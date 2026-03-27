// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IPunchSwapV2Pair
/// @notice Minimal interface for a PunchSwap V2 (UniswapV2-style) LP pair.
///         Used by PunchSwapLPAdapter to read reserves and manage LP token ownership.
interface IPunchSwapV2Pair {
    // ─── ERC-20 (LP token) ─────────────────────────────────────────────────

    function balanceOf(address owner) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);

    // ─── Pair info ─────────────────────────────────────────────────────────

    /// @notice The lower-sort-order token in the pair
    function token0() external view returns (address);

    /// @notice The higher-sort-order token in the pair
    function token1() external view returns (address);

    /// @notice Current reserves and the timestamp of the last block that had a trade
    /// @return reserve0     Reserve of token0
    /// @return reserve1     Reserve of token1
    /// @return blockTimestampLast  Unix timestamp (mod 2^32) of last swap
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}
