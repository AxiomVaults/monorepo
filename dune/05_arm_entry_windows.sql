-- 05_arm_entry_windows.sql
-- Entry window summary — weeks where ankrFLOW was underpriced on DEX
-- Filters to spread_bps > 50 (vault should be buying ankrFLOW aggressively).
-- Shows how many weeks per year the strategy triggers and total deployable volume.
--
-- spread_bps = (fair_value_rate - dex_rate) / dex_rate * 10000
--   e.g. spread_bps = 695 → vault can buy 1 ankrFLOW for 6.95% below fair value
--
-- Table: erc20_flow.evt_transfer, prices.day
-- DEX pair (PunchSwap ankrFLOW/WFLOW): 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
-- ankrFLOW: 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
-- WFLOW:    0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e

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
  SELECT week, AVG(wflow_per_ankrflow) AS dex_rate, COUNT(*) AS swap_count, SUM(vol_ankrflow) AS vol_ankrflow
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
  SELECT
    d.week,
    d.swap_count,
    d.vol_ankrflow,
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
WHERE spread_bps > 50
ORDER BY spread_bps DESC
