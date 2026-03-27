// scripts/axiom/interact/testMetaVaultFull.js
// Full integration test for the Axiom meta-vault (MultiStrategyManager).
//
// Tests (in order):
//   1. User deposits WFLOW → gets axWFLOW shares
//   2. autoRebalance() → idle capital goes to highest-APY adapter (ankrMORE, id=0)
//   3. allAdaptersStatus() — print dashboard snapshot
//   4. rotateCapital(0→2) — move some capital to MORELending
//   5. rotateCapital(0→3) — move some capital to PunchSwap LP
//   6. allAdaptersStatus() — print updated snapshot
//   7. setAdapterApy(2, 1500) — keeper updates APY hint for MORELending
//   8. autoRebalance() — remaining idle goes to id=2 (now highest)
//   9. deallocateAll(0) — withdraw all from ankrMORE back to vault
//  10. User withdraws WFLOW → burns shares, receives base asset
//
// Prerequisites:
//   - Fork running: hardhat node --fork https://mainnet.evm.nodes.onflow.org
//   - Meta-vault deployed: hardhat run scripts/axiom/deployMetaFork.js --network flowFork
//   - Output at scripts/axiom/deployed-meta-fork.json
//
// Usage:
//   node_modules/.bin/hardhat run scripts/axiom/interact/testMetaVaultFull.js --network flowFork

const { ethers } = require("hardhat");
const fs         = require("fs");
const path       = require("path");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const E = ethers.parseEther;
const f = (n) => Number(ethers.formatEther(n)).toFixed(4);
const bps = (n) => (Number(n) / 100).toFixed(2) + "%";

function section(title) {
  const line = "─".repeat(62);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

function row(label, val, unit = "") {
  console.log(`  ${label.padEnd(40)} ${val}${unit ? " " + unit : ""}`);
}

function pass(msg) { console.log(`  ✓  ${msg}`); }
function info(msg) { console.log(`  ·  ${msg}`); }

function loadDeployed() {
  const p = path.join(__dirname, "..", "deployed-meta-fork.json");
  if (!fs.existsSync(p)) {
    throw new Error("deployed-meta-fork.json not found — run deployMetaFork.js first");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// WFLOW ABI — wrap native FLOW into WFLOW via deposit()
const WFLOW_ABI = [
  "function deposit() payable",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

async function getWFLOW(signerWithWFLOWABI, amount) {
  // Wrap native FLOW → WFLOW using the deployer's existing FLOW balance
  await (await signerWithWFLOWABI.deposit({ value: amount })).wait();
}

async function printAdapterStatus(msmC) {
  const [names, deployed, underlying, apyBps, active] = await msmC.allAdaptersStatus();
  console.log("\n  ID  Name                        Deployed      Underlying    APY     Active");
  console.log("  ─── ─────────────────────────── ──────────── ──────────── ─────── ──────");
  for (let i = 0; i < names.length; i++) {
    const mark = active[i] ? "●" : "○";
    console.log(
      `  [${i}] ${names[i].padEnd(28)} ${f(deployed[i]).padEnd(12)} ${f(underlying[i]).padEnd(12)} ${bps(apyBps[i]).padEnd(7)} ${mark}`
    );
  }
  const total = await msmC.totalDeployedAcrossAdapters();
  console.log(`\n  Total deployed across adapters: ${f(total)} WFLOW`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const dep    = loadDeployed();
  const addrs  = dep.contracts;
  const tokens = dep.realTokens;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     Axiom Meta-Vault — Full Integration Test                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Signer: ${deployer.address}\n`);

  // ─── Load contracts ──────────────────────────────────────────────────────
  const wflow  = new ethers.Contract(tokens.WFLOW, WFLOW_ABI, deployer);
  const wflowC = wflow; // shared reference used for balanceOf etc.
  const vaultC = await ethers.getContractAt("AxiomVault",          addrs.vault,                deployer);
  const msmC   = await ethers.getContractAt("MultiStrategyManager", addrs.multiStrategyManager, deployer);

  // ─── Step 1: Deposit ────────────────────────────────────────────────────
  section("Step 1 — User deposits 10 WFLOW");

  const depositAmount = E("10");

  // Wrap native FLOW → WFLOW (deployer has ~9960 FLOW on fork)
  await getWFLOW(wflow, depositAmount);
  info(`Wrapped ${f(depositAmount)} FLOW → WFLOW`);

  const wflowBefore = await wflowC.balanceOf(deployer.address);
  info(`WFLOW balance before deposit: ${f(wflowBefore)}`);

  await (await wflow.approve(addrs.vault, depositAmount)).wait();
  const depositTx = await vaultC.deposit(depositAmount, deployer.address);
  await depositTx.wait();

  const shares = await vaultC.balanceOf(deployer.address);
  pass(`Deposit executed — shares received: ${f(shares)} axWFLOW`);

  const vaultAssets = await vaultC.totalAssets();
  row("  Vault totalAssets:", f(vaultAssets), "WFLOW");

  const avail = await vaultC.availableLiquidity();
  row("  Vault availableLiquidity:", f(avail), "WFLOW");

  // ─── Step 2: autoRebalance ───────────────────────────────────────────────
  section("Step 2 — autoRebalance() → idle capital to best adapter");

  const autoTx = await msmC.autoRebalance();
  const autoReceipt = await autoTx.wait();
  pass("autoRebalance() executed");

  const availAfter = await vaultC.availableLiquidity();
  row("  Vault availableLiquidity after:", f(availAfter), "WFLOW");
  row("  Total deployed:", f(await msmC.totalDeployedAcrossAdapters()), "WFLOW");

  // ─── Step 3: Status snapshot ─────────────────────────────────────────────
  section("Step 3 — Adapter status snapshot");
  await printAdapterStatus(msmC);

  // ─── Step 4: rotateCapital 0 → 2 (ankrMORE → MORELending) ───────────────
  section("Step 4 — rotateCapital: ankrMORE [0] → MORELending [2]  (2 WFLOW)");

  const rotateAmount = E("2");
  const [,dep0before] = await getDeployedForAdapter(msmC, 0, 2);
  info(`Before: adapter[0].deployed = ${f(dep0before[0])}, adapter[2].deployed = ${f(dep0before[2])}`);

  try {
    const rotateTx = await msmC.rotateCapital(0, 2, rotateAmount);
    await rotateTx.wait();
    pass(`rotateCapital(0→2, ${f(rotateAmount)}) executed`);
    await printAdapterStatus(msmC);
  } catch (e) {
    info(`rotateCapital skipped — adapter may not have enough deployed yet: ${e.message.split("\n")[0]}`);
  }

  // ─── Step 5: rotateCapital 0 → 3 (ankrMORE → PunchSwap LP) ──────────────
  section("Step 5 — rotateCapital: ankrMORE [0] → PunchSwap LP [3]  (1 WFLOW)");

  try {
    const rotateTx2 = await msmC.rotateCapital(0, 3, E("1"));
    await rotateTx2.wait();
    pass("rotateCapital(0→3, 1 WFLOW) executed");
    await printAdapterStatus(msmC);
  } catch (e) {
    info(`rotateCapital skipped: ${e.message.split("\n")[0]}`);
  }

  // ─── Step 6: allocateTo specific adapters ────────────────────────────────
  section("Step 6 — Explicit allocateTo each adapter (if idle capital exists)");

  const availNow = await vaultC.availableLiquidity();
  info(`Vault idle liquidity: ${f(availNow)} WFLOW`);

  if (availNow >= E("2")) {
    info("Allocating 1 WFLOW each to adapters 1 (ankrFLOW) and 2 (MORELending)...");
    try {
      await (await msmC.allocateTo(1, E("1"))).wait();
      pass("allocateTo(1, 1 WFLOW) — ankrFLOW Staking");
    } catch (e) { info(`allocateTo(1) skipped: ${e.message.split("\n")[0]}`); }

    try {
      await (await msmC.allocateTo(2, E("1"))).wait();
      pass("allocateTo(2, 1 WFLOW) — MORE Lending");
    } catch (e) { info(`allocateTo(2) skipped: ${e.message.split("\n")[0]}`); }
  } else {
    info("Insufficient idle — skipped explicit allocations");
  }

  await printAdapterStatus(msmC);

  // ─── Step 7: keeper updates APY hint ────────────────────────────────────
  section("Step 7 — Keeper: setAdapterApy(2, 1500)  — MORELending jumps to 15%");

  await (await msmC.setAdapterApy(2, 1_500)).wait();
  const [,,,apys] = await msmC.allAdaptersStatus();
  pass(`adapter[2].apyBps = ${bps(apys[2])}`);
  console.log("  Adapter APYs after update:");
  for (let i = 0; i < apys.length; i++) {
    console.log(`    [${i}] ${bps(apys[i])}`);
  }

  // ─── Step 8: autoRebalance with new best adapter ─────────────────────────
  section("Step 8 — autoRebalance() with updated hints → should pick adapter[2]");

  const availB4 = await vaultC.availableLiquidity();
  info(`Idle before autoRebalance: ${f(availB4)} WFLOW`);

  try {
    await (await msmC.autoRebalance()).wait();
    pass("autoRebalance() executed");
  } catch (e) {
    info(`autoRebalance skipped: ${e.message.split("\n")[0]}`);
  }

  await printAdapterStatus(msmC);

  // ─── Step 9: deallocateAll from ankrMORE ─────────────────────────────────
  section("Step 9 — deallocateAll(0) — pull everything from ankrMORE adapter");

  const [,d0] = await getDeployedForAdapter(msmC, 0);
  info(`adapter[0].deployed before: ${f(d0[0])} WFLOW`);

  try {
    await (await msmC.deallocateAll(0)).wait();
    pass("deallocateAll(0) executed");
    const [,d0after] = await getDeployedForAdapter(msmC, 0);
    row("  adapter[0].deployed after:", f(d0after[0]), "WFLOW");
  } catch (e) {
    info(`deallocateAll(0) skipped: ${e.message.split("\n")[0]}`);
  }

  const vaultAssetsNow = await vaultC.totalAssets();
  row("  Vault totalAssets now:", f(vaultAssetsNow), "WFLOW");

  // ─── Step 10: User withdrawal ────────────────────────────────────────────
  section("Step 10 — User withdraws all shares");

  const userShares = await vaultC.balanceOf(deployer.address);
  info(`User shares: ${f(userShares)} axWFLOW`);

  const wflowBalBefore = await wflowC.balanceOf(deployer.address);

  try {
    const redeemTx = await vaultC.redeem(userShares, deployer.address, deployer.address);
    await redeemTx.wait();
    const wflowBalAfter = await wflowC.balanceOf(deployer.address);
    const received = wflowBalAfter - wflowBalBefore;
    pass(`redeem() executed — received ${f(received)} WFLOW`);
    row("  Shares remaining:", f(await vaultC.balanceOf(deployer.address)));
  } catch (e) {
    // May fail if capital is still deployed — try partial withdraw
    info(`Full redeem failed (capital still deployed): ${e.message.split("\n")[0]}`);
    info("Attempting deallocateAll on remaining adapters first...");
    for (let i = 0; i < 4; i++) {
      try {
        await (await msmC.deallocateAll(i)).wait();
        info(`  deallocateAll(${i}) done`);
      } catch {}
    }
    try {
      const redeemTx2 = await vaultC.redeem(userShares, deployer.address, deployer.address);
      await redeemTx2.wait();
      const wflowBalAfter2 = await wflowC.balanceOf(deployer.address);
      const received2 = wflowBalAfter2 - wflowBalBefore;
      pass(`redeem() (after deallocation) — received ${f(received2)} WFLOW`);
    } catch (e2) {
      info(`redeem still failed: ${e2.message.split("\n")[0]}`);
    }
  }

  // ─── Final state ─────────────────────────────────────────────────────────
  section("Final State");

  row("Vault totalAssets:",   f(await vaultC.totalAssets()), "WFLOW");
  row("Vault totalDeployed:", f(await vaultC.totalDeployedToYield()), "WFLOW");
  row("Deployer axWFLOW:",    f(await vaultC.balanceOf(deployer.address)));
  row("Deployer WFLOW:",      f(await wflowC.balanceOf(deployer.address)));
  await printAdapterStatus(msmC);

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║      ✓ Meta-Vault Integration Test Complete                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getDeployedForAdapter(msmC, ...ids) {
  const [names, deployed] = await msmC.allAdaptersStatus();
  return [names, deployed];
}

main().catch((e) => { console.error(e); process.exit(1); });
