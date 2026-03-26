// scripts/axiom/interact-real/testRealYield.js
// Test the AnkrMOREYieldAdapter end-to-end:
//   1. Wrap FLOW → WFLOW
//   2. Deposit WFLOW into vault
//   3. StrategyManager.allocateToYield() → AnkrMOREYieldAdapter runs:
//        WFLOW → unwrap → FLOW → Ankr.stakeCerts() → ankrFLOW → MORE.supply → MORE.borrow WFLOW
//   4. Read MORE health factor, totalUnderlying, position details
//   5. StrategyManager.deallocateAllFromYield() → unwind
//   6. Verify WFLOW returned to vault
//
// Usage:
//   npx hardhat run scripts/axiom/interact-real/testRealYield.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, fb, pct, hf, row, section, pass, fail } = require("./_contracts");

const DEPOSIT_FLOW = "2"; // FLOW to wrap + deposit

async function main() {
  const { signer, c, vault, wflow, ankrFlow,
          strategyManager, ankrMOREYieldAdapter,
          morePool, moreDataProv } = await loadContracts();

  console.log("\n=== ANKR-MORE YIELD ADAPTER — REAL INTEGRATION TEST ===\n");
  console.log(`  AnkrMOREYieldAdapter: ${c.ankrMOREYieldAdapter}`);

  const depositWei = ethers.parseEther(DEPOSIT_FLOW);
  let passes = 0, failures = 0;

  // ─── Step 1: Wrap and deposit ─────────────────────────────────────────────
  section("STEP 1: WRAP FLOW + DEPOSIT INTO VAULT");
  console.log(`  Wrapping ${DEPOSIT_FLOW} FLOW → WFLOW...`);
  await (await wflow.deposit({ value: depositWei })).wait();
  pass(`Wrapped ${DEPOSIT_FLOW} FLOW`);

  await (await wflow.approve(c.vault, depositWei)).wait();
  await (await vault.deposit(depositWei, signer.address)).wait();
  const totalAssetsBefore = await vault.totalAssets();
  row("vault totalAssets after deposit", fb(totalAssetsBefore), "WFLOW");
  pass(`Deposited ${DEPOSIT_FLOW} WFLOW into vault`);
  passes++;

  // ─── Step 2: Allocate to yield adapter ───────────────────────────────────
  section("STEP 2: ALLOCATE TO AnkrMOREYieldAdapter");
  row("allocating", fb(depositWei), "WFLOW → Ankr stake + MORE supply/borrow");

  const allocTx = await strategyManager.allocateToYield(depositWei);
  const allocRcpt = await allocTx.wait();
  console.log(`  Alloc tx: ${allocRcpt.hash}`);

  // Read Position
  const [ankrAToken,,,,,,,,] = await moreDataProv.getUserReserveData(c.redeemableAsset, c.ankrMOREYieldAdapter);
  const [,, wflowDebt,,,,,,] = await moreDataProv.getUserReserveData(c.baseAsset,       c.ankrMOREYieldAdapter);
  const hfVal                = await ankrMOREYieldAdapter.healthFactor();
  const tu                   = await ankrMOREYieldAdapter.totalUnderlying();
  const bfBps                = await ankrMOREYieldAdapter.borrowFractionBps();
  const wflowBuf             = await wflow.balanceOf(c.ankrMOREYieldAdapter);

  section("POSITION AFTER ALLOCATION");
  row("ankrFLOW in MORE (aToken)", fb(ankrAToken),  "ankrFLOW");
  row("variable WFLOW debt",       fb(wflowDebt),   "WFLOW");
  row("WFLOW repay buffer",        fb(wflowBuf),    "WFLOW (= borrowed WFLOW kept in adapter)");
  row("borrowFractionBps",         pct(bfBps));
  row("totalUnderlying()",         fb(tu),           "WFLOW (net position value)");
  row("healthFactor()",            hfVal === 0n ? "∞" : hf(hfVal));

  if (ankrAToken > 0n) {
    pass(`ankrFLOW supplied to MORE: ${fb(ankrAToken)}`);
    passes++;
  } else {
    fail("No ankrFLOW in MORE — staking or supply failed");
    failures++;
  }

  if (hfVal === 0n || Number(hfVal) / 1e18 > 1.5) {
    pass(`Health factor safe: ${hfVal === 0n ? "∞" : hf(hfVal)}`);
    passes++;
  } else {
    fail(`Health factor too low: ${hf(hfVal)} — position at risk!`);
    failures++;
  }

  if (tu > 0n) {
    pass(`totalUnderlying positive: ${fb(tu)} WFLOW`);
    passes++;
  } else {
    fail("totalUnderlying is 0");
    failures++;
  }

  // ─── Step 3: Wait and re-read ─────────────────────────────────────────────
  section("STEP 3: READ VAULT ACCOUNTING");
  const deployedToYield = await vault.totalDeployedToYield();
  const totalAssetsNow  = await vault.totalAssets();
  row("vault.totalDeployedToYield()",  fb(deployedToYield), "WFLOW");
  row("vault.totalAssets()",           fb(totalAssetsNow),  "WFLOW");

  if (deployedToYield === depositWei) {
    pass(`Vault deployed accounting matches: ${fb(deployedToYield)} WFLOW`);
    passes++;
  } else {
    fail(`Accounting mismatch: vault shows ${fb(deployedToYield)} but deposited ${fb(depositWei)}`);
    failures++;
  }

  // ─── Step 4: Deallocate all ───────────────────────────────────────────────
  section("STEP 4: DEALLOCATE ALL FROM AnkrMOREYieldAdapter");
  const vaultWflowBefore = await wflow.balanceOf(c.vault);
  row("vault WFLOW before dealloc", fb(vaultWflowBefore), "WFLOW");

  const deallocTx = await strategyManager.deallocateAllFromYield();
  const deallocRcpt = await deallocTx.wait();
  console.log(`  Dealloc tx: ${deallocRcpt.hash}`);

  const vaultWflowAfter   = await wflow.balanceOf(c.vault);
  const returned          = vaultWflowAfter - vaultWflowBefore;
  const tuAfter           = await ankrMOREYieldAdapter.totalUnderlying();
  const hfAfter           = await ankrMOREYieldAdapter.healthFactor();

  row("WFLOW returned to vault",    fb(returned),    "WFLOW");
  row("totalUnderlying after",      fb(tuAfter),     "WFLOW (should be ≈ 0)");
  row("healthFactor after",         hfAfter === 0n ? "∞ (no position)" : hf(hfAfter));

  // Returned should be close to deposited (slight variation from swap prices)
  const minExpected = depositWei * 95n / 100n; // allow up to 5% for swap costs
  if (returned >= minExpected) {
    pass(`Returned ${fb(returned)} WFLOW (≥ 95% of deposit — real swap costs OK)`);
    passes++;
  } else {
    fail(`Only returned ${fb(returned)} WFLOW — unexpected loss > 5%`);
    failures++;
  }

  if (tuAfter < ethers.parseEther("0.001")) {
    pass("Position fully unwound (totalUnderlying ≈ 0)");
    passes++;
  } else {
    fail(`Residual position: ${fb(tuAfter)} WFLOW remaining in adapter`);
    failures++;
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  section("SUMMARY");
  console.log(`  PASS: ${passes}  FAIL: ${failures}`);
  if (failures === 0) {
    console.log("\n  ✓ AnkrMOREYieldAdapter WORKING — real Ankr staking + MORE lending!\n");
  } else {
    console.log("\n  ✗ Some tests failed.\n");
    process.exit(1);
  }
}

main().catch(console.error);
