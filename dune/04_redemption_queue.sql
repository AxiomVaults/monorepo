-- 04_redemption_queue.sql
-- ankrFLOW native redemption queue dynamics
--
-- AnkrRedemptionAdapter events (replace <REDEMPTION_ADAPTER_ADDRESS>):
--   RedemptionRequested(address indexed user, uint256 amount, uint256 indexed requestId)
--   RedemptionClaimed(address indexed user, uint256 amount, uint256 indexed requestId)
--
-- Shows: queue depth, average wait time, cumulative claimed vs pending.

WITH requests AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    '0x' || right(cast(topic1 AS varchar), 40)                  AS user_addr,
    bytearray_to_uint256(topic3)                                 AS request_id,
    bytearray_to_uint256(substr(data, 1, 32))                    AS amount_raw
  FROM flow_evm.logs
  WHERE contract_address = lower('<REDEMPTION_ADAPTER_ADDRESS>')
    AND topic0 = 0x<REDEMPTION_REQUESTED_TOPIC0>
),

claims AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    '0x' || right(cast(topic1 AS varchar), 40)                  AS user_addr,
    bytearray_to_uint256(topic3)                                 AS request_id,
    bytearray_to_uint256(substr(data, 1, 32))                    AS amount_raw
  FROM flow_evm.logs
  WHERE contract_address = lower('<REDEMPTION_ADAPTER_ADDRESS>')
    AND topic0 = 0x<REDEMPTION_CLAIMED_TOPIC0>
),

matched AS (
  SELECT
    r.request_id,
    r.user_addr,
    r.block_time                              AS requested_at,
    r.amount_raw / 1e18                       AS amount_ankrflow,
    c.block_time                              AS claimed_at,
    date_diff('hour', r.block_time, c.block_time) AS wait_hours,
    c.tx_hash                                 AS claim_tx,
    CASE WHEN c.request_id IS NULL THEN 'pending' ELSE 'claimed' END AS status
  FROM requests r
  LEFT JOIN claims c ON r.request_id = c.request_id
)

-- ── Request overview ─────────────────────────────────────────────────────────
SELECT
  date_trunc('day', requested_at) AS day,
  COUNT(*)                         AS total_requests,
  SUM(amount_ankrflow)             AS total_ankrflow_requested,
  COUNT(*) FILTER (WHERE status = 'claimed') AS claimed,
  COUNT(*) FILTER (WHERE status = 'pending') AS pending,
  AVG(wait_hours) FILTER (WHERE status = 'claimed') AS avg_wait_hours
FROM matched
GROUP BY 1
ORDER BY 1 DESC
;

-- ── Current pending queue ────────────────────────────────────────────────────
SELECT
  request_id,
  user_addr,
  requested_at,
  amount_ankrflow,
  date_diff('hour', requested_at, NOW()) AS hours_waiting
FROM matched
WHERE status = 'pending'
ORDER BY requested_at ASC
;

-- ── Redemption funnel summary ────────────────────────────────────────────────
SELECT
  COUNT(*)                                               AS total_requests,
  SUM(amount_ankrflow)                                   AS total_requested_flow,
  SUM(amount_ankrflow) FILTER (WHERE status = 'claimed') AS total_claimed_flow,
  SUM(amount_ankrflow) FILTER (WHERE status = 'pending') AS total_pending_flow,
  AVG(wait_hours) FILTER (WHERE status = 'claimed')      AS mean_wait_hours,
  MAX(wait_hours) FILTER (WHERE status = 'claimed')      AS max_wait_hours
FROM matched
;
