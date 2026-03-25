// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IAxiomVault.sol";

/// @title AxiomVault
/// @notice The main capital owner in the Axiom system.
///         Implements ERC4626-compatible deposit/withdraw with multi-component totalAssets:
///           totalAssets = onHandBalance + totalDeployedToYield + totalPendingRedemption
///
/// @dev Architecture notes:
///      - VENUE_ROLE is granted to AxiomVenue; it calls authorizedTransfer() to pay swap sellers.
///      - STRATEGY_MANAGER_ROLE is granted to StrategyManager; it updates accounting and receives
///        redemption proceeds.
///      - A reserve buffer (reserveBufferBps) keeps a minimum on-hand balance for withdrawals.
///      - availableLiquidity() is what the venue checks before processing a swap.
///
/// @custom:security Uses OZ v4 ERC4626, AccessControl, ReentrancyGuard, and SafeERC20.
contract AxiomVault is ERC4626, AccessControl, Pausable, ReentrancyGuard, IAxiomVault {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VENUE_ROLE = keccak256("VENUE_ROLE");
    bytes32 public constant STRATEGY_MANAGER_ROLE = keccak256("STRATEGY_MANAGER_ROLE");

    // ─── Errors ──────────────────────────────────────────────────────────────

    error InsufficientLiquidity(uint256 requested, uint256 available);
    error ExceedsMaxDeposit(uint256 amount, uint256 maxAllowed);
    error ReserveBufferTooHigh(uint256 bps);
    error ZeroAddress();
    error ZeroAmount();
    error AccountingUnderflow();

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_RESERVE_BUFFER_BPS = 5000; // 50% hard cap
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Capital currently deployed into the yield adapter (tracked by StrategyManager)
    uint256 public override totalDeployedToYield;

    /// @notice Capital queued in the redemption adapter awaiting claim (tracked by StrategyManager)
    uint256 public override totalPendingRedemption;

    /// @notice Fraction of on-hand balance kept as a withdrawal buffer (default 10% = 1000 bps)
    uint256 public reserveBufferBps;

    /// @notice Hard cap on total assets the vault will accept (0 = uncapped)
    uint256 public maxTotalDeposit;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param asset_ Base asset address (e.g. FUSD)
    /// @param name_ ERC20 name for vault shares (e.g. "Axiom Vault FUSD")
    /// @param symbol_ ERC20 symbol for vault shares (e.g. "axFUSD")
    constructor(
        address asset_,
        string memory name_,
        string memory symbol_
    ) ERC4626(IERC20Metadata(asset_)) ERC20(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        reserveBufferBps = 1000; // 10% default
    }

    // ─── ERC4626 overrides ────────────────────────────────────────────────────

    /// @notice Total value of assets under vault management across all components.
    ///         This drives the ERC4626 share price.
    function totalAssets()
        public
        view
        override(ERC4626, IAxiomVault)
        returns (uint256)
    {
        return IERC20(asset()).balanceOf(address(this))
            + totalDeployedToYield
            + totalPendingRedemption;
    }

    /// @notice Maximum depositable amount respecting the maxTotalDeposit cap.
    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        if (maxTotalDeposit == 0) return type(uint256).max;
        uint256 current = totalAssets();
        if (current >= maxTotalDeposit) return 0;
        return maxTotalDeposit - current;
    }

    /// @notice Maximum mintable shares respecting the maxTotalDeposit cap.
    function maxMint(address receiver) public view override returns (uint256) {
        uint256 maxDep = maxDeposit(receiver);
        if (maxDep == type(uint256).max) return type(uint256).max;
        return convertToShares(maxDep);
    }

    /// @notice Deposit base assets and mint shares to receiver.
    /// @dev Paused state blocks deposits.
    function deposit(uint256 assets, address receiver)
        public
        override(ERC4626, IAxiomVault)
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        uint256 maxDep = maxDeposit(receiver);
        if (assets > maxDep) revert ExceedsMaxDeposit(assets, maxDep);
        shares = super.deposit(assets, receiver);
    }

    /// @notice Withdraw base assets by burning shares from owner.
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override(ERC4626, IAxiomVault)
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        shares = super.withdraw(assets, receiver, owner);
    }

    /// @notice Redeem shares for base assets.
    function redeem(uint256 shares, address receiver, address owner)
        public
        override(ERC4626, IAxiomVault)
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        assets = super.redeem(shares, receiver, owner);
    }

    // ─── IAxiomVault: View ────────────────────────────────────────────────────

    /// @notice On-hand base asset balance minus the reserved buffer amount.
    ///         The venue should never request more than this in a single swap.
    function availableLiquidity() external view override returns (uint256) {
        uint256 onHand = IERC20(asset()).balanceOf(address(this));
        uint256 reserveRequired = (onHand * reserveBufferBps) / BPS_DENOMINATOR;
        if (onHand <= reserveRequired) return 0;
        return onHand - reserveRequired;
    }

    /// @inheritdoc IAxiomVault
    function convertToShares(uint256 assets_)
        public
        view
        override(ERC4626, IAxiomVault)
        returns (uint256)
    {
        return super.convertToShares(assets_);
    }

    /// @inheritdoc IAxiomVault
    function convertToAssets(uint256 shares_)
        public
        view
        override(ERC4626, IAxiomVault)
        returns (uint256)
    {
        return super.convertToAssets(shares_);
    }

    // ─── IAxiomVault: Privileged writes ──────────────────────────────────────

    /// @inheritdoc IAxiomVault
    /// @dev VENUE_ROLE only. Checks availableLiquidity before transferring.
    function authorizedTransfer(address to, uint256 amount)
        external
        override
        onlyRole(VENUE_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 onHand = IERC20(asset()).balanceOf(address(this));
        uint256 reserveRequired = (onHand * reserveBufferBps) / BPS_DENOMINATOR;
        uint256 available = onHand > reserveRequired ? onHand - reserveRequired : 0;
        if (amount > available) revert InsufficientLiquidity(amount, available);
        IERC20(asset()).safeTransfer(to, amount);
        emit AuthorizedTransfer(to, amount);
    }

    /// @inheritdoc IAxiomVault
    function receiveRedemptionProceeds(uint256 amount)
        external
        override
        onlyRole(STRATEGY_MANAGER_ROLE)
    {
        if (amount == 0) revert ZeroAmount();
        if (amount > totalPendingRedemption) revert AccountingUnderflow();
        totalPendingRedemption -= amount;
        emit RedemptionProceedsReceived(amount);
    }

    /// @inheritdoc IAxiomVault
    function updateDeployedToYield(int256 delta)
        external
        override
        onlyRole(STRATEGY_MANAGER_ROLE)
    {
        if (delta >= 0) {
            totalDeployedToYield += uint256(delta);
        } else {
            uint256 decrease = uint256(-delta);
            if (decrease > totalDeployedToYield) revert AccountingUnderflow();
            totalDeployedToYield -= decrease;
        }
        emit DeployedToYieldUpdated(delta, totalDeployedToYield);
    }

    /// @inheritdoc IAxiomVault
    function updatePendingRedemption(int256 delta)
        external
        override
        onlyRole(STRATEGY_MANAGER_ROLE)
    {
        if (delta >= 0) {
            totalPendingRedemption += uint256(delta);
        } else {
            uint256 decrease = uint256(-delta);
            if (decrease > totalPendingRedemption) revert AccountingUnderflow();
            totalPendingRedemption -= decrease;
        }
        emit PendingRedemptionUpdated(delta, totalPendingRedemption);
    }

    // ─── Config: OPERATOR_ROLE ────────────────────────────────────────────────

    /// @notice Set the reserve buffer — fraction of on-hand balance kept for withdrawals.
    /// @param bps Basis points (e.g. 1000 = 10%)
    function setReserveBufferBps(uint256 bps) external onlyRole(OPERATOR_ROLE) {
        if (bps > MAX_RESERVE_BUFFER_BPS) revert ReserveBufferTooHigh(bps);
        reserveBufferBps = bps;
        emit ReserveBufferBpsSet(bps);
    }

    /// @notice Set a hard cap on total depositable assets (0 = uncapped).
    function setMaxTotalDeposit(uint256 cap) external onlyRole(OPERATOR_ROLE) {
        maxTotalDeposit = cap;
        emit MaxTotalDepositSet(cap);
    }

    // ─── Pause: DEFAULT_ADMIN_ROLE ────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ─── ERC4626 internal: block ERC4626 pause-bypass ─────────────────────────

    /// @dev ERC4626 calls _deposit/_withdraw internally; we gate at the public entry points above.
    ///      This override ensures maxWithdraw also respects the pause.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        if (paused()) return 0;
        return super.maxWithdraw(owner_);
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        if (paused()) return 0;
        return super.maxRedeem(owner_);
    }
}
