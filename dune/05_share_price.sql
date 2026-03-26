-- 05_share_price.sql
-- axWFLOW share price history derived from ERC4626 Deposit/Withdraw events
--
-- Method: at each deposit/withdraw, share price = assets / shares
-- This gives the instantaneous exchange rate from the event data.
--
-- ERC-4626 events:
--   Deposit(address caller, address owner, uint256 assets, uint256 shares)
--   Withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
--
-- Replace <VAULT_ADDRESS>.

WITH share_events AS (
  -- Deposits: data = abi.encode(assets, shares)
  SELECT
    block_time,
    block_number,
    tx_hash,
    'deposit'                                              AS event_type,
    bytearray_to_uint256(substr(data,  1, 32))             AS assets_raw,
    bytearray_to_uint256(substr(data, 33, 32))             AS shares_raw
  FROM flow_evm.logs
  WHERE contract_address = lower('<VAULT_ADDRESS>')
    AND topic0 = 0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4d709d7

  UNION ALL

  -- Withdraws: data = abi.encode(assets, shares) (caller, receiver, owner are indexed)
  SELECT
    block_time,
    block_number,
    tx_hash,
    'withdraw'                                             AS event_type,
    bytearray_to_uint256(substr(data,  1, 32))             AS assets_raw,
    bytearray_to_uint256(substr(data, 33, 32))             AS shares_raw
  FROM flow_evm.logs
  WHERE contract_address = lower('<VAULT_ADDRESS>')
    AND topic0 = 0xfbde7971b16b72e8f8e2fa9be9b7d71e1c4f5519e000b9e37c9a1df3bc4b8b9f
),

with_price AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    event_type,
    assets_raw / 1e18  AS assets,
    shares_raw / 1e18  AS shares,
    -- Instantaneous price at this event: how many assets per share
    (assets_raw * 1e18) / NULLIF(shares_raw, 0) / 1e18 AS share_price_wflow
  FROM share_events
  WHERE shares_raw > 0
)

-- ── Share price over time (hourly OHLC) ──────────────────────────────────────
SELECT
  date_trunc('hour', block_time)  AS hour,
  MIN(share_price_wflow)          AS low,
  MAX(share_price_wflow)          AS high,
  -- first/last price in the hour using window functions
  FIRST_VALUE(share_price_wflow) OVER (
    PARTITION BY date_trunc('hour', block_time)
    ORDER BY block_number ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  )                               AS open,
  LAST_VALUE(share_price_wflow) OVER (
    PARTITION BY date_trunc('hour', block_time)
    ORDER BY block_number ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  )                               AS close,
  COUNT(*)                        AS event_count
FROM with_price
GROUP BY 1, share_price_wflow, block_number
ORDER BY 1 DESC
;

-- ── All-time share price (most recent) ──────────────────────────────────────
SELECT
  block_time,
  tx_hash,
  event_type,
  assets,
  shares,
  share_price_wflow
FROM with_price
ORDER BY block_number DESC
LIMIT 50
;

-- ── APY estimate: annualised growth of share price ───────────────────────────
-- Compare earliest and latest share price to estimate vault APY.
WITH bounds AS (
  SELECT
    MIN(block_time)    AS t_start,
    MAX(block_time)    AS t_end,
    MIN_BY(share_price_wflow, block_number) AS price_start,
    MAX_BY(share_price_wflow, block_number) AS price_end
  FROM with_price
)
SELECT
  t_start,
  t_end,
  price_start,
  price_end,
  date_diff('day', t_start, t_end)              AS days_elapsed,
  -- APY = (price_end/price_start)^(365/days) - 1
  (POWER(price_end / price_start, 365.0 / NULLIF(date_diff('day', t_start, t_end), 0)) - 1) * 100
                                                 AS estimated_apy_pct
FROM bounds
;
