-- 03_yield_allocations.sql
-- Capital allocation lifecycle: when capital moves in/out of yield strategies
--
-- StrategyManager events (no indexed params — filter by contract address only):
--   AllocatedToYield(uint256 amount, uint256 totalDeployed)
--   topic0 = 0xd7068ffc5712961c5b574c5848a5d5aa84d81b2e67ee6a1b8f5ba6b7377bcc71
--
--   DeallocatedFromYield(uint256 amount, uint256 totalDeployed)
--   topic0 = 0xfe68061eae052626a73a04629725f82f021d874047f9379085ba9236a325aa08
--
-- StrategyManager: 0xd5ac451b0c50b9476107823af206ed814a2e2580

WITH alloc_events AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    -- data = abi.encode(amount, totalDeployed)
    bytearray_to_uint256(substr(data,  1, 32)) AS amount_raw,
    bytearray_to_uint256(substr(data, 33, 32)) AS total_deployed_raw,
    'allocate'                                  AS action
  FROM flow.logs
  WHERE contract_address = 0xd5ac451b0c50b9476107823af206ed814a2e2580
    AND topic0 = 0xd7068ffc5712961c5b574c5848a5d5aa84d81b2e67ee6a1b8f5ba6b7377bcc71

  UNION ALL

  SELECT
    block_time,
    block_number,
    tx_hash,
    bytearray_to_uint256(substr(data,  1, 32)) AS amount_raw,
    bytearray_to_uint256(substr(data, 33, 32)) AS total_deployed_raw,
    'deallocate'                                AS action
  FROM flow.logs
  WHERE contract_address = 0xd5ac451b0c50b9476107823af206ed814a2e2580
    AND topic0 = 0xfe68061eae052626a73a04629725f82f021d874047f9379085ba9236a325aa08
),

signed AS (
  SELECT *,
    CASE action WHEN 'allocate' THEN amount_raw ELSE -amount_raw END AS signed_amount
  FROM alloc_events
)

-- ── Daily allocation flows ───────────────────────────────────────────────────
SELECT
  date_trunc('day', block_time)                                             AS day,
  SUM(CASE WHEN action = 'allocate'   THEN amount_raw ELSE 0 END) / 1e18  AS allocated_flow,
  SUM(CASE WHEN action = 'deallocate' THEN amount_raw ELSE 0 END) / 1e18  AS deallocated_flow,
  (SUM(CASE WHEN action = 'allocate'   THEN amount_raw ELSE 0 END)
   - SUM(CASE WHEN action = 'deallocate' THEN amount_raw ELSE 0 END)) / 1e18
                                                                            AS net_flow,
  MAX(total_deployed_raw) / 1e18                                            AS deployed_eod,
  COUNT(*)                                                                   AS event_count
FROM signed
GROUP BY 1
ORDER BY 1 DESC
;

-- ── Running deployed capital per event ───────────────────────────────────────
-- totalDeployed field is updated in-contract after each action — use it directly.
SELECT
  block_time,
  tx_hash,
  action,
  amount_raw / 1e18          AS amount_flow,
  total_deployed_raw / 1e18  AS total_deployed_after
FROM alloc_events
ORDER BY block_number DESC
LIMIT 100
;
