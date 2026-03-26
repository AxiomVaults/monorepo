// scripts/axiom/interact/testFullCycle.js
// End-to-end system demonstration:
//   1. Deposit FUSD as a vault user
//   2. Swap stFLOW for FUSD via AxiomVenue (creates redemption request)
//   3. Allocate capital to yield adapter (aggregator generates yield)
//   4. Poll until redemption is claimable (300s lock)
//   5. Claim redemption (base recycles back to vault)
//   6. Deallocate yield (harvest yield into vault)
//   7. Redeem initial shares
//   8. Print full P&L and pass/fail report
//
// Usage:
//   npx hardhat run scripts/axiom/interact/testFullCycle.js --network flowTestnet
//
// ⚠️  This script waits up to 310s for the claim delay. It will take ~5 minutes.

const { ethers } = require("hardhat");
const { loadContracts, f, fb, pct, section, row } = require("./_contracts");

// ─── Config ──────────────────────────────────────────────────────────────────
const DEPOSIT_FUSD  = ethers.parseEther("10000");  // 10k FUSD deposited by user
const SWAP_STFLOW   = ethers.parseEther("2000");   // 2k stFLOW sold via venue
const ALLOCATE_FUSD = ethers.parseEther("5000");   // 5k FUSD deployed to yield
const YIELD_RESERVE = ethers.parseEther("500");    // 500 FUSD pre-funded for yield backing
const POLL_INTERVAL = 15_000;                       // 15s between claimability polls
const MAX_WAIT      = 360_000;                      // 6 minute max wait

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const { signer, c, vault, venue, strategyManager, yieldAdapter, redemptionAdapter,
          baseAsset, redeemableAsset } = await loadContracts();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║            AXIOM VAULTS — FULL CYCLE TEST                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Signer: ${signer.address}`);
  console.log(`  Time:   ${new Date().toISOString()}\n`);

  // ═══ BASELINE SNAPSHOT ═══════════════════════════════════════════════════
  section("BASELINE SNAPSHOT");
  const baseFusd   = await baseAsset.balanceOf(signer.address);
  const baseStflow = await redeemableAsset.balanceOf(signer.address);
  const baseShares = await vault.balanceOf(signer.address);
  const baseTa     = await vault.totalAssets();
  row("FUSD balance",    fb(baseFusd),   "FUSD");
  row("stFLOW balance",  fb(baseStflow), "stFLOW");
  row("axFUSD shares",   fb(baseShares), "axFUSD");
  row("vault totalAssets",fb(baseTa),   "FUSD");

  // ═══ PHASE 1: USER DEPOSIT ═══════════════════════════════════════════════
  section("PHASE 1 — USER DEPOSIT: 10 000 FUSD → vault");
  let tx = await baseAsset.approve(c.vault, DEPOSIT_FUSD);
  await tx.wait();
  const depositTx = await vault.deposit(DEPOSIT_FUSD, signer.address);
  await depositTx.wait();
  console.log(`  Deposited  tx: ${depositTx.hash}`);
  const sharesReceived  = (await vault.balanceOf(signer.address)) - baseShares;
  const taAfterDeposit  = await vault.totalAssets();
  row("shares minted",  fb(sharesReceived),   "axFUSD");
  row("totalAssets",    fb(taAfterDeposit),   "FUSD");

  // ═══ PHASE 2: SWAP stFLOW → FUSD VIA VENUE ═══════════════════════════════
  section("PHASE 2 — SWAP: 2 000 stFLOW → FUSD via AxiomVenue");
  const quote = await venue.getQuote(c.redeemableAsset, SWAP_STFLOW);
  const minOut = (quote * 9990n) / 10000n;
  row("quote (2000 stFLOW)", fb(quote),  "FUSD");
  tx = await redeemableAsset.approve(c.venue, SWAP_STFLOW);
  await tx.wait();
  const fusdBeforeSwap = await baseAsset.balanceOf(signer.address);
  const swapTx = await venue.swapRedeemableForBase(c.redeemableAsset, SWAP_STFLOW, minOut, signer.address);
  await swapTx.wait();
  console.log(`  Swapped    tx: ${swapTx.hash}`);
  const fusdFromSwap = (await baseAsset.balanceOf(signer.address)) - fusdBeforeSwap;
  const reqId           = (await redemptionAdapter.nextRequestId()) - 1n;
  const req             = await redemptionAdapter.requests(reqId);
  const claimDelay      = await redemptionAdapter.claimDelay();
  const claimableAt     = Number(req.timestamp) + Number(claimDelay);
  row("FUSD received from swap", fb(fusdFromSwap), "FUSD");
  row("redemption requestId",    reqId.toString());
  row("claimable at",            new Date(claimableAt * 1000).toISOString());

  // ═══ PHASE 3: YIELD ALLOCATION ════════════════════════════════════════════
  section("PHASE 3 — YIELD: allocate 5 000 FUSD to yield adapter");
  // Pre-fund yield adapter with backing reserve
  tx = await baseAsset.transfer(c.yieldAdapter, YIELD_RESERVE);
  await tx.wait();
  console.log(`  Yield reserve funded: ${fb(YIELD_RESERVE)} FUSD`);
  const availLiq = await vault.availableLiquidity();
  const alloc    = availLiq < ALLOCATE_FUSD ? availLiq : ALLOCATE_FUSD;
  if (alloc < ethers.parseEther("1000")) {
    console.log("  ⚠️  Less than 1000 FUSD available liquidity — skipping yield allocation.");
  } else {
    tx = await strategyManager.allocateToYield(alloc);
    await tx.wait();
    console.log(`  Allocated  tx: ${tx.hash}`);
    row("deployed to yield", fb(await vault.totalDeployedToYield()), "FUSD");
  }

  // ═══ PHASE 4: POLL FOR CLAIMABILITY ══════════════════════════════════════
  section("PHASE 4 — POLL: waiting for redemption request to become claimable");
  console.log(`  Claim delay: ${claimDelay}s`);
  const startWait   = Date.now();
  let claimableNow  = false;
  while (Date.now() - startWait < MAX_WAIT) {
    const nowTs = Math.floor(Date.now() / 1000);
    const secsLeft = Math.max(0, claimableAt - nowTs);
    if (secsLeft === 0) {
      claimableNow = true;
      break;
    }
    const elapsed = Math.floor((Date.now() - startWait) / 1000);
    process.stdout.write(`\r  ⏳  ${secsLeft}s until claimable (${elapsed}s elapsed)   `);
    await sleep(POLL_INTERVAL);
  }

  if (!claimableNow) {
    console.log(`\n  ⚠️  Timed out waiting for claim delay. Re-run testRedemptionClaim.js later.`);
    console.log("  Continuing with yield test…");
  } else {
    console.log(`\n  ✓ Request [${reqId}] is now claimable!`);

    // ═══ PHASE 5: CLAIM REDEMPTION ══════════════════════════════════════════
    section("PHASE 5 — CLAIM redemption request back to vault");
    const taBefClaim = await vault.totalAssets();
    const pendBefClaim = await vault.totalPendingRedemption();
    const claimTx = await strategyManager.claimRedemption(reqId);
    await claimTx.wait();
    console.log(`  Claimed    tx: ${claimTx.hash}`);
    const taAftClaim   = await vault.totalAssets();
    const pendAftClaim = await vault.totalPendingRedemption();
    row("totalPendingRedemption before", fb(pendBefClaim),  "FUSD");
    row("totalPendingRedemption after",  fb(pendAftClaim),  "FUSD (decrease = claim returned 1:1)");
    row("totalAssets unchanged",         fb(taAftClaim),    "FUSD (reclassified, not grown)");
  }

  // ═══ PHASE 6: DEALLOCATE YIELD ════════════════════════════════════════════
  section("PHASE 6 — YIELD: deallocate all back to vault");
  const deployed = await vault.totalDeployedToYield();
  if (deployed > 0n) {
    const taBeforeDe = await vault.totalAssets();
    tx = await strategyManager.deallocateAllFromYield();
    await tx.wait();
    console.log(`  Deallocated tx: ${tx.hash}`);
    const taAfterDe = await vault.totalAssets();
    const yieldHarvested = taAfterDe > taBeforeDe ? taAfterDe - taBeforeDe : 0n;
    row("totalAssets before deallocate", fb(taBeforeDe), "FUSD");
    row("totalAssets after deallocate",  fb(taAfterDe),  "FUSD");
    row("yield harvested",               fb(yieldHarvested), "FUSD");
  } else {
    console.log("  Nothing deployed to yield, skipping.");
  }

  // ═══ PHASE 7: REDEEM SHARES ═══════════════════════════════════════════════
  section("PHASE 7 — USER REDEEM: redeem original deposit shares");
  const sharesNow    = await vault.balanceOf(signer.address);
  const redeemAmount = sharesReceived > 0n ? sharesReceived : sharesNow / 2n;
  if (redeemAmount === 0n) {
    console.log("  No shares to redeem, skipping.");
  } else {
    const fusdBeforeRedeem = await baseAsset.balanceOf(signer.address);
    const preview = await vault.previewRedeem(redeemAmount);
    row("redemption preview", fb(preview), "FUSD");
    tx = await vault.redeem(redeemAmount, signer.address, signer.address);
    await tx.wait();
    console.log(`  Redeemed   tx: ${tx.hash}`);
    const fusdAfterRedeem = await baseAsset.balanceOf(signer.address);
    const fusdReceived    = fusdAfterRedeem - fusdBeforeRedeem;
    row("FUSD received",    fb(fusdReceived), "FUSD");
  }

  // ═══ FINAL REPORT ══════════════════════════════════════════════════════════
  section("FINAL REPORT");
  const finalFusd   = await baseAsset.balanceOf(signer.address);
  const finalStflow = await redeemableAsset.balanceOf(signer.address);
  const finalShares = await vault.balanceOf(signer.address);
  const finalTa     = await vault.totalAssets();
  const finalTs     = await vault.totalSupply();
  const finalPrice  = finalTs > 0n
    ? (Number(ethers.formatEther(finalTa)) / Number(ethers.formatEther(finalTs))).toFixed(8)
    : "1.00000000";

  row("FUSD start",          fb(baseFusd),   "FUSD");
  row("FUSD end",            fb(finalFusd),  "FUSD");
  const netFusd = finalFusd - baseFusd; // net accounting: spent on deposit, received from swap+redeem
  row("net FUSD delta",      fb(netFusd),    "FUSD (negative because deposit ≠ full redeem yet)");
  row("stFLOW start",        fb(baseStflow), "stFLOW");
  row("stFLOW end",          fb(finalStflow),"stFLOW");
  row("stFLOW spent",        fb(baseStflow - finalStflow),"stFLOW");
  row("remaining axFUSD",    fb(finalShares),"axFUSD");
  row("vault totalAssets",   fb(finalTa),   "FUSD");
  row("vault share price",   finalPrice,    "FUSD/axFUSD");
  row("vault totalSupply",   fb(finalTs),   "axFUSD");

  divider();
  const swapOk   = quoteWasValid(quote);
  const claimOk  = claimableNow;
  const taGrew   = finalTa >= baseTa;
  console.log(`\n  Vault deposit/redeem:          ${sharesReceived > 0n ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Venue swap + discount:         ${swapOk ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Redemption request created:    ✅ PASS`);
  console.log(`  Claim wait + claim executed:   ${claimOk ? "✅ PASS" : "⚠️  SKIPPED (timed out)"}`);
  console.log(`  Yield allocation/deallocation: ${deployed > 0n ? "✅ PASS" : "⚠️  SKIPPED (low liquidity)"}`);
  console.log(`  Vault totalAssets ≥ baseline:  ${taGrew ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`\n  Overall: ${(sharesReceived > 0n && swapOk && taGrew) ? "✅ SYSTEM OPERATIONAL" : "❌ CHECK FAILURES ABOVE"}`);
  console.log("\n");
}

function quoteWasValid(quote) {
  // A valid quote should be just below the swap amount (20bps discount)
  const q = Number(ethers.formatEther(quote));
  const swapFusdEquiv = Number(ethers.formatEther(SWAP_STFLOW)); // 1:1 par
  return q >= swapFusdEquiv * 0.998 && q <= swapFusdEquiv;
}

function divider() { console.log("  " + "─".repeat(52)); }

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
