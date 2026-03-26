// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IAnkrStaking
/// @notice Ankr certificate-based liquid staking pool on Flow EVM.
///         Address (Flow EVM Testnet): 0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a
///
/// @dev `stakeCerts()` mints ankrFLOW (certificate tokens) to msg.sender
///      in exchange for the native FLOW sent as msg.value.
///      The exact ankrFLOW amount received depends on the current exchange rate.
interface IAnkrStaking {
    /// @notice Stake native FLOW and receive ankrFLOW certificate tokens.
    ///         Mints ankrFLOW directly to msg.sender.
    function stakeCerts() external payable;
}
