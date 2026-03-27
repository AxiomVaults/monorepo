// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IAxiomVault.sol";
import "./interfaces/IYieldAdapter.sol";
import "./interfaces/IRedemptionAdapter.sol";

/// @title MultiStrategyManager
/// @notice Routes idle vault capital across multiple yield adapters — the meta-vault brain.
///
/// @dev Architecture:
///      A single deposit source (AxiomVault) is distributed across N registered yield adapters.
///      Each adapter represents a distinct yield source (e.g. ankrFLOW staking, MORE lending,
///      PunchSwap LP farming). The operator (keeper bot) can:
///        1. Manually allocate/deallocate to specific adapters
///        2. Rotate capital between adapters without touching vault accounting
///        3. Call autoRebalance() to route all idle capital to the highest-APY adapter
///
///      APY hints per adapter are set off-chain by the keeper (who reads live protocol rates)
///      and stored here for on-chain routing transparency and autoRebalance() logic.
///
///      Redemption handling mirrors the original StrategyManager — spread-capture
///      flow remains: Venue → receiveRedeemable → redemptionAdapter → claimRedemption → Vault.
///
/// @custom:roles
///      DEFAULT_ADMIN_ROLE — register adapters, set redemption adapter, manage roles
///      OPERATOR_ROLE      — keeper; allocate/deallocate/rotate/rebalance/claim
///      VENUE_ROLE         — AxiomVenue; call receiveRedeemable after flushing inventory
///
/// @custom:max-adapters 8 (upper bound prevents unbounded gas in view functions)
contract MultiStrategyManager is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VENUE_ROLE    = keccak256("VENUE_ROLE");

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error AdapterNotRegistered(uint8 id);
    error AdapterAlreadyRegistered(address adapter);
    error MaxAdaptersReached();
    error RedemptionAdapterNotSet();
    error RedemptionNotClaimable(uint256 requestId);
    error AllocationExceedsLiquidity(uint256 requested, uint256 available);
    error DeallocationExceedsDeployed(uint256 requested, uint256 deployed);
    error InsufficientDeployed(uint8 fromId, uint256 requested, uint256 available);
    error AssetMismatch(address expected, address got);
    error AdapterNotActive(uint8 id);

    // ─── Events ──────────────────────────────────────────────────────────────

    event AdapterRegistered(uint8 indexed id, address indexed adapter, string name);
    event AdapterDeactivated(uint8 indexed id);
    event AdapterApySet(uint8 indexed id, uint256 apyBps);
    event RedemptionAdapterSet(address indexed adapter);

    event AllocatedTo(uint8 indexed adapterId, uint256 amount, uint256 adapterDeployed);
    event DeallocatedFrom(uint8 indexed adapterId, uint256 amount, uint256 adapterDeployed);
    event RotatedCapital(uint8 indexed fromId, uint8 indexed toId, uint256 amount);
    event AutoRebalanced(uint8 indexed adapterId, uint256 amount);

    event RedeemableReceived(address indexed asset, uint256 amount, uint256 requestId);
    event RedemptionClaimed(uint256 indexed requestId, uint256 baseAmount);

    // ─── Constants ────────────────────────────────────────────────────────────

    uint8   public constant MAX_ADAPTERS    = 8;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct AdapterConfig {
        IYieldAdapter adapter;   // adapter contract
        string        name;      // human-readable label (e.g. "ankrFLOW Staking")
        uint256       deployed;  // base asset allocated to this adapter (tracked locally)
        uint256       apyBps;    // current APY hint in bps (set by operator/keeper)
        bool          active;    // whether this adapter accepts new allocations
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IAxiomVault public immutable vault;
    address     public immutable baseAsset;

    AdapterConfig[] public adapters;

    IRedemptionAdapter public redemptionAdapter;

    /// @notice Track redemption request IDs created via receiveRedeemable
    mapping(uint256 => bool) public managedRequestIds;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param vault_     AxiomVault address
    /// @param baseAsset_ Base asset address (WFLOW)
    constructor(address vault_, address baseAsset_) {
        if (vault_ == address(0)) revert ZeroAddress();
        if (baseAsset_ == address(0)) revert ZeroAddress();
        vault     = IAxiomVault(vault_);
        baseAsset = baseAsset_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ─── Admin: adapter registry ─────────────────────────────────────────────

    /// @notice Register a new yield adapter.
    /// @dev Adapter must implement IYieldAdapter and have baseAsset matching this manager's.
    ///      Ownership of the adapter must be transferred to this contract before depositing.
    /// @return id The index of the newly registered adapter
    function registerAdapter(
        address adapterAddr,
        string calldata name,
        uint256 initialApyBps
    )
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint8 id)
    {
        if (adapterAddr == address(0)) revert ZeroAddress();
        if (adapters.length >= MAX_ADAPTERS) revert MaxAdaptersReached();

        // Ensure not already registered
        for (uint8 i = 0; i < adapters.length; i++) {
            if (address(adapters[i].adapter) == adapterAddr) revert AdapterAlreadyRegistered(adapterAddr);
        }

        IYieldAdapter adapter = IYieldAdapter(adapterAddr);
        if (adapter.baseAsset() != baseAsset) revert AssetMismatch(baseAsset, adapter.baseAsset());

        id = uint8(adapters.length);
        adapters.push(AdapterConfig({
            adapter:  adapter,
            name:     name,
            deployed: 0,
            apyBps:   initialApyBps,
            active:   true
        }));

        emit AdapterRegistered(id, adapterAddr, name);
    }

    /// @notice Deactivate an adapter (no new allocations; existing capital must be manually withdrawn).
    function deactivateAdapter(uint8 id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireAdapter(id);
        adapters[id].active = false;
        emit AdapterDeactivated(id);
    }

    /// @notice Set the redemption adapter (handles the spread-capture rToken redemption flow).
    function setRedemptionAdapter(address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter == address(0)) revert ZeroAddress();
        redemptionAdapter = IRedemptionAdapter(adapter);
        emit RedemptionAdapterSet(adapter);
    }

    // ─── Operator: APY hints ─────────────────────────────────────────────────

    /// @notice Update the APY hint for an adapter. Called by the keeper after reading live rates.
    /// @dev The hint is used ONLY for autoRebalance() routing — never for accounting.
    function setAdapterApy(uint8 id, uint256 apyBps) external onlyRole(OPERATOR_ROLE) {
        _requireAdapter(id);
        adapters[id].apyBps = apyBps;
        emit AdapterApySet(id, apyBps);
    }

    // ─── Operator: capital allocation ────────────────────────────────────────

    /// @notice Pull capital from vault and deploy to a specific adapter.
    /// @param id     Adapter index
    /// @param amount Amount of base asset to deploy
    function allocateTo(uint8 id, uint256 amount) external onlyRole(OPERATOR_ROLE) nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _requireAdapter(id);
        if (!adapters[id].active) revert AdapterNotActive(id);

        // Pull from vault
        vault.deployCapital(address(this), amount);

        // Deposit into adapter
        IERC20(baseAsset).safeIncreaseAllowance(address(adapters[id].adapter), amount);
        adapters[id].adapter.deposit(amount);

        // Update tracking
        adapters[id].deployed += amount;
        vault.updateDeployedToYield(int256(amount));

        emit AllocatedTo(id, amount, adapters[id].deployed);
    }

    /// @notice Withdraw capital from an adapter and return it to the vault.
    /// @param id     Adapter index
    /// @param amount Amount of base asset to retrieve
    function deallocateFrom(uint8 id, uint256 amount) external onlyRole(OPERATOR_ROLE) nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _requireAdapter(id);
        if (amount > adapters[id].deployed) revert DeallocationExceedsDeployed(amount, adapters[id].deployed);

        uint256 preBal = IERC20(baseAsset).balanceOf(address(this));
        adapters[id].adapter.withdraw(amount);
        uint256 received = IERC20(baseAsset).balanceOf(address(this)) - preBal;

        // Return to vault
        IERC20(baseAsset).safeTransfer(address(vault), received);

        // Deduct the requested amount from both local tracking and vault accounting.
        // Any slippage (received != amount) flows through to totalAssets naturally.
        uint256 deducted = amount > adapters[id].deployed ? adapters[id].deployed : amount;
        adapters[id].deployed -= deducted;
        vault.updateDeployedToYield(-int256(amount));

        emit DeallocatedFrom(id, received, adapters[id].deployed);
    }

    /// @notice Withdraw all capital from an adapter and return it to vault.
    function deallocateAll(uint8 id) external onlyRole(OPERATOR_ROLE) nonReentrant {
        _requireAdapter(id);

        uint256 wasDeployed = adapters[id].deployed;
        adapters[id].deployed = 0;

        uint256 preBal = IERC20(baseAsset).balanceOf(address(this));
        adapters[id].adapter.withdrawAll();
        uint256 received = IERC20(baseAsset).balanceOf(address(this)) - preBal;

        if (received > 0) {
            IERC20(baseAsset).safeTransfer(address(vault), received);
        }
        // Reduce by the recorded deployment amount (not received) so any yield gain/loss
        // flows through to totalAssets correctly.
        if (wasDeployed > 0) {
            vault.updateDeployedToYield(-int256(wasDeployed));
        }

        emit DeallocatedFrom(id, received, 0);
    }

    /// @notice Move capital from one adapter to another in a single transaction.
    ///         Vault's totalDeployedToYield does NOT change — capital stays deployed.
    /// @param fromId  Source adapter index
    /// @param toId    Destination adapter index
    /// @param amount  Amount of base asset to rotate
    function rotateCapital(
        uint8 fromId,
        uint8 toId,
        uint256 amount
    )
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        _requireAdapter(fromId);
        _requireAdapter(toId);
        if (!adapters[toId].active) revert AdapterNotActive(toId);
        if (amount > adapters[fromId].deployed) revert InsufficientDeployed(fromId, amount, adapters[fromId].deployed);

        // Withdraw from source adapter
        uint256 preBal = IERC20(baseAsset).balanceOf(address(this));
        adapters[fromId].adapter.withdraw(amount);
        uint256 received = IERC20(baseAsset).balanceOf(address(this)) - preBal;

        // Deposit into destination adapter
        IERC20(baseAsset).safeIncreaseAllowance(address(adapters[toId].adapter), received);
        adapters[toId].adapter.deposit(received);

        // Update local tracking — vault total stays the same
        adapters[fromId].deployed -= amount > adapters[fromId].deployed ? adapters[fromId].deployed : amount;
        adapters[toId].deployed   += received;

        // Reconcile: if received != amount (slippage), adjust vault accounting
        if (received < amount) {
            vault.updateDeployedToYield(-int256(amount - received));
        }

        emit RotatedCapital(fromId, toId, received);
    }

    // ─── Operator: auto-routing ───────────────────────────────────────────────

    /// @notice Route all idle vault capital to the active adapter with the highest APY hint.
    /// @dev The best adapter is determined solely by adapters[i].apyBps (keeper-set).
    ///      Skips adapters with apyBps == 0 and inactive adapters.
    function autoRebalance() external onlyRole(OPERATOR_ROLE) nonReentrant {
        // Find idle capital above reserve buffer
        uint256 available = vault.availableLiquidity();
        if (available == 0) return;

        // Find best active adapter by APY hint
        uint8   bestId     = type(uint8).max;
        uint256 bestApy   = 0;
        for (uint8 i = 0; i < adapters.length; i++) {
            if (adapters[i].active && adapters[i].apyBps > bestApy) {
                bestApy = adapters[i].apyBps;
                bestId  = i;
            }
        }

        if (bestId == type(uint8).max) return; // no active adapters
        if (bestApy == 0) return;              // no APY hint set

        // Allocate
        vault.deployCapital(address(this), available);
        IERC20(baseAsset).safeIncreaseAllowance(address(adapters[bestId].adapter), available);
        adapters[bestId].adapter.deposit(available);

        adapters[bestId].deployed += available;
        vault.updateDeployedToYield(int256(available));

        emit AutoRebalanced(bestId, available);
    }

    // ─── Spread-capture: redemption relay (mirrors StrategyManager) ───────────

    /// @notice Called by AxiomVenue after flushing rToken inventory to this contract.
    ///         Queues the received rToken into the redemption adapter.
    function receiveRedeemable(address asset, uint256 amount)
        external
        onlyRole(VENUE_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (address(redemptionAdapter) == address(0)) revert RedemptionAdapterNotSet();

        IERC20(asset).safeIncreaseAllowance(address(redemptionAdapter), amount);
        uint256 requestId = redemptionAdapter.requestRedemption(asset, amount);

        vault.updatePendingRedemption(int256(amount));
        managedRequestIds[requestId] = true;

        emit RedeemableReceived(asset, amount, requestId);
    }

    /// @notice Claim a matured redemption request and route proceeds back to vault.
    function claimRedemption(uint256 requestId)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
    {
        if (address(redemptionAdapter) == address(0)) revert RedemptionAdapterNotSet();
        if (!redemptionAdapter.isClaimable(requestId)) revert RedemptionNotClaimable(requestId);

        uint256 preBal     = IERC20(baseAsset).balanceOf(address(this));
        uint256 baseAmount = redemptionAdapter.claimRedemption(requestId);
        uint256 received   = IERC20(baseAsset).balanceOf(address(this)) - preBal;

        if (received > 0) {
            IERC20(baseAsset).safeTransfer(address(vault), received);
            vault.receiveRedemptionProceeds(received);
        }

        emit RedemptionClaimed(requestId, baseAmount);
    }

    // ─── Emergency ────────────────────────────────────────────────────────────

    /// @notice Pull all capital from every adapter back to vault. For emergency use.
    function emergencyWithdrawAll() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        for (uint8 i = 0; i < adapters.length; i++) {
            if (adapters[i].deployed == 0) continue;

            uint256 preBal = IERC20(baseAsset).balanceOf(address(this));
            try adapters[i].adapter.withdrawAll() returns (uint256) {} catch {}
            uint256 received = IERC20(baseAsset).balanceOf(address(this)) - preBal;

            if (received > 0) {
                IERC20(baseAsset).safeTransfer(address(vault), received);
                vault.updateDeployedToYield(-int256(received));
            }
            adapters[i].deployed = 0;
        }
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    /// @notice Number of registered adapters
    function adapterCount() external view returns (uint256) {
        return adapters.length;
    }

    /// @notice Total base asset deployed across all adapters (locally tracked)
    function totalDeployedAcrossAdapters() external view returns (uint256 total) {
        for (uint8 i = 0; i < adapters.length; i++) {
            total += adapters[i].deployed;
        }
    }

    /// @notice Live totalUnderlying from a specific adapter (includes accrued yield)
    function adapterTotalUnderlying(uint8 id) external view returns (uint256) {
        _requireAdapter(id);
        return adapters[id].adapter.totalUnderlying();
    }

    /// @notice Snapshot of all adapter status for dashboard display
    /// @return names        Array of adapter names
    /// @return deployed     Locally tracked deployment per adapter
    /// @return underlying   Live totalUnderlying per adapter
    /// @return apyBps       Current APY hint per adapter (bps)
    /// @return active       Whether each adapter is active
    function allAdaptersStatus()
        external
        view
        returns (
            string[]  memory names,
            uint256[] memory deployed,
            uint256[] memory underlying,
            uint256[] memory apyBps,
            bool[]    memory active
        )
    {
        uint256 n = adapters.length;
        names      = new string[](n);
        deployed   = new uint256[](n);
        underlying = new uint256[](n);
        apyBps     = new uint256[](n);
        active     = new bool[](n);

        for (uint8 i = 0; i < n; i++) {
            names[i]    = adapters[i].name;
            deployed[i] = adapters[i].deployed;
            apyBps[i]   = adapters[i].apyBps;
            active[i]   = adapters[i].active;
            try adapters[i].adapter.totalUnderlying() returns (uint256 u) {
                underlying[i] = u;
            } catch {
                underlying[i] = adapters[i].deployed; // fallback to tracked value
            }
        }
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _requireAdapter(uint8 id) internal view {
        if (id >= adapters.length) revert AdapterNotRegistered(id);
    }
}
