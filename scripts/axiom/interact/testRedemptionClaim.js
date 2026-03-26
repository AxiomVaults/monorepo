// scripts/axiom/interact/testRedemptionClaim.js
// Claims a matured redemption request: verifies vault accounting is updated correctly.
// Run this ≥ 300s after testVenueSwap.js or testPairSwap.js created a request.
//
// Usage:
//   npx hardhat run scripts/axiom/interact/testRedemptionClaim.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, f, fb, section, row } = require("./_contracts");

async function main() {
  const { signer, c, vault, strategyManager, redemptionAdapter, baseAsset, redeemableAsset } = await loadContracts();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║           TEST: REDEMPTION CLAIM                    ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Signer: ${signer.address}\n`);

  // ─── Discover pending requests ────────────────────────────────────────────
  section("PENDING REDEMPTION REQUESTS");
  const claimDelay  = await redemptionAdapter.claimDelay();
  const nextReqId   = await redemptionAdapter.nextRequestId();
  const now         = Math.floor(Date.now() / 1000);

  row("claimDelay",   claimDelay.toString() + "s");
  row("total requests (nextRequestId)", nextReqId.toString());

  if (nextReqId === 0n) {
    console.log("\n  ⚠️  No redemption requests found.");
    console.log("  Run testVenueSwap.js or testPairSwap.js first to create a request.");
    process.exit(0);
  }

  // ─── Print all requests and find claimable ones ───────────────────────────
  const claimable = [];
  const pending   = [];
  for (let i = 0n; i < nextReqId; i++) {
    const req = await redemptionAdapter.requests(i);
    const claimableAt = Number(req.timestamp) + Number(claimDelay);
    const secsLeft    = Math.max(0, claimableAt - now);
    const ready       = !req.claimed && now >= claimableAt;
    if (!req.claimed) {
      console.log(`  [${i}] amount=${fb(req.amount)} stFLOW  claimableAt=${new Date(claimableAt*1000).toISOString()}  ${ready ? "READY ✓" : `locked (${secsLeft}s left)`}`);
      if (ready) claimable.push(i);
      else pending.push({ id: i, secsLeft });
    } else {
      console.log(`  [${i}] amount=${fb(req.amount)} stFLOW  ALREADY CLAIMED`);
    }
  }

  if (claimable.length === 0) {
    if (pending.length > 0) {
      const soonest = pending.reduce((a, b) => a.secsLeft < b.secsLeft ? a : b);
      console.log(`\n  ⏳ No requests are claimable yet.`);
      console.log(`     Soonest: request [${soonest.id}] claimable in ${soonest.secsLeft}s`);
      console.log(`     Wait ${soonest.secsLeft}s and re-run this script.`);
    }
    process.exit(0);
  }

  // ─── Before state ─────────────────────────────────────────────────────────
  section("BEFORE CLAIM");
  const taBefore     = await vault.totalAssets();
  const pendRedemBef = await vault.totalPendingRedemption();
  const vaultFusdBef = await baseAsset.balanceOf(c.vault);
  const adapterFusdB = await baseAsset.balanceOf(c.redemptionAdapter);
  row("vault.totalAssets()",         fb(taBefore),     "FUSD");
  row("vault.totalPendingRedemption",fb(pendRedemBef), "FUSD");
  row("vault FUSD on-hand",          fb(vaultFusdBef), "FUSD");
  row("adapter FUSD balance",        fb(adapterFusdB), "FUSD");

  // ─── Claim all claimable requests ─────────────────────────────────────────
  section(`CLAIMING ${claimable.length} REQUEST(S)`);
  let totalClaimed = 0n;
  for (const reqId of claimable) {
    const req = await redemptionAdapter.requests(reqId);
    console.log(`\n  Claiming request [${reqId}] (${fb(req.amount)} stFLOW) …`);
    const tx  = await strategyManager.claimRedemption(reqId);
    await tx.wait();
    console.log(`  Claimed    tx: ${tx.hash}`);

    const reqAfter = await redemptionAdapter.requests(reqId);
    row("  request.claimed", reqAfter.claimed ? "YES ✓" : "NO (!)");
    totalClaimed += req.amount;
  }

  // ─── After state ──────────────────────────────────────────────────────────
  section("AFTER CLAIM");
  const taAfter      = await vault.totalAssets();
  const pendRedemAft = await vault.totalPendingRedemption();
  const vaultFusdAft = await baseAsset.balanceOf(c.vault);
  const adapterFusdA = await baseAsset.balanceOf(c.redemptionAdapter);

  row("vault.totalAssets()",          fb(taAfter),      "FUSD (should ≈ before — just reclassified)");
  row("vault.totalPendingRedemption", fb(pendRedemAft), "FUSD (should decrease)");
  row("vault FUSD on-hand",           fb(vaultFusdAft), "FUSD (should increase)");
  row("adapter FUSD balance",         fb(adapterFusdA), "FUSD (should decrease by payout)");
  row("total stFLOW redeemed",        fb(totalClaimed), "stFLOW (1:1 par)");

  // ─── Summary ──────────────────────────────────────────────────────────────
  section("SUMMARY");
  const pendingDecreased = pendRedemAft < pendRedemBef;
  const vaultFusdGrew    = vaultFusdAft > vaultFusdBef;
  // totalAssets should be approximately unchanged (funds just moved from pending → on-hand)
  const taApproxSame     = taAfter >= taBefore - ethers.parseEther("1"); // allow tiny rounding

  row("pending redemption decreased", pendingDecreased ? "YES ✓" : "NO (!)");
  row("vault FUSD on-hand grew",      vaultFusdGrew    ? "YES ✓" : "NO (!)");
  row("totalAssets roughly unchanged",taApproxSame     ? "YES ✓" : "NO (!)");

  const pass = pendingDecreased && vaultFusdGrew && taApproxSame;
  console.log(`\n  RESULT: ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
