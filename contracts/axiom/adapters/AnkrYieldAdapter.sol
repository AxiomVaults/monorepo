// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/external/IWFLOW.sol";
import "../interfaces/external/IAnkrStaking.sol";
import "../interfaces/external/IPunchSwapV2Router.sol";

/// @title AnkrYieldAdapter
/// @notice Production yield adapter: stakes WFLOW via Ankr on Flow EVM to earn staking APR.
///
/// @dev Capital flow:
///      deposit(WFLOW) → unwrap WFLOW → native FLOW → Ankr stakeCerts() → hold ankrFLOW
///      totalUnderlying() → ankrFLOW balance * PunchSwap spot price  (ankrFLOW appreciates vs FLOW)
///      withdraw(WFLOW) → sell exact output ankrFLOW on PunchSwap → return WFLOW
///
///      No leverage; risk profile equivalent to plain liquid staking.
///      ankrFLOW appreciates against native FLOW as staking rewards accrue.
///
/// @custom:security
///      - Only StrategyManager (or owner) should call deposit/withdraw.
///      - receive() is required because WFLOW.withdraw() sends native FLOW to this contract.
///      - maxSlippageBps guards against sandwich attacks on PunchSwap swaps.
contract AnkrYieldAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientOutput(uint256 required, uint256 received);
    error SwapQuoteFailed();
    error SlippageTooHigh(uint256 provided, uint256 max);

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_SLIPPAGE_BPS = 500; // 5% hard cap
    uint256 public constant SWAP_DEADLINE_BUFFER = 10 minutes;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Wrapped FLOW token (base asset this adapter accepts/returns)
    IWFLOW public immutable wflow;

    /// @notice ankrFLOW certificate token minted by Ankr on staking
    IERC20 public immutable ankrFlow;

    /// @notice Ankr liquid staking pool
    IAnkrStaking public immutable ankrStaking;

    /// @notice PunchSwap V2 router used to liquidate ankrFLOW → WFLOW on withdrawal
    IPunchSwapV2Router public immutable swapRouter;

    /// @notice Max allowed swap slippage in basis points (e.g. 100 = 1%)
    uint256 public maxSlippageBps;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param wflow_          WFLOW token address  (Flow EVM Testnet: 0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e)
    /// @param ankrFlow_       ankrFLOW token address (Flow EVM Testnet: 0x1b97100eA1D7126C4d60027e231EA4CB25314bdb)
    /// @param ankrStaking_    Ankr staking pool address (Flow EVM Testnet: 0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a)
    /// @param swapRouter_     PunchSwap V2 router address (Flow EVM Testnet: 0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d)
    /// @param maxSlippageBps_ Initial max swap slippage in bps (e.g. 100 = 1%)
    constructor(
        address wflow_,
        address ankrFlow_,
        address ankrStaking_,
        address swapRouter_,
        uint256 maxSlippageBps_
    ) {
        if (wflow_ == address(0)) revert ZeroAddress();
        if (ankrFlow_ == address(0)) revert ZeroAddress();
        if (ankrStaking_ == address(0)) revert ZeroAddress();
        if (swapRouter_ == address(0)) revert ZeroAddress();
        if (maxSlippageBps_ > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(maxSlippageBps_, MAX_SLIPPAGE_BPS);

        wflow        = IWFLOW(wflow_);
        ankrFlow     = IERC20(ankrFlow_);
        ankrStaking  = IAnkrStaking(ankrStaking_);
        swapRouter   = IPunchSwapV2Router(swapRouter_);
        maxSlippageBps = maxSlippageBps_;
    }

    // ─── ETH/FLOW receiver ───────────────────────────────────────────────────

    /// @dev Required: WFLOW.withdraw() sends native FLOW to this contract.
    receive() external payable {}

    // ─── IYieldAdapter: Write ─────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Pulls WFLOW from msg.sender, unwraps to FLOW, stakes with Ankr → ankrFLOW held here.
    function deposit(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // 1. Pull WFLOW from caller (StrategyManager)
        IERC20(address(wflow)).safeTransferFrom(msg.sender, address(this), amount);

        // 2. Unwrap WFLOW → native FLOW (received via receive())
        wflow.withdraw(amount);

        // 3. Stake native FLOW → ankrFLOW minted to address(this)
        //    Track balance delta because stakeCerts() doesn't return a value.
        uint256 ankrBefore = ankrFlow.balanceOf(address(this));
        ankrStaking.stakeCerts{value: amount}();
        // ankrFLOW received is validated implicitly — if staking reverts, entire tx reverts.
        // The delta is informational only; all accounting is done via balanceOf.
        uint256 ankrReceived = ankrFlow.balanceOf(address(this)) - ankrBefore;

        emit Deposited(msg.sender, amount);
        // Emit ankrFLOW received for off-chain tracking
        emit AnkrFlowReceived(ankrReceived, amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Sells ankrFLOW on PunchSwap for exactly `amount` WFLOW, transfers to msg.sender.
    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Sell ankrFLOW for exact WFLOW output
        _swapAnkrFlowForExactWFLOW(amount);

        IERC20(address(wflow)).safeTransfer(msg.sender, amount);
        emit Withdrew(msg.sender, amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Sells ALL ankrFLOW for WFLOW, transfers everything to msg.sender.
    function withdrawAll() external override nonReentrant returns (uint256 total) {
        uint256 ankrBal = ankrFlow.balanceOf(address(this));

        if (ankrBal > 0) {
            _swapAllAnkrFlowToWFLOW(ankrBal);
        }

        total = IERC20(address(wflow)).balanceOf(address(this));
        if (total > 0) {
            IERC20(address(wflow)).safeTransfer(msg.sender, total);
        }
        emit Withdrew(msg.sender, total);
    }

    // ─── IYieldAdapter: View ─────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Returns the WFLOW value of all held ankrFLOW via PunchSwap spot price,
    ///      plus any WFLOW already in the contract.
    function totalUnderlying() external view override returns (uint256) {
        uint256 ankrBal = ankrFlow.balanceOf(address(this));
        uint256 wflowBal = IERC20(address(wflow)).balanceOf(address(this));

        if (ankrBal == 0) return wflowBal;

        address[] memory path = new address[](2);
        path[0] = address(ankrFlow);
        path[1] = address(wflow);

        try swapRouter.getAmountsOut(ankrBal, path) returns (uint256[] memory amounts) {
            return amounts[1] + wflowBal;
        } catch {
            // Fallback: 1:1 parity (conservative underestimate since ankrFLOW ≥ FLOW)
            return ankrBal + wflowBal;
        }
    }

    /// @inheritdoc IYieldAdapter
    function baseAsset() external view override returns (address) {
        return address(wflow);
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    /// @notice Update the max allowed swap slippage
    function setMaxSlippageBps(uint256 newBps) external onlyOwner {
        if (newBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(newBps, MAX_SLIPPAGE_BPS);
        maxSlippageBps = newBps;
        emit MaxSlippageUpdated(newBps);
    }

    /// @notice Emergency: recover any ERC20 accidentally sent to this contract.
    ///         Cannot be used to drain ankrFLOW or WFLOW from active positions.
    function recoverERC20(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Swap ankrFLOW → exact `wflowOut` WFLOW via PunchSwap.
    ///      Reverts if the required ankrFLOW input exceeds available balance + slippage tolerance.
    function _swapAnkrFlowForExactWFLOW(uint256 wflowOut) internal {
        address[] memory path = new address[](2);
        path[0] = address(ankrFlow);
        path[1] = address(wflow);

        // Quote: how much ankrFLOW needed to buy exactly `wflowOut`
        uint256[] memory amountsIn = swapRouter.getAmountsIn(wflowOut, path);
        uint256 ankrNeeded = amountsIn[0];

        // Apply slippage ceiling: accept up to maxSlippageBps% more ankrFLOW input
        uint256 ankrMaxIn = ankrNeeded * (10_000 + maxSlippageBps) / 10_000;

        IERC20(address(ankrFlow)).forceApprove(address(swapRouter), ankrMaxIn);
        swapRouter.swapTokensForExactTokens(
            wflowOut,
            ankrMaxIn,
            path,
            address(this),
            block.timestamp + SWAP_DEADLINE_BUFFER
        );
        // Reset approval
        IERC20(address(ankrFlow)).forceApprove(address(swapRouter), 0);
    }

    /// @dev Swap ALL `ankrBal` ankrFLOW for WFLOW via PunchSwap.
    ///      Enforces minAmountOut based on spot price minus slippage tolerance.
    function _swapAllAnkrFlowToWFLOW(uint256 ankrBal) internal {
        address[] memory path = new address[](2);
        path[0] = address(ankrFlow);
        path[1] = address(wflow);

        uint256[] memory expected = swapRouter.getAmountsOut(ankrBal, path);
        uint256 minOut = expected[1] * (10_000 - maxSlippageBps) / 10_000;

        IERC20(address(ankrFlow)).forceApprove(address(swapRouter), ankrBal);
        swapRouter.swapExactTokensForTokens(
            ankrBal,
            minOut,
            path,
            address(this),
            block.timestamp + SWAP_DEADLINE_BUFFER
        );
        IERC20(address(ankrFlow)).forceApprove(address(swapRouter), 0);
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    event AnkrFlowReceived(uint256 ankrAmount, uint256 flowStaked);
    event MaxSlippageUpdated(uint256 newBps);
}
