// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IWFLOW
/// @notice Wrapped FLOW token interface (WETH-pattern).
///         Unwrapping sends native FLOW to the caller; the caller must have a receive() function.
interface IWFLOW is IERC20 {
    /// @notice Wrap native FLOW into WFLOW
    function deposit() external payable;

    /// @notice Unwrap WFLOW back to native FLOW.  Sends FLOW to msg.sender.
    /// @param wad Amount of WFLOW to unwrap (18 decimals)
    function withdraw(uint256 wad) external;
}
