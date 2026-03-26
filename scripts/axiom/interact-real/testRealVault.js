// scripts/axiom/interact-real/testRealVault.js
// Test ERC4626 deposit/redeem on the real vault with real WFLOW.
// Wraps native FLOW → WFLOW, deposits into vault, checks share price, redeems.
//
// Usage:
//   npx hardhat run scripts/axiom/interact-real/testRealVault.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, fb, row, section, pass, fail } = require("./_contracts");

const DEPOSIT_FLOW = "5"; // amount of FLOW to wrap and deposit

async function main() {
  const { signer, c, vault, wflow, ankrFlow } = await loadContracts();

  console.log("\n=== AXIOM VAULT — REAL DEPOSIT/REDEEM TEST ===\n");
  console.log(`  Vault:    ${c.vault}`);
  console.log(`  WFLOW:    ${c.baseAsset}`);

  const depositWei = ethers.parseEther(DEPOSIT_FLOW);
  let passes = 0, failures = 0;

  // ─── Step 1: Wrap FLOW → WFLOW ────────────────────────────────────────────
  section("STEP 1: WRAP FLOW → WFLOW");
  const flowBefore  = await ethers.provider.getBalance(signer.address);
  const wflowBefore = await wflow.balanceOf(signer.address);
  row("native FLOW before", fb(flowBefore));
  row("WFLOW before",       fb(wflowBefore));

  console.log(`\n  Wrapping ${DEPOSIT_FLOW} FLOW → WFLOW...`);
  const wrapTx = await wflow.deposit({ value: depositWei });
  await wrapTx.wait();

  const wflowAfterWrap = await wflow.balanceOf(signer.address);
  row("WFLOW after wrap",   fb(wflowAfterWrap));

  if (wflowAfterWrap >= wflowBefore + depositWei) {
    pass(`Wrapped ${DEPOSIT_FLOW} FLOW successfully`);
    passes++;
  } else {
    fail("Wrap produced insufficient WFLOW");
    failures++;
  }

  // ─── Step 2: Approve vault ────────────────────────────────────────────────
  section("STEP 2: APPROVE VAULT");
  const approveTx = await wflow.approve(c.vault, depositWei);
  await approveTx.wait();
  pass(`Approved vault for ${DEPOSIT_FLOW} WFLOW`);

  // ─── Step 3: Deposit into AxiomVault ─────────────────────────────────────
  section("STEP 3: DEPOSIT INTO AXIOM VAULT (ERC4626)");
  const sharesBefore   = await vault.balanceOf(signer.address);
  const totalBefore    = await vault.totalAssets();
  const supplyBefore   = await vault.totalSupply();
  row("totalAssets before",  fb(totalBefore), "WFLOW");
  row("shares before",       fb(sharesBefore),"axWFLOW");

  const depositTx = await vault.deposit(depositWei, signer.address);
  const depositRcpt = await depositTx.wait();
  console.log(`  Deposit tx: ${depositRcpt.hash}`);

  const sharesAfter  = await vault.balanceOf(signer.address);
  const totalAfter   = await vault.totalAssets();
  const sharesGained = sharesAfter - sharesBefore;
  row("shares received",     fb(sharesGained), "axWFLOW");
  row("totalAssets after",   fb(totalAfter),   "WFLOW");

  const sharePrice = totalAfter * ethers.parseEther("1") / (await vault.totalSupply());
  row("share price",         fb(sharePrice),   "WFLOW/axWFLOW");

  if (sharesGained > 0n) {
    pass(`Deposit: received ${fb(sharesGained)} axWFLOW shares`);
    passes++;
  } else {
    fail("Deposit returned 0 shares");
    failures++;
  }

  // ─── Step 4: Convert to assets check ─────────────────────────────────────
  section("STEP 4: PREVIEW REDEEM");
  const previewRedeem = await vault.convertToAssets(sharesGained);
  row("convertToAssets(shares)", fb(previewRedeem), "WFLOW");
  // Should be ~= depositWei (no yield added yet)
  const delta = depositWei - previewRedeem;
  if (delta < ethers.parseEther("0.01")) {
    pass(`Share price accurate: ~1:1 (delta ${fb(delta)} WFLOW)`);
    passes++;
  } else {
    fail(`Price discrepancy: ${fb(delta)} WFLOW`);
    failures++;
  }

  // ─── Step 5: Redeem half ──────────────────────────────────────────────────
  section("STEP 5: REDEEM HALF SHARES");
  const redeemShares = sharesGained / 2n;
  const wflowBeforeRedeem = await wflow.balanceOf(signer.address);

  const redeemTx = await vault.redeem(redeemShares, signer.address, signer.address);
  const redeemRcpt = await redeemTx.wait();
  console.log(`  Redeem tx: ${redeemRcpt.hash}`);

  const wflowAfterRedeem = await wflow.balanceOf(signer.address);
  const wflowBack = wflowAfterRedeem - wflowBeforeRedeem;
  const sharesLeft = await vault.balanceOf(signer.address);

  row("WFLOW returned",      fb(wflowBack),    "WFLOW");
  row("shares remaining",    fb(sharesLeft),   "axWFLOW");

  if (wflowBack > 0n) {
    pass(`Redeem: received ${fb(wflowBack)} WFLOW back`);
    passes++;
  } else {
    fail("Redeem returned 0 WFLOW");
    failures++;
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  section("SUMMARY");
  console.log(`  PASS: ${passes}  FAIL: ${failures}`);
  if (failures === 0) {
    console.log("\n  ✓ All vault tests passed — ERC4626 with real WFLOW working!\n");
  } else {
    console.log("\n  ✗ Some tests failed.\n");
    process.exit(1);
  }
}

main().catch(console.error);
