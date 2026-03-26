-- 06_lp_pair_activity.sql
-- AxiomUniV2Pair on-chain activity: Eisen/aggregator swaps via the UniV2 pair interface
--
-- AxiomUniV2Pair event (IUniswapV2Pair-compatible):
--   Swap(address indexed sender, uint256 amount0In, uint256 amount1In,
--        uint256 amount0Out, uint256 amount1Out, address indexed to)
--   topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
--
-- token0 = WFLOW  (0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e)
-- token1 = ankrFLOW (0x1b97100ea1d7126c4d60027e231ea4cb25314bdb)
-- Pair:    0x07882ae1ecb7429a84f1d53048d35c4bb2056877
-- Factory: 0xd0141e899a65c95a556fe2b27e5982a6de7fdd7a

-- ── Individual swap events ───────────────────────────────────────────────────
SELECT
  block_time,
  block_number,
  tx_hash,
  '0x' || right(cast(topic1 AS varchar), 40)        AS sender,
  '0x' || right(cast(topic2 AS varchar), 40)        AS to_addr,
  -- data = abi.encode(amount0In, amount1In, amount0Out, amount1Out)
  bytearray_to_uint256(substr(data,  1, 32)) / 1e18 AS amount0_in_wflow,
  bytearray_to_uint256(substr(data, 33, 32)) / 1e18 AS amount1_in_ankrflow,
  bytearray_to_uint256(substr(data, 65, 32)) / 1e18 AS amount0_out_wflow,
  bytearray_to_uint256(substr(data, 97, 32)) / 1e18 AS amount1_out_ankrflow,
  CASE
    WHEN bytearray_to_uint256(substr(data, 33, 32)) > 0 THEN 'ankrFLOW→WFLOW'
    ELSE 'WFLOW→ankrFLOW'
  END AS direction
FROM flow_evm.logs
WHERE contract_address = 0x07882ae1ecb7429a84f1d53048d35c4bb2056877
  AND topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
ORDER BY block_number DESC
;

-- ── Daily pair swap summary ──────────────────────────────────────────────────
SELECT
  date_trunc('day', block_time)                                              AS day,
  COUNT(*)                                                                    AS swap_count,
  COUNT(DISTINCT '0x' || right(cast(topic1 AS varchar), 40))                 AS unique_senders,
  SUM(bytearray_to_uint256(substr(data, 33, 32))) / 1e18                     AS total_ankrflow_in,
  SUM(bytearray_to_uint256(substr(data, 65, 32))) / 1e18                     AS total_wflow_out
FROM flow_evm.logs
WHERE contract_address = 0x07882ae1ecb7429a84f1d53048d35c4bb2056877
  AND topic0 = 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
GROUP BY 1
ORDER BY 1 DESC
;

-- ── Aggregator routing detection ─────────────────────────────────────────────
-- Transactions calling pair.swap() with non-empty calldata bytes are aggregator-initiated.
-- swap(uint256,uint256,address,bytes) selector = 0x022c0d9f
SELECT
  block_time,
  hash                                        AS tx_hash,
  "from"                                      AS caller,
  length(data)                                AS calldata_bytes,
  substr(cast(data AS varchar), 1, 10)        AS selector
FROM flow_evm.transactions
WHERE to = 0x07882ae1ecb7429a84f1d53048d35c4bb2056877
  AND substr(cast(data AS varchar), 1, 10) = '0x022c0d9f'
ORDER BY block_time DESC
LIMIT 50
;
