// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRedemptionAdapter.sol";
import "../libraries/AxiomTypes.sol";

/// @title MockRedemptionAdapter
/// @notice Simulates an async redemption queue for a redeemable asset.
///         Users (via StrategyManager) deposit rToken → receive base asset at par after claimDelay.
///
/// @dev Redeems at a strict 1:1 ratio (redeemable asset : base asset).
///      The adapter must be pre-funded with base asset via fundWithBase() before claims can be processed.
///      In production this would be replaced by a real protocol withdrawal queue (e.g. Lido, ankrFLOW).
contract MockRedemptionAdapter is IRedemptionAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error UnsupportedAsset(address asset);
    error RequestNotFound(uint256 requestId);
    error AlreadyClaimed(uint256 requestId);
    error ClaimDelayNotMet(uint256 requestId, uint64 claimableAt);
    error InsufficientBaseFunds(uint256 needed, uint256 available);
    error ZeroAmount();

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable redeemableAsset;
    IERC20 public immutable baseAssetToken;

    uint256 public immutable override claimDelay;

    mapping(uint256 => AxiomTypes.RedemptionRequest) public requests;
    uint256 public nextRequestId;

    /// @notice Sum of all unclaimed base-equivalent amounts
    uint256 private _totalPending;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param redeemableAsset_ The rToken accepted by this adapter (e.g. stFLOW)
    /// @param baseAsset_ The base asset paid out on claim (e.g. FUSD)
    /// @param claimDelay_ Seconds to wait before a request is claimable (300 = 5 min for testnet)
    constructor(address redeemableAsset_, address baseAsset_, uint256 claimDelay_) {
        require(redeemableAsset_ != address(0), "zero redeemableAsset");
        require(baseAsset_ != address(0), "zero baseAsset");
        redeemableAsset = IERC20(redeemableAsset_);
        baseAssetToken = IERC20(baseAsset_);
        claimDelay = claimDelay_;
    }

    // ─── IRedemptionAdapter: Write ────────────────────────────────────────────

    /// @inheritdoc IRedemptionAdapter
    /// @dev Caller must approve this contract to spend `amount` of `asset` before calling.
    function requestRedemption(address asset, uint256 amount) external override nonReentrant returns (uint256 requestId) {
        if (asset != address(redeemableAsset)) revert UnsupportedAsset(asset);
        if (amount == 0) revert ZeroAmount();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        requestId = nextRequestId++;
        requests[requestId] = AxiomTypes.RedemptionRequest({
            requester: msg.sender,
            amount: amount,
            timestamp: uint64(block.timestamp),
            claimed: false
        });
        _totalPending += amount;

        emit RedemptionRequested(requestId, msg.sender, amount, uint64(block.timestamp));
    }

    /// @inheritdoc IRedemptionAdapter
    /// @dev Sends base asset to msg.sender (StrategyManager). 1:1 par redemption.
    function claimRedemption(uint256 requestId) external override nonReentrant returns (uint256 baseAmount) {
        AxiomTypes.RedemptionRequest storage req = requests[requestId];
        if (req.timestamp == 0) revert RequestNotFound(requestId);
        if (req.claimed) revert AlreadyClaimed(requestId);

        uint64 claimableAt = req.timestamp + uint64(claimDelay);
        if (block.timestamp < claimableAt) revert ClaimDelayNotMet(requestId, claimableAt);

        baseAmount = req.amount; // 1:1 par
        uint256 available = baseAssetToken.balanceOf(address(this));
        if (available < baseAmount) revert InsufficientBaseFunds(baseAmount, available);

        req.claimed = true;
        _totalPending -= baseAmount;

        baseAssetToken.safeTransfer(msg.sender, baseAmount);

        emit RedemptionClaimed(requestId, msg.sender, baseAmount);
    }

    // ─── IRedemptionAdapter: View ─────────────────────────────────────────────

    /// @inheritdoc IRedemptionAdapter
    function pendingValue(uint256 requestId) external view override returns (uint256) {
        AxiomTypes.RedemptionRequest storage req = requests[requestId];
        if (req.claimed) return 0;
        return req.amount;
    }

    /// @inheritdoc IRedemptionAdapter
    function isClaimable(uint256 requestId) external view override returns (bool) {
        AxiomTypes.RedemptionRequest storage req = requests[requestId];
        if (req.claimed || req.timestamp == 0) return false;
        return block.timestamp >= req.timestamp + uint64(claimDelay);
    }

    /// @inheritdoc IRedemptionAdapter
    function totalPending() external view override returns (uint256) {
        return _totalPending;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Fund this adapter with base asset so it can pay out claims.
    ///         In production this would be replaced by the real protocol payout mechanism.
    /// @param amount Amount of base asset to transfer in
    function fundWithBase(uint256 amount) external onlyOwner {
        baseAssetToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Emergency: recover any token accidentally sent here
    function recoverToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
