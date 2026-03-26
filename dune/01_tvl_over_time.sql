-- 01_tvl_over_time.sql
-- Axiom Vault TVL over time on Flow EVM (chain 747)
-- Uses Deposit and Withdraw events to compute running net TVL.
--
-- ERC-4626 AxiomVault events:
--   Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)
--   Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)
--
-- Vault: 0xcace1b78160ae76398f486c8a18044da0d66d86d
-- Chain: Flow EVM (747) — Dune schema: flow.logs / flow.transactions

WITH raw_events AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    CASE
      WHEN topic0 = 0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7
      THEN 'deposit'
      WHEN topic0 = 0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db
      THEN 'withdraw'
    END AS event_type,
    -- assets = first 32 bytes of non-indexed data (same position for both events)
    bytearray_to_uint256(substr(data, 1, 32)) AS assets_raw
  FROM flow.logs
  WHERE contract_address = 0xcace1b78160ae76398f486c8a18044da0d66d86d
    AND topic0 IN (
      0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7,  -- Deposit
      0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db   -- Withdraw
    )
),

signed AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    event_type,
    assets_raw,
    CASE event_type WHEN 'deposit' THEN assets_raw ELSE -assets_raw END AS signed_assets
  FROM raw_events
  WHERE event_type IS NOT NULL
),

cumulative AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    event_type,
    assets_raw / 1e18 AS assets_flow,
    SUM(signed_assets) OVER (ORDER BY block_number, tx_hash) / 1e18 AS tvl_flow
  FROM signed
)

SELECT
  date_trunc('hour', block_time) AS hour,
  MAX(tvl_flow)                  AS tvl_flow,  -- last known TVL in that hour
  SUM(CASE WHEN event_type = 'deposit'  THEN assets_flow ELSE 0 END) AS hourly_deposits,
  SUM(CASE WHEN event_type = 'withdraw' THEN assets_flow ELSE 0 END) AS hourly_withdrawals,
  COUNT(DISTINCT tx_hash)        AS txn_count
FROM cumulative
GROUP BY 1
ORDER BY 1 DESC
;
