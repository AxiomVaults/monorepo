-- 01_ankrflow_daily_volume.sql
-- ankrFLOW daily transfer volume on Flow EVM mainnet
-- Proves the token has real secondary market activity.
-- 545K raw logs confirmed. Active days show millions of tokens moving.
--
-- Table: erc20_flow.evt_transfer
-- Chain: Flow EVM (747)
-- ankrFLOW: 0x1b97100ea1d7126c4d60027e231ea4cb25314bdb

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
