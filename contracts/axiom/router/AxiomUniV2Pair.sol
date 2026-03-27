// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAxiomVenueSwap {
    function swapRedeemableForBase(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver
    ) external returns (uint256 amountOut);

    function getQuote(address tokenIn, uint256 amountIn) external view returns (uint256);
}

interface IAxiomVaultLiquidity {
    function availableLiquidity() external view returns (uint256);
}

/// @title AxiomUniV2Pair
/// @notice A UniswapV2Pair-compatible adapter that wraps AxiomVenue for permissionless
///         discovery and routing by aggregators such as Eisen.
///
/// @dev ─── CRITICAL PRICING NOTE ───
///      This is NOT a constant-product AMM. The K invariant is NOT enforced.
///      Prices are driven by a fixed discount configuration in AxiomVenue, not reserves.
///      getReserves() returns VIRTUAL reserves that are computed to match the discount price.
///      These virtual reserves exist solely for price discovery by routers that call getReserves().
///
///      Virtual reserve formula:
///        reserve0 (base asset) = vault.availableLiquidity()
///        reserve1 (rToken)     = reserve0 * BPS / (BPS - discountBps)
///      This means: reserve1/reserve0 = effectivePrice, matching the venue's actual swap rate.
///
///      ─── UniV2 INTERFACE COVERAGE ───
///      Implemented:  token0, token1, factory, getReserves, swap, price0CumulativeLast,
///                    price1CumulativeLast, kLast, MINIMUM_LIQUIDITY
///      Stubbed (no LP):  totalSupply=0, balanceOf=0, mint→revert, burn→revert, sync, skim
///      NOT implemented:  permit, ERC20 share token (no LP shares in this venue design)
///
///      ─── SWAP DIRECTION ───
///      This pair only supports one direction: token1 → token0 (sell rToken, receive base).
///      Selling base asset to receive rToken is blocked (single-directional venue).
///      amount0Out > 0, amount1Out == 0 in swap().
///
///      ─── EISEN INTEGRATION ───
///      1. Deploy this pair: AxiomUniV2Pair(factory, baseAsset, rToken, venue)
///      2. Register: AxiomFactory.registerPair(baseAsset, rToken, pairAddress)
///      3. Eisen scans AxiomFactory.allPairs() → finds this pair → reads token0/token1/getReserves
///      4. Eisen routes a trade → calls this.swap(amount0Out, 0, to, '') → delegates to venue
contract AxiomUniV2Pair is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────

    error LPNotSupported();
    error InvalidSwapDirection();
    error InsufficientInputAmount();
    error InsufficientLiquidity();
    error DeadlineExpired();
    error ZeroAddress();
    error OnlyVenue();

    // ─── Events (IUniswapV2Pair-compatible) ───────────────────────────────────

    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice IUniswapV2Pair-compatible constant
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    // ─── Immutables ──────────────────────────────────────────────────────────

    /// @notice IUniswapV2Factory address (AxiomFactory)
    address public immutable factory;

    /// @notice token0 = base asset (e.g. FUSD) — what traders receive
    address public immutable token0;

    /// @notice token1 = redeemable asset (e.g. stFLOW) — what traders sell
    address public immutable token1;

    /// @notice The AxiomVenue that executes swaps
    IAxiomVenueSwap public immutable venue;

    /// @notice The AxiomVault used for virtual reserve calculation
    IAxiomVaultLiquidity public immutable vault;

    /// @notice Discount in bps stored here for virtual reserve computation (mirrors venue config)
    /// @dev Kept here to avoid an extra SLOAD on the venue for every getReserves() call.
    ///      Must be updated via setDiscountBps() when the venue config changes.
    uint16 public discountBps;

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint256 public kLast; // 0 — no K invariant enforced

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param factory_    AxiomFactory address
    /// @param token0_     Base asset address (e.g. FUSD)
    /// @param token1_     Redeemable asset address (e.g. stFLOW)
    /// @param venue_      AxiomVenue address
    /// @param vault_      AxiomVault address (for reserve0 computation)
    /// @param discountBps_ Initial discount in bps (must match venue config for this pair)
    constructor(
        address factory_,
        address token0_,
        address token1_,
        address venue_,
        address vault_,
        uint16 discountBps_
    ) {
        if (factory_ == address(0) || token0_ == address(0) || token1_ == address(0)
            || venue_ == address(0) || vault_ == address(0)) revert ZeroAddress();
        factory = factory_;
        token0 = token0_;
        token1 = token1_;
        venue = IAxiomVenueSwap(venue_);
        vault = IAxiomVaultLiquidity(vault_);
        discountBps = discountBps_;
    }

    // ─── IUniswapV2Pair: Core interface ───────────────────────────────────────

    /// @notice Returns virtual reserves for price discovery.
    ///
    ///         reserve0 = vault.availableLiquidity() (live base asset available)
    ///         reserve1 = reserve0 * BPS / (BPS - discountBps) (virtual rToken supply)
    ///
    ///         The ratio reserve1/reserve0 gives the effective exchange rate traders receive,
    ///         matching the venue's actual getQuote() output exactly.
    ///
    ///         UniV2 routers compute: amountOut = amountIn * reserve0 / (reserve1 + amountIn)
    ///         For large trades this diverges from our flat-rate pricing.
    ///         We therefore recommend routing through swapExactTokensForTokens on AxiomVenue
    ///         directly for exact pricing; getReserves is primarily for price discovery / sorting.
    function getReserves()
        public
        view
        returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32 blockTimestampLast
        )
    {
        uint256 liq = vault.availableLiquidity();
        // Cap to uint112 max
        if (liq > type(uint112).max) liq = type(uint112).max;
        reserve0 = uint112(liq);

        if (discountBps < BPS_DENOMINATOR && liq > 0) {
            uint256 virt = (liq * BPS_DENOMINATOR) / (BPS_DENOMINATOR - discountBps);
            if (virt > type(uint112).max) virt = type(uint112).max;
            reserve1 = uint112(virt);
        } else {
            reserve1 = reserve0;
        }

        blockTimestampLast = uint32(block.timestamp % 2**32);
    }

    /// @notice UniV2-compatible swap entry point.
    ///
    ///         IMPORTANT: Only the token1→token0 direction is supported (sell rToken, receive base).
    ///
    /// @notice Execute a one-way swap: sell token1 (rToken) to receive token0 (base).
    ///         The caller must transfer token1 to this pair BEFORE calling swap(),
    ///         following the UniV2 pay-first pattern. This contract measures the delta
    ///         and delegates to AxiomVenue.
    ///
    /// @param amount0Out Amount of token0 (base) the caller expects to receive
    /// @param amount1Out Must be 0 -- reverse direction not supported
    /// @param to         Recipient of token0
    /// @param data       Must be empty (no flash loan support in v1)
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external nonReentrant {
        if (amount1Out != 0) revert InvalidSwapDirection();
        if (amount0Out == 0) revert InsufficientInputAmount();
        if (to == address(0)) revert ZeroAddress();
        if (data.length != 0) revert InvalidSwapDirection(); // no flash loan in v1

        // Measure how much token1 (rToken) was pre-sent by the caller (UniV2 pay-first)
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        if (balance1 == 0) revert InsufficientInputAmount();

        // Slippage guard: quoted output must meet the caller's minimum
        uint256 quoted = venue.getQuote(token1, balance1);
        if (quoted < amount0Out) revert InsufficientLiquidity();

        // Approve venue to pull balance1 token1 from this pair, then call the swap.
        // This pair is msg.sender to venue; venue will safeTransferFrom(address(this), ...).
        // Zero-then-set pattern for ERC20 approve safety.
        IERC20(token1).safeApprove(address(venue), 0);
        IERC20(token1).safeApprove(address(venue), balance1);

        // Venue pulls token1 from this pair and sends base asset to `to`
        uint256 amountOut = venue.swapRedeemableForBase(token1, balance1, amount0Out, to);

        // Zero out residual approval
        IERC20(token1).safeApprove(address(venue), 0);

        emit Swap(msg.sender, 0, balance1, amountOut, 0, to);

        // Emit Sync with updated virtual reserves
        (uint112 r0, uint112 r1,) = getReserves();
        emit Sync(r0, r1);
    }

    // ─── IUniswapV2Pair: LP stubs (not supported) ─────────────────────────────

    function totalSupply() external pure returns (uint256) { return 0; }
    function balanceOf(address) external pure returns (uint256) { return 0; }

    function mint(address) external pure returns (uint256) {
        revert LPNotSupported();
    }

    function burn(address) external pure returns (uint256, uint256) {
        revert LPNotSupported();
    }

    function sync() external view {
        // No-op: virtual reserves are always recomputed on-the-fly
    }

    function skim(address) external pure {
        // No-op
    }
}
