// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYieldAdapter.sol";

/// @title MockYieldAdapter
/// @notice Simulates a yield-bearing strategy that accepts base asset deposits and accrues
///         simple linear yield at a configurable APR (in basis points).
///
/// @dev Yield is calculated as:
///          pending = principal * aprBps * elapsed / (10_000 * 365 days)
///      This adapter does NOT auto-compound. Yield accrues linearly from last harvest.
///      In production this would be replaced by a real lending protocol (e.g. Morpho, Increment).
///
/// @custom:security StrategyManager is the expected caller for deposit/withdraw.
///                  Owner can update APR and recover tokens.
contract MockYieldAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAmount();
    error InsufficientPrincipal(uint256 requested, uint256 available);
    error AprTooHigh(uint256 provided, uint256 max);

    // ─── Events (in addition to IYieldAdapter) ────────────────────────────────

    event AprUpdated(uint256 newAprBps);
    event YieldHarvested(uint256 yieldAmount, uint256 newPrincipal);

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_APR_BPS = 5000; // 50% APR hard cap (mock safety)

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 private immutable _baseAsset;

    /// @notice Simple interest APR expressed in basis points (500 = 5%)
    uint256 public aprBps;

    /// @notice Current principal held by this adapter (does not include accrued yield yet)
    uint256 public principalDeposited;

    /// @notice Timestamp of last yield harvest / deposit / withdrawal
    uint256 public lastHarvestTimestamp;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param baseAsset_ Address of the base asset (e.g. FUSD)
    /// @param aprBps_ Simple APR in basis points (e.g. 500 = 5%)
    constructor(address baseAsset_, uint256 aprBps_) {
        require(baseAsset_ != address(0), "zero baseAsset");
        if (aprBps_ > MAX_APR_BPS) revert AprTooHigh(aprBps_, MAX_APR_BPS);
        _baseAsset = IERC20(baseAsset_);
        aprBps = aprBps_;
        lastHarvestTimestamp = block.timestamp;
    }

    // ─── IYieldAdapter: Write ─────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @dev Pulls base asset from msg.sender. Harvests pending yield first to avoid
    ///      diluting existing yield with new principal.
    function deposit(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _harvestYield();
        _baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        principalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Withdraws from principal only; accrued yield stays in contract.
    ///      In practice the caller (StrategyManager) will call withdrawAll() to sweep everything.
    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _harvestYield();
        uint256 available = _baseAsset.balanceOf(address(this));
        if (amount > available) revert InsufficientPrincipal(amount, available);
        // Reduce principal by withdrawn amount (capped at principalDeposited)
        if (amount >= principalDeposited) {
            principalDeposited = 0;
        } else {
            principalDeposited -= amount;
        }
        _baseAsset.safeTransfer(msg.sender, amount);
        emit Withdrew(msg.sender, amount);
    }

    /// @inheritdoc IYieldAdapter
    function withdrawAll() external override nonReentrant returns (uint256 total) {
        _harvestYield();
        total = _baseAsset.balanceOf(address(this));
        principalDeposited = 0;
        if (total > 0) {
            _baseAsset.safeTransfer(msg.sender, total);
        }
        emit Withdrew(msg.sender, total);
    }

    // ─── IYieldAdapter: View ──────────────────────────────────────────────────

    /// @inheritdoc IYieldAdapter
    /// @notice Returns principal + all pending (un-harvested) yield
    function totalUnderlying() external view override returns (uint256) {
        return principalDeposited + _pendingYield();
    }

    /// @inheritdoc IYieldAdapter
    function baseAsset() external view override returns (address) {
        return address(_baseAsset);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Update the simulated APR. Harvests existing yield first.
    function setAprBps(uint256 newAprBps) external onlyOwner {
        if (newAprBps > MAX_APR_BPS) revert AprTooHigh(newAprBps, MAX_APR_BPS);
        _harvestYield();
        aprBps = newAprBps;
        emit AprUpdated(newAprBps);
    }

    /// @notice Manually trigger a yield harvest (adds pending yield to principal accounting)
    function harvestYield() external onlyOwner {
        _harvestYield();
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Calculate pending yield since last harvest (view, no storage writes)
    function _pendingYield() internal view returns (uint256) {
        if (principalDeposited == 0 || aprBps == 0) return 0;
        uint256 elapsed = block.timestamp - lastHarvestTimestamp;
        return (principalDeposited * aprBps * elapsed) / (10_000 * 365 days);
    }

    /// @dev Materialise pending yield: the balance already sits in the contract (we must have been
    ///      funded with enough base for yield simulation). We just update accounting timestamps.
    ///      NOTE: For yield to actually appear in balanceOf, the owner must pre-fund the adapter
    ///      with enough base asset to cover projected yield (mock behaviour).
    function _harvestYield() internal {
        uint256 yield_ = _pendingYield();
        lastHarvestTimestamp = block.timestamp;
        if (yield_ > 0) {
            // In the mock, yield is "phantom" until funded. We track it in principalDeposited
            // only if the contract actually has sufficient balance to back it.
            uint256 balance = _baseAsset.balanceOf(address(this));
            uint256 backedYield = balance > principalDeposited ? balance - principalDeposited : 0;
            uint256 realised = yield_ < backedYield ? yield_ : backedYield;
            principalDeposited += realised;
            if (realised > 0) emit YieldHarvested(realised, principalDeposited);
        }
    }
}
