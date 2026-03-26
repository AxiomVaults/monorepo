-- 02_swap_volume.sql
-- Axiom Venue swap volume and discount revenue on Flow EVM (chain 747)
--
-- AxiomVenue emits:
--   SwapExecuted(address indexed user, address indexed tokenIn, address indexed tokenOut,
--                uint256 amountIn, uint256 amountOut, uint256 discountPaid)
--   topic0 = keccak256("SwapExecuted(address,address,address,uint256,uint256,uint256)")
--
-- Replace <VENUE_ADDRESS> with deployed venue address.

WITH swap_events AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    -- indexed topics: topic1=user, topic2=tokenIn, topic3=tokenOut
    '0x' || right(cast(topic1 AS varchar), 40) AS user_addr,
    '0x' || right(cast(topic2 AS varchar), 40) AS token_in,
    '0x' || right(cast(topic3 AS varchar), 40) AS token_out,
    -- non-indexed data: amountIn (32 bytes), amountOut (32 bytes), discountPaid (32 bytes)
    bytearray_to_uint256(substr(data,  1, 32)) AS amount_in_raw,
    bytearray_to_uint256(substr(data, 33, 32)) AS amount_out_raw,
    bytearray_to_uint256(substr(data, 65, 32)) AS discount_paid_raw
  FROM flow_evm.logs
  WHERE contract_address = lower('<VENUE_ADDRESS>')
    AND topic0 = 0x<SWAP_EXECUTED_TOPIC0>
    -- keccak256("SwapExecuted(address,address,address,uint256,uint256,uint256)")
    -- pre-compute offline and replace above
)

SELECT
  date_trunc('day', block_time)        AS day,
  COUNT(*)                              AS swap_count,
  COUNT(DISTINCT user_addr)             AS unique_swappers,
  SUM(amount_in_raw)  / 1e18           AS volume_ankrflow_in,
  SUM(amount_out_raw) / 1e18           AS volume_wflow_out,
  SUM(discount_paid_raw) / 1e18        AS discount_revenue_wflow,
  AVG(discount_paid_raw * 10000.0
      / NULLIF(amount_in_raw, 0))       AS avg_discount_bps
FROM swap_events
GROUP BY 1
ORDER BY 1 DESC
;

-- ── Cumulative volume ────────────────────────────────────────────────────────
SELECT
  SUM(amount_in_raw)  / 1e18           AS total_volume_ankrflow,
  SUM(discount_paid_raw) / 1e18        AS total_discount_revenue,
  COUNT(*)                              AS total_swaps,
  COUNT(DISTINCT user_addr)             AS total_unique_swappers
FROM (
  SELECT
    bytearray_to_uint256(substr(data,  1, 32)) AS amount_in_raw,
    bytearray_to_uint256(substr(data, 65, 32)) AS discount_paid_raw,
    '0x' || right(cast(topic1 AS varchar), 40) AS user_addr
  FROM flow_evm.logs
  WHERE contract_address = lower('<VENUE_ADDRESS>')
    AND topic0 = 0x<SWAP_EXECUTED_TOPIC0>
) t
;
