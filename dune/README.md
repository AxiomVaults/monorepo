# Dune Analytics Queries — Axiom Vault

Queries for Flow EVM (chain 747). All use the `flow_evm` schema on Dune Analytics.

## Setup

1. Open [dune.com](https://dune.com) → New Query
2. Select **Flow EVM** as the data source
3. Paste query content, replacing all `<PLACEHOLDER>` values:

| Placeholder | Value |
|---|---|
| `<VAULT_ADDRESS>` | `0xCace1b78160AE76398F486c8a18044da0d66d86D` |
| `<VENUE_ADDRESS>` | `0x34B40BA116d5Dec75548a9e9A8f15411461E8c70` |
| `<STRATEGY_MANAGER_ADDRESS>` | `0xD5ac451B0c50B9476107823Af206eD814a2e2580` |
| `<REDEMPTION_ADAPTER_ADDRESS>` | `0xc96304e3c037f81dA488ed9dEa1D8F2a48278a75` |
| `<PAIR_ADDRESS>` | `0x07882Ae1ecB7429a84f1D53048d35c4bB2056877` |
| `<FACTORY_ADDRESS>` | `0xD0141E899a65C95a556fE2B27e5982A6DE7fDD7A` |

> ⚠ These are **testnet fork addresses**. Replace with mainnet deployment addresses before publishing.

## Event Topic0 Reference

Pre-compute these keccak256 hashes and substitute into `<..._TOPIC0>` placeholders:

```
ERC-4626 Deposit(address,address,uint256,uint256)
  topic0 = 0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4d709d7

ERC-4626 Withdraw(address,address,address,uint256,uint256)
  topic0 = 0xfbde7971b16b72e8f8e2fa9be9b7d71e1c4f5519e000b9e37c9a1df3bc4b8b9f

UniV2 Swap(address,uint256,uint256,uint256,uint256,address)
  topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822

-- Compute the rest using: cast(keccak_hash('EventName(type,type,...)') as varchar)
-- Or: web3.utils.keccak256('SwapExecuted(address,address,address,uint256,uint256,uint256)')
```

## Query Files

| File | Description |
|---|---|
| [01_tvl_over_time.sql](01_tvl_over_time.sql) | Vault TVL per hour from Deposit/Withdraw events |
| [02_swap_volume.sql](02_swap_volume.sql) | Venue daily swap volume and discount revenue |
| [03_yield_allocations.sql](03_yield_allocations.sql) | Capital allocation in/out of yield strategies |
| [04_redemption_queue.sql](04_redemption_queue.sql) | Redemption queue depth, wait times, funnel |
| [05_share_price.sql](05_share_price.sql) | axWFLOW share price OHLC and APY estimate |
| [06_lp_pair_activity.sql](06_lp_pair_activity.sql) | UniV2 pair swap events and aggregator routing detection |

## Suggested Dashboard

1. **TVL card** — latest value from `01_tvl_over_time` (last row)
2. **TVL area chart** — `hour` vs `tvl_flow` from `01_tvl_over_time`
3. **Volume bar chart** — `day` vs `volume_ankrflow_in` from `02_swap_volume`
4. **Share price line** — `hour` vs `close` from `05_share_price`
5. **Redemption pending table** — current pending queue from `04_redemption_queue`
6. **Aggregator routing table** — aggregator detections from `06_lp_pair_activity`
