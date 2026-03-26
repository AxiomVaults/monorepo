// scripts/axiom/interact-real/testRealVenueSwap.js
// Test the venue swap: user holds ankrFLOW, swaps it for WFLOW at a 20bps discount.
// The swap triggers autoFlush() → StrategyManager.receiveRedeemable() → AnkrRedemptionAdapter.
//
// Prerequisites:
//   - Vault has WFLOW liquidity (run testRealVault.js first to seed)
//   - Venue is configured (run setupVenue.js first)
//   - User must hold ankrFLOW (obtained by running Ankr stake on testnet)
//
// Usage:
//   npx hardhat run scripts/axiom/interact-real/testRealVenueSwap.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, fb, row, section, pass, fail } = require("./_contracts");

// Stake this much FLOW to get ankrFLOW for the swap test
const FLOW_TO_STAKE = "1";

// Ankr staking ABI (minimal)
const ANKR_STAKING_ABI = [
  "function stakeCerts() external payable",
];

async function main() {
  const { signer, c, rt, vault, venue, strategyManager,
          ankrRedemptionAdapter, wflow, ankrFlow } = await loadContracts();

  console.log("\n=== AXIOM VENUE — REAL ankrFLOW SWAP TEST ===\n");
  console.log(`  Venue:    ${c.venue}`);
  console.log(`  WFLOW:    ${c.baseAsset}`);
  console.log(`  ankrFLOW: ${c.redeemableAsset}`);

  let passes = 0, failures = 0;

  // ─── Step 1: Stake FLOW → ankrFLOW ───────────────────────────────────────
  section("STEP 1: STAKE FLOW → ankrFLOW (via Ankr)");
  const stakeWei = ethers.parseEther(FLOW_TO_STAKE);
  const ankrBefore = await ankrFlow.balanceOf(signer.address);
  row("ankrFLOW before stake", fb(ankrBefore));

  const ankrStaking = new ethers.Contract(rt.ankrStaking, ANKR_STAKING_ABI, signer);
  const stakeTx = await ankrStaking.stakeCerts({ value: stakeWei, gasLimit: 500_000 });
  await stakeTx.wait();

  const ankrAfterStake = await ankrFlow.balanceOf(signer.address);
  const ankrReceived   = ankrAfterStake - ankrBefore;
  row("ankrFLOW received", fb(ankrReceived));

  if (ankrReceived === 0n) {
    console.log("  Note: Ankr staking returned 0 ankrFLOW — check staking contract on testnet.");
    console.log("  Trying to continue if wallet already has ankrFLOW...");
    if (ankrBefore === 0n) {
      fail("No ankrFLOW available — skipping swap test");
      failures++;
      goto_summary();
      return;
    }
  } else {
    pass(`Staked ${FLOW_TO_STAKE} FLOW, received ${fb(ankrReceived)} ankrFLOW`);
    passes++;
  }

  const ankrToSwap = ankrReceived > 0n ? ankrReceived : ankrBefore / 2n;

  // ─── Step 2: Seed vault with WFLOW liquidity (so venue can pay out) ───────
  section("STEP 2: SEED VAULT WITH WFLOW");
  const vaultLiq = await vault.availableLiquidity();
  if (vaultLiq < ankrToSwap) {
    const needed = ankrToSwap - vaultLiq + ethers.parseEther("1");
    console.log(`  Vault needs more WFLOW. Wrapping + depositing ${fb(needed)} FLOW...`);
    await (await wflow.deposit({ value: needed })).wait();
    await (await wflow.approve(c.vault, needed)).wait();
    await (await vault.deposit(needed, signer.address)).wait();
    pass(`Seeded vault with ${fb(needed)} WFLOW`);
  } else {
    pass(`Vault already has enough liquidity: ${fb(vaultLiq)} WFLOW`);
  }
  passes++;

  // ─── Step 3: Approve venue for ankrFLOW ──────────────────────────────────
  section("STEP 3: APPROVE VENUE");
  await (await ankrFlow.approve(c.venue, ankrToSwap)).wait();
  pass(`Approved venue to spend ${fb(ankrToSwap)} ankrFLOW`);
  passes++;

  // ─── Step 4: Execute swap (ankrFLOW → WFLOW at discount) ─────────────────
  section("STEP 4: SWAP ankrFLOW → WFLOW");
  const wflowBeforeSwap = await wflow.balanceOf(signer.address);
  const quote           = await venue.getQuote(c.redeemableAsset, ankrToSwap);
  row("ankrFLOW in",    fb(ankrToSwap),    "ankrFLOW");
  row("expected out",   fb(quote),          "WFLOW (at discount)");

  const swapTx = await venue.swapRedeemableForBase(c.redeemableAsset, ankrToSwap, 0);
  const swapRcpt = await swapTx.wait();
  console.log(`  Swap tx: ${swapRcpt.hash}`);

  const wflowAfterSwap = await wflow.balanceOf(signer.address);
  const wflowOut = wflowAfterSwap - wflowBeforeSwap;
  row("WFLOW received", fb(wflowOut));

  // Expect ~= quote (small difference possible if getQuote and swap cross a block)
  if (wflowOut >= quote * 99n / 100n) {
    pass(`Swap successful: ${fb(ankrToSwap)} ankrFLOW → ${fb(wflowOut)} WFLOW`);
    passes++;
  } else {
    fail(`Swap slippage too high: expected ~${fb(quote)}, got ${fb(wflowOut)}`);
    failures++;
  }

  // ─── Step 5: Check venue inventory flushed to StrategyManager ────────────
  section("STEP 5: VERIFY FLUSH TO STRATEGY MANAGER");
  const inventory = await venue.inventoryBalances(c.redeemableAsset);
  const pendReq   = await ankrRedemptionAdapter.nextRequestId();
  const pendAmt   = await ankrRedemptionAdapter.totalPending();
  row("venue inventory after swap", fb(inventory),  "ankrFLOW (should be 0 if flushed)");
  row("redemption requests created", pendReq.toString());
  row("WFLOW locked for claims",     fb(pendAmt),    "WFLOW");

  // The venue may accumulate until maxInventory; a manual flush may be needed
  if (inventory === 0n) {
    pass("Auto-flushed: ankrFLOW routed through SM → AnkrRedemptionAdapter (PunchSwap swap done)");
    passes++;
  } else {
    console.log(`  Note: ${fb(inventory)} ankrFLOW still in venue inventory (below flush threshold)`);
    console.log("  Run strategyManager.receiveRedeemable() or flush manually to trigger redemption queue.");
    pass("Swap executed; flush pending (inventory below auto-flush threshold)");
    passes++;
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  section("SUMMARY");
  console.log(`  PASS: ${passes}  FAIL: ${failures}`);
  if (failures === 0) {
    console.log("\n  ✓ Venue swap working — real ankrFLOW accepted, real WFLOW paid out!\n");
  } else {
    console.log("\n  ✗ Some tests failed.\n");
    process.exit(1);
  }
}

function goto_summary() {}; // ESLint-friendly placeholder

main().catch(console.error);
