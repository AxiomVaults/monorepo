# Dune Analytics Queries - Axiom Vault

All addresses and topic0 hashes are pre-filled. Copy any query and paste directly into Dune Analytics -> New Query -> select **Flow EVM** chain.

## Contract Addresses

| Contract | Address |
|---|---|
| AxiomVault | `0xcace1b78160ae76398f486c8a18044da0d66d86d` |
| AxiomStrategyManager | `0xd5ac451b0c50b9476107823af206ed814a2e2580` |
| AxiomVenue | `0x34b40ba116d5dec75548a9e9a8f15411461e8c70` |
| AxiomFactory | `0xd0141e899a65c95a556fe2b27e5982a6de7fdd7a` |
| AxiomUniV2Pair | `0x07882ae1ecb7429a84f1d53048d35c4bb2056877` |
| AnkrRedemptionAdapter | `0xc96304e3c037f81da488ed9dea1d8f2a48278a75` |
| WFLOW | `0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e` |
| ankrFLOW | `0x1b97100eA1D7126C4d60027e231EA4CB25314bdb` |

## Event Topic0 Reference  (all pre-computed and already filled into the SQL)

| Event | Signature | topic0 |
|---|---|---|
| Deposit | `Deposit(address,address,uint256,uint256)` | `0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7` |
| Withdraw | `Withdraw(address,address,address,uint256,uint256)` | `0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db` |
| SwapExecuted | `SwapExecuted(address,address,uint256,uint256,uint256)` | `0x28c738dbec11a1bed94ba127a3712d54bcd39cf4ae95b6ebd671aaf10fd0287b` |
| AllocatedToYield | `AllocatedToYield(uint256,uint256)` | `0xd7068ffc5712961c5b574c5848a5d5aa84d81b2e67ee6a1b8f5ba6b7377bcc71` |
| DeallocatedFromYield | `DeallocatedFromYield(uint256,uint256)` | `0xfe68061eae052626a73a04629725f82f021d874047f9379085ba9236a325aa08` |
| RedemptionRequested | `RedemptionRequested(uint256,address,uint256,uint64)` | `0x73baede4549b15bc5bd693c38a8e083221a7764658b58d982510f094d44dd999` |
| RedemptionClaimed | `RedemptionClaimed(uint256,address,uint256)` | `0xa15008b6e695cc35d35421608ccb0ed390dab78c54707b1be30293cb76296c81` |
| Swap (UniV2) | `Swap(address,uint256,uint256,uint256,uint256,address)` | `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822` |

## Query Files

| File | Paste-ready? | Description |
|---|---|---|
| [01_tvl_over_time.sql](01_tvl_over_time.sql) | ✓ | Vault TVL per hour from Deposit/Withdraw events |
| [02_swap_volume.sql](02_swap_volume.sql) | ✓ | Venue daily swap volume and discount revenue |
| [03_yield_allocations.sql](03_yield_allocations.sql) | ✓ | Capital allocation in/out of yield strategies |
| [04_redemption_queue.sql](04_redemption_queue.sql) | ✓ | Redemption queue depth, wait times, funnel |
| [05_share_price.sql](05_share_price.sql) | ✓ | axWFLOW share price and APY estimate |
| [06_lp_pair_activity.sql](06_lp_pair_activity.sql) | ✓ | UniV2 pair swaps + aggregator routing detection |

## Suggested Dashboard Layout

1. **TVL card** — latest row from `01_tvl_over_time` → `tvl_flow`
2. **TVL area chart** — `hour` vs `tvl_flow`
3. **Daily volume bar** — `day` vs `volume_ankrflow_in` from `02_swap_volume`
4. **Discount revenue line** — `day` vs `discount_revenue_wflow`
5. **Share price line** — `hour` vs `share_price_wflow` from `05_share_price`
6. **Pending redemptions table** — from `04_redemption_queue` pending query
7. **Aggregator routing table** — from `06_lp_pair_activity` aggregator detection

