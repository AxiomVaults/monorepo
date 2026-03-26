-- 01_tvl_over_time.sql
-- Axiom Vault TVL over time on Flow EVM (chain 747)
-- Uses Deposit and Withdraw events to compute net TVL per block
--
-- ERC-4626 AxiomVault events:
--   Deposit(caller, owner, assets, shares)  topic0 = 0xdcbc1c05...
--   Withdraw(caller, receiver, owner, assets, shares) topic0 = 0xfbde7971...
--
-- Replace <VAULT_ADDRESS> with deployed vault address (checksummed, lowercase for Dune).

WITH raw_events AS (
  SELECT
    block_time,
    block_number,
    tx_hash,
    -- Deposit: topic1=caller, topic2=owner, data contains (assets, shares)
    CASE
      WHEN topic0 = 0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4d709d7
      THEN 'deposit'
      WHEN topic0 = 0xfbde7971b16b72e8f8e2fa9be9b7d71e1c4f5519e000b9e37c9a1df3bc4b8b9f
      THEN 'withdraw'
    END AS event_type,
    -- assets is first word of non-indexed data
    bytearray_to_uint256(substr(data, 1, 32)) AS assets_raw
  FROM flow_evm.logs
  WHERE contract_address = lower('<VAULT_ADDRESS>')
    AND topic0 IN (
      0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4d709d7,  -- Deposit
      0xfbde7971b16b72e8f8e2fa9be9b7d71e1c4f5519e000b9e37c9a1df3bc4b8b9f   -- Withdraw
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
