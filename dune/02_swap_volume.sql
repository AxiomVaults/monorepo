-- 02_swap_volume.sql
-- Axiom Venue swap volume and discount revenue on Flow EVM (chain 747)
--
-- AxiomVenue event:
--   SwapExecuted(address indexed tokenIn, address indexed receiver,
--                uint256 amountIn, uint256 amountOut, uint256 discountBps)
--   topic0 = 0x28c738dbec11a1bed94ba127a3712d54bcd39cf4ae95b6ebd671aaf10fd0287b
--
-- Venue:     0x34b40ba116d5dec75548a9e9a8f15411461e8c70
-- ankrFLOW:  0x1b97100ea1d7126c4d60027e231ea4cb25314bdb

WITH swap_events AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    -- topic1 = tokenIn (indexed), topic2 = receiver (indexed)
    '0x' || right(cast(topic1 AS varchar), 40) AS token_in,
    '0x' || right(cast(topic2 AS varchar), 40) AS receiver,
    -- non-indexed data: amountIn | amountOut | discountBps  (32 bytes each)
    bytearray_to_uint256(substr(data,  1, 32)) AS amount_in_raw,
    bytearray_to_uint256(substr(data, 33, 32)) AS amount_out_raw,
    bytearray_to_uint256(substr(data, 65, 32)) AS discount_bps_raw
  FROM flow_evm.logs
  WHERE contract_address = 0x34b40ba116d5dec75548a9e9a8f15411461e8c70
    AND topic0 = 0x28c738dbec11a1bed94ba127a3712d54bcd39cf4ae95b6ebd671aaf10fd0287b
),

-- True discount paid = amountIn * discountBps / 10000
with_discount AS (
  SELECT *,
    amount_in_raw * discount_bps_raw / 10000 AS discount_paid_raw
  FROM swap_events
)

-- ── Daily swap summary ───────────────────────────────────────────────────────
SELECT
  date_trunc('day', block_time)              AS day,
  COUNT(*)                                    AS swap_count,
  COUNT(DISTINCT receiver)                    AS unique_receivers,
  SUM(amount_in_raw)  / 1e18                 AS volume_ankrflow_in,
  SUM(amount_out_raw) / 1e18                 AS volume_wflow_out,
  SUM(discount_paid_raw) / 1e18              AS discount_revenue_wflow,
  AVG(discount_bps_raw)                       AS avg_discount_bps
FROM with_discount
GROUP BY 1
ORDER BY 1 DESC
;

-- ── Cumulative all-time totals ───────────────────────────────────────────────
SELECT
  COUNT(*)                            AS total_swaps,
  COUNT(DISTINCT receiver)            AS total_unique_receivers,
  SUM(amount_in_raw)  / 1e18         AS total_volume_ankrflow,
  SUM(amount_out_raw) / 1e18         AS total_volume_wflow_out,
  SUM(discount_paid_raw) / 1e18      AS total_discount_revenue_wflow
FROM with_discount
;
