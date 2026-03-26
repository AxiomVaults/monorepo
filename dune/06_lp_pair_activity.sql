-- 06_lp_pair_activity.sql
-- AxiomUniV2Pair on-chain activity: Eisen/aggregator routing discovery and swaps
--
-- Tracks: which addresses discovered the pair, swap events via the pair,
--         virtual reserve snapshots.
--
-- Replace <PAIR_ADDRESS> and <FACTORY_ADDRESS>.

-- ── Pair swap events via the pair contract ───────────────────────────────────
-- AxiomUniV2Pair inherits UniV2 Swap event:
--   Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
--   topic0 = 0xd78ad95f...

SELECT
  block_time,
  block_number,
  tx_hash,
  '0x' || right(cast(topic1 AS varchar), 40)               AS sender,
  '0x' || right(cast(topic2 AS varchar), 40)               AS to_addr,
  bytearray_to_uint256(substr(data,  1, 32)) / 1e18        AS amount0_in_wflow,
  bytearray_to_uint256(substr(data, 33, 32)) / 1e18        AS amount1_in_ankrflow,
  bytearray_to_uint256(substr(data, 65, 32)) / 1e18        AS amount0_out_wflow,
  bytearray_to_uint256(substr(data, 97, 32)) / 1e18        AS amount1_out_ankrflow,
  -- Direction: selling ankrFLOW (token1 in) or buying ankrFLOW (token0 in)
  CASE
    WHEN bytearray_to_uint256(substr(data, 33, 32)) > 0 THEN 'ankrFLOW→WFLOW'
    ELSE 'WFLOW→ankrFLOW'
  END AS direction
FROM flow_evm.logs
WHERE contract_address = lower('<PAIR_ADDRESS>')
  AND topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822  -- Swap
ORDER BY block_number DESC
;

-- ── Daily pair swap summary ──────────────────────────────────────────────────
SELECT
  date_trunc('day', block_time) AS day,
  COUNT(*)                       AS swap_count,
  COUNT(DISTINCT '0x' || right(cast(topic1 AS varchar), 40)) AS unique_senders,
  SUM(bytearray_to_uint256(substr(data, 33, 32))) / 1e18     AS total_ankrflow_in,
  SUM(bytearray_to_uint256(substr(data, 65, 32))) / 1e18     AS total_wflow_out
FROM flow_evm.logs
WHERE contract_address = lower('<PAIR_ADDRESS>')
  AND topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
GROUP BY 1
ORDER BY 1 DESC
;

-- ── Aggregator routing detection (calldata pattern) ──────────────────────────
-- Transactions calling pair.swap() with non-empty data bytes are aggregator-initiated
SELECT
  block_time,
  tx_hash,
  "from"  AS aggregator_addr,
  length(input) AS calldata_bytes,
  -- first 4 bytes = function selector swap(uint256,uint256,address,bytes)
  substr(cast(input AS varchar), 1, 10) AS selector
FROM flow_evm.transactions
WHERE to = lower('<PAIR_ADDRESS>')
  AND substr(cast(input AS varchar), 1, 10) = '0x022c0d9f'  -- swap() selector
ORDER BY block_time DESC
LIMIT 50
;
