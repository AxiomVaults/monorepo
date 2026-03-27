-- 07_market_opportunity.sql
-- Axiom Vault strategy validation: prove the ankrFLOW depeg-arbitrage opportunity on Flow EVM
--
-- Strategy thesis (like Origin ARM but for Flow wrapped tokens):
--   1. Buy ankrFLOW at a DISCOUNT on secondary markets (DEX spot price < fair value)
--   2. Deploy to yield: Ankr staking accumulation + MORE lending spread
--   3. Redeem 1:1 at par via Ankr unbonding → pocket the discount + accrued yield
--   Profit = depeg spread + staking APY + MORE borrow rate
--
-- Token addresses (Flow EVM mainnet, chain 747)
--   WFLOW:    0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
--   ankrFLOW: 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
--   Ankr Staking:  0xfe8189a3016cb6a3668b8ccdac520ce572d4287a
--   MORE Pool:     0xbc92aac2dbbf42215248b5688eb3d3d2b32f2c8d
--
-- ── QUERY 1 (PRIMARY): Implied ankrFLOW/WFLOW Exchange Rate from On-Chain Swaps ────────────────
-- Finds any tx where a wallet sent ankrFLOW and received WFLOW (or vice versa).
-- Implied price < 1.0 WFLOW per ankrFLOW = discount opportunity.

WITH ankrflow_out AS (
  -- transfers where wallets SENT ankrFLOW (into a DEX)
  SELECT
    block_time,
    tx_hash,
    '0x' || "right"(cast(topic1 AS varchar), 40) AS sender,
    '0x' || "right"(cast(topic2 AS varchar), 40) AS recipient,
    bytearray_to_uint256(data) / 1e18              AS ankrflow_amount
  FROM flow.logs
  WHERE contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    AND '0x' || "right"(cast(topic1 AS varchar), 40) != '0x0000000000000000000000000000000000000000'
    AND '0x' || "right"(cast(topic2 AS varchar), 40) != '0x0000000000000000000000000000000000000000'
),
wflow_in AS (
  -- transfers where wallets RECEIVED WFLOW (back from a DEX)
  SELECT
    tx_hash,
    '0x' || "right"(cast(topic1 AS varchar), 40) AS wflow_from,
    '0x' || "right"(cast(topic2 AS varchar), 40) AS wflow_to,
    bytearray_to_uint256(data) / 1e18              AS wflow_amount
  FROM flow.logs
  WHERE contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    AND '0x' || "right"(cast(topic2 AS varchar), 40) != '0x0000000000000000000000000000000000000000'
),
swap_prices AS (
  -- Match: same tx, same user sent ankrFLOW and received WFLOW
  SELECT
    a.block_time,
    a.tx_hash,
    a.sender                                              AS swapper,
    a.ankrflow_amount,
    w.wflow_amount,
    w.wflow_amount / NULLIF(a.ankrflow_amount, 0)        AS price_wflow_per_ankrflow,
    (1.0 - w.wflow_amount / NULLIF(a.ankrflow_amount, 0)) * 100 AS discount_pct,
    'ankrFLOW→WFLOW'                                     AS direction
  FROM ankrflow_out a
  JOIN wflow_in w ON a.tx_hash = w.tx_hash
    AND a.sender = w.wflow_to    -- same address sent ankrFLOW and received WFLOW
  WHERE a.ankrflow_amount > 0.01
    AND w.wflow_amount > 0.01
)
SELECT
  block_time,
  tx_hash,
  swapper,
  ROUND(ankrflow_amount, 4)         AS ankrflow_in,
  ROUND(wflow_amount, 4)            AS wflow_out,
  ROUND(price_wflow_per_ankrflow, 6) AS price,
  ROUND(discount_pct, 4)            AS discount_pct,
  direction
FROM swap_prices
ORDER BY block_time DESC


/* ── SEPARATE DUNE QUERY 2: WFLOW Wrap/Unwrap Volume (Flow DeFi Activity Scale) ────────────────
   A wrap = user bridged or wrapped FLOW into WFLOW to use in DeFi.
   Paste the SELECT below as a new Dune query.

WITH daily_wflow AS (
  SELECT
    date_trunc('day', block_time)                          AS day,
    SUM(CASE WHEN topic0 = 0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c
             THEN bytearray_to_uint256(data) / 1e18 ELSE 0 END) AS wflow_wrapped,
    SUM(CASE WHEN topic0 = 0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65
             THEN bytearray_to_uint256(data) / 1e18 ELSE 0 END) AS wflow_unwrapped,
    COUNT(DISTINCT CASE WHEN topic0 = 0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c
             THEN '0x' || "right"(cast(topic1 AS varchar), 40) END) AS unique_wrappers
  FROM flow.logs
  WHERE contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    AND topic0 IN (
      0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c,  -- Deposit
      0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65   -- Withdrawal
    )
  GROUP BY 1
)
SELECT
  day,
  ROUND(wflow_wrapped, 2)     AS flow_wrapped_into_defi,
  ROUND(wflow_unwrapped, 2)   AS flow_unwrapped_from_defi,
  unique_wrappers,
  ROUND(SUM(wflow_wrapped) OVER (ORDER BY day), 2) AS cumulative_wrapped_all_time
FROM daily_wflow
ORDER BY day DESC

*/


/* ── SEPARATE DUNE QUERY 3: ankrFLOW Secondary Market Activity ──────────────────────────────────
   Tracks daily ankrFLOW transfer volume (excludes mints/burns from staking contract).
   High velocity → active secondary market → viable swap venue.
   Paste the SELECT below as a new Dune query.

WITH ankr_activity AS (
  SELECT
    date_trunc('day', block_time) AS day,
    '0x' || "right"(cast(topic1 AS varchar), 40) AS from_addr,
    '0x' || "right"(cast(topic2 AS varchar), 40) AS to_addr,
    bytearray_to_uint256(data) / 1e18             AS amount
  FROM flow.logs
  WHERE contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
    AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    AND '0x' || "right"(cast(topic1 AS varchar), 40) != '0x0000000000000000000000000000000000000000'
    AND '0x' || "right"(cast(topic2 AS varchar), 40) != '0x0000000000000000000000000000000000000000'
    -- exclude Ankr staking contract mints/distributions
    AND '0x' || "right"(cast(topic1 AS varchar), 40) != '0xfe8189a3016cb6a3668b8ccdac520ce572d4287a'
    AND '0x' || "right"(cast(topic2 AS varchar), 40) != '0xfe8189a3016cb6a3668b8ccdac520ce572d4287a'
)
SELECT
  day,
  COUNT(*)                        AS transfer_count,
  COUNT(DISTINCT from_addr)       AS unique_senders,
  COUNT(DISTINCT to_addr)         AS unique_recipients,
  ROUND(SUM(amount), 2)           AS volume_ankrflow,
  ROUND(AVG(amount), 4)           AS avg_transfer_size
FROM ankr_activity
GROUP BY 1
ORDER BY 1 DESC

*/


/* ── SEPARATE DUNE QUERY 4: Ankr Staking Inflows (TVL Growth Proxy) ────────────────────────────
   Shows staking events at the Ankr Flow staking contract.
   The two confirmed active topic0s (from live Dune data on 2024-09-09):
     topic0 A: 0x3df45cb339f96ae4bdb793efcb6e22100dd0dc4fd739a4ee2033fe67ea35af96
     topic0 B: 0x11ff5db12742675bcf3ccb786e43022f6e18f2a9e7600e406ee808724bf20880
   More staking events → growing liquid staking TVL → more supply of ankrFLOW to trade.
   Paste the SELECT below as a new Dune query.

SELECT
  date_trunc('week', block_time)  AS week,
  COUNT(*)                         AS staking_events,
  COUNT(DISTINCT tx_hash)          AS unique_txs,
  COUNT(DISTINCT CASE WHEN topic0 = 0x3df45cb339f96ae4bdb793efcb6e22100dd0dc4fd739a4ee2033fe67ea35af96
                      THEN tx_hash END) AS type_a_events,
  COUNT(DISTINCT CASE WHEN topic0 = 0x11ff5db12742675bcf3ccb786e43022f6e18f2a9e7600e406ee808724bf20880
                      THEN tx_hash END) AS type_b_events
FROM flow.logs
WHERE contract_address = 0xfe8189a3016cb6a3668b8ccdac520ce572d4287a
  AND topic0 IN (
    0x3df45cb339f96ae4bdb793efcb6e22100dd0dc4fd739a4ee2033fe67ea35af96,
    0x11ff5db12742675bcf3ccb786e43022f6e18f2a9e7600e406ee808724bf20880
  )
GROUP BY 1
ORDER BY 1 DESC

*/


/* ── SEPARATE DUNE QUERY 5: MORE Lending Pool — Yield Rate History ──────────────────────────────
   ReserveDataUpdated shows the borrow/supply APY at the MORE lending pool.
   The liquidityRate is the yield earned by WFLOW suppliers (in ray = 1e27).
   variableBorrowRate / 1e27 * 100 = annual borrow APY.
   High utilization → high yield → makes the leverage strategy (borrow WFLOW, swap to ankrFLOW) profitable.
   Paste the SELECT below as a new Dune query.

   ReserveDataUpdated(address indexed reserve, uint256 liquidityRate, uint256 stableBorrowRate,
                      uint256 variableBorrowRate, uint256 liquidityIndex, uint256 variableDebtIndex)
   topic0 = 0x804c9b842b2748a22bb64b345453a3de7ca54a6ca45ce00d415894979e22897a
   topic1 = reserve address (indexed)
   data   = abi.encode(liquidityRate, stableBorrowRate, variableBorrowRate, liquidityIndex, variableDebtIndex)

SELECT
  block_time,
  tx_hash,
  '0x' || "right"(cast(topic1 AS varchar), 40)                              AS reserve,
  ROUND(CAST(bytearray_to_uint256(substr(data, 1, 32))  AS DOUBLE) / 1e27 * 100, 4) AS liquidity_apy,
  ROUND(CAST(bytearray_to_uint256(substr(data, 33, 32)) AS DOUBLE) / 1e27 * 100, 4) AS stable_borrow_apy,
  ROUND(CAST(bytearray_to_uint256(substr(data, 65, 32)) AS DOUBLE) / 1e27 * 100, 4) AS variable_borrow_apy
FROM flow.logs
WHERE contract_address = 0xbc92aac2dbbf42215248b5688eb3d3d2b32f2c8d
  AND topic0 = 0x804c9b842b2748a22bb64b345453a3de7ca54a6ca45ce00d415894979e22897a
ORDER BY block_time DESC
LIMIT 200

*/
