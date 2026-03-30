# Axiom Vault

Flow-native ERC-4626 vault. Acts as a UniV2-compatible swap venue on Eisen, capturing spread on ankrFLOW/WFLOW trades. Idle capital deployed across four yield adapters automatically.

Live on Flow EVM mainnet (chain 747).

## The Idea

ankrFLOW accrues staking rewards continuously, so it should always trade at a premium to WFLOW. On PunchSwap it regularly doesn't. Sellers push the price below fair value.

The vault sits as a liquidity venue in Eisen's routing graph. When traders swap ankrFLOW -> WFLOW, the trade routes through the vault. The vault buys ankrFLOW at the discount and redeems it at par via Ankr's protocol, pocketing the spread. No leverage, no liquidation risk.

From 18 months of on-chain data:

| Metric | Value |
|---|---|
| Weeks with spread > 50 bps | 17 of 48 (35%) |
| Average discount during those windows | 243 bps |
| Largest window | 695 bps (Nov 2025), 1.2M ankrFLOW available |

Modelled yield:

| Regime | APY |
|---|---|
| Conservative blended | ~7% |
| Active spread windows | 12-15% |
| High volatility (Oct-Jan) | 25-35% |

## How It Works

1. Deposit WFLOW, receive axWFLOW shares
2. Vault implements UniV2 swap interface -- Eisen auto-discovers it, no whitelisting needed
3. ankrFLOW/WFLOW swap flow is routed through the vault by Eisen
4. Vault captures spread on every routed trade
5. Idle capital between swaps is deployed to the four adapters below
6. All yield accrues into the axWFLOW share price -- no claiming needed
7. Redeem shares anytime for WFLOW + yield

## Architecture

```
USER ──deposit(WFLOW)─────────────────────────► AxiomVault (mints axWFLOW shares)

Eisen Router ─────────────────────────────────► AxiomUniV2Pair.swap()
                                                   └─► AxiomVenue.swapRedeemableForBase()
                                                         └─► ankrFLOW -> redeem at par -> WFLOW

Eisen Discovery ──getPair(WFLOW, ankrFLOW)────► AxiomFactory -> AxiomUniV2Pair

MultiStrategyManager ─────────────────────────► allocateTo(id, amount)
    ├── id=0  AnkrMOREYieldAdapter  (leveraged staking via MORE Markets)
    ├── id=1  AnkrYieldAdapter      (plain ankrFLOW staking)
    ├── id=2  MORELendingAdapter    (WFLOW supply to MORE Markets)
    └── id=3  PunchSwapLPAdapter    (ankrFLOW/WFLOW LP on PunchSwap V2)

Keeper bot ───────────────────────────────────► setAdapterApy() + autoRebalance()
```

## Deployed Contracts (Flow EVM mainnet)

| Contract | Address |
|---|---|
| AxiomVault | `0x2E6e627f8E5B019c85aC6f7A033D928741F65568` |
| MultiStrategyManager | `0x77b326C1015ab95fae5491fBB0B658313E216A10` |
| AxiomVenue | `0x507f4A207215baA279bCDaEE606b5D66e08d6f69` |
| AxiomFactory | `0x81ed24669E20edb2DC282b909D898F78cfB7aE50` |
| AxiomUniV2Pair (WFLOW/ankrFLOW) | `0xD9C5414C5d854E5760Ba7da443104272834dA624` |
| AnkrMOREYieldAdapter | `0x83d0147715edF136dC91563A343Ab1617732478f` |
| AnkrRedemptionAdapter | `0x866Af4F785C685D157ba9100Dd6AceE87eC5E295` |
| WFLOW | `0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e` |
| ankrFLOW | `0x1b97100eA1D7126C4d60027e231EA4CB25314bdb` |

## Yield Adapters

| ID | Adapter | Strategy | Baseline APY |
|---|---|---|---|
| 0 | `AnkrMOREYieldAdapter` | Stake WFLOW -> ankrFLOW, supply to MORE Markets, borrow WFLOW at 60% LTV | ~12% |
| 1 | `AnkrYieldAdapter` | Plain ankrFLOW liquid staking | ~7% |
| 2 | `MORELendingAdapter` | Supply WFLOW to MORE Markets lending pool | ~2-6% |
| 3 | `PunchSwapLPAdapter` | ankrFLOW/WFLOW LP farming on PunchSwap V2 | ~4-11% |

A keeper bot monitors live APYs and calls `autoRebalance()` to shift capital to the highest-yielding adapter.

## Eisen Integration

The vault implements a standard UniV2 factory/pair interface:

```
AxiomFactory.getPair(WFLOW, ankrFLOW) => AxiomUniV2Pair address
AxiomUniV2Pair.token0() => WFLOW
AxiomUniV2Pair.token1() => ankrFLOW
AxiomUniV2Pair.getReserves() => virtual reserves reflecting vault liquidity + discount
AxiomUniV2Pair.swap(amount0Out, 0, to, '') => routes through AxiomVenue
```

Eisen discovers the pair automatically via factory scan. No partnership or whitelisting required.

`getReserves()` returns computed values so the spot price reflects the configured discount. The K invariant is not enforced. For large trades use `AxiomVenue.swapExactTokensForTokens()` for exact pricing.

## Key Parameters

| Parameter | Value |
|---|---|
| ankrFLOW discount | 20 bps |
| Reserve buffer | 10% (always liquid for withdrawals) |
| Borrow fraction (adapter 0) | 60% LTV |

## Running the Demo Scripts

```bash
cd contract-deployment

# Live system status
node_modules/.bin/hardhat run scripts/interact-real/status.js --network flow_mainnet

# Eisen aggregator discovery + swap
node_modules/.bin/hardhat run scripts/interact-real/testEisenSwap.js --network flow_mainnet

# AnkrMORE leveraged yield adapter
node_modules/.bin/hardhat run scripts/interact-real/testRealYield.js --network flow_mainnet

# Full end-to-end cycle
node_modules/.bin/hardhat run scripts/interact-real/testRealFullCycle.js --network flow_mainnet
```

## Contract Source Files

| Contract | Path |
|---|---|
| `AxiomVault` | `contracts/axiom/AxiomVault.sol` |
| `AxiomVenue` | `contracts/axiom/AxiomVenue.sol` |
| `MultiStrategyManager` | `contracts/axiom/MultiStrategyManager.sol` |
| `AxiomFactory` | `contracts/axiom/router/AxiomFactory.sol` |
| `AxiomUniV2Pair` | `contracts/axiom/router/AxiomUniV2Pair.sol` |
| `AnkrMOREYieldAdapter` | `contracts/axiom/adapters/AnkrMOREYieldAdapter.sol` |
| `AnkrYieldAdapter` | `contracts/axiom/adapters/AnkrYieldAdapter.sol` |
| `MORELendingAdapter` | `contracts/axiom/adapters/MORELendingAdapter.sol` |
| `PunchSwapLPAdapter` | `contracts/axiom/adapters/PunchSwapLPAdapter.sol` |
| `AnkrRedemptionAdapter` | `contracts/axiom/adapters/AnkrRedemptionAdapter.sol` |

## Post-Launch

If axWFLOW gets listed as collateral on MORE Markets, users can loop the position through MORE to amplify returns without leaving the Flow ecosystem.