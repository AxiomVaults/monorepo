// scripts/axiom/interact/testPairSwap.js
// Eisen-compatible path: user sells stFLOW through AxiomUniV2Pair (pay-first UniV2 pattern).
// This is the exact path Eisen router will use — validates full compatibility.
//
// Usage:
//   npx hardhat run scripts/axiom/interact/testPairSwap.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, f, fb, pct, section, row } = require("./_contracts");

const SELL_AMOUNT = ethers.parseEther("500"); // 500 stFLOW in

async function main() {
  const { signer, c, vault, venue, pair, redemptionAdapter, baseAsset, redeemableAsset } = await loadContracts();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║     TEST: PAIR SWAP (EISEN PATH) — stFLOW → FUSD   ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Signer: ${signer.address}`);
  console.log(`  Selling: ${fb(SELL_AMOUNT)} stFLOW via AxiomUniV2Pair`);
  console.log(`  Pair:    ${c.pair}\n`);

  // ─── Before state ─────────────────────────────────────────────────────────
  section("BEFORE STATE");
  const fusdBefore   = await baseAsset.balanceOf(signer.address);
  const stflowBefore = await redeemableAsset.balanceOf(signer.address);
  const reserves     = await pair.getReserves();
  const nextReqBef   = await redemptionAdapter.nextRequestId();
  row("Signer FUSD",          fb(fusdBefore),    "FUSD");
  row("Signer stFLOW",        fb(stflowBefore),  "stFLOW");
  row("pair.reserve0 (FUSD)", fb(reserves[0]),   "FUSD (virtual)");
  row("pair.reserve1 (stFLOW)",fb(reserves[1]),  "stFLOW (virtual)");
  row("nextRequestId",        nextReqBef.toString());

  // ─── Compute expected amount0Out ──────────────────────────────────────────
  section("STEP 1 — Compute expected FUSD out");
  // Use venue.getQuote which is the canonical price source for the pair
  const expectedOut = await venue.getQuote(c.redeemableAsset, SELL_AMOUNT);
  const amount0Out  = (expectedOut * 9990n) / 10000n; // 0.1% slippage
  row("stFLOW in",              fb(SELL_AMOUNT),  "stFLOW");
  row("getQuote(500 stFLOW)",   fb(expectedOut),  "FUSD");
  row("amount0Out (min, 0.1%)", fb(amount0Out),   "FUSD");

  // ─── Important: check vault has the liquidity ──────────────────────────────
  const availLiq = await vault.availableLiquidity();
  row("vault availableLiquidity", fb(availLiq), "FUSD");
  if (availLiq < expectedOut) {
    console.log("\n  ⚠️  Insufficient vault liquidity. Run testVault.js first to deposit more FUSD.");
    process.exit(1);
  }

  // ─── Step 2: Send stFLOW to pair (pay-first pattern) ─────────────────────
  section("STEP 2 — Transfer stFLOW to pair address (pay-first)");
  console.log(`  Transferring ${fb(SELL_AMOUNT)} stFLOW → pair…`);
  const transferTx = await redeemableAsset.transfer(c.pair, SELL_AMOUNT);
  await transferTx.wait();
  console.log(`  Transferred tx: ${transferTx.hash}`);

  const pairStFlowBal = await redeemableAsset.balanceOf(c.pair);
  row("pair stFLOW balance now", fb(pairStFlowBal), "stFLOW (should = sell amount)");
  if (pairStFlowBal < SELL_AMOUNT) {
    console.error("  ❌ FAIL: pair did not receive stFLOW");
    process.exit(1);
  }

  // ─── Step 3: Call pair.swap ───────────────────────────────────────────────
  section("STEP 3 — Call pair.swap(amount0Out, 0, to, data)");
  console.log(`  Calling swap(${fb(amount0Out)}, 0, ${signer.address}, 0x) …`);
  // Matching UniV2 ABI: swap(uint amount0Out, uint amount1Out, address to, bytes calldata data)
  const swapTx = await pair.swap(amount0Out, 0n, signer.address, "0x");
  const swapRx = await swapTx.wait();
  console.log(`  Swapped    tx: ${swapTx.hash}`);

  // ─── After state ──────────────────────────────────────────────────────────
  section("AFTER STATE");
  const fusdAfter    = await baseAsset.balanceOf(signer.address);
  const stflowAfter  = await redeemableAsset.balanceOf(signer.address);
  const reservesAft  = await pair.getReserves();
  const nextReqAft   = await redemptionAdapter.nextRequestId();
  const pendingAft   = await vault.totalPendingRedemption();

  const fusdReceived = fusdAfter - fusdBefore;
  const stflowSpent  = stflowBefore - stflowAfter;

  row("FUSD received",            fb(fusdReceived), "FUSD");
  row("stFLOW spent",             fb(stflowSpent),  "stFLOW");
  row("new reserve0 (FUSD)",      fb(reservesAft[0]),"FUSD (virtual, should decrease)");
  row("new reserve1 (stFLOW)",    fb(reservesAft[1]),"stFLOW (virtual)");
  row("nextRequestId",            nextReqAft.toString(), "(should increase)");
  row("totalPendingRedemption",   fb(pendingAft),   "FUSD");

  // ─── Verify reserves updated ──────────────────────────────────────────────
  section("RESERVE DELTA CHECK");
  row("reserve0 before", fb(reserves[0]),    "FUSD");
  row("reserve0 after",  fb(reservesAft[0]), "FUSD (should be lower — less liquidity)");
  row("reserve1 before", fb(reserves[1]),    "stFLOW");
  row("reserve1 after",  fb(reservesAft[1]), "stFLOW (virtual, based on reserve0)");

  // ─── Summary ──────────────────────────────────────────────────────────────
  section("SUMMARY");
  const pass = fusdReceived >= amount0Out && stflowSpent === SELL_AMOUNT && nextReqAft > nextReqBef;
  row("FUSD received ≥ minOut",   fusdReceived >= amount0Out ? "YES ✓" : "NO (!)");
  row("stFLOW fully consumed",    stflowSpent === SELL_AMOUNT ? "YES ✓" : "NO (!)");
  row("redemption request created",nextReqAft > nextReqBef ? "YES ✓" : "NO (!)");
  row("Eisen path compatibility", pass ? "CONFIRMED ✓" : "FAILED (!)");
  console.log(`\n  RESULT: ${pass ? "✅ PASS — Eisen router compatible" : "❌ FAIL"}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
