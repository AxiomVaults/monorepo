// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IYieldAdapter
/// @notice Interface for yield-bearing adapters that hold base asset and accrue yield.
///
/// @dev StrategyManager calls deposit/withdraw to rebalance capital.
///      totalUnderlying() reflects the current fair value including accrued yield.
///      The vault tracks its deployed capital via updateDeployedToYield; the strategy manager
///      must call vault.updateDeployedToYield(delta) after any deposit or withdrawal.
interface IYieldAdapter {
    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposited(address indexed caller, uint256 amount);
    event Withdrew(address indexed caller, uint256 amount);

    // ─── Write ────────────────────────────────────────────────────────────────

    /// @notice Deposit base asset into the yield strategy
    /// @dev Pulls `amount` of base asset from msg.sender
    /// @param amount Amount of base asset to deposit
    function deposit(uint256 amount) external;

    /// @notice Withdraw a specific amount of base asset from the yield strategy
    /// @dev Pushes base asset to msg.sender
    /// @param amount Amount of base asset to withdraw
    function withdraw(uint256 amount) external;

    /// @notice Withdraw all base asset (principal + yield) from the strategy
    /// @return total Amount of base asset returned to caller
    function withdrawAll() external returns (uint256 total);

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice Current total value held by this adapter (principal + accrued yield)
    function totalUnderlying() external view returns (uint256);

    /// @notice The base asset this adapter accepts and returns
    function baseAsset() external view returns (address);
}
