// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IMorePoolDataProvider
/// @notice MORE Protocol pool data provider (Aave V3-compatible).
///         Address (Flow EVM Testnet): 0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf
interface IMorePoolDataProvider {
    /// @notice Returns per-reserve user data for `asset`.
    /// @return currentATokenBalance      aToken balance (principal + supply interest, 18 dec)
    /// @return currentStableDebt         Stable debt token balance
    /// @return currentVariableDebt       Variable debt token balance (18 dec)
    /// @return principalStableDebt       Stable debt principal
    /// @return scaledVariableDebt        Scaled variable debt
    /// @return stableBorrowRate          Current stable borrow rate (ray, 27 dec)
    /// @return liquidityRate             Current supply APY (ray, 27 dec)
    /// @return stableRateLastUpdated     Timestamp of last stable rate update
    /// @return usageAsCollateralEnabled  Whether this asset is enabled as collateral
    function getUserReserveData(address asset, address user)
        external
        view
        returns (
            uint256 currentATokenBalance,
            uint256 currentStableDebt,
            uint256 currentVariableDebt,
            uint256 principalStableDebt,
            uint256 scaledVariableDebt,
            uint256 stableBorrowRate,
            uint256 liquidityRate,
            uint40 stableRateLastUpdated,
            bool usageAsCollateralEnabled
        );

    /// @notice Returns the aToken, stableDebtToken, and variableDebtToken addresses for a reserve.
    function getReserveTokensAddresses(address asset)
        external
        view
        returns (
            address aTokenAddress,
            address stableDebtTokenAddress,
            address variableDebtTokenAddress
        );
}
