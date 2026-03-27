# Axiom Vaults

A Flow-native vault that acts as a liquidity venue. Spread capture on redeemable assets, with a secondary yield leg and full Eisen router compatibility.

## Axiom Vaults v1 — Module Reference

### Architecture

```
USER ──deposit(FUSD)──────────────────────────► AxiomVault (mints axFUSD shares)

USER ──swapRedeemableForBase(stFLOW, in)──────► AxiomVenue
           │  vault.authorizedTransfer(base, out, user)
           └─► StrategyManager.receiveRedeemable()
                 └─► MockRedemptionAdapter (async request, 5-min delay)
                 └─► claimRedemption() → base → vault

StrategyManager.allocateToYield()─────────────► MockYieldAdapter (5% APR)

Eisen Router ─────────────────────────────────► AxiomUniV2Pair.swap()
                                                   └─► AxiomVenue.swapRedeemableForBase()

Eisen Discovery ──getPair(FUSD, stFLOW)───────► AxiomFactory → AxiomUniV2Pair
```

### Contract files

| Contract | Path | Role |
|---|---|---|
| `AxiomVault` | `contracts/axiom/AxiomVault.sol` | Capital owner, ERC4626 shares |
| `AxiomVenue` | `contracts/axiom/AxiomVenue.sol` | Swap endpoint, UniV2 router aliases |
| `StrategyManager` | `contracts/axiom/StrategyManager.sol` | Yield / redemption coordinator |
| `AxiomFactory` | `contracts/axiom/router/AxiomFactory.sol` | Pair registry (Eisen discovery) |
| `AxiomUniV2Pair` | `contracts/axiom/router/AxiomUniV2Pair.sol` | UniV2 pair wrapper (Eisen routing) |
| `MockERC20` | `contracts/axiom/mocks/MockERC20.sol` | Testnet base asset (FUSD) |
| `MockRedeemableAsset` | `contracts/axiom/mocks/MockRedeemableAsset.sol` | Testnet rToken (stFLOW) |
| `MockRedemptionAdapter` | `contracts/axiom/mocks/MockRedemptionAdapter.sol` | Async redemption queue (5 min delay) |
| `MockYieldAdapter` | `contracts/axiom/mocks/MockYieldAdapter.sol` | Linear yield simulation (5% APR) |
| `IAxiomVault` | `contracts/axiom/interfaces/IAxiomVault.sol` | Vault interface |
| `IRedemptionAdapter` | `contracts/axiom/interfaces/IRedemptionAdapter.sol` | Redemption adapter interface |
| `IYieldAdapter` | `contracts/axiom/interfaces/IYieldAdapter.sol` | Yield adapter interface |
| `AxiomTypes` | `contracts/axiom/libraries/AxiomTypes.sol` | Shared struct library |

### Deployment — Flow EVM Testnet

Add the network to your `hardhat.config.js`:

```js
networks: {
  flowTestnet: {
    url: "https://testnet.evm.nodes.onflow.org",
    chainId: 545,
    accounts: [process.env.PRIVATE_KEY],
  }
}
```

**Step 1 — Deploy all contracts:**

```bash
npx hardhat run scripts/axiom/deployAxiom.js --network flowTestnet
```

Saves addresses to `scripts/axiom/deployed.json`.

**Step 2 — Wire roles and config:**

```bash
npx hardhat run scripts/axiom/configureAxiom.js --network flowTestnet
```

This will:
- Grant `VENUE_ROLE` on vault to `AxiomVenue`
- Grant `STRATEGY_MANAGER_ROLE` on vault to `StrategyManager`
- Configure stFLOW as supported asset (20 bps discount)
- Set vault reserve buffer to 10%
- Mint test tokens and make an initial deposit
- Fund `MockRedemptionAdapter` with FUSD for claim payouts

### Eisen router integration

After deployment, point Eisen at `AxiomFactory`:

```
AxiomFactory.getPair(FUSD, stFLOW) => AxiomUniV2Pair address
AxiomUniV2Pair.token0() => FUSD (base asset)
AxiomUniV2Pair.token1() => stFLOW (redeemable)
AxiomUniV2Pair.getReserves() => virtual reserves reflecting live vault liquidity + discount
```

The pair's `swap(amount0Out, 0, to, '')` routes through `AxiomVenue.swapRedeemableForBase()`.
No whitelisting required — Eisen discovers the pair automatically via factory scan.

> Note on virtual reserves: `getReserves()` returns computed values so the spot price matches
> the venue's discount. The K invariant is not enforced. For large trades, use
> `AxiomVenue.swapExactTokensForTokens()` for exact pricing.

### Key parameters (v1 defaults)

| Parameter | Value | Where |
|---|---|---|
| Discount | 20 bps | `AxiomVenue.swapConfigs[stFLOW].discountBps` |
| Reserve buffer | 10% | `AxiomVault.reserveBufferBps` |
| Max deposit | 10M FUSD | `AxiomVault.maxTotalDeposit` |
| Max swap size | 50k stFLOW | `AxiomVenue.swapConfigs[stFLOW].maxSwapSize` |
| Claim delay | 300s | `MockRedemptionAdapter.claimDelay` |
| Mock APR | 5% | `MockYieldAdapter.aprBps` |

### Flow: user sells stFLOW for FUSD

1. User approves `AxiomVenue` to spend stFLOW
2. User calls `venue.swapRedeemableForBase(stFLOW, amountIn, minOut, receiver)`
3. Venue pulls stFLOW, calls `vault.authorizedTransfer(receiver, amountOut)`
4. Vault checks `availableLiquidity()` and pays FUSD to receiver
5. Venue forwards stFLOW to `StrategyManager`
6. StrategyManager calls `redemptionAdapter.requestRedemption(stFLOW, amount)`
7. After 300s: operator calls `strategyManager.claimRedemption(requestId)`
8. Vault receives FUSD back at par, spread captured

---

## The Opportunity

ankrFLOW is always worth more than WFLOW because it continuously accrues staking rewards — so at any given moment 1 ankrFLOW should trade at a premium to WFLOW.

On PunchSwap it regularly doesn't. Sellers push the price below fair value, creating a temporary discount.

From 18 months of on-chain data from Flow EVM:

| Window | Stat |
|---|---|
| Weeks with spread > 50 bps | 17 of 48 tracked (35%) |
| Average discount during those windows | 243 bps |
| Largest single window | +695 bps in late Nov 2025 — over 1.2M ankrFLOW available |

## Plan

A Flow-native vault that acts as a liquidity venue, capturing yield from discounted redeemable assets.

Combines:
- Spread capture (buy below redemption value, redeem at par)
- Idle capital yield (lend unused liquidity)

Revenue scales with flow x spread, not just TVL.

### Core Mechanism

**Aggregator Flow** - External routers route swaps into the vault (best price execution)

**Spread Engine** - Buy discounted asset (e.g. staked derivative), redeem via protocol withdrawal queue, capture delta to par

**Capital Recycling** - Redeemed base asset returned to vault, reused for future swaps

**Lending Floor** - Idle capital allocated to lending strategies, ensures non-zero yield during low-arb periods

### Architecture

- Vault (ERC-4626 style) - handles deposits, shares, accounting
- Swap Interface (AMM-compatible) - allows aggregators to route flow directly
- Pricing Engine (off-chain + keeper) - dynamically updates buy/sell quotes
- Strategy Manager - arb queue allocation, lending allocation

### Yield Model

Primary: Spread from discounted redemptions  
Secondary: Lending APY on idle capital

Regime-dependent:
- Calm: lending-dominated
- Volatile: spread-dominated

### Key Design Goals

- Plug into aggregators permissionlessly via standard interface
- Maintain continuous liquidity (not episodic arbitrage)
- Optimize capital efficiency across regimes
- Avoid TVL dilution via dual-engine allocation