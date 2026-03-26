// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRedemptionAdapter.sol";
import "../interfaces/external/IPunchSwapV2Router.sol";

/// @title AnkrRedemptionAdapter
/// @notice Production redemption adapter: accepts ankrFLOW, swaps it to WFLOW via PunchSwap,
///         and releases the WFLOW after a configurable claim delay.
///
/// @dev Flow:
///   requestRedemption(ankrFLOW, amount)
///     → pull ankrFLOW from caller
///     → swap ankrFLOW → WFLOW on PunchSwap (immediate, spot price − slippage)
///     → store {requester, baseAmount(WFLOW received), timestamp}
///     → return requestId
///
///   claimRedemption(requestId)
///     → check claimDelay elapsed
///     → transfer baseAmount WFLOW to msg.sender
///
///   The swap is executed at request time so that:
///     - The WFLOW value is locked in at market price when the request is made
///     - Claims always succeed (no slippage risk at claim time)
///     - The adapter always has exactly the right WFLOW for each pending claim
///
/// @custom:note
///   In a future version this can be upgraded to use the Ankr on-chain unstaking
///   queue once the unbonding ABI is confirmed stable on Flow EVM mainnet.
contract AnkrRedemptionAdapter is IRedemptionAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error UnsupportedAsset(address got, address expected);
    error RequestNotFound(uint256 requestId);
    error AlreadyClaimed(uint256 requestId);
    error ClaimDelayNotMet(uint256 requestId, uint64 claimableAt);
    error ZeroAmount();
    error ZeroAddress();
    error SlippageTooHigh(uint256 provided, uint256 max);
    error SwapOutputZero();

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_SLIPPAGE_BPS = 500; // 5% hard cap
    uint256 public constant SWAP_DEADLINE    = 10 minutes;

    // ─── Storage: Request queue ───────────────────────────────────────────────

    struct RedemptionRequest {
        address requester;
        uint256 baseAmount;   // WFLOW locked in at request time
        uint64  timestamp;
        bool    claimed;
    }

    mapping(uint256 => RedemptionRequest) public requests;
    uint256 public nextRequestId;

    uint256 private _totalPending; // sum of unclaimed baseAmounts (WFLOW)

    // ─── Immutables ──────────────────────────────────────────────────────────

    IERC20 public immutable ankrFlowToken;
    IERC20 public immutable wflowToken;
    IPunchSwapV2Router public immutable swapRouter;
    uint256 public immutable override claimDelay;

    // ─── Mutable ─────────────────────────────────────────────────────────────

    uint256 public maxSlippageBps;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param ankrFlowToken_  ankrFLOW address  (Flow EVM Testnet: 0x1b97100eA1D7126C4d60027e231EA4CB25314bdb)
    /// @param wflowToken_     WFLOW address     (Flow EVM Testnet: 0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e)
    /// @param swapRouter_     PunchSwap router  (Flow EVM Testnet: 0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d)
    /// @param claimDelay_     Seconds after request before claim is allowed (e.g. 3600 = 1 hour)
    /// @param maxSlippageBps_ Initial max swap slippage in bps (e.g. 100 = 1%)
    constructor(
        address ankrFlowToken_,
        address wflowToken_,
        address swapRouter_,
        uint256 claimDelay_,
        uint256 maxSlippageBps_
    ) {
        if (ankrFlowToken_ == address(0)) revert ZeroAddress();
        if (wflowToken_ == address(0))    revert ZeroAddress();
        if (swapRouter_ == address(0))    revert ZeroAddress();
        if (maxSlippageBps_ > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(maxSlippageBps_, MAX_SLIPPAGE_BPS);

        ankrFlowToken  = IERC20(ankrFlowToken_);
        wflowToken     = IERC20(wflowToken_);
        swapRouter     = IPunchSwapV2Router(swapRouter_);
        claimDelay     = claimDelay_;
        maxSlippageBps = maxSlippageBps_;
    }

    // ─── IRedemptionAdapter: Write ────────────────────────────────────────────

    /// @inheritdoc IRedemptionAdapter
    /// @dev Pulls ankrFLOW from caller, swaps to WFLOW immediately, stores request.
    ///      Caller must approve this contract to spend `amount` ankrFLOW before calling.
    function requestRedemption(address asset, uint256 amount)
        external
        override
        nonReentrant
        returns (uint256 requestId)
    {
        if (asset != address(ankrFlowToken)) revert UnsupportedAsset(asset, address(ankrFlowToken));
        if (amount == 0) revert ZeroAmount();

        // Pull ankrFLOW from the caller (StrategyManager)
        ankrFlowToken.safeTransferFrom(msg.sender, address(this), amount);

        // Swap ankrFLOW → WFLOW on PunchSwap
        uint256 wflowReceived = _swapAnkrFlowToWFLOW(amount);
        if (wflowReceived == 0) revert SwapOutputZero();

        // Store the request
        requestId = nextRequestId++;
        requests[requestId] = RedemptionRequest({
            requester:  msg.sender,
            baseAmount: wflowReceived,
            timestamp:  uint64(block.timestamp),
            claimed:    false
        });
        _totalPending += wflowReceived;

        emit RedemptionRequested(requestId, msg.sender, amount, uint64(block.timestamp));
    }

    /// @inheritdoc IRedemptionAdapter
    /// @dev Transfers the WFLOW locked at request time to msg.sender.
    function claimRedemption(uint256 requestId)
        external
        override
        nonReentrant
        returns (uint256 baseAmount)
    {
        RedemptionRequest storage req = requests[requestId];
        if (req.timestamp == 0) revert RequestNotFound(requestId);
        if (req.claimed)        revert AlreadyClaimed(requestId);

        uint64 claimableAt = req.timestamp + uint64(claimDelay);
        if (block.timestamp < claimableAt) revert ClaimDelayNotMet(requestId, claimableAt);

        baseAmount  = req.baseAmount;
        req.claimed = true;
        _totalPending -= baseAmount;

        wflowToken.safeTransfer(msg.sender, baseAmount);

        emit RedemptionClaimed(requestId, msg.sender, baseAmount);
    }

    // ─── IRedemptionAdapter: View ─────────────────────────────────────────────

    /// @inheritdoc IRedemptionAdapter
    function pendingValue(uint256 requestId) external view override returns (uint256) {
        RedemptionRequest storage req = requests[requestId];
        if (req.claimed) return 0;
        return req.baseAmount;
    }

    /// @inheritdoc IRedemptionAdapter
    function isClaimable(uint256 requestId) external view override returns (bool) {
        RedemptionRequest storage req = requests[requestId];
        if (req.timestamp == 0 || req.claimed) return false;
        return block.timestamp >= req.timestamp + uint64(claimDelay);
    }

    /// @inheritdoc IRedemptionAdapter
    function totalPending() external view override returns (uint256) {
        return _totalPending;
    }

    // ─── Owner ────────────────────────────────────────────────────────────────

    function setMaxSlippageBps(uint256 newBps) external onlyOwner {
        if (newBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(newBps, MAX_SLIPPAGE_BPS);
        maxSlippageBps = newBps;
        emit MaxSlippageUpdated(newBps);
    }

    function recoverERC20(address token, uint256 amount) external onlyOwner {
        // Prevent draining locked WFLOW (totalPending is earmarked for claimants)
        if (token == address(wflowToken)) {
            uint256 available = wflowToken.balanceOf(address(this));
            require(available > _totalPending, "no excess to recover");
            uint256 excess = available - _totalPending;
            require(amount <= excess, "amount exceeds excess");
        }
        IERC20(token).safeTransfer(owner(), amount);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _swapAnkrFlowToWFLOW(uint256 ankrAmount) internal returns (uint256 wflowOut) {
        address[] memory path = new address[](2);
        path[0] = address(ankrFlowToken);
        path[1] = address(wflowToken);

        uint256[] memory expected = swapRouter.getAmountsOut(ankrAmount, path);
        uint256 minOut = expected[1] * (10_000 - maxSlippageBps) / 10_000;

        ankrFlowToken.forceApprove(address(swapRouter), ankrAmount);
        uint256[] memory amounts = swapRouter.swapExactTokensForTokens(
            ankrAmount,
            minOut,
            path,
            address(this),
            block.timestamp + SWAP_DEADLINE
        );
        ankrFlowToken.forceApprove(address(swapRouter), 0);

        wflowOut = amounts[amounts.length - 1];
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    event MaxSlippageUpdated(uint256 newBps);
}
