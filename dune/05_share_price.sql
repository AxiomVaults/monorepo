-- 05_share_price.sql
-- axWFLOW share price history derived from ERC4626 Deposit/Withdraw events
--
-- ERC-4626 events:
--   Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
--   topic0 = 0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7
--
--   Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
--   topic0 = 0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db
--
-- Vault: 0xcace1b78160ae76398f486c8a18044da0d66d86d

WITH share_events AS (
  -- Deposits: topic1=caller, topic2=owner | data = abi.encode(assets, shares)
  SELECT
    block_time,
    block_number,
    tx_hash,
    'deposit'                                              AS event_type,
    bytearray_to_uint256(substr(data,  1, 32))             AS assets_raw,
    bytearray_to_uint256(substr(data, 33, 32))             AS shares_raw
  FROM flow.logs
  WHERE contract_address = 0xcace1b78160ae76398f486c8a18044da0d66d86d
    AND topic0 = 0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7

  UNION ALL

  -- Withdraws: topic1=caller, topic2=receiver, topic3=owner | data = abi.encode(assets, shares)
  SELECT
    block_time,
    block_number,
    tx_hash,
    'withdraw'                                             AS event_type,
    bytearray_to_uint256(substr(data,  1, 32))             AS assets_raw,
    bytearray_to_uint256(substr(data, 33, 32))             AS shares_raw
  FROM flow.logs
  WHERE contract_address = 0xcace1b78160ae76398f486c8a18044da0d66d86d
    AND topic0 = 0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db
),

with_price AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    event_type,
    assets_raw / 1e18  AS assets,
    shares_raw / 1e18  AS shares,
    -- Instantaneous share price at this event
    (CAST(assets_raw AS DOUBLE) / NULLIF(CAST(shares_raw AS DOUBLE), 0)) AS share_price_wflow
  FROM share_events
  WHERE shares_raw > 0
)

-- ── Share price over time (latest per hour) ──────────────────────────────────
SELECT
  date_trunc('hour', block_time)             AS hour,
  MAX_BY(share_price_wflow, block_number)    AS share_price_wflow,
  COUNT(*)                                    AS event_count
FROM with_price
GROUP BY 1
ORDER BY 1 DESC
;

-- ── Recent share price events ────────────────────────────────────────────────
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

-- ── APY estimate ─────────────────────────────────────────────────────────────
WITH bounds AS (
  SELECT
    MIN(block_time)                              AS t_start,
    MAX(block_time)                              AS t_end,
    MIN_BY(share_price_wflow, block_number)      AS price_start,
    MAX_BY(share_price_wflow, block_number)      AS price_end
  FROM with_price
)
SELECT
  t_start,
  t_end,
  price_start,
  price_end,
  date_diff('day', t_start, t_end)               AS days_elapsed,
  (POWER(
    price_end / NULLIF(price_start, 0),
    365.0 / NULLIF(date_diff('day', t_start, t_end), 0)
  ) - 1) * 100                                   AS estimated_apy_pct
FROM bounds
;
