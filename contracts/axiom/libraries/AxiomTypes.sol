// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title AxiomTypes
/// @notice Shared struct definitions for the Axiom Vaults system
library AxiomTypes {
    /// @notice Configuration for a supported redeemable asset on AxiomVenue
    /// @param supported Whether this asset is accepted for swaps
    /// @param discountBps Discount in basis points applied to the redeemable asset price (e.g. 20 = 0.20%)
    /// @param maxSwapSize Maximum single-swap size in asset units (18-decimal)
    /// @param maxInventory Maximum total rToken inventory the venue will hold before forcing a flush
    /// @param redemptionAdapter The adapter contract that redeems this asset back to base
    struct SwapConfig {
        bool supported;
        uint16 discountBps;
        uint256 maxSwapSize;
        uint256 maxInventory;
        address redemptionAdapter;
    }

    /// @notice A pending redemption request created in MockRedemptionAdapter
    /// @param requester Address that initiated the redemption
    /// @param amount Amount of redeemable asset deposited
    /// @param timestamp Block timestamp when the request was created
    /// @param claimed Whether the request has been claimed
    struct RedemptionRequest {
        address requester;
        uint256 amount;
        uint64 timestamp;
        bool claimed;
    }
}
