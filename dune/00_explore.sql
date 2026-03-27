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
