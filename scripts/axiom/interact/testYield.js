// scripts/axiom/interact/testYield.js
// Yield aggregator test: allocate FUSD to MockYieldAdapter, observe accrual, deallocate.
// Pre-funds the yield adapter with extra FUSD so backed yield materialises on withdraw.
//
// Usage:
//   npx hardhat run scripts/axiom/interact/testYield.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, f, fb, pct, section, row } = require("./_contracts");

const ALLOCATE_AMOUNT = ethers.parseEther("50000"); // 50 000 FUSD to deploy
const YIELD_RESERVE   = ethers.parseEther("2000");  // 2 000 FUSD pre-funded to back yield
const WAIT_SECS       = 30;                          // seconds to wait for accrual

async function main() {
  const { signer, c, vault, strategyManager, yieldAdapter, baseAsset } = await loadContracts();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║        TEST: YIELD ALLOCATION & ACCRUAL             ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Signer:   ${signer.address}`);
  console.log(`  Allocate: ${fb(ALLOCATE_AMOUNT)} FUSD to yield adapter\n`);

  // ─── Snapshot before ──────────────────────────────────────────────────────
  section("BEFORE STATE");
  const fusdBefore     = await baseAsset.balanceOf(signer.address);
  const vaultFusdBef   = await baseAsset.balanceOf(c.vault);
  const taBefore       = await vault.totalAssets();
  const deployedBef    = await vault.totalDeployedToYield();
  const adapterFusdBef = await baseAsset.balanceOf(c.yieldAdapter);
  const availLiqBef    = await vault.availableLiquidity();

  row("Signer FUSD",          fb(fusdBefore),    "FUSD");
  row("Vault FUSD on-hand",   fb(vaultFusdBef),  "FUSD");
  row("totalAssets()",        fb(taBefore),      "FUSD");
  row("totalDeployedToYield", fb(deployedBef),   "FUSD");
  row("yieldAdapter FUSD",    fb(adapterFusdBef),"FUSD");
  row("vault availableLiquidity",fb(availLiqBef),"FUSD");

  // ─── Pre-fund yield adapter ────────────────────────────────────────────────
  section("STEP 1 — Pre-fund yield adapter with backing FUSD");
  console.log(`  Transferring ${fb(YIELD_RESERVE)} FUSD -> yieldAdapter...`);
  let tx = await baseAsset.transfer(c.yieldAdapter, YIELD_RESERVE);
  await tx.wait();
  console.log(`  Transferred tx: ${tx.hash}`);
  row("yieldAdapter FUSD after fund", fb(await baseAsset.balanceOf(c.yieldAdapter)), "FUSD");

  // ─── Allocate (skip if already done) ──────────────────────────────────────
  section("STEP 2 — Allocate to yield adapter");
  const alreadyDeployed = await vault.totalDeployedToYield();
  if (alreadyDeployed >= ALLOCATE_AMOUNT) {
    console.log(`  Already deployed ${fb(alreadyDeployed)} FUSD — skipping allocation.`);
  } else {
    const allocAmt = availLiqBef < ALLOCATE_AMOUNT ? availLiqBef : ALLOCATE_AMOUNT;
    console.log(`  Calling strategyManager.allocateToYield(${fb(allocAmt)}) ...`);
    tx = await strategyManager.allocateToYield(allocAmt);
    await tx.wait();
    console.log(`  Allocated  tx: ${tx.hash}`);
  }

  const deployedAft  = await vault.totalDeployedToYield();
  const principalAft = await yieldAdapter.principalDeposited();
  const tAafterAlloc = await vault.totalAssets();
  const vaultFusdAft = await baseAsset.balanceOf(c.vault);
  const adapterFusdAft = await baseAsset.balanceOf(c.yieldAdapter);

  row("vault.totalDeployedToYield",    fb(deployedAft),   "FUSD");
  row("yieldAdapter.principal",         fb(principalAft), "FUSD");
  row("vault.totalAssets()",            fb(tAafterAlloc), "FUSD (should approx before)");
  row("vault FUSD on-hand",             fb(vaultFusdAft), "FUSD (decreased)");
  row("yieldAdapter total FUSD",        fb(adapterFusdAft),"FUSD (principal + reserve)");

  // ─── Observe accrual ──────────────────────────────────────────────────────
  section("STEP 3 — Observe yield accrual");
  const block0      = await ethers.provider.getBlockNumber();
  const underlying0 = await yieldAdapter.totalUnderlying();
  const ts0         = (await ethers.provider.getBlock(block0)).timestamp;
  row("block T0",          block0.toString());
  row("totalUnderlying T0",fb(underlying0), "FUSD");

  console.log(`\n  Waiting ${WAIT_SECS}s for time to pass (Flow EVM ~1 block/s)...`);
  await new Promise(r => setTimeout(r, WAIT_SECS * 1000));

  const block1      = await ethers.provider.getBlockNumber();
  const underlying1 = await yieldAdapter.totalUnderlying();
  const ts1         = (await ethers.provider.getBlock(block1)).timestamp;
  const yieldAccrued = underlying1 > underlying0 ? underlying1 - underlying0 : 0n;
  const elapsed     = ts1 - ts0;
  const aprBps      = await yieldAdapter.aprBps();
  const expectedYield = deployedAft > 0n
    ? (deployedAft * aprBps * BigInt(elapsed)) / (10000n * 31536000n)
    : 0n;

  row("block T1",              block1.toString());
  row("totalUnderlying T1",    fb(underlying1),   "FUSD");
  row("yield accrued (view)",  fb(yieldAccrued),  "FUSD");
  row("elapsed",               elapsed.toString() + "s");
  row("APR",                   pct(aprBps));
  row("expected yield (calc)", fb(expectedYield), "FUSD");

  // ─── Deallocate ───────────────────────────────────────────────────────────
  section("STEP 4 — Deallocate all from yield adapter");
  console.log("  Calling strategyManager.deallocateAllFromYield() ...");
  tx = await strategyManager.deallocateAllFromYield();
  await tx.wait();
  console.log(`  Deallocated tx: ${tx.hash}`);

  const deployedFinal    = await vault.totalDeployedToYield();
  const tAFinal          = await vault.totalAssets();
  const vaultFusdFinal   = await baseAsset.balanceOf(c.vault);
  const adapterFusdFinal = await baseAsset.balanceOf(c.yieldAdapter);
  const principalFinal   = await yieldAdapter.principalDeposited();
  const yieldHarvested   = tAFinal > taBefore ? tAFinal - taBefore : 0n;

  row("vault.totalDeployedToYield", fb(deployedFinal),   "FUSD (should be 0)");
  row("yieldAdapter.principal",     fb(principalFinal),  "FUSD (should be 0)");
  row("vault.totalAssets()",        fb(tAFinal),         "FUSD");
  row("vault FUSD on-hand",         fb(vaultFusdFinal),  "FUSD");
  row("yieldAdapter FUSD remaining",fb(adapterFusdFinal),"FUSD (unbacked reserve)");
  row("net yield harvested",        fb(yieldHarvested),  "FUSD");

  // ─── Summary ──────────────────────────────────────────────────────────────
  section("SUMMARY");
  const allocationOk = deployedAft > 0n;
  const capitalBack  = deployedFinal === 0n;
  const noAssetLoss  = tAFinal >= taBefore;

  row("yield allocated",            allocationOk ? "YES v" : "NO (!)");
  row("capital returned to vault",  capitalBack  ? "YES v" : "NO (!)");
  row("vault totalAssets >= before",noAssetLoss  ? "YES v" : "NO (!)");
  row("yield harvested",            yieldHarvested > 0n ? fb(yieldHarvested) + " FUSD v" : "0 (short elapsed or unbacked)");

  const pass = allocationOk && capitalBack && noAssetLoss;
  console.log(`\n  RESULT: ${pass ? "OK PASS" : "FAIL"}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
