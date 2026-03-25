// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IRedemptionAdapter
/// @notice Interface for async redemption adapters that accept redeemable assets
///         and return base asset at par after a configurable delay.
///
/// @dev Implementations should:
///      - Pull the redeemable asset from msg.sender on requestRedemption
///      - Store a pending request with a timestamp
///      - Release base asset to the StrategyManager after claimDelay has elapsed
interface IRedemptionAdapter {
    // ─── Events ──────────────────────────────────────────────────────────────

    event RedemptionRequested(uint256 indexed requestId, address indexed requester, uint256 amount, uint64 timestamp);
    event RedemptionClaimed(uint256 indexed requestId, address indexed recipient, uint256 baseAmount);

    // ─── Write ────────────────────────────────────────────────────────────────

    /// @notice Deposit a redeemable asset to create a pending redemption request
    /// @param asset Address of the redeemable asset (must match adapter's configured asset)
    /// @param amount Amount of redeemable asset to redeem
    /// @return requestId Unique identifier for this redemption request
    function requestRedemption(address asset, uint256 amount) external returns (uint256 requestId);

    /// @notice Claim base asset for a matured redemption request
    /// @param requestId The request to claim
    /// @return baseAmount Amount of base asset returned to caller
    function claimRedemption(uint256 requestId) external returns (uint256 baseAmount);

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice The par-equivalent base value of a pending request (before claim)
    function pendingValue(uint256 requestId) external view returns (uint256);

    /// @notice Whether a request has passed its claim delay and can be claimed
    function isClaimable(uint256 requestId) external view returns (bool);

    /// @notice Total base value of all unclaimed redemption requests
    function totalPending() external view returns (uint256);

    /// @notice The delay in seconds before a redemption request can be claimed
    function claimDelay() external view returns (uint256);
}
