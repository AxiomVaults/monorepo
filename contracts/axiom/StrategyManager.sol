// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IAxiomVault.sol";
import "./interfaces/IYieldAdapter.sol";
import "./interfaces/IRedemptionAdapter.sol";

/// @title StrategyManager
/// @notice Coordinates capital flows between AxiomVault, MockYieldAdapter, and MockRedemptionAdapter.
///
/// @dev Responsibilities:
///      - Receive rTokens from AxiomVenue and queue them into the redemption adapter
///      - Allocate idle base asset from the vault into the yield adapter
///      - Claim matured redemptions and return proceeds to the vault
///      - Deallocate yield adapter capital back to the vault on demand
///      - Rebalance: keeper-callable function to maintain target reserve buffer
///
///      This contract does NOT hold long-term asset custody.
///      All base asset remains in the vault; adapters hold collateral temporarily.
///
/// @custom:roles
///      OPERATOR_ROLE — keeper/strategist; can call allocate/deallocate/rebalance/claimRedemption
///      VENUE_ROLE    — AxiomVenue; can call receiveRedeemable after flushing inventory
contract StrategyManager is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VENUE_ROLE = keccak256("VENUE_ROLE");

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error AdapterNotSet();
    error AllocationTooLarge(uint256 requested, uint256 available);
    error DeallocationTooLarge(uint256 requested, uint256 deployed);
    error RedemptionNotClaimable(uint256 requestId);
    error AssetMismatch(address expected, address got);

    // ─── Events ──────────────────────────────────────────────────────────────

    event RedeemableReceived(address indexed asset, uint256 amount, uint256 requestId);
    event AllocatedToYield(uint256 amount, uint256 totalDeployed);
    event DeallocatedFromYield(uint256 amount, uint256 totalDeployed);
    event RedemptionClaimed(uint256 indexed requestId, uint256 baseAmount);
    event RebalanceExecuted(uint256 allocatedOrDeallocated, bool wasAllocation);
    event YieldAdapterSet(address indexed adapter);
    event RedemptionAdapterSet(address indexed adapter);
    event TargetReserveBufferBpsSet(uint256 bps);

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── State ────────────────────────────────────────────────────────────────

    IAxiomVault public immutable vault;
    address public immutable baseAsset;

    IYieldAdapter public yieldAdapter;
    IRedemptionAdapter public redemptionAdapter;

    /// @notice Target on-hand reserve buffer for the vault (in bps). Used by rebalance().
    uint256 public targetReserveBufferBps;

    /// @notice Track which request IDs were created by receiveRedeemable (for claimRedemption)
    mapping(uint256 => bool) public managedRequestIds;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param vault_     AxiomVault address
    /// @param baseAsset_ Base asset address tracked for safety checks
    constructor(address vault_, address baseAsset_) {
        if (vault_ == address(0)) revert ZeroAddress();
        if (baseAsset_ == address(0)) revert ZeroAddress();
        vault = IAxiomVault(vault_);
        baseAsset = baseAsset_;
        targetReserveBufferBps = 1000; // 10% default
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ─── Venue relay ─────────────────────────────────────────────────────────

    /// @notice Called by AxiomVenue after flushing rToken inventory to this contract.
    ///         Queues the received rToken into the redemption adapter.
    ///
    /// @dev AxiomVenue transfers the tokens to this address before calling this function.
    ///      Caller must have VENUE_ROLE.
    ///
    /// @param asset  The redeemable asset address
    /// @param amount Amount of rToken received
    function receiveRedeemable(address asset, uint256 amount)
        external
        onlyRole(VENUE_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (address(redemptionAdapter) == address(0)) revert AdapterNotSet();

        // Approve adapter to pull the rToken
        IERC20(asset).safeIncreaseAllowance(address(redemptionAdapter), amount);
        uint256 requestId = redemptionAdapter.requestRedemption(asset, amount);

        // Update vault accounting: +amount pending redemption
        vault.updatePendingRedemption(int256(amount));

        managedRequestIds[requestId] = true;
        emit RedeemableReceived(asset, amount, requestId);
    }

    // ─── Yield adapter ────────────────────────────────────────────────────────

    /// @notice Allocate base asset from the vault into the yield adapter.
    /// @param amount Amount of base asset to deploy
    function allocateToYield(uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (address(yieldAdapter) == address(0)) revert AdapterNotSet();

        // Pull base asset from vault into this contract
        vault.authorizedTransfer(address(this), amount);

        // Deposit into yield adapter
        IERC20(baseAsset).safeIncreaseAllowance(address(yieldAdapter), amount);
        yieldAdapter.deposit(amount);

        // Update vault accounting
        vault.updateDeployedToYield(int256(amount));

        emit AllocatedToYield(amount, vault.totalDeployedToYield());
    }

    /// @notice Withdraw base asset from the yield adapter and return it to the vault.
    /// @param amount Amount of base asset to retrieve
    function deallocateFromYield(uint256 amount)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (address(yieldAdapter) == address(0)) revert AdapterNotSet();

        uint256 preBalance = IERC20(baseAsset).balanceOf(address(this));
        yieldAdapter.withdraw(amount);
        uint256 received = IERC20(baseAsset).balanceOf(address(this)) - preBalance;

        // Return to vault
        IERC20(baseAsset).safeTransfer(address(vault), received);

        // Update vault accounting
        vault.updateDeployedToYield(-int256(received));

        emit DeallocatedFromYield(received, vault.totalDeployedToYield());
    }

    /// @notice Deallocate everything from the yield adapter back to the vault.
    function deallocateAllFromYield()
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
    {
        if (address(yieldAdapter) == address(0)) revert AdapterNotSet();

        uint256 preBalance = IERC20(baseAsset).balanceOf(address(this));
        yieldAdapter.withdrawAll();
        uint256 received = IERC20(baseAsset).balanceOf(address(this)) - preBalance;

        if (received > 0) {
            IERC20(baseAsset).safeTransfer(address(vault), received);
        }

        // Reconcile: set deployed to 0 (withdrawAll clears everything)
        uint256 currentDeployed = vault.totalDeployedToYield();
        if (currentDeployed > 0) {
            vault.updateDeployedToYield(-int256(currentDeployed));
        }

        emit DeallocatedFromYield(received, 0);
    }

    // ─── Redemption ───────────────────────────────────────────────────────────

    /// @notice Claim a mature redemption request and route proceeds back to vault.
    /// @param requestId The redemption request ID to claim
    function claimRedemption(uint256 requestId)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
    {
        if (address(redemptionAdapter) == address(0)) revert AdapterNotSet();
        if (!redemptionAdapter.isClaimable(requestId)) revert RedemptionNotClaimable(requestId);

        uint256 preBalance = IERC20(baseAsset).balanceOf(address(this));
        uint256 baseAmount = redemptionAdapter.claimRedemption(requestId);
        uint256 received = IERC20(baseAsset).balanceOf(address(this)) - preBalance;

        // Forward base asset to vault
        if (received > 0) {
            IERC20(baseAsset).safeTransfer(address(vault), received);
            vault.receiveRedemptionProceeds(received);
        }

        emit RedemptionClaimed(requestId, baseAmount);
    }

    // ─── Rebalance (keeper-callable) ──────────────────────────────────────────

    /// @notice Auto-rebalance: if vault on-hand liquidity exceeds the target buffer by more than
    ///         a threshold, allocate the excess to yield. If vault is below buffer, do nothing
    ///         (that path requires manual operator action or waiting for redemptions to clear).
    ///
    /// @dev This is a simple one-direction rebalance. For production, add a full two-way
    ///      rebalancer with configurable deadband.
    function rebalance() external onlyRole(OPERATOR_ROLE) nonReentrant {
        if (address(yieldAdapter) == address(0)) revert AdapterNotSet();

        uint256 onHand = IERC20(baseAsset).balanceOf(address(vault));
        uint256 targetReserve = (onHand * targetReserveBufferBps) / BPS_DENOMINATOR;

        if (onHand <= targetReserve) {
            // Nothing to allocate
            return;
        }

        uint256 excess = onHand - targetReserve;

        // Pull from vault and deposit into yield adapter
        vault.authorizedTransfer(address(this), excess);
        IERC20(baseAsset).safeIncreaseAllowance(address(yieldAdapter), excess);
        yieldAdapter.deposit(excess);
        vault.updateDeployedToYield(int256(excess));

        emit AllocatedToYield(excess, vault.totalDeployedToYield());
        emit RebalanceExecuted(excess, true);
    }

    // ─── Config: DEFAULT_ADMIN_ROLE ───────────────────────────────────────────

    /// @notice Set the yield adapter. Only callable by admin.
    function setYieldAdapter(address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter == address(0)) revert ZeroAddress();
        yieldAdapter = IYieldAdapter(adapter);
        emit YieldAdapterSet(adapter);
    }

    /// @notice Set the redemption adapter. Only callable by admin.
    function setRedemptionAdapter(address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter == address(0)) revert ZeroAddress();
        redemptionAdapter = IRedemptionAdapter(adapter);
        emit RedemptionAdapterSet(adapter);
    }

    // ─── Config: OPERATOR_ROLE ────────────────────────────────────────────────

    /// @notice Set the target reserve buffer used by rebalance().
    function setTargetReserveBufferBps(uint256 bps) external onlyRole(OPERATOR_ROLE) {
        targetReserveBufferBps = bps;
        emit TargetReserveBufferBpsSet(bps);
    }
}
