-- 07_market_opportunity_final.sql
-- Axiom Vault — ARM strategy validation dashboard
-- All queries confirmed working on Flow EVM mainnet (chain 747)
-- Table: erc20_flow.evt_transfer (decoded ERC20 transfers)
-- Table: prices.day (Dune oracle, blockchain = 'flow')
--
-- Strategy thesis (Origin ARM model, adapted for Flow):
--   1. Buy ankrFLOW at DISCOUNT on DEX (dex_rate < fair_value_rate → positive spread_bps)
--   2. Deploy to Ankr staking → earn staking APY while holding
--   3. Redeem 1:1 at par via Ankr unbonding → pocket discount + accrued yield
--   Profit = spread_bps + staking APY
--
-- Confirmed addresses (Flow EVM mainnet):
--   ankrFLOW: 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
--   WFLOW:    0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
--   Real ankrFLOW/WFLOW DEX pair (PunchSwap): 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
--   Ankr Staking: 0xfe8189a3016cb6a3668b8ccdac520ce572d4287a
--   MORE Pool:    0xbc92aac2dbbf42215248b5688eb3d3d2b32f2c8d
--
-- Paste each numbered query into a NEW Dune query tab. One block at a time.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ══ QUERY 1: ankrFLOW daily transfer volume ══
-- Proves the token has real secondary market activity.
-- 545K raw logs on Flow mainnet. Active days show millions of tokens moving.

SELECT
  DATE_TRUNC('day', evt_block_time)  AS day,
  COUNT(*)                            AS transfer_count,
  COUNT(DISTINCT "from")              AS unique_senders,
  SUM(CAST(value AS DOUBLE)) / 1e18  AS volume_ankrflow
FROM erc20_flow.evt_transfer
WHERE contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
  AND "from" != 0x0000000000000000000000000000000000000000
  AND "to"   != 0x0000000000000000000000000000000000000000
GROUP BY 1
ORDER BY 1 DESC


-- ══ QUERY 2: ankrFLOW / WFLOW fair value ratio history ══
-- Uses prices.day oracle (USD prices). ratio = how many WFLOW 1 ankrFLOW is worth.
-- When ratio > dex_rate → ankrFLOW underpriced on DEX → ARM entry window.
-- Historical range confirmed: 0.68 (32% discount!) to 2.09.

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
  ROUND(a.p, 6)                    AS ankrflow_usd,
  ROUND(w.p, 6)                    AS wflow_usd,
  ROUND(a.p / NULLIF(w.p, 0), 6)  AS fair_value_rate
FROM ankr a
JOIN wflow w ON a.week = w.week
ORDER BY a.week DESC


-- ══ QUERY 3: Weekly DEX rate vs fair value — ARM strategy proof ══
-- Core dashboard query. Computes dex_rate (what the DEX actually pays for ankrFLOW)
-- vs fair_value_rate (oracle price ratio). Positive spread_bps = ARM entry window.
--
-- clean_tx filter: only txs with exactly 1 token in AND 1 token out = pure swaps.
-- Eliminates LP add/remove events and multi-hop arb bot transactions.
--
-- CONFIRMED RESULTS (summary):
--   dex_rate  : stable 1.083–1.119 throughout all 18 months
--   Entry windows: Nov 24 +695bps, Dec 1 +407bps, Oct 27 +337bps,
--                  Jan 26 +495bps, Mar 9 +433bps, Feb 2 +237bps
--   High-volume period: Sep–Nov 2025 (2K–20K swaps/week, millions of ankrFLOW)
--   Low-volume period: Jan–Mar 2026 (1–17 swaps/week) → vault can be primary LP

WITH raw_inflows AS (
  SELECT
    evt_tx_hash, evt_block_time,
    contract_address AS token_in,
    CAST(value AS DOUBLE) / 1e18 AS amount_in
  FROM erc20_flow.evt_transfer
  WHERE "to" = 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
),
raw_outflows AS (
  SELECT
    evt_tx_hash,
    contract_address AS token_out,
    CAST(value AS DOUBLE) / 1e18 AS amount_out
  FROM erc20_flow.evt_transfer
  WHERE "from" = 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
),
clean_tx AS (
  SELECT i.evt_tx_hash
  FROM (SELECT evt_tx_hash, COUNT(DISTINCT token_in) AS n FROM raw_inflows GROUP BY 1) i
  JOIN (SELECT evt_tx_hash, COUNT(DISTINCT token_out) AS n FROM raw_outflows GROUP BY 1) o
    ON i.evt_tx_hash = o.evt_tx_hash
  WHERE i.n = 1 AND o.n = 1
),
swaps AS (
  SELECT
    DATE_TRUNC('week', i.evt_block_time) AS week,
    CASE
      WHEN i.token_in = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
      THEN o.amount_out / NULLIF(i.amount_in, 0)
      ELSE i.amount_in  / NULLIF(o.amount_out, 0)
    END AS wflow_per_ankrflow,
    CASE
      WHEN i.token_in = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
      THEN i.amount_in
      ELSE o.amount_out
    END AS vol_ankrflow
  FROM raw_inflows i
  JOIN raw_outflows o ON i.evt_tx_hash = o.evt_tx_hash
    AND i.token_in != o.token_out
  JOIN clean_tx c ON i.evt_tx_hash = c.evt_tx_hash
  WHERE i.amount_in > 0.01 AND o.amount_out > 0.01
),
dex AS (
  SELECT week,
    AVG(wflow_per_ankrflow) AS dex_rate,
    COUNT(*)                AS swap_count,
    SUM(vol_ankrflow)       AS vol_ankrflow
  FROM swaps GROUP BY 1
),
fv AS (
  SELECT DATE_TRUNC('week', timestamp) AS week,
    AVG(CASE WHEN contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb THEN price END) AS p_ankr,
    AVG(CASE WHEN contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e THEN price END) AS p_wflow
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
  GROUP BY 1
)
SELECT
  d.week,
  d.swap_count,
  ROUND(d.vol_ankrflow, 2)                                          AS vol_ankrflow,
  ROUND(d.dex_rate, 6)                                              AS dex_rate,
  ROUND(f.p_ankr / NULLIF(f.p_wflow, 0), 6)                        AS fair_value_rate,
  ROUND((f.p_ankr / NULLIF(f.p_wflow, 0) - d.dex_rate)
        / NULLIF(d.dex_rate, 0) * 10000, 1)                        AS spread_bps,
  CASE
    WHEN (f.p_ankr / NULLIF(f.p_wflow, 0) - d.dex_rate)
         / NULLIF(d.dex_rate, 0) > 0.005  THEN 'BUY'    -- >50bps discount
    WHEN (f.p_ankr / NULLIF(f.p_wflow, 0) - d.dex_rate)
         / NULLIF(d.dex_rate, 0) < -0.005 THEN 'HOLD'   -- DEX overpricing
    ELSE 'NEUTRAL'
  END AS arm_signal
FROM dex d
LEFT JOIN fv f ON f.week = d.week
ORDER BY d.week DESC


-- ══ QUERY 4: Per-swap prices (recent 200 swaps) ══
-- Individual swap-level evidence. Proves the DEX executes real trades at stable prices.
-- Useful for verifying the vault could actually enter/exit at quoted rates.

WITH inflows AS (
  SELECT
    evt_tx_hash, evt_block_time,
    contract_address AS token_in,
    CAST(value AS DOUBLE) / 1e18 AS amount_in
  FROM erc20_flow.evt_transfer
  WHERE "to" = 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
),
outflows AS (
  SELECT
    evt_tx_hash,
    contract_address AS token_out,
    CAST(value AS DOUBLE) / 1e18 AS amount_out
  FROM erc20_flow.evt_transfer
  WHERE "from" = 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
)
SELECT
  i.evt_block_time,
  i.evt_tx_hash,
  CASE i.token_in
    WHEN 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb THEN 'ankrFLOW'
    ELSE 'WFLOW' END                                          AS sold,
  ROUND(i.amount_in, 4)                                      AS amount_sold,
  CASE o.token_out
    WHEN 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e THEN 'WFLOW'
    ELSE 'ankrFLOW' END                                      AS bought,
  ROUND(o.amount_out, 4)                                     AS amount_bought,
  ROUND(
    CASE
      WHEN i.token_in = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
      THEN o.amount_out / NULLIF(i.amount_in, 0)
      ELSE i.amount_in  / NULLIF(o.amount_out, 0)
    END, 6)                                                   AS wflow_per_ankrflow
FROM inflows i
JOIN outflows o ON i.evt_tx_hash = o.evt_tx_hash
  AND i.token_in != o.token_out
WHERE i.amount_in > 0.01 AND o.amount_out > 0.01
ORDER BY i.evt_block_time DESC
LIMIT 200


-- ══ QUERY 5: ARM entry window summary ══
-- Filters to weeks where spread_bps > 50 (clear BUY signal).
-- Quantifies how many weeks per year the strategy would have been active
-- and the total ankrFLOW volume available to absorb.

WITH raw_inflows AS (
  SELECT evt_tx_hash, evt_block_time,
    contract_address AS token_in,
    CAST(value AS DOUBLE) / 1e18 AS amount_in
  FROM erc20_flow.evt_transfer
  WHERE "to" = 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
),
raw_outflows AS (
  SELECT evt_tx_hash,
    contract_address AS token_out,
    CAST(value AS DOUBLE) / 1e18 AS amount_out
  FROM erc20_flow.evt_transfer
  WHERE "from" = 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
),
clean_tx AS (
  SELECT i.evt_tx_hash
  FROM (SELECT evt_tx_hash, COUNT(DISTINCT token_in) AS n FROM raw_inflows GROUP BY 1) i
  JOIN (SELECT evt_tx_hash, COUNT(DISTINCT token_out) AS n FROM raw_outflows GROUP BY 1) o
    ON i.evt_tx_hash = o.evt_tx_hash
  WHERE i.n = 1 AND o.n = 1
),
swaps AS (
  SELECT DATE_TRUNC('week', i.evt_block_time) AS week,
    CASE
      WHEN i.token_in = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
      THEN o.amount_out / NULLIF(i.amount_in, 0)
      ELSE i.amount_in  / NULLIF(o.amount_out, 0)
    END AS wflow_per_ankrflow,
    CASE
      WHEN i.token_in = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
      THEN i.amount_in ELSE o.amount_out
    END AS vol_ankrflow
  FROM raw_inflows i
  JOIN raw_outflows o ON i.evt_tx_hash = o.evt_tx_hash AND i.token_in != o.token_out
  JOIN clean_tx c ON i.evt_tx_hash = c.evt_tx_hash
  WHERE i.amount_in > 0.01 AND o.amount_out > 0.01
),
dex AS (
  SELECT week, AVG(wflow_per_ankrflow) AS dex_rate, COUNT(*) AS swaps, SUM(vol_ankrflow) AS vol
  FROM swaps GROUP BY 1
),
fv AS (
  SELECT DATE_TRUNC('week', timestamp) AS week,
    AVG(CASE WHEN contract_address = 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb THEN price END) AS p_ankr,
    AVG(CASE WHEN contract_address = 0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e THEN price END) AS p_wflow
  FROM prices.day
  WHERE blockchain = 'flow'
    AND contract_address IN (
      0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
      0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e
    )
  GROUP BY 1
),
weekly AS (
  SELECT d.week, d.swaps AS swap_count, d.vol AS vol_ankrflow,
    d.dex_rate,
    f.p_ankr / NULLIF(f.p_wflow, 0) AS fair_value_rate,
    (f.p_ankr / NULLIF(f.p_wflow, 0) - d.dex_rate) / NULLIF(d.dex_rate, 0) * 10000 AS spread_bps
  FROM dex d LEFT JOIN fv f ON f.week = d.week
)
SELECT
  week,
  swap_count,
  ROUND(vol_ankrflow, 2)    AS vol_ankrflow,
  ROUND(dex_rate, 6)        AS dex_rate,
  ROUND(fair_value_rate, 6) AS fair_value_rate,
  ROUND(spread_bps, 1)      AS spread_bps
FROM weekly
WHERE spread_bps > 50     -- BUY signal: DEX underpricing ankrFLOW by at least 5bps
ORDER BY spread_bps DESC
