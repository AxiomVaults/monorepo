// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IMorePool
/// @notice MORE Protocol lending pool interface (Aave V3-compatible).
///         Address (Flow EVM Testnet): 0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d
interface IMorePool {
    /// @notice Supply `amount` of `asset` as collateral on behalf of `onBehalfOf`.
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    /// @notice Borrow `amount` of `asset` at `interestRateMode` (1=stable, 2=variable).
    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;

    /// @notice Repay borrowed `asset`.  Use type(uint256).max to repay the full debt.
    /// @return repaid Actual amount repaid
    function repay(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        address onBehalfOf
    ) external returns (uint256 repaid);

    /// @notice Withdraw `amount` of `asset` collateral, sending it to `to`.
    ///         Use type(uint256).max to withdraw the full aToken balance.
    /// @return withdrawn Actual amount withdrawn
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256 withdrawn);

    /// @notice Returns account-level data for `user`.
    /// @return totalCollateralBase   Total collateral in USD oracle units (8 decimals)
    /// @return totalDebtBase         Total debt in USD oracle units (8 decimals)
    /// @return availableBorrowsBase  Available to borrow in USD oracle units (8 decimals)
    /// @return currentLiquidationThreshold LT in bps (e.g. 8000 = 80%)
    /// @return ltv                   Max LTV in bps (e.g. 7500 = 75%)
    /// @return healthFactor          1e18 = 1.0; positions < 1e18 are liquidatable
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}
