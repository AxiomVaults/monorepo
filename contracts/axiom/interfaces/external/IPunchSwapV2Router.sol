// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title IPunchSwapV2Router
/// @notice PunchSwap V2 router interface (UniswapV2-compatible).
///         Address (Flow EVM Testnet): 0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d
interface IPunchSwapV2Router {
    // ─── Swap ─────────────────────────────────────────────────────────────────

    /// @notice Swap an exact amount of input tokens for as many output tokens as possible.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Swap as few input tokens as possible for an exact amount of output tokens.
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    // ─── Liquidity ────────────────────────────────────────────────────────────

    /// @notice Add liquidity to a tokenA/tokenB pair, creating it if it doesn't exist.
    /// @return amountA   Actual amount of tokenA added
    /// @return amountB   Actual amount of tokenB added
    /// @return liquidity LP tokens minted to `to`
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    /// @notice Remove liquidity from a tokenA/tokenB pair.
    /// @return amountA   Amount of tokenA received
    /// @return amountB   Amount of tokenB received
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);

    // ─── Quotes (view) ────────────────────────────────────────────────────────

    /// @notice Given an exact input amount, returns the maximum output amounts along the path.
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);

    /// @notice Given an exact output amount, returns the minimum input amounts along the path.
    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}
