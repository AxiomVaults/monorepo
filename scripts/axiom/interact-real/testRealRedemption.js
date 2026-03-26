// scripts/axiom/interact-real/testRealRedemption.js
// Test the AnkrRedemptionAdapter: request ankrFLOW redemption and claim WFLOW back.
// The adapter swaps ankrFLOW → WFLOW on PunchSwap immediately at request time,
// then releases WFLOW to the caller after claimDelay.
//
// Usage:
//   npx hardhat run scripts/axiom/interact-real/testRealRedemption.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, fb, row, section, pass, fail } = require("./_contracts");

const FLOW_TO_STAKE = "1"; // FLOW → ankrFLOW for the test

const ANKR_STAKING_ABI = ["function stakeCerts() external payable"];

async function main() {
  const { signer, c, rt, strategyManager, ankrRedemptionAdapter, wflow, ankrFlow } =
    await loadContracts();

  console.log("\n=== ANKR REDEMPTION ADAPTER — REAL INTEGRATION TEST ===\n");
  console.log(`  AnkrRedemptionAdapter: ${c.ankrRedemptionAdapter}`);
  const claimDelay = await ankrRedemptionAdapter.claimDelay();
  console.log(`  claimDelay:            ${claimDelay}s`);

  let passes = 0, failures = 0;

  // ─── Step 1: Get ankrFLOW ─────────────────────────────────────────────────
  section("STEP 1: STAKE FLOW → ankrFLOW");
  const ankrBefore = await ankrFlow.balanceOf(signer.address);
  const ankrStaking = new ethers.Contract(rt.ankrStaking, ANKR_STAKING_ABI, signer);
  await (await ankrStaking.stakeCerts({ value: ethers.parseEther(FLOW_TO_STAKE), gasLimit: 500_000 })).wait();
  const ankrAfter   = await ankrFlow.balanceOf(signer.address);
  const ankrAmount  = ankrAfter - ankrBefore;

  if (ankrAmount === 0n) {
    console.log("  No new ankrFLOW from staking — using existing balance if any...");
    const existing = await ankrFlow.balanceOf(signer.address);
    if (existing === 0n) {
      fail("No ankrFLOW available for test");
      failures++;
    }
  } else {
    row("ankrFLOW received", fb(ankrAmount));
    pass(`Staked ${FLOW_TO_STAKE} FLOW → ${fb(ankrAmount)} ankrFLOW`);
    passes++;
  }

  const ankrToRedeem = ankrAmount > 0n ? ankrAmount : await ankrFlow.balanceOf(signer.address);
  if (ankrToRedeem === 0n) {
    console.log("\n  ✗ No ankrFLOW available — cannot continue\n");
    process.exit(1);
  }

  // ─── Step 2: requestRedemption directly (bypassing StrategyManager) ───────
  // This tests the adapter as a standalone contract. In production,
  // StrategyManager.receiveRedeemable() is the caller.
  section("STEP 2: REQUEST REDEMPTION (direct adapter call)");
  row("ankrFLOW to redeem", fb(ankrToRedeem));

  const wflowInAdapterBefore = await wflow.balanceOf(c.ankrRedemptionAdapter);
  const totalPendBefore      = await ankrRedemptionAdapter.totalPending();

  // Approve and call requestRedemption directly
  await (await ankrFlow.approve(c.ankrRedemptionAdapter, ankrToRedeem)).wait();

  let requestId;
  try {
    const reqTx  = await ankrRedemptionAdapter.requestRedemption(c.redeemableAsset, ankrToRedeem);
    const reqRcpt = await reqTx.wait();
    console.log(`  Request tx: ${reqRcpt.hash}`);

    // Get requestId from event
    const iface = new ethers.Interface([
      "event RedemptionRequested(uint256 indexed requestId, address indexed requester, uint256 amount, uint64 timestamp)"
    ]);
    const log = reqRcpt.logs.find(l => {
      try { iface.parseLog(l); return true; } catch { return false; }
    });
    const parsed = log ? iface.parseLog(log) : null;
    requestId = parsed ? parsed.args.requestId : (await ankrRedemptionAdapter.nextRequestId()) - 1n;
    pass(`Request created: ID ${requestId}`);
    passes++;
  } catch (e) {
    fail(`requestRedemption failed: ${e.message}`);
    console.error(e);
    failures++;
    process.exit(1);
  }

  // ─── Step 3: Verify WFLOW locked in adapter ───────────────────────────────
  section("STEP 3: VERIFY WFLOW LOCKED");
  const wflowInAdapterAfter = await wflow.balanceOf(c.ankrRedemptionAdapter);
  const totalPendAfter      = await ankrRedemptionAdapter.totalPending();
  const wflowLocked         = wflowInAdapterAfter - wflowInAdapterBefore;
  const req                 = await ankrRedemptionAdapter.requests(requestId);

  row("WFLOW locked (PunchSwap output)", fb(wflowLocked),     "WFLOW");
  row("req.baseAmount",                  fb(req[1]),            "WFLOW");
  row("req.requester",                   req[0]);
  row("totalPending after",              fb(totalPendAfter),   "WFLOW");

  if (wflowLocked > 0n) {
    pass(`PunchSwap swap executed: ${fb(ankrToRedeem)} ankrFLOW → ${fb(wflowLocked)} WFLOW locked`);
    passes++;
  } else {
    fail("No WFLOW locked — PunchSwap swap may have failed");
    failures++;
  }

  // ─── Step 4: Check claimable before delay ────────────────────────────────
  section("STEP 4: NOT YET CLAIMABLE (check revert before delay)");
  const isClaimableNow = await ankrRedemptionAdapter.isClaimable(requestId);
  row("isClaimable() immediately", isClaimableNow.toString(), "(should be false)");
  if (!isClaimableNow) {
    pass("Correctly not claimable before delay");
    passes++;
  } else {
    fail("Marked claimable too soon");
    failures++;
  }

  // ─── Step 5: Wait for claim delay ────────────────────────────────────────
  if (Number(claimDelay) <= 120) {
    section(`STEP 5: WAIT ${claimDelay}s FOR CLAIM DELAY`);
    console.log(`  Waiting ${claimDelay} seconds...`);
    await new Promise(r => setTimeout(r, Number(claimDelay) * 1000 + 3000));
    pass("Claim delay elapsed");
    passes++;
  } else {
    section("STEP 5: SKIP WAIT (claimDelay > 2min)");
    console.log(`  claimDelay is ${claimDelay}s — skipping wait and claim test.`);
    console.log(`  Re-run after ${(Number(claimDelay)/3600).toFixed(2)}h to test claim.`);
    console.log("\n  ✓ Request + PunchSwap swap confirmed on-chain.\n");
    return;
  }

  // ─── Step 6: Claim redemption ─────────────────────────────────────────────
  section("STEP 6: CLAIM REDEMPTION");
  const wflowBeforeClaim = await wflow.balanceOf(signer.address);

  const claimTx   = await ankrRedemptionAdapter.claimRedemption(requestId);
  const claimRcpt = await claimTx.wait();
  console.log(`  Claim tx: ${claimRcpt.hash}`);

  const wflowAfterClaim = await wflow.balanceOf(signer.address);
  const wflowReturned   = wflowAfterClaim - wflowBeforeClaim;
  row("WFLOW returned", fb(wflowReturned));

  if (wflowReturned === req[1]) {
    pass(`Claimed exactly ${fb(wflowReturned)} WFLOW — matches locked amount`);
    passes++;
  } else {
    fail(`Claimed ${fb(wflowReturned)}, expected ${fb(req[1])}`);
    failures++;
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  section("SUMMARY");
  console.log(`  PASS: ${passes}  FAIL: ${failures}`);
  if (failures === 0) {
    console.log("\n  ✓ AnkrRedemptionAdapter WORKING — real ankrFLOW → WFLOW via PunchSwap!\n");
  } else {
    console.log("\n  ✗ Some tests failed.\n");
    process.exit(1);
  }
}

main().catch(console.error);
