-- 02_fair_value_ratio_history.sql
-- ankrFLOW / WFLOW fair value ratio — weekly oracle price history
-- Uses prices.day (Dune USD oracle). ratio = how many WFLOW 1 ankrFLOW is worth at fair value.
-- When fair_value_rate > dex_rate (from query 03) → ankrFLOW underpriced on DEX → ARM entry.
-- Historical range confirmed: 0.68 (32% discount) to 2.09 premium.
--
-- Table: prices.day
-- Chain: flow
-- ankrFLOW: 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
-- WFLOW:    0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e

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
