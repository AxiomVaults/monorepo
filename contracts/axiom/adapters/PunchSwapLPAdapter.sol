// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/external/IPunchSwapV2Pair.sol";
import "../interfaces/external/IPunchSwapV2Router.sol";
import "../interfaces/external/IWFLOW.sol";

/// @title PunchSwapLPAdapter
/// @notice Yield adapter: provides liquidity to the ankrFLOW/WFLOW pool on PunchSwap V2
///         and earns swap fees from the pair.
///
/// @dev Capital flow (deposit):
///      WFLOW from caller → split half → swap half to ankrFLOW via router
///      → router.addLiquidity(WFLOW, ankrFLOW) → LP tokens held here
///      Any dust WFLOW or ankrFLOW remaining after addLiquidity is kept and counted
///      in totalUnderlying().
///
/// @dev Capital flow (withdraw):
///      Calculate LP share proportional to requested WFLOW value
///      → router.removeLiquidity() → receive WFLOW + ankrFLOW
///      → swap received ankrFLOW back to WFLOW via router
///      → forward total WFLOW to caller
///
/// @dev Yield source:
///      PunchSwap charges 0.3% per swap, distributed pro-rata to LP providers.
///      The ankrFLOW/WFLOW price band is historically tight (~1.083-1.119 over 18 months),
///      resulting in minimal impermanent loss and reliable fee accumulation.
///
/// @dev totalUnderlying() accounts for:
///      - LP tokens: valued as proportional share of pool reserves (converted to WFLOW)
///      - Dust WFLOW held in this contract after add/remove liquidity rounding
///      - Dust ankrFLOW held in this contract (converted to WFLOW via getAmountsOut)
///
/// @custom:security nonReentrant on all state-mutating calls; maxSlippageBps guards swaps.
contract PunchSwapLPAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAmount();
    error ZeroAddress();
    error SlippageTooHigh(uint256 provided, uint256 max);
    error InsufficientOutput(uint256 minExpected, uint256 received);
    error NothingToWithdraw();
    error WithdrawExceedsPosition(uint256 requested, uint256 available);

    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposited(address indexed caller, uint256 wflowIn, uint256 lpMinted);
    event Withdrew(address indexed caller, uint256 wflowOut, uint256 lpBurned);

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_SLIPPAGE_BPS  = 500;  // 5% hard cap
    uint256 public constant BPS_DENOMINATOR   = 10_000;
    uint256 public constant SWAP_DEADLINE     = 10 minutes;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice WFLOW — base asset accepted and returned
    IERC20 public immutable wflow;

    /// @notice ankrFLOW — the other token in the LP pair
    IERC20 public immutable ankrFlow;

    /// @notice The ankrFLOW/WFLOW PunchSwap V2 LP pair
    IPunchSwapV2Pair public immutable pair;

    /// @notice PunchSwap V2 router
    IPunchSwapV2Router public immutable router;

    /// @notice Max allowed slippage on swaps and add/remove liquidity (bps)
    uint256 public maxSlippageBps;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param wflow_          WFLOW address (Flow EVM: 0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e)
    /// @param ankrFlow_       ankrFLOW address (Flow EVM: 0x1b97100eA1D7126C4d60027e231EA4CB25314bdb)
    /// @param pair_           ankrFLOW/WFLOW PunchSwap pair (Flow EVM: 0x7854498d4d1b2970fcb4e6960ddf782a68463a43)
    /// @param router_         PunchSwap V2 router (Flow EVM: 0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d)
    /// @param maxSlippageBps_ Initial max swap slippage (e.g. 100 = 1%)
    constructor(
        address wflow_,
        address ankrFlow_,
        address pair_,
        address router_,
        uint256 maxSlippageBps_
    ) {
        if (wflow_ == address(0)) revert ZeroAddress();
        if (ankrFlow_ == address(0)) revert ZeroAddress();
        if (pair_ == address(0)) revert ZeroAddress();
        if (router_ == address(0)) revert ZeroAddress();
        if (maxSlippageBps_ > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(maxSlippageBps_, MAX_SLIPPAGE_BPS);

        wflow          = IERC20(wflow_);
        ankrFlow       = IERC20(ankrFlow_);
        pair           = IPunchSwapV2Pair(pair_);
        router         = IPunchSwapV2Router(router_);
        maxSlippageBps = maxSlippageBps_;
    }

    // ─── IYieldAdapter ────────────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Splits WFLOW approximately 50/50 by value: swaps half to ankrFLOW,
    ///      then calls addLiquidity. Dust stays in this contract (counted in totalUnderlying).
    function deposit(uint256 amount) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Pull WFLOW from caller
        wflow.safeTransferFrom(msg.sender, address(this), amount);

        // ── Step 1: Swap half WFLOW to ankrFLOW ─────────────────────────────
        uint256 wflowToSwap = amount / 2;
        uint256 ankrReceived = _swapWFLOWForAnkr(wflowToSwap);

        // ── Step 2: Add liquidity with remaining WFLOW + ankrFLOW received ──
        uint256 wflowForLP = wflow.balanceOf(address(this)) - _dustWFLOW(); // remaining after swap
        // Correct: use balance rather than amount-wflowToSwap to capture any swap excess
        wflowForLP = amount - wflowToSwap; // = half we kept

        uint256 ankrForLP  = ankrReceived;

        uint256 wflowMin = (wflowForLP * (BPS_DENOMINATOR - maxSlippageBps)) / BPS_DENOMINATOR;
        uint256 ankrMin  = (ankrForLP  * (BPS_DENOMINATOR - maxSlippageBps)) / BPS_DENOMINATOR;

        wflow.safeIncreaseAllowance(address(router), wflowForLP);
        ankrFlow.safeIncreaseAllowance(address(router), ankrForLP);

        (, , uint256 lpMinted) = router.addLiquidity(
            address(wflow),
            address(ankrFlow),
            wflowForLP,
            ankrForLP,
            wflowMin,
            ankrMin,
            address(this),
            block.timestamp + SWAP_DEADLINE
        );

        emit Deposited(msg.sender, amount, lpMinted);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Withdraws WFLOW-equivalent value from the LP position.
    ///      Calculates LP tokens to burn proportional to the requested WFLOW value,
    ///      removes liquidity, swaps ankrFLOW back to WFLOW, transfers total to caller.
    function withdraw(uint256 amount) external override onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 lpBalance = pair.balanceOf(address(this));
        if (lpBalance == 0) revert NothingToWithdraw();

        uint256 totalVal = _lpValueInWFLOW(lpBalance);
        if (amount > totalVal) revert WithdrawExceedsPosition(amount, totalVal);

        // LP tokens proportional to requested WFLOW fraction
        uint256 lpToBurn = (lpBalance * amount) / totalVal;
        if (lpToBurn == 0) lpToBurn = 1; // avoid zero-lp edge case

        uint256 wflowOut = _removeLPAndConsolidate(lpToBurn);

        wflow.safeTransfer(msg.sender, wflowOut);
        emit Withdrew(msg.sender, wflowOut, lpToBurn);
    }

    /// @inheritdoc IYieldAdapter
    function withdrawAll() external override onlyOwner nonReentrant returns (uint256 total) {
        uint256 lpBalance = pair.balanceOf(address(this));
        if (lpBalance == 0) {
            // No LP but may have dust
            total = wflow.balanceOf(address(this));
            // Sell any ankrFLOW dust
            uint256 ankrDust = ankrFlow.balanceOf(address(this));
            if (ankrDust > 0) {
                total += _swapAnkrForWFLOW(ankrDust);
            }
            if (total > 0) wflow.safeTransfer(msg.sender, total);
            emit Withdrew(msg.sender, total, 0);
            return total;
        }

        total = _removeLPAndConsolidate(lpBalance);
        wflow.safeTransfer(msg.sender, total);
        emit Withdrew(msg.sender, total, lpBalance);
    }

    // ─── IYieldAdapter: View ──────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Sums: (LP share of pool reserves → WFLOW) + dust WFLOW + dust ankrFLOW (→ WFLOW).
    function totalUnderlying() external view override returns (uint256) {
        uint256 lpBalance = pair.balanceOf(address(this));
        uint256 lpValue   = lpBalance > 0 ? _lpValueInWFLOW(lpBalance) : 0;

        // Add dust balances
        uint256 dustWFLOW    = wflow.balanceOf(address(this));
        uint256 dustAnkr     = ankrFlow.balanceOf(address(this));
        uint256 dustAnkrWFLO = 0;
        if (dustAnkr > 0) {
            try router.getAmountsOut(dustAnkr, _path(address(ankrFlow), address(wflow))) returns (uint256[] memory amounts) {
                dustAnkrWFLO = amounts[1];
            } catch {}
        }

        return lpValue + dustWFLOW + dustAnkrWFLO;
    }

    /// @inheritdoc IYieldAdapter
    function baseAsset() external view override returns (address) {
        return address(wflow);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        if (bps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(bps, MAX_SLIPPAGE_BPS);
        maxSlippageBps = bps;
    }

    function rescueToken(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Swap `wflowIn` WFLOW for ankrFLOW via PunchSwap. Returns ankrFLOW received.
    function _swapWFLOWForAnkr(uint256 wflowIn) internal returns (uint256) {
        uint256[] memory amountsOut = router.getAmountsOut(wflowIn, _path(address(wflow), address(ankrFlow)));
        uint256 minOut = (amountsOut[1] * (BPS_DENOMINATOR - maxSlippageBps)) / BPS_DENOMINATOR;

        wflow.safeIncreaseAllowance(address(router), wflowIn);
        uint256[] memory result = router.swapExactTokensForTokens(
            wflowIn, minOut,
            _path(address(wflow), address(ankrFlow)),
            address(this),
            block.timestamp + SWAP_DEADLINE
        );
        return result[1];
    }

    /// @dev Swap `ankrIn` ankrFLOW for WFLOW via PunchSwap. Returns WFLOW received.
    function _swapAnkrForWFLOW(uint256 ankrIn) internal returns (uint256) {
        if (ankrIn == 0) return 0;
        uint256[] memory amountsOut = router.getAmountsOut(ankrIn, _path(address(ankrFlow), address(wflow)));
        uint256 minOut = (amountsOut[1] * (BPS_DENOMINATOR - maxSlippageBps)) / BPS_DENOMINATOR;

        ankrFlow.safeIncreaseAllowance(address(router), ankrIn);
        uint256[] memory result = router.swapExactTokensForTokens(
            ankrIn, minOut,
            _path(address(ankrFlow), address(wflow)),
            address(this),
            block.timestamp + SWAP_DEADLINE
        );
        return result[1];
    }

    /// @dev Remove `lpAmount` LP tokens and consolidate all to WFLOW. Returns WFLOW received.
    function _removeLPAndConsolidate(uint256 lpAmount) internal returns (uint256) {
        // Approve pair to pull LP
        pair.approve(address(router), lpAmount);

        (uint256 wflowFromLP, uint256 ankrFromLP) = router.removeLiquidity(
            address(wflow),
            address(ankrFlow),
            lpAmount,
            0, // accept any amount (slippage checked below via minOut on swap)
            0,
            address(this),
            block.timestamp + SWAP_DEADLINE
        );

        // Swap all received ankrFLOW back to WFLOW
        uint256 wflowFromSwap = ankrFromLP > 0 ? _swapAnkrForWFLOW(ankrFromLP) : 0;

        return wflowFromLP + wflowFromSwap;
    }

    /// @dev Compute the WFLOW-equivalent value of `lpAmount` LP tokens using current reserves.
    function _lpValueInWFLOW(uint256 lpAmount) internal view returns (uint256) {
        if (lpAmount == 0) return 0;

        uint256 totalLP = pair.totalSupply();
        if (totalLP == 0) return 0;

        (uint112 r0, uint112 r1,) = pair.getReserves();
        address token0 = pair.token0();

        uint256 reserveWFLOW  = token0 == address(wflow) ? uint256(r0) : uint256(r1);
        uint256 reserveAnkr   = token0 == address(wflow) ? uint256(r1) : uint256(r0);

        // My share of pool
        uint256 myWFLOW = (reserveWFLOW * lpAmount) / totalLP;
        uint256 myAnkr  = (reserveAnkr  * lpAmount) / totalLP;

        // Convert ankrFLOW portion to WFLOW
        uint256 ankrAsWFLOW = 0;
        if (myAnkr > 0) {
            try router.getAmountsOut(myAnkr, _path(address(ankrFlow), address(wflow))) returns (uint256[] memory amounts) {
                ankrAsWFLOW = amounts[1];
            } catch {
                // If quote fails, use raw ankr amount as approximate (conservative)
                ankrAsWFLOW = myAnkr;
            }
        }

        return myWFLOW + ankrAsWFLOW;
    }

    /// @dev Returns WFLOW balance in this contract that isn't LP-related (dust tracking).
    function _dustWFLOW() internal view returns (uint256) {
        return wflow.balanceOf(address(this));
    }

    /// @dev Build a 2-hop swap path array.
    function _path(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }
}
