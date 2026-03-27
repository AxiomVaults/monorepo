# Axiom Vault — Roadmap

## What ships now

- ERC-4626 vault accepting WFLOW deposits
- Automated allocation to ankrFLOW staking when spread > 50 bps
- Share price accrual: yield compounds directly into axWFLOW value
- Deposit / withdraw UI with real-time vault stats
- Flow EVM (chain 747) native — no bridges required

---

## Near-term

### axWFLOW as collateral on MORE Markets
Holders of axWFLOW can supply it as collateral in [MORE Markets](https://www.more.markets/) and borrow WFLOW against it. This lets users lever their yield position: deposit WFLOW -> receive axWFLOW -> borrow WFLOW -> deposit again. The loop amplifies exposure to the vault's spread-capture returns without leaving the Flow ecosystem.

### axWFLOW liquidity token (liquid staking receipt)
axWFLOW becomes a transferable, composable receipt. Any protocol that integrates it can treat the continuously appreciating share as vanilla ERC-20 collateral. This opens the door to money markets, yield aggregators, and structured products on Flow using axWFLOW directly.

### On-chain allocation bot
Switch the manual strategy trigger to an on-chain Keeper or Gelato job. Bot monitors the ankrFLOW/WFLOW DEX rate on PunchSwap every block, fires `StrategyManager.allocate()` when spread > threshold, and `rebalance()` when it normalizes. Full path from signal to execution becomes trustless.

---

## Medium-term

### Multi-asset vault support
Expand beyond WFLOW to support other Flow liquid staking tokens (stFLOW, etc.) and stable assets. Each asset class gets its own vault instance deployed via `AxiomFactory`, and a shared `StrategyManager` routes capital to the best available spread opportunity at any given time.

### Configurable spread threshold (governance)
Vault operator parameters (minimum spread, reserve buffer, max deposit cap) move from admin multisig to a lightweight on-chain governance contract. Tokenholders vote on strategy parameters; the vault reads them trustlessly.

### Risk engine integration
Connect the vault's allocation decisions to an on-chain risk oracle that factors in DEX depth, ankrFLOW redemption queue length, and FLOW price volatility. Allocations pause automatically if any risk metric crosses a safety threshold.

---

## Long-term

### Loop strategy product
Package the axWFLOW -> MORE Markets borrow -> re-deposit loop as a one-click product. Users specify a target leverage multiplier; the vault executes the loop automatically and unwinds on withdrawal. Leverage is bounded by the vault's own collateral ratio to stay solvent across market conditions.

### Cross-chain expansion
Deploy Axiom vaults on other EVM chains where liquid staking spreads exist (Ethereum LSDs, Cosmos liquid staking on dYdX, etc.). A cross-chain messaging layer lets liquidity flow to the highest-yield venue automatically. Flow EVM remains the primary deployment; satellite vaults bridge yield back.

### Structured yield products
Offer fixed-rate tranches backed by Axiom Vault's variable yield. Senior tranche holders receive a guaranteed fixed rate; junior tranche holders absorb variance and earn higher returns during high-spread windows. Structured on top of existing contracts without modifying the base vault.

### Institutional API
REST + GraphQL interface exposing vault APY, TVL, and historical allocation data for portfolio managers and analytics dashboards. Rate-limited public tier; authenticated tier for protocol integrators.

---

## Version milestones

| Version | Focus |
|---------|-------|
| v1.0 | Vault live, manual allocation, dApp UI |
| v1.1 | axWFLOW listed as MORE Markets collateral |
| v1.2 | Automated on-chain Keeper |
| v2.0 | Multi-asset vaults + governance |
| v2.1 | Loop strategy product |
| v3.0 | Cross-chain vaults, structured tranches |
