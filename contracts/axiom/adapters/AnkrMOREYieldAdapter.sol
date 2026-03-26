// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/external/IWFLOW.sol";
import "../interfaces/external/IAnkrStaking.sol";
import "../interfaces/external/IMorePool.sol";
import "../interfaces/external/IMorePoolDataProvider.sol";
import "../interfaces/external/IPunchSwapV2Router.sol";

/// @title AnkrMOREYieldAdapter
/// @notice Production yield adapter: 1-loop leveraged Ankr staking + MORE lending on Flow EVM.
///
/// @dev Capital flow (deposit):
///      WFLOW → unwrap → FLOW → Ankr.stakeCerts() → ankrFLOW
///      → MORE.supply(ankrFLOW) → MORE.borrow(WFLOW, borrowFractionBps% of capacity)
///      → borrowed WFLOW held in this contract as a repayment buffer
///
///      Position accounting:
///        totalUnderlying = PunchSwap(ankrFLOW in MORE → WFLOW) - WFLOW debt + WFLOW buffer
///
///      Capital flow (withdraw):
///      proportional repay WFLOW debt from buffer
///      → MORE.withdraw(proportional ankrFLOW)
///      → PunchSwap(ankrFLOW → WFLOW)
///      → return WFLOW to caller
///
///      Yield sources:
///        1. ankrFLOW appreciates vs FLOW (Ankr staking APR, ~8% on testnet)
///        2. aToken supply yield from MORE market
///        3. Leveraged exposure: net APR ≈ (ankrAPR × collateral) - (borrowAPR × debt) / principal
///
///      Risk: health factor monitored off-chain; operator must inject WFLOW buffer
///      if borrow interest erodes buffer below outstanding debt (via injectWFLOWBuffer).
///
/// @custom:security nonReentrant on all state-mutating calls; receive() required for WFLOW unwrap.
contract AnkrMOREYieldAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientWFLOWBuffer(uint256 debtToRepay, uint256 bufferAvailable);
    error InsufficientOutputAfterSwap(uint256 required, uint256 received);
    error SlippageTooHigh(uint256 provided, uint256 max);
    error BorrowFractionTooHigh(uint256 provided, uint256 max);
    error PositionUnderwater();

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_SLIPPAGE_BPS    = 500;   // 5% hard cap on swap slippage
    uint256 public constant MAX_BORROW_FRAC_BPS = 8_500; // 85% of available borrows max
    uint256 public constant SWAP_DEADLINE       = 10 minutes;
    uint256 public constant PRICE_QUERY_UNIT    = 1e18;  // 1 WFLOW for oracle price query

    // ─── Immutables ──────────────────────────────────────────────────────────

    /// @notice Wrapped FLOW — base asset this adapter accepts and returns
    IWFLOW public immutable wflow;

    /// @notice ankrFLOW certificate token
    IERC20 public immutable ankrFlow;

    /// @notice Ankr staking pool (Flow EVM Testnet: 0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a)
    IAnkrStaking public immutable ankrStaking;

    /// @notice MORE lending pool (Flow EVM Testnet: 0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d)
    IMorePool public immutable morePool;

    /// @notice MORE data provider (Flow EVM Testnet: 0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf)
    IMorePoolDataProvider public immutable moreDataProvider;

    /// @notice PunchSwap V2 router (Flow EVM Testnet: 0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d)
    IPunchSwapV2Router public immutable swapRouter;

    /// @notice stgUSDC — used as USD oracle reference via PunchSwap
    ///         (Flow EVM Testnet: 0xF1815bd50389c46847f0Bda824eC8da914045D14)
    address public immutable stgUSDC;

    // ─── Mutable state ────────────────────────────────────────────────────────

    /// @notice Fraction of available borrow capacity to utilise per deposit (bps, e.g. 6000 = 60%)
    uint256 public borrowFractionBps;

    /// @notice Max allowed PunchSwap slippage on ankrFLOW → WFLOW swaps (bps)
    uint256 public maxSlippageBps;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address wflow_,
        address ankrFlow_,
        address ankrStaking_,
        address morePool_,
        address moreDataProvider_,
        address swapRouter_,
        address stgUSDC_,
        uint256 borrowFractionBps_,
        uint256 maxSlippageBps_
    ) {
        if (wflow_ == address(0))           revert ZeroAddress();
        if (ankrFlow_ == address(0))        revert ZeroAddress();
        if (ankrStaking_ == address(0))     revert ZeroAddress();
        if (morePool_ == address(0))        revert ZeroAddress();
        if (moreDataProvider_ == address(0)) revert ZeroAddress();
        if (swapRouter_ == address(0))      revert ZeroAddress();
        if (stgUSDC_ == address(0))         revert ZeroAddress();
        if (borrowFractionBps_ > MAX_BORROW_FRAC_BPS) revert BorrowFractionTooHigh(borrowFractionBps_, MAX_BORROW_FRAC_BPS);
        if (maxSlippageBps_ > MAX_SLIPPAGE_BPS)       revert SlippageTooHigh(maxSlippageBps_, MAX_SLIPPAGE_BPS);

        wflow            = IWFLOW(wflow_);
        ankrFlow         = IERC20(ankrFlow_);
        ankrStaking      = IAnkrStaking(ankrStaking_);
        morePool         = IMorePool(morePool_);
        moreDataProvider = IMorePoolDataProvider(moreDataProvider_);
        swapRouter       = IPunchSwapV2Router(swapRouter_);
        stgUSDC          = stgUSDC_;
        borrowFractionBps = borrowFractionBps_;
        maxSlippageBps   = maxSlippageBps_;
    }

    // ─── ETH/FLOW receiver ───────────────────────────────────────────────────

    /// @dev Required: WFLOW.withdraw() sends native FLOW to this contract before staking.
    receive() external payable {}

    // ─── IYieldAdapter: Write ─────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Full deposit flow:
    ///   1. Pull WFLOW from caller
    ///   2. Unwrap WFLOW → native FLOW
    ///   3. Stake FLOW with Ankr → ankrFLOW
    ///   4. Supply ankrFLOW to MORE
    ///   5. Borrow borrowFractionBps% of available borrowing capacity in WFLOW
    ///      (borrowed WFLOW is kept in this contract as a repayment buffer)
    function deposit(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // ── Step 1: Pull WFLOW from StrategyManager ───────────────────────────
        IERC20(address(wflow)).safeTransferFrom(msg.sender, address(this), amount);

        // ── Step 2: Unwrap WFLOW → native FLOW ───────────────────────────────
        wflow.withdraw(amount);

        // ── Step 3: Stake FLOW → ankrFLOW ────────────────────────────────────
        uint256 ankrBefore = ankrFlow.balanceOf(address(this));
        ankrStaking.stakeCerts{value: amount}();
        uint256 ankrReceived = ankrFlow.balanceOf(address(this)) - ankrBefore;

        // ── Step 4: Supply ankrFLOW to MORE ──────────────────────────────────
        IERC20(address(ankrFlow)).forceApprove(address(morePool), ankrReceived);
        morePool.supply(address(ankrFlow), ankrReceived, address(this), 0);
        IERC20(address(ankrFlow)).forceApprove(address(morePool), 0);

        // ── Step 5: Borrow WFLOW (leverage buffer) ────────────────────────────
        uint256 wflowToBorrow = _calcWFLOWToBorrow();
        if (wflowToBorrow > 0) {
            morePool.borrow(address(wflow), wflowToBorrow, 2, 0, address(this));
            // Borrowed WFLOW stays in this contract as the repayment buffer.
        }

        emit Deposited(msg.sender, amount);
        emit LeverageApplied(ankrReceived, wflowToBorrow);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Proportional unwind:
    ///   1. Calculate share fraction = amount / totalUnderlying
    ///   2. Repay proportional WFLOW debt from the in-contract WFLOW buffer
    ///   3. Withdraw proportional ankrFLOW from MORE
    ///   4. Sell ankrFLOW for WFLOW on PunchSwap
    ///   5. Transfer `amount` WFLOW to caller
    ///
    ///   Reverts with InsufficientWFLOWBuffer if interest accrual has eroded
    ///   the buffer below the proportional debt — operator must call injectWFLOWBuffer first.
    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();

        (uint256 ankrInMORE, uint256 wflowDebt) = _getMorePosition();
        uint256 wflowBuf = IERC20(address(wflow)).balanceOf(address(this));
        uint256 total = _computeTotal(ankrInMORE, wflowDebt, wflowBuf);

        // Fraction in 1e18 fixed-point
        uint256 fraction = amount * 1e18 / total;

        uint256 debtToRepay      = wflowDebt * fraction / 1e18;
        uint256 ankrToWithdraw   = ankrInMORE * fraction / 1e18;

        // Ensure buffer covers the proportional debt repayment
        if (wflowBuf < debtToRepay) {
            revert InsufficientWFLOWBuffer(debtToRepay, wflowBuf);
        }

        // ── Repay proportional WFLOW debt ─────────────────────────────────────
        if (debtToRepay > 0) {
            IERC20(address(wflow)).forceApprove(address(morePool), debtToRepay);
            morePool.repay(address(wflow), debtToRepay, 2, address(this));
            IERC20(address(wflow)).forceApprove(address(morePool), 0);
        }

        // ── Withdraw proportional ankrFLOW from MORE ──────────────────────────
        if (ankrToWithdraw > 0) {
            morePool.withdraw(address(ankrFlow), ankrToWithdraw, address(this));
        }

        // ── Sell ankrFLOW for WFLOW ───────────────────────────────────────────
        uint256 ankrHeld = ankrFlow.balanceOf(address(this));
        if (ankrHeld > 0) {
            _swapAllAnkrFlowToWFLOW(ankrHeld);
        }

        // ── Transfer exactly `amount` to caller ───────────────────────────────
        uint256 wflowNow = IERC20(address(wflow)).balanceOf(address(this));
        // (wflowNow includes remaining buffer + proceeds from swap, minus the repaid portion)
        if (wflowNow < amount) {
            revert InsufficientOutputAfterSwap(amount, wflowNow);
        }
        IERC20(address(wflow)).safeTransfer(msg.sender, amount);

        emit Withdrew(msg.sender, amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Full unwind: repay all debt then sell all ankrFLOW.
    ///      Reverts with InsufficientWFLOWBuffer if borrow interest has outgrown the buffer;
    ///      in that case the operator should call injectWFLOWBuffer before calling withdrawAll.
    function withdrawAll() external override nonReentrant returns (uint256 total) {
        (uint256 ankrInMORE, uint256 wflowDebt) = _getMorePosition();
        uint256 wflowBuf = IERC20(address(wflow)).balanceOf(address(this));

        // ── Repay all WFLOW debt using the in-contract buffer ─────────────────
        if (wflowDebt > 0) {
            if (wflowBuf < wflowDebt) {
                revert InsufficientWFLOWBuffer(wflowDebt, wflowBuf);
            }
            IERC20(address(wflow)).forceApprove(address(morePool), wflowDebt);
            morePool.repay(address(wflow), type(uint256).max, 2, address(this));
            IERC20(address(wflow)).forceApprove(address(morePool), 0);
        }

        // ── Withdraw ALL ankrFLOW from MORE ───────────────────────────────────
        if (ankrInMORE > 0) {
            morePool.withdraw(address(ankrFlow), type(uint256).max, address(this));
        }

        // ── Sell all ankrFLOW → WFLOW ─────────────────────────────────────────
        uint256 ankrHeld = ankrFlow.balanceOf(address(this));
        if (ankrHeld > 0) {
            _swapAllAnkrFlowToWFLOW(ankrHeld);
        }

        // ── Return everything ─────────────────────────────────────────────────
        total = IERC20(address(wflow)).balanceOf(address(this));
        if (total > 0) {
            IERC20(address(wflow)).safeTransfer(msg.sender, total);
        }

        emit Withdrew(msg.sender, total);
    }

    // ─── IYieldAdapter: View ─────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev total = PunchSwap(ankrFLOW in MORE → WFLOW) − WFLOW debt + WFLOW buffer in adapter
    function totalUnderlying() external view override returns (uint256) {
        (uint256 ankrInMORE, uint256 wflowDebt) = _getMorePosition();
        uint256 wflowBuf = IERC20(address(wflow)).balanceOf(address(this));
        return _computeTotal(ankrInMORE, wflowDebt, wflowBuf);
    }

    /// @inheritdoc IYieldAdapter
    function baseAsset() external view override returns (address) {
        return address(wflow);
    }

    // ─── Owner: Config ────────────────────────────────────────────────────────

    function setBorrowFractionBps(uint256 newBps) external onlyOwner {
        if (newBps > MAX_BORROW_FRAC_BPS) revert BorrowFractionTooHigh(newBps, MAX_BORROW_FRAC_BPS);
        borrowFractionBps = newBps;
        emit BorrowFractionUpdated(newBps);
    }

    function setMaxSlippageBps(uint256 newBps) external onlyOwner {
        if (newBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(newBps, MAX_SLIPPAGE_BPS);
        maxSlippageBps = newBps;
        emit MaxSlippageUpdated(newBps);
    }

    /// @notice Operator injects WFLOW into the contract to top up the repayment buffer.
    ///         Required when borrow interest has accrued beyond the initial buffer.
    function injectWFLOWBuffer(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        IERC20(address(wflow)).safeTransferFrom(msg.sender, address(this), amount);
        emit BufferInjected(amount);
    }

    /// @notice View current MORE health factor for this adapter's position (1e18 = 1.0).
    function healthFactor() external view returns (uint256 hf) {
        (,,,,, hf) = morePool.getUserAccountData(address(this));
    }

    function recoverERC20(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Read ankrFLOW aToken balance and variable WFLOW debt from MORE data provider.
    function _getMorePosition()
        internal
        view
        returns (uint256 ankrInMORE, uint256 wflowDebt)
    {
        (ankrInMORE,,,,,,,,) = moreDataProvider.getUserReserveData(address(ankrFlow), address(this));
        (,, wflowDebt,,,,,,) = moreDataProvider.getUserReserveData(address(wflow),    address(this));
    }

    /// @dev Compute total WFLOW-equivalent value of the position.
    function _computeTotal(
        uint256 ankrInMORE,
        uint256 wflowDebt,
        uint256 wflowBuf
    ) internal view returns (uint256) {
        if (ankrInMORE == 0) return wflowBuf;

        address[] memory path = new address[](2);
        path[0] = address(ankrFlow);
        path[1] = address(wflow);

        uint256 ankrValueInWflow;
        try swapRouter.getAmountsOut(ankrInMORE, path) returns (uint256[] memory amounts) {
            ankrValueInWflow = amounts[1];
        } catch {
            ankrValueInWflow = ankrInMORE; // 1:1 fallback
        }

        // Guard against underwater position returning 0 instead of underflowing
        uint256 gross = ankrValueInWflow + wflowBuf;
        if (gross <= wflowDebt) return 0;
        return gross - wflowDebt;
    }

    /// @dev Determine how much WFLOW to borrow after supplying ankrFLOW to MORE.
    ///      Uses PunchSwap to convert the USD oracle "availableBorrows" into WFLOW units.
    function _calcWFLOWToBorrow() internal view returns (uint256) {
        (,, uint256 availBorrowsBase,,,) = morePool.getUserAccountData(address(this));
        if (availBorrowsBase == 0) return 0;

        // Get WFLOW price: swap 1 WFLOW → stgUSDC on PunchSwap (stgUSDC is 6 decimals)
        address[] memory path = new address[](2);
        path[0] = address(wflow);
        path[1] = stgUSDC;

        try swapRouter.getAmountsOut(PRICE_QUERY_UNIT, path) returns (uint256[] memory amounts) {
            if (amounts[1] == 0) return 0;
            // Convert stgUSDC (6 dec) → 8-decimal oracle base units (same as availBorrowsBase)
            uint256 wflowPriceBase8 = amounts[1] * 100;
            // WFLOW borrowable = availBorrows(USD, 8dec) × 1e18 / wflowPrice(USD, 8dec)
            uint256 maxBorrowWflow = availBorrowsBase * 1e18 / wflowPriceBase8;
            return maxBorrowWflow * borrowFractionBps / 10_000;
        } catch {
            return 0; // If price query fails, skip borrows (safe default)
        }
    }

    /// @dev Swap all `ankrBal` ankrFLOW → WFLOW, enforcing maxSlippageBps.
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
            block.timestamp + SWAP_DEADLINE
        );
        IERC20(address(ankrFlow)).forceApprove(address(swapRouter), 0);
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    event LeverageApplied(uint256 ankrFlowSupplied, uint256 wflowBorrowed);
    event BorrowFractionUpdated(uint256 newBps);
    event MaxSlippageUpdated(uint256 newBps);
    event BufferInjected(uint256 amount);
}
