# Axiom

**Yield-optimized capital on Flow EVM — live on mainnet.**

---

## The Problem

Most FLOW holders earn nothing.

Native staking via Ankr produces ~7% APY in the form of ankrFLOW — a liquid receipt token — but the process is manual, the yield is passive, and it leaves a systematic edge uncaptured.

ankrFLOW has traded at a persistent discount to its WFLOW redemption value on PunchSwap for 18 consecutive months.

---

## The Opportunity

Over 18 months of on-chain data, the ankrFLOW/WFLOW spread on PunchSwap averaged **243 basis points**.

35% of all weeks exceeded 50 bps, and the peak spread reached **+695 bps**.

This is not noise — it is a structural imbalance between patient capital willing to hold ankrFLOW to redemption and impatient capital wanting immediate WFLOW liquidity.

Axiom sits on the patient side of that trade — systematically buying the discount, earning staking yield, and redeeming at par.

---

## What Axiom Does

Axiom is an ERC-4626 vault that accepts WFLOW deposits and issues **axWFLOW** — a yield-bearing share token that appreciates as the vault earns.

Capital is routed across four integrated yield adapters — no single point of failure, no manual rebalancing required.

| Strategy | Protocol | Est. APY |
|---|---|---|
| ankrFLOW Staking | Ankr | ~7% |
| Leveraged Staking | Ankr + MORE Markets | ~12% |
| WFLOW Lending | MORE Markets | ~6% |
| LP Farming | PunchSwap V2 | ~4% |

A keeper bot reads live APYs from each protocol every hour and calls `autoRebalance()` — idle capital always moves to whichever adapter is currently highest.

---

## Compounding Utility

axWFLOW is accepted as collateral on MORE Markets.

This enables a looping strategy: deposit WFLOW → receive axWFLOW → post as collateral → borrow WFLOW → deposit again.

Each loop compounds yield on top of yield, with axWFLOW's underlying value increasing every block.

Modelled net returns range from **~7% APY** (single deposit, no leverage) to **25–35% APY** (full looping, leveraged staking adapter).

---

## Live on Mainnet

10 contracts are deployed and verified on Flow EVM mainnet (chainId 747) as of 27 March 2026.

The integration test suite passes 10/10 against live mainnet state — deposit, autoRebalance, rotateCapital, setAdapterApy, deallocateAll, and full withdrawal all verified.
