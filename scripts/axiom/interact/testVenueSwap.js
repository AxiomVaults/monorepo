// scripts/axiom/interact/testVenueSwap.js
// User sells stFLOW directly through AxiomVenue → receives FUSD at discount.
// Also verifies a redemption request is created and StrategyManager receives inventory.
//
// Usage:
//   npx hardhat run scripts/axiom/interact/testVenueSwap.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, f, fb, pct, section, divider, row } = require("./_contracts");

const SWAP_AMOUNT = ethers.parseEther("1000"); // 1 000 stFLOW to sell

async function main() {
  const { signer, c, vault, venue, strategyManager, redemptionAdapter, baseAsset, redeemableAsset } = await loadContracts();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║           TEST: VENUE SWAP — stFLOW → FUSD          ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Signer: ${signer.address}`);
  console.log(`  Swap:   ${fb(SWAP_AMOUNT)} stFLOW → FUSD\n`);

  // ─── Before state ─────────────────────────────────────────────────────────
  section("BEFORE STATE");
  const fusdBefore   = await baseAsset.balanceOf(signer.address);
  const stflowBefore = await redeemableAsset.balanceOf(signer.address);
  const vaultFusdBefore = await baseAsset.balanceOf(c.vault);
  const nextReqIdBefore = await redemptionAdapter.nextRequestId();
  const pendingBefore   = await vault.totalPendingRedemption();
  row("Signer FUSD",        fb(fusdBefore),      "FUSD");
  row("Signer stFLOW",      fb(stflowBefore),    "stFLOW");
  row("Vault FUSD on-hand", fb(vaultFusdBefore), "FUSD");
  row("totalPendingRedempt",fb(pendingBefore),   "FUSD");
  row("nextRequestId",      nextReqIdBefore.toString());

  // ─── Quote ────────────────────────────────────────────────────────────────
  section("STEP 1 — Get quote");
  const cfg         = await venue.swapConfigs(c.redeemableAsset);
  const quote       = await venue.getQuote(c.redeemableAsset, SWAP_AMOUNT);
  const swapAmt     = Number(ethers.formatEther(SWAP_AMOUNT));
  const quotedAmt   = Number(ethers.formatEther(quote));
  const effectiveDiscount = ((swapAmt - quotedAmt) / swapAmt * 100).toFixed(4);

  row("swapAmount",          fb(SWAP_AMOUNT),    "stFLOW");
  row("discountBps",         cfg.discountBps.toString() + " bps  (" + pct(cfg.discountBps) + ")");
  row("quoted FUSD out",     fb(quote),          "FUSD");
  row("effective discount",  effectiveDiscount + "%  (should be ≈ 0.0020%)");
  row("spot price implied",  (quotedAmt / swapAmt).toFixed(6), "FUSD per stFLOW");

  // ─── Approve ──────────────────────────────────────────────────────────────
  section("STEP 2 — Approve venue for stFLOW");
  const allowanceBefore = await redeemableAsset.allowance(signer.address, c.venue);
  if (allowanceBefore < SWAP_AMOUNT) {
    console.log("  Approving …");
    const approveTx = await redeemableAsset.approve(c.venue, SWAP_AMOUNT);
    await approveTx.wait();
    console.log(`  Approved  tx: ${approveTx.hash}`);
  } else {
    console.log("  Allowance sufficient, skipping approve.");
  }

  // ─── Execute swap ─────────────────────────────────────────────────────────
  section("STEP 3 — Execute swap");
  const minOut = (quote * 9990n) / 10000n; // 0.1 % slippage tolerance
  row("minOut (0.1% slippage)", fb(minOut), "FUSD");
  console.log("  Swapping …");
  const swapTx = await venue.swapRedeemableForBase(
    c.redeemableAsset,
    SWAP_AMOUNT,
    minOut,
    signer.address
  );
  const swapRx = await swapTx.wait();
  console.log(`  Swapped    tx: ${swapTx.hash}`);

  // ─── After state ──────────────────────────────────────────────────────────
  section("AFTER STATE");
  const fusdAfter    = await baseAsset.balanceOf(signer.address);
  const stflowAfter  = await redeemableAsset.balanceOf(signer.address);
  const vaultFusdAft = await baseAsset.balanceOf(c.vault);
  const nextReqIdAft = await redemptionAdapter.nextRequestId();
  const pendingAft   = await vault.totalPendingRedemption();
  const inventory    = await venue.inventoryBalances(c.redeemableAsset);

  const fusdReceived  = fusdAfter - fusdBefore;
  const stflowSpent   = stflowBefore - stflowAfter;
  row("FUSD received",         fb(fusdReceived), "FUSD");
  row("stFLOW spent",          fb(stflowSpent),  "stFLOW");
  row("Vault FUSD on-hand",    fb(vaultFusdAft), "FUSD (should decrease)");
  row("Venue inventory",       fb(inventory),    "stFLOW (flushed → StrategyManager)");
  row("nextRequestId",         nextReqIdAft.toString(), "(should have increased by 1)");
  row("totalPendingRedemption",fb(pendingAft),   "FUSD (should increase by quote)");

  // ─── Check redemption request ─────────────────────────────────────────────
  if (nextReqIdAft > 0n) {
    section("REDEMPTION REQUEST DETAILS");
    const latestReqId = nextReqIdAft - 1n;
    const req = await redemptionAdapter.requests(latestReqId);
    const claimDelay  = await redemptionAdapter.claimDelay();
    const claimableAt = Number(req.timestamp) + Number(claimDelay);
    const nowTs       = Math.floor(Date.now() / 1000);
    row("requestId",        latestReqId.toString());
    row("requester",        req.requester);
    row("amount",           fb(req.amount), "stFLOW");
    row("timestamp",        new Date(Number(req.timestamp) * 1000).toISOString());
    row("claimable after",  new Date(claimableAt * 1000).toISOString());
    row("seconds remaining",Math.max(0, claimableAt - nowTs).toString() + "s");
    row("is claimed",       req.claimed.toString());
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  section("SUMMARY");
  const pass = fusdReceived >= minOut && stflowSpent === SWAP_AMOUNT && nextReqIdAft > nextReqIdBefore;
  row("FUSD received within slippage", fusdReceived >= minOut ? "YES ✓" : "NO (!)");
  row("stFLOW fully spent",            stflowSpent === SWAP_AMOUNT ? "YES ✓" : "NO (!)");
  row("redemption request created",    nextReqIdAft > nextReqIdBefore ? "YES ✓" : "NO (!)");
  console.log(`\n  RESULT: ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
