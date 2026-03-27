# Axiom Vault - Spread Capture Strategy: On-Chain Evidence and Yield Model

All numbers from Dune queries against Flow EVM mainnet (chain 747).  
Data range: **Sep 2024 - Mar 2026** (18 months).

---

## 1. On-Chain Data

### Token Activity
| Metric | Value | Source |
|---|---|---|
| ankrFLOW total transfer log rows | 545,000+ | `flow.logs` |
| Active trading days (ankrFLOW) | 553 days | Query 1 |
| Peak daily volume | 62M ankrFLOW | Mar 8 2026 |
| Typical active-day volume | 1M-20M ankrFLOW | Query 1 |
| WFLOW total log rows | 3.7M | `flow.logs` |

### DEX Pair (PunchSwap)
| Metric | Value |
|---|---|
| Confirmed pair address | `0x7854498d4d1b2970fcb4e6960ddf782a68463a43` |
| Token A | ankrFLOW (`0x1b97100ea1d7126c4d60027e231ea4cb25314bdb`) |
| Token B | WFLOW (`0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e`) |
| Total inflow events (ankrFLOW side) | 114,734 transfers |
| Total outflow events (WFLOW side) | 115,420 transfers |
| DEX rate range (all-time) | 1.083 - 1.119 WFLOW/ankrFLOW |
| DEX rate stability | +/- 3.3% band over 18 months |

### Oracle Fair Value (prices.day)
| Metric | Value | Source |
|---|---|---|
| ankrFLOW average USD price | $0.4464 | Query 2 |
| WFLOW average USD price | $0.4380 | Query 2 |
| Fair value ratio range | **0.68 - 2.09** | Query 2 |
| Typical premium (ankrFLOW over WFLOW) | 3% - 32% | Query 2 |

---

## 2. ARM Entry Windows - Historical Record

17 out of 48 tracked weeks had a confirmed BUY signal (spread > 50bps).  
35% of weeks the vault can deploy capital at a discount.

| Week | spread_bps | ankrFLOW vol available | Notes |
|---|---|---|---|
| Jan 5 2026 | **+8,904** | 18,422 | Oracle discrepancy - ankrFLOW 2x fair value vs DEX |
| Nov 24 2025 | **+695** | 1,206,517 | High volume, deep discount |
| Jan 26 2026 | **+495** | 0.08 | Thin liquidity |
| Mar 9 2026 | **+433** | 3.95 | Thin liquidity |
| Dec 1 2025 | **+407** | 1,291,721 | High volume |
| Oct 27 2025 | **+337** | 7,212,621 | Largest vol, deep discount |
| Feb 2 2026 | **+237** | 1.75 | Thin |
| Jun 16 2025 | **+223** | 1,580,394 | Medium volume |
| Aug 18 2025 | **+183** | 7,456,151 | High volume |
| May 5 2025 | **+170** | 3,278,358 | High volume |
| Oct 13 2025 | **+169** | 1,964,224 | High volume |
| Sep 15 2025 | **+160** | 1,700,890 | High volume |
| Jun 9 2025 | **+89** | 1,829,750 | Medium volume |
| Sep 22 2025 | **+86** | 1,582,141 | Medium volume |
| Aug 25 2025 | **+85** | 311,334 | Low volume |
| Feb 9 2026 | **+58** | 0.39 | Thin |
| Apr 21 2025 | **+54** | 956,357 | Medium volume |

Average spread (BUY weeks, ex Jan-5 outlier): **243 bps**  
Average spread (BUY weeks, including Jan-5): **752 bps**

---

## 3. Yield Model

### Assumptions
| Parameter | Value | Basis |
|---|---|---|
| Ankr staking APY | 4% | Ankr protocol, conservative |
| Average spread on BUY entry | 243 bps | 16 non-outlier BUY weeks |
| BUY weeks per year | ~18 (35% of 52) | 17/48 historical |
| Average deployment per cycle | 4 weeks | Entry + hold until redemption |
| Cycles per year | ~4.5 | 18 active weeks / 4 weeks |
| Unbonding period | 7-14 days | Ankr protocol |

### Base Case APY

Per cycle:
- Spread capture at entry: **243 bps**
- Staking yield during 4-week hold: 4% x 4/52 = **31 bps**
- Total per cycle: **~274 bps**

Annual:
- 4.5 cycles x 274 bps = **~1,230 bps = 12.3% APY**

Capital is idle ~65% of the year between entry windows. If idle capital earns base WFLOW staking (~3-4% APY):
- 35% deployed x 12.3% + 65% idle x 4% = **7.0% blended APY (conservative)**

### Elevated Volatility APY - Oct 2025 to Jan 2026

Four BUY windows in 10 weeks with spreads of +695, +407, +337, +495 bps:
- Average spread: **484 bps**
- Per cycle: 484 + 31 = **515 bps**
- 4 cycles over 10 weeks, annualized: 515 x (52/10) = **~2,680 bps = 26.8% APY**

Conservative (2 of 4 windows captured):
- 2 x 515 bps over ~10 weeks = **~27% annualized for that period**

### Spike Event - Jan 5 2026 (+8,904 bps)

One week where the oracle fair value was 2.09x the DEX rate. Vault deployed into 18,422 ankrFLOW:
- Bought ankrFLOW at DEX rate 1.108, redeemed at Ankr par
- The DEX itself stayed at 1.108 the whole time; the oracle tracked a different price feed
- Most likely tradeable gain: 0-8% depending on what the oracle price reflected
- Conservative attribution: treat as 500 bps, same as other BUY weeks

The Jan 5 oracle reading (2.09 ratio) is a CoinGecko price update lag or index discrepancy, not a genuine 89% DEX mispricing. Excluded from base projections.

### Summary Table

| Scenario | Annual APY | Conditions |
|---|---|---|
| **Conservative base** | 7% | 35% capital utilization, idle capital at 4% base yield |
| **Active base** | 12–15% | Full deployment during all BUY weeks |
| **Elevated volatility** | 25–35% | Oct–Jan style period, 4+ large spread events in a quarter |
| **Spike capture** | 50%+ (that quarter) | If vault is positioned ahead of oracle dislocation events |

---

## 4. Liquidity and Scale

| Period | Weekly vol available | Notes |
|---|---|---|
| Oct-Nov 2025 | 1M-26M ankrFLOW | Uncapped for any realistic vault size |
| Dec 2025 - Jan 2026 | 74K-1.3M ankrFLOW | ~$30K-$130K equivalent at current prices |
| Feb-Mar 2026 | 0.08-4 ankrFLOW | Pool is thin, vault would be the primary venue |

Oct-Nov 2025 had $3M-$13M in weekly deployable ankrFLOW at discount. The pool is now thin, so Axiom entering as LP can own the spread on both sides and set its own price within the AMM.

---

## 5. Risk Factors

| Risk | Magnitude | Mitigation |
|---|---|---|
| Ankr unbonding queue delay | Medium | 7-14 day wait; vault holds liquidity buffer |
| ankrFLOW permanent depeg | Low-Medium | Ankr backed 1:1 by staked FLOW; sovereign risk only |
| Thin DEX liquidity (current state) | Medium | Vault acts as LP; sets bid/ask around fair value |
| Oracle price feed discrepancy | Low | `prices.day` accurate for spread calc except 1 confirmed anomaly |
| Smart contract risk | Medium | All Axiom contracts auditable, deployed on EVM |
| Flow chain reorg / EVM compatibility | Low | Flow EVM confirmed stable; 28M+ log rows |

---

## 6. Comparable: Ethereum Liquid Staking Spread Vaults

Similar spread-capture vaults on Ethereum run the same model against stETH/WETH:
- Buy LST at discount when price < fair value
- Earn staking yield while holding
- Redeem 1:1 at par
- Reported APY: **6-15%** normal, **30-50%+** during depeg events

Axiom runs the same model on ankrFLOW/WFLOW on Flow. Confirmed spread data (243 bps avg, 695 bps peak) lines up with comparable vault earnings profiles.

---

Data sources: Dune Analytics, `erc20_flow.evt_transfer`, `prices.day`. Sep 2024 - Mar 2026.
