-- 03_yield_allocations.sql
-- Capital allocation lifecycle: when capital moves in/out of yield strategies
--
-- StrategyManager events (replace <STRATEGY_MANAGER_ADDRESS>):
--   AllocatedToYield(address indexed adapter, uint256 amount)
--   DeallocatedFromYield(address indexed adapter, uint256 amount)
--   topic0s: keccak256 of each signature
--
-- This shows capital efficiency — how much of TVL is working in yield vs idle.

WITH alloc_events AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    '0x' || right(cast(topic1 AS varchar), 40) AS adapter,
    bytearray_to_uint256(substr(data, 1, 32))  AS amount_raw,
    'allocate'                                  AS action
  FROM flow_evm.logs
  WHERE contract_address = lower('<STRATEGY_MANAGER_ADDRESS>')
    AND topic0 = 0x<ALLOCATED_TO_YIELD_TOPIC0>

  UNION ALL

  SELECT
    block_time,
    block_number,
    tx_hash,
    '0x' || right(cast(topic1 AS varchar), 40) AS adapter,
    bytearray_to_uint256(substr(data, 1, 32))  AS amount_raw,
    'deallocate'                                AS action
  FROM flow_evm.logs
  WHERE contract_address = lower('<STRATEGY_MANAGER_ADDRESS>')
    AND topic0 = 0x<DEALLOCATED_FROM_YIELD_TOPIC0>
),

signed AS (
  SELECT
    *,
    CASE action WHEN 'allocate' THEN amount_raw ELSE -amount_raw END AS signed_amount
  FROM alloc_events
),

daily AS (
  SELECT
    date_trunc('day', block_time) AS day,
    COALESCE(adapter, 'all')      AS adapter,
    SUM(CASE WHEN action = 'allocate'   THEN amount_raw ELSE 0 END) / 1e18 AS allocated_flow,
    SUM(CASE WHEN action = 'deallocate' THEN amount_raw ELSE 0 END) / 1e18 AS deallocated_flow,
    COUNT(*) AS event_count
  FROM signed
  GROUP BY GROUPING SETS ((date_trunc('day', block_time), adapter), (date_trunc('day', block_time)))
)

SELECT
  day,
  adapter,
  allocated_flow,
  deallocated_flow,
  allocated_flow - deallocated_flow AS net_flow,
  event_count
FROM daily
ORDER BY day DESC, adapter
;

-- ── Running deployed capital ─────────────────────────────────────────────────
-- Shows the cumulative capital deployed at each point in time
SELECT
  block_time,
  tx_hash,
  adapter,
  action,
  amount_raw / 1e18 AS amount_flow,
  SUM(signed_amount) OVER (
    PARTITION BY adapter
    ORDER BY block_number, tx_hash
  ) / 1e18 AS deployed_cumulative
FROM signed
ORDER BY block_number DESC
LIMIT 100
;
