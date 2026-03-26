-- 04_redemption_queue.sql
-- ankrFLOW native redemption queue dynamics
--
-- AnkrRedemptionAdapter events:
--   RedemptionRequested(uint256 indexed requestId, address indexed requester, uint256 amount, uint64 timestamp)
--   topic0 = 0x73baede4549b15bc5bd693c38a8e083221a7764658b58d982510f094d44dd999
--
--   RedemptionClaimed(uint256 indexed requestId, address indexed recipient, uint256 baseAmount)
--   topic0 = 0xa15008b6e695cc35d35421608ccb0ed390dab78c54707b1be30293cb76296c81
--
-- AnkrRedemptionAdapter: 0xc96304e3c037f81da488ed9dea1d8f2a48278a75

WITH requests AS (
  SELECT
    block_time,
    tx_hash,
    -- topic1 = requestId (indexed uint256), topic2 = requester (indexed address)
    bytearray_to_uint256(topic1)                                 AS request_id,
      '0x' || "right"(cast(topic2 AS varchar), 40)                   AS requester,
    -- data = abi.encode(amount, timestamp)
    bytearray_to_uint256(substr(data,  1, 32))                   AS amount_raw
  FROM flow.logs
  WHERE contract_address = 0xc96304e3c037f81da488ed9dea1d8f2a48278a75
    AND topic0 = 0x73baede4549b15bc5bd693c38a8e083221a7764658b58d982510f094d44dd999
),

claims AS (
  SELECT
    block_time,
    tx_hash,
    -- topic1 = requestId (indexed), topic2 = recipient (indexed)
    bytearray_to_uint256(topic1)                                 AS request_id,
      '0x' || "right"(cast(topic2 AS varchar), 40)                   AS recipient,
    -- data = abi.encode(baseAmount)
    bytearray_to_uint256(substr(data,  1, 32))                   AS base_amount_raw
  FROM flow.logs
  WHERE contract_address = 0xc96304e3c037f81da488ed9dea1d8f2a48278a75
    AND topic0 = 0xa15008b6e695cc35d35421608ccb0ed390dab78c54707b1be30293cb76296c81
),

matched AS (
  SELECT
    r.request_id,
    r.requester,
    r.block_time                                          AS requested_at,
    r.amount_raw / 1e18                                   AS amount_ankrflow,
    c.block_time                                          AS claimed_at,
    c.base_amount_raw / 1e18                              AS base_amount_flow,
    date_diff('hour', r.block_time, c.block_time)         AS wait_hours,
    c.tx_hash                                             AS claim_tx,
    CASE WHEN c.request_id IS NULL THEN 'pending' ELSE 'claimed' END AS status
  FROM requests r
  LEFT JOIN claims c ON r.request_id = c.request_id
)

-- ── Daily redemption statistics ──────────────────────────────────────────────
SELECT
  date_trunc('day', requested_at)                          AS day,
  COUNT(*)                                                  AS total_requests,
  SUM(amount_ankrflow)                                      AS total_ankrflow_requested,
  COUNT(*) FILTER (WHERE status = 'claimed')                AS claimed,
  COUNT(*) FILTER (WHERE status = 'pending')                AS pending,
  AVG(wait_hours) FILTER (WHERE status = 'claimed')         AS avg_wait_hours
FROM matched
GROUP BY 1
ORDER BY 1 DESC

/* ── SEPARATE DUNE QUERY: Current pending queue ──────────────────────────────
   Paste the full block below (WITH ... SELECT) as a new Dune query.

WITH requests AS (
  SELECT block_time, tx_hash,
    bytearray_to_uint256(topic1) AS request_id,
    '0x' || "right"(cast(topic2 AS varchar), 40) AS requester,
    bytearray_to_uint256(substr(data, 1, 32)) AS amount_raw
  FROM flow.logs
  WHERE contract_address = 0xc96304e3c037f81da488ed9dea1d8f2a48278a75
    AND topic0 = 0x73baede4549b15bc5bd693c38a8e083221a7764658b58d982510f094d44dd999
),
claims AS (
  SELECT block_time, tx_hash,
    bytearray_to_uint256(topic1) AS request_id,
    bytearray_to_uint256(substr(data, 1, 32)) AS base_amount_raw
  FROM flow.logs
  WHERE contract_address = 0xc96304e3c037f81da488ed9dea1d8f2a48278a75
    AND topic0 = 0xa15008b6e695cc35d35421608ccb0ed390dab78c54707b1be30293cb76296c81
),
matched AS (
  SELECT r.request_id, r.requester, r.block_time AS requested_at,
    r.amount_raw / 1e18 AS amount_ankrflow,
    CASE WHEN c.request_id IS NULL THEN 'pending' ELSE 'claimed' END AS status
  FROM requests r LEFT JOIN claims c ON r.request_id = c.request_id
)
SELECT request_id, requester, requested_at, amount_ankrflow,
  date_diff('hour', requested_at, NOW()) AS hours_waiting
FROM matched
WHERE status = 'pending'
ORDER BY requested_at ASC

*/

/* ── SEPARATE DUNE QUERY: All-time redemption funnel ─────────────────────────

WITH requests AS (
  SELECT block_time, tx_hash,
    bytearray_to_uint256(topic1) AS request_id,
    bytearray_to_uint256(substr(data, 1, 32)) AS amount_raw
  FROM flow.logs
  WHERE contract_address = 0xc96304e3c037f81da488ed9dea1d8f2a48278a75
    AND topic0 = 0x73baede4549b15bc5bd693c38a8e083221a7764658b58d982510f094d44dd999
),
claims AS (
  SELECT block_time, tx_hash,
    bytearray_to_uint256(topic1) AS request_id,
    bytearray_to_uint256(substr(data, 1, 32)) AS base_amount_raw
  FROM flow.logs
  WHERE contract_address = 0xc96304e3c037f81da488ed9dea1d8f2a48278a75
    AND topic0 = 0xa15008b6e695cc35d35421608ccb0ed390dab78c54707b1be30293cb76296c81
),
matched AS (
  SELECT r.request_id, r.block_time AS requested_at,
    r.amount_raw / 1e18 AS amount_ankrflow,
    date_diff('hour', r.block_time, c.block_time) AS wait_hours,
    CASE WHEN c.request_id IS NULL THEN 'pending' ELSE 'claimed' END AS status
  FROM requests r LEFT JOIN claims c ON r.request_id = c.request_id
)
SELECT
  COUNT(*)                                                AS total_requests,
  SUM(amount_ankrflow)                                    AS total_requested_flow,
  SUM(amount_ankrflow) FILTER (WHERE status = 'claimed') AS total_claimed_flow,
  SUM(amount_ankrflow) FILTER (WHERE status = 'pending') AS total_pending_flow,
  AVG(wait_hours)      FILTER (WHERE status = 'claimed') AS mean_wait_hours,
  MAX(wait_hours)      FILTER (WHERE status = 'claimed') AS max_wait_hours
FROM matched

*/
