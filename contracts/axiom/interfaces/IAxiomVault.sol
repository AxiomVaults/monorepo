// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IAxiomVault
/// @notice Interface for the Axiom Vault — the main capital owner in the Axiom system
interface IAxiomVault {
    // ─── Events ──────────────────────────────────────────────────────────────

    event DeployedToYieldUpdated(int256 delta, uint256 newTotal);
    event PendingRedemptionUpdated(int256 delta, uint256 newTotal);
    event RedemptionProceedsReceived(uint256 amount);
    event AuthorizedTransfer(address indexed to, uint256 amount);
    event ReserveBufferBpsSet(uint256 bps);
    event MaxTotalDepositSet(uint256 cap);

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice Total assets under management: on-hand + deployed to yield + pending redemption
    function totalAssets() external view returns (uint256);

    /// @notice Base asset balance held directly in the vault minus the reserve buffer
    function availableLiquidity() external view returns (uint256);

    /// @notice Convert a base asset amount to vault shares
    function convertToShares(uint256 assets) external view returns (uint256);

    /// @notice Convert a share amount to base assets
    function convertToAssets(uint256 shares) external view returns (uint256);

    /// @notice Total base asset deployed to a yield adapter
    function totalDeployedToYield() external view returns (uint256);

    /// @notice Total base asset value pending in the redemption queue
    function totalPendingRedemption() external view returns (uint256);

    // ─── User actions ─────────────────────────────────────────────────────────

    /// @notice Deposit base assets and mint shares to receiver
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// @notice Withdraw base assets, burning shares from owner
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);

    /// @notice Redeem shares for base assets
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    // ─── Privileged: VENUE_ROLE ───────────────────────────────────────────────

    /// @notice Transfer base asset to `to` on behalf of the venue (after liquidity check)
    /// @dev Only callable by accounts with VENUE_ROLE
    function authorizedTransfer(address to, uint256 amount) external;

    // ─── Privileged: STRATEGY_MANAGER_ROLE ────────────────────────────────────

    /// @notice Pull base asset from vault and send to the caller (strategy manager) for deployment.
    /// @dev Only callable by accounts with STRATEGY_MANAGER_ROLE — obeys reserve buffer.
    function deployCapital(address to, uint256 amount) external;

    /// @notice Record that base asset has been received back from the redemption adapter
    /// @dev Decrements totalPendingRedemption; actual token transfer is done by caller before calling this
    function receiveRedemptionProceeds(uint256 amount) external;

    /// @notice Adjust the vault's accounting of capital deployed to the yield adapter
    /// @param delta Positive = deployed more; negative = withdrawn
    function updateDeployedToYield(int256 delta) external;

    /// @notice Adjust the vault's accounting of capital queued in redemption
    /// @param delta Positive = queued more; negative = claimed back
    function updatePendingRedemption(int256 delta) external;
}
