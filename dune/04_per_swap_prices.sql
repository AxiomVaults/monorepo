-- 04_per_swap_prices.sql
-- Individual swap prices from the real ankrFLOW/WFLOW DEX pair
-- Shows what the DEX actually paid per swap — execution quality proof.
-- dex_rate consistently 1.10–1.13 WFLOW per ankrFLOW in recent months.
--
-- Table: erc20_flow.evt_transfer
-- DEX pair (PunchSwap ankrFLOW/WFLOW): 0x7854498d4d1b2970fcb4e6960ddf782a68463a43
-- ankrFLOW: 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb
-- WFLOW:    0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e

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
