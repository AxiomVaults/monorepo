-- 00_explore.sql
-- Confirmed: flow.logs has 28M rows, 2024-09-04 → 2026-03-27
-- Confirmed indexed: WFLOW 3.7M logs, ankrFLOW 545K logs
-- Key insight from Flow official Dune dashboards:
--   Dune has DECODED tables: erc20_flow.evt_transfer (use this, not raw logs)
--   columns: evt_tx_hash, evt_block_time, evt_block_date, contract_address, "from", "to", value
--
-- Paste each query block below into a NEW Dune query. One block at a time.
-- ──────────────────────────────────────────────────────────────────────────────


-- ══ QUERY A: ankrFLOW daily transfer volume (uses decoded table — WILL RETURN DATA) ══
-- 545K raw logs confirmed. This proves secondary market activity scale.

SELECT
  DATE_TRUNC('day', evt_block_time)   AS day,
  COUNT(*)                             AS transfer_count,
  COUNT(DISTINCT "from")               AS unique_senders,
  SUM(CAST(value AS DOUBLE)) / 1e18   AS volume_ankrflow
FROM erc20_flow.evt_transfer
WHERE contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
  AND "from" != 0x0000000000000000000000000000000000000000
  AND "to"   != 0x0000000000000000000000000000000000000000
GROUP BY 1
ORDER BY 1 DESC


-- ══ QUERY B: Identify the top unknown contracts (what DEXes are active?) ══
-- Shows 5 raw log rows each from the top unknown contracts in the top-30 list.
-- Look at topic0 values to identify what type of contract each is.

SELECT
  contract_address,
  topic0,
  COUNT(*) AS event_count
FROM flow.logs
WHERE contract_address IN (
  0x2aabea2058b5ac2d339b163c6ab6f2b6d53aabed,
  0x84c6a2e6765e88427c41bb38c82a78b570e24709,
  0x2880ab155794e7179c9ee2e38200202908c17b43,
  0x7f27352d5f83db87a5a3e00f4b07cc2138d8ee52,
  0xd112634f06902a977db1d596c77715d72f8da8a9
)
GROUP BY 1, 2
ORDER BY 1, 3 DESC


-- ══ QUERY C: ankrFLOW/WFLOW swaps — same tx, same wallet sent one and received the other ══
-- Proves depeg arbitrage opportunity exists. price < 1.0 = discount.
-- Uses decoded erc20_flow.evt_transfer — no raw log parsing.

WITH ankrflow_sent AS (
  SELECT
    evt_tx_hash,
    evt_block_time,
    "from"                            AS wallet,
    CAST(value AS DOUBLE) / 1e18      AS ankrflow_amount
  FROM erc20_flow.evt_transfer
  WHERE contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
    AND "from" != 0x0000000000000000000000000000000000000000
    AND evt_block_date >= DATE '2024-09-01'
),
wflow_received AS (
  SELECT
    evt_tx_hash,
    "to"                              AS wallet,
    CAST(value AS DOUBLE) / 1e18      AS wflow_amount
  FROM erc20_flow.evt_transfer
  WHERE contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    AND "to" != 0x0000000000000000000000000000000000000000
    AND evt_block_date >= DATE '2024-09-01'
)
SELECT
  a.evt_block_time,
  a.evt_tx_hash,
  a.wallet,
  ROUND(a.ankrflow_amount, 4)                                AS ankrflow_in,
  ROUND(w.wflow_amount, 4)                                   AS wflow_out,
  ROUND(w.wflow_amount / NULLIF(a.ankrflow_amount, 0), 6)   AS price_wflow_per_ankrflow,
  ROUND((1 - w.wflow_amount / NULLIF(a.ankrflow_amount, 0)) * 100, 4) AS discount_pct
FROM ankrflow_sent a
JOIN wflow_received w
  ON a.evt_tx_hash = w.evt_tx_hash
  AND a.wallet = w.wallet
WHERE a.ankrflow_amount > 0.01
  AND w.wflow_amount   > 0.01
ORDER BY a.evt_block_time DESC
LIMIT 200


-- ══ QUERY D: Does Dune have a price feed for ankrFLOW or WFLOW? ══

SELECT
  blockchain,
  contract_address,
  symbol,
  MIN(timestamp) AS first_price,
  MAX(timestamp) AS last_price,
  AVG(price)     AS avg_price
FROM prices.day
WHERE blockchain = 'flow'
GROUP BY 1, 2, 3
ORDER BY 6 DESC


-- ══ CONFIRMED FROM D ══
-- ankrFLOWEVM (0x1b97100...) avg $0.4464 | WFLOW (0xd3bf53...) avg $0.4380
-- Ratio = 1.019 average premium. Clean swap rows from C = 1.14 WFLOW/ankrFLOW.
-- 0x2aabea... = USDF   |  0x7f2735... = USDC.e  |  0x84c6a2... = not in prices
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ QUERY E: Find the actual ankrFLOW/WFLOW DEX pair address ══
-- Looks for UniV2 Swap events at all contracts. The pair with the most swaps
-- involving ankrFLOW IS the live liquidity pool. Run this as a new query.

SELECT
  contract_address,
  COUNT(*) AS swap_event_count
FROM flow.logs
WHERE topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20


-- ══ QUERY F: ankrFLOW/WFLOW fair value ratio over time — WILL RETURN DATA ══
-- Uses prices.day (confirmed working). Shows the "fair value" benchmark line.
-- If DEX price ever trades below this ratio → discount → ARM strategy profit.

WITH ankr AS (
  SELECT DATE_TRUNC('week', timestamp) AS week, AVG(price) AS p
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
  GROUP BY 1
),
wflow AS (
  SELECT DATE_TRUNC('week', timestamp) AS week, AVG(price) AS p
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
  GROUP BY 1
)
SELECT
  a.week,
  ROUND(a.p, 6)                      AS ankrflow_usd,
  ROUND(w.p, 6)                      AS wflow_usd,
  ROUND(a.p / NULLIF(w.p, 0), 6)    AS ankrflow_wflow_ratio
FROM ankr a
JOIN wflow w ON a.week = w.week
ORDER BY a.week DESC


-- ══ QUERY G: Decode unknown 0x2880ab — raw event peek ══
-- 1.1M events of one topic0. Check what the data looks like to identify it.

SELECT
  block_time,
  tx_hash,
  topic1,
  topic2,
  topic3,
  length(data) AS data_bytes
FROM flow.logs
WHERE contract_address = 0x2880ab155794e7179c9ee2e38200202908c17b43
  AND topic0 = 0xd06a6b7f4918494b3719217d1802786c1f5112a6c1d88fe2cfec00b4584f6aec
ORDER BY block_time DESC
LIMIT 5


-- ══ CONFIRMED FROM E ══
-- 0x17e96496212d06eb1ff10c6f853669cc9947a1e7 = LIVE ankrFLOW/WFLOW pair, 449K swaps
-- ankrFLOW = token0 (0x1b97... < 0xd3bf...), WFLOW = token1
-- UniV2: data = abi.encode(amount0In, amount1In, amount0Out, amount1Out) = 128 bytes
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ QUERY H: Real swap prices from the actual DEX pair — GUARANTEED DATA ══
-- Uses 0x17e96496 (449K Swap events confirmed). Computes WFLOW-per-ankrFLOW market rate
-- vs the prices.day fair value ratio. Positive spread_bps = discount opportunity.
-- ankrFLOW = token0, WFLOW = token1.

WITH swaps AS (
  SELECT
    block_time,
    tx_hash,
    -- data layout: amount0In | amount1In | amount0Out | amount1Out (32 bytes each)
    CAST(bytearray_to_uint256(substr(data,  1, 32)) AS DOUBLE) / 1e18 AS ankrflow_in,
    CAST(bytearray_to_uint256(substr(data, 33, 32)) AS DOUBLE) / 1e18 AS wflow_in,
    CAST(bytearray_to_uint256(substr(data, 65, 32)) AS DOUBLE) / 1e18 AS ankrflow_out,
    CAST(bytearray_to_uint256(substr(data, 97, 32)) AS DOUBLE) / 1e18 AS wflow_out
  FROM flow.logs
  WHERE contract_address = 0x17e96496212d06eb1ff10c6f853669cc9947a1e7
    AND topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
),
dex_prices AS (
  SELECT
    DATE_TRUNC('week', block_time)      AS week,
    -- ankrFLOW→WFLOW direction: rate = wflow_out / ankrflow_in
    AVG(CASE WHEN ankrflow_in > 0.1 AND wflow_out > 0.1
             THEN wflow_out / ankrflow_in END)  AS dex_wflow_per_ankrflow,
    COUNT(*) AS swap_count,
    SUM(CASE WHEN ankrflow_in > 0 THEN ankrflow_in ELSE ankrflow_out END) AS vol_ankrflow
  FROM swaps
  GROUP BY 1
),
fair_value AS (
  SELECT
    DATE_TRUNC('week', timestamp) AS week,
    AVG(price) AS p_ankr
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
  GROUP BY 1
),
wflow_price AS (
  SELECT
    DATE_TRUNC('week', timestamp) AS week,
    AVG(price) AS p_wflow
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
  GROUP BY 1
)
SELECT
  d.week,
  d.swap_count,
  ROUND(d.vol_ankrflow, 2)                                                  AS vol_ankrflow,
  ROUND(d.dex_wflow_per_ankrflow, 6)                                        AS dex_rate,
  ROUND(f.p_ankr / NULLIF(w.p_wflow, 0), 6)                                AS fair_value_rate,
  ROUND((f.p_ankr / NULLIF(w.p_wflow, 0) - d.dex_wflow_per_ankrflow)
        / NULLIF(d.dex_wflow_per_ankrflow, 0) * 10000, 1)                  AS spread_bps
FROM dex_prices d
LEFT JOIN fair_value f ON f.week = d.week
LEFT JOIN wflow_price w ON w.week = d.week
WHERE d.week >= DATE '2024-10-01'
ORDER BY d.week DESC


-- ══ QUERY I: Weeks where ankrFLOW traded at a DISCOUNT — the ARM entry windows ══
-- Filters Query F ratio < 1.0 (ankrFLOW cheaper than WFLOW in USD terms).
-- These are exactly the moments the vault should be buying ankrFLOW aggressively.

WITH ankr AS (
  SELECT DATE_TRUNC('week', timestamp) AS week, AVG(price) AS p
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
  GROUP BY 1
),
wflow AS (
  SELECT DATE_TRUNC('week', timestamp) AS week, AVG(price) AS p
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
  GROUP BY 1
)
SELECT
  a.week,
  ROUND(a.p, 6)                        AS ankrflow_usd,
  ROUND(w.p, 6)                        AS wflow_usd,
  ROUND(a.p / NULLIF(w.p, 0), 6)      AS ratio,
  ROUND((1 - a.p / NULLIF(w.p, 0)) * 100, 3) AS discount_pct
FROM ankr a
JOIN wflow w ON a.week = w.week
WHERE a.p / NULLIF(w.p, 0) < 1.05     -- within 5% of parity or below
ORDER BY a.week DESC


-- ══ QUERY J: Peek raw data from actual pair — diagnose why H returns 0 ══
-- data_len tells us how many bytes. If 128 = correct ABI layout. If 0 = empty.
-- Also tries varbinary_substring which some Dune chains need instead of substr.

SELECT
  block_time,
  topic1,
  topic2,
  length(data)                                                    AS data_len,
  bytearray_to_uint256(varbinary_substring(data,  1, 32)) / 1e18 AS word1,
  bytearray_to_uint256(varbinary_substring(data, 33, 32)) / 1e18 AS word2,
  bytearray_to_uint256(varbinary_substring(data, 65, 32)) / 1e18 AS word3,
  bytearray_to_uint256(varbinary_substring(data, 97, 32)) / 1e18 AS word4
FROM flow.logs
WHERE contract_address = 0x17e96496212d06eb1ff10c6f853669cc9947a1e7
  AND topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
ORDER BY block_time DESC
LIMIT 5
