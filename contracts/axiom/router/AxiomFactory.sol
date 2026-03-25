// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AxiomFactory
/// @notice Minimal registry that maps token pairs to AxiomUniV2Pair addresses.
///
/// @dev This is NOT a clone factory — pairs are deployed externally and registered here.
///      The factory interface (getPair, allPairs, allPairsLength) is compatible with the
///      IUniswapV2Factory interface that aggregators such as Eisen use for auto-discovery.
///
/// @custom:eisen-compat
///      Eisen's router scans factories for all registered pairs via:
///        - allPairsLength()
///        - allPairs(i)
///      And queries each pair for token0/token1/getReserves.
///      Registering an AxiomUniV2Pair here makes the Axiom venue permissionlessly discoverable.
contract AxiomFactory is Ownable {

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAddress();
    error PairAlreadyRegistered(address token0, address token1);
    error IdenticalAddresses();

    // ─── Events ──────────────────────────────────────────────────────────────

    event PairRegistered(address indexed token0, address indexed token1, address indexed pair, uint256 totalPairs);

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice IUniswapV2Factory-compatible: getPair[tokenA][tokenB] → pair address
    mapping(address => mapping(address => address)) public getPair;

    /// @notice IUniswapV2Factory-compatible: ordered list of all registered pairs
    address[] public allPairs;

    // ─── IUniswapV2Factory-compatible view ────────────────────────────────────

    /// @notice Total number of registered pairs
    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Register an externally deployed AxiomUniV2Pair for a token pair.
    ///         Registers both directions: getPair[tokenA][tokenB] and getPair[tokenB][tokenA].
    ///
    /// @param tokenA One token of the pair
    /// @param tokenB The other token of the pair
    /// @param pair   The AxiomUniV2Pair address to register
    function registerPair(address tokenA, address tokenB, address pair) external onlyOwner {
        if (tokenA == address(0) || tokenB == address(0) || pair == address(0)) revert ZeroAddress();
        if (tokenA == tokenB) revert IdenticalAddresses();
        if (getPair[tokenA][tokenB] != address(0)) revert PairAlreadyRegistered(tokenA, tokenB);

        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
        allPairs.push(pair);

        emit PairRegistered(tokenA, tokenB, pair, allPairs.length);
    }

    /// @notice Update an existing pair registration (e.g. after a venue upgrade).
    function updatePair(address tokenA, address tokenB, address newPair) external onlyOwner {
        if (newPair == address(0)) revert ZeroAddress();
        address existing = getPair[tokenA][tokenB];
        require(existing != address(0), "pair not registered");

        getPair[tokenA][tokenB] = newPair;
        getPair[tokenB][tokenA] = newPair;

        // Update allPairs array
        for (uint256 i = 0; i < allPairs.length; i++) {
            if (allPairs[i] == existing) {
                allPairs[i] = newPair;
                break;
            }
        }

        emit PairRegistered(tokenA, tokenB, newPair, allPairs.length);
    }
}
