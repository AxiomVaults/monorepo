// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IAxiomVault.sol";
import "./libraries/AxiomTypes.sol";

interface IStrategyManagerRelay {
    function receiveRedeemable(address asset, uint256 amount) external;
}

/// @title AxiomVenue
/// @notice The swap endpoint for Axiom Vaults.
///         Users sell supported redeemable assets (e.g. stFLOW) and receive base asset (e.g. FUSD)
///         at a configurable discount. The vault provides the base liquidity.
///
/// @dev Asset flow per swap:
///        1. Pull rToken from seller (safeTransferFrom)
///        2. Call vault.authorizedTransfer(receiver, amountOut) — vault pays seller
///        3. Forward rToken to StrategyManager for queued redemption
///
///      Eisen router compatibility:
///        - swapExactTokensForTokens() and swapTokensForExactTokens() are UniV2 router aliases.
///        - getAmountsOut() follows the UniV2 router interface.
///        - For full auto-discovery, deploy AxiomUniV2Pair + AxiomFactory (router/AxiomUniV2Pair.sol).
///
/// @custom:future-eisen
///        To expose this venue through a UniV2 factory-compatible interface without whitelisting:
///        1. Deploy AxiomUniV2Pair(factory, token0=baseAsset, token1=rToken, venue=this)
///        2. Register in AxiomFactory.registerPair(token0, token1, pair)
///        3. Any aggregator scanning the factory's allPairs() list will detect the pair.
///        The pair's swap() function delegates to this venue's swapRedeemableForBase().
contract AxiomVenue is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Errors ──────────────────────────────────────────────────────────────

    error AssetNotSupported(address token);
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);
    error ExceedsMaxSwapSize(uint256 amount, uint256 maxSize);
    error ExceedsMaxInventory(uint256 current, uint256 adding, uint256 max);
    error DeadlineExpired(uint256 deadline, uint256 current);
    error PathLengthInvalid(uint256 len);
    error PathAssetMismatch(address expected, address got);
    error ZeroAmount();
    error ZeroAddress();
    error DiscountTooHigh(uint256 provided, uint256 max);
    error InvalidSwapDirection();

    // ─── Events ──────────────────────────────────────────────────────────────

    event SwapExecuted(
        address indexed tokenIn,
        address indexed receiver,
        uint256 amountIn,
        uint256 amountOut,
        uint256 discountBps
    );
    event AssetConfigured(address indexed asset, AxiomTypes.SwapConfig config);
    event InventoryFlushed(address indexed asset, uint256 amount);
    event StrategyManagerUpdated(address indexed newManager);

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant MAX_DISCOUNT_BPS = 1000; // 10% hard cap on any single swap discount
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── State ────────────────────────────────────────────────────────────────

    IAxiomVault public immutable vault;
    IStrategyManagerRelay public strategyManager;

    /// @notice Per-asset swap configuration
    mapping(address => AxiomTypes.SwapConfig) public swapConfigs;

    /// @notice rToken inventory currently held by this venue pending a flush to StrategyManager
    mapping(address => uint256) public inventoryBalances;

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param vault_ AxiomVault address — the source of base asset liquidity
    /// @param strategyManager_ StrategyManager address — receives rTokens for queued redemption
    constructor(address vault_, address strategyManager_) {
        if (vault_ == address(0)) revert ZeroAddress();
        if (strategyManager_ == address(0)) revert ZeroAddress();
        vault = IAxiomVault(vault_);
        strategyManager = IStrategyManagerRelay(strategyManager_);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ─── Core swap ────────────────────────────────────────────────────────────

    /// @notice Preview how much base asset a seller would receive for `amountIn` of `tokenIn`.
    /// @dev Pure pricing — no state changes, no liquidity check.
    /// @param tokenIn The redeemable asset being sold
    /// @param amountIn Amount of tokenIn
    /// @return amountOut Base asset the seller receives (after discount)
    function getQuote(address tokenIn, uint256 amountIn)
        public
        view
        returns (uint256 amountOut)
    {
        AxiomTypes.SwapConfig storage cfg = swapConfigs[tokenIn];
        if (!cfg.supported) revert AssetNotSupported(tokenIn);
        amountOut = (amountIn * (BPS_DENOMINATOR - cfg.discountBps)) / BPS_DENOMINATOR;
    }

    /// @notice Sell redeemable asset for base asset at a discount.
    ///
    /// @param tokenIn      The redeemable asset being sold (e.g. stFLOW)
    /// @param amountIn     Amount of tokenIn to sell
    /// @param minAmountOut Minimum base asset to receive (slippage protection)
    /// @param receiver     Address that receives the base asset payout
    /// @return amountOut   Actual base asset paid to receiver
    function swapRedeemableForBase(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver
    )
        public
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        AxiomTypes.SwapConfig storage cfg = swapConfigs[tokenIn];
        if (!cfg.supported) revert AssetNotSupported(tokenIn);
        if (amountIn > cfg.maxSwapSize) revert ExceedsMaxSwapSize(amountIn, cfg.maxSwapSize);

        uint256 newInventory = inventoryBalances[tokenIn] + amountIn;
        if (newInventory > cfg.maxInventory) {
            revert ExceedsMaxInventory(inventoryBalances[tokenIn], amountIn, cfg.maxInventory);
        }

        amountOut = (amountIn * (BPS_DENOMINATOR - cfg.discountBps)) / BPS_DENOMINATOR;
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        // Pull rToken from seller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Pay seller in base asset from vault
        vault.authorizedTransfer(receiver, amountOut);

        // Update inventory and forward to StrategyManager
        inventoryBalances[tokenIn] = newInventory;
        _flushToStrategyManager(tokenIn);

        emit SwapExecuted(tokenIn, receiver, amountIn, amountOut, cfg.discountBps);
    }

    // ─── UniV2 router interface ───────────────────────────────────────────────
    //
    // These aliases make AxiomVenue callable by any UniV2-compatible aggregator router
    // that calls swapExactTokensForTokens directly on a venue contract.
    //
    // For full auto-discovery via factory.getPair(), deploy AxiomUniV2Pair + AxiomFactory.

    /// @notice UniV2 router-compatible alias for swapRedeemableForBase.
    ///         path[0] = tokenIn (redeemable), path[1] = tokenOut (base asset).
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        if (path.length != 2) revert PathLengthInvalid(path.length);
        uint256 amountOut = swapRedeemableForBase(path[0], amountIn, amountOutMin, to);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    /// @notice UniV2 router-compatible alias — computes required input for an exact base output.
    ///         path[0] = tokenIn (redeemable), path[1] = tokenOut (base asset).
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        if (path.length != 2) revert PathLengthInvalid(path.length);

        AxiomTypes.SwapConfig storage cfg = swapConfigs[path[0]];
        if (!cfg.supported) revert AssetNotSupported(path[0]);

        // Reverse quote: amountIn = amountOut * BPS / (BPS - discountBps)
        // Ceiling division to ensure the seller provides enough to cover amountOut
        uint256 amountIn = (amountOut * BPS_DENOMINATOR + (BPS_DENOMINATOR - cfg.discountBps) - 1)
            / (BPS_DENOMINATOR - cfg.discountBps);

        if (amountIn > amountInMax) revert SlippageExceeded(amountIn, amountInMax);

        uint256 actualOut = swapRedeemableForBase(path[0], amountIn, amountOut, to);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = actualOut;
    }

    /// @notice UniV2 router-compatible price preview.
    ///         path[0] = tokenIn (redeemable), path[1] = base asset.
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        if (path.length != 2) revert PathLengthInvalid(path.length);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = getQuote(path[0], amountIn);
    }

    /// @notice UniV2 router-compatible reverse price preview.
    ///         path[0] = tokenIn (redeemable), path[1] = base asset.
    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        if (path.length != 2) revert PathLengthInvalid(path.length);
        AxiomTypes.SwapConfig storage cfg = swapConfigs[path[0]];
        if (!cfg.supported) revert AssetNotSupported(path[0]);
        uint256 amountIn = (amountOut * BPS_DENOMINATOR + (BPS_DENOMINATOR - cfg.discountBps) - 1)
            / (BPS_DENOMINATOR - cfg.discountBps);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    // ─── Inventory management ─────────────────────────────────────────────────

    /// @notice Manually flush accumulated rToken inventory to StrategyManager.
    ///         Called automatically after each swap; can also be called by keeper.
    function flushInventory(address asset) external {
        _flushToStrategyManager(asset);
    }

    // ─── Config: OPERATOR_ROLE ────────────────────────────────────────────────

    /// @notice Add or update a supported redeemable asset configuration.
    /// @param asset          The redeemable asset address
    /// @param supported      Activate/deactivate this asset
    /// @param discountBps    Discount in basis points (e.g. 20 = 0.20%)
    /// @param maxSwapSize    Max single-swap size for this asset
    /// @param maxInventory   Max total inventory before swaps are blocked
    /// @param redemptionAdapter Adapter contract that handles redemption of this asset
    function setSupportedAsset(
        address asset,
        bool supported,
        uint16 discountBps,
        uint256 maxSwapSize,
        uint256 maxInventory,
        address redemptionAdapter
    ) external onlyRole(OPERATOR_ROLE) {
        if (asset == address(0)) revert ZeroAddress();
        if (discountBps > MAX_DISCOUNT_BPS) revert DiscountTooHigh(discountBps, MAX_DISCOUNT_BPS);
        swapConfigs[asset] = AxiomTypes.SwapConfig({
            supported: supported,
            discountBps: discountBps,
            maxSwapSize: maxSwapSize,
            maxInventory: maxInventory,
            redemptionAdapter: redemptionAdapter
        });
        emit AssetConfigured(asset, swapConfigs[asset]);
    }

    /// @notice Update only the discount for an already-supported asset.
    function setDiscountBps(address asset, uint16 bps) external onlyRole(OPERATOR_ROLE) {
        if (!swapConfigs[asset].supported) revert AssetNotSupported(asset);
        if (bps > MAX_DISCOUNT_BPS) revert DiscountTooHigh(bps, MAX_DISCOUNT_BPS);
        swapConfigs[asset].discountBps = bps;
        emit AssetConfigured(asset, swapConfigs[asset]);
    }

    /// @notice Update the StrategyManager address.
    function setStrategyManager(address strategyManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (strategyManager_ == address(0)) revert ZeroAddress();
        strategyManager = IStrategyManagerRelay(strategyManager_);
        emit StrategyManagerUpdated(strategyManager_);
    }

    // ─── Pause ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Forward all accumulated inventory for `asset` to the StrategyManager.
    ///      StrategyManager will queue it for redemption via the configured adapter.
    function _flushToStrategyManager(address asset) internal {
        uint256 balance = inventoryBalances[asset];
        if (balance == 0) return;
        inventoryBalances[asset] = 0;
        IERC20(asset).safeTransfer(address(strategyManager), balance);
        strategyManager.receiveRedeemable(asset, balance);
        emit InventoryFlushed(asset, balance);
    }
}
