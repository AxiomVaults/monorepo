-- 00_explore.sql  ← STEP 1 already done: 28M rows, 2024-09-04 → 2026-03-27
--
-- HOW TO USE THIS FILE:
--   Each query below is separated by a "-- ══ QUERY N ══" header.
--   In Dune, create a new query, paste ONLY that one SELECT block, and run it.
--   Do NOT paste the dashes or comments — just the SELECT...FROM...ORDER BY block.
-- ──────────────────────────────────────────────────────────────────────────────

-- ══ QUERY 2: See actual column names (critical — do this before anything else) ══
-- Shows 5 raw rows so you can confirm column names, data types, and address format.

SELECT *
FROM flow.logs
LIMIT 5


-- ══ QUERY 3: Which contracts have the most logs? (no filter — must return data) ══

SELECT
  contract_address,
  COUNT(*)         AS log_count,
  MIN(block_time)  AS first_seen,
  MAX(block_time)  AS last_seen
FROM flow.logs
GROUP BY 1
ORDER BY 2 DESC
LIMIT 30


-- ══ QUERY 4: Do our target protocol addresses have logs? ══
-- (use exact column name confirmed from Query 2 above)

SELECT
  contract_address,
  COUNT(*) AS log_count
FROM flow.logs
WHERE contract_address IN (
  0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e,
  0x1b97100ea1d7126c4d60027e231ea4cb25314bdb,
  0xfe8189a3016cb6a3668b8ccdac520ce572d4287a,
  0xbc92aac2dbbf42215248b5688eb3d3d2b32f2c8d,
  0xf45afe28fd5519d5f8c1d4787a4d5f724c0efa4d
)
GROUP BY 1
ORDER BY 2 DESC


-- ══ QUERY 5: Does flow.transactions table exist and have data? ══

SELECT
  MIN(block_time)  AS earliest,
  MAX(block_time)  AS latest,
  COUNT(*)         AS total_txs
FROM flow.transactions


-- ══ QUERY 6: Top active addresses (run only if Query 5 returns data) ══

SELECT
  "from"           AS sender,
  COUNT(*)         AS tx_count,
  MIN(block_time)  AS first_tx,
  MAX(block_time)  AS last_tx
FROM flow.transactions
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20
