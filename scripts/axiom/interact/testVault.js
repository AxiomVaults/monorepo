// scripts/axiom/interact/testVault.js
// Vault user flow: deposit FUSD → receive axFUSD shares → redeem half → withdraw.
//
// Usage:
//   npx hardhat run scripts/axiom/interact/testVault.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, f, fb, section, divider, row } = require("./_contracts");

const DEPOSIT_AMOUNT = ethers.parseEther("5000");   // 5 000 FUSD
const REDEEM_SHARES  = ethers.parseEther("2500");   // redeem half back

async function main() {
  const { signer, c, vault, baseAsset } = await loadContracts();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║              TEST: VAULT DEPOSIT / REDEEM           ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Signer: ${signer.address}\n`);

  // ─── Snapshot before ─────────────────────────────────────────────────────
  section("BEFORE");
  const fusdBefore   = await baseAsset.balanceOf(signer.address);
  const sharesBefore = await vault.balanceOf(signer.address);
  const taBefore     = await vault.totalAssets();
  const tsBefore     = await vault.totalSupply();
  row("FUSD balance",  fb(fusdBefore),  "FUSD");
  row("axFUSD shares", fb(sharesBefore),"axFUSD");
  row("totalAssets",   fb(taBefore),    "FUSD");
  row("totalSupply",   fb(tsBefore),    "axFUSD");
  const preBefore = tsBefore > 0n
    ? (Number(ethers.formatEther(taBefore)) / Number(ethers.formatEther(tsBefore))).toFixed(8)
    : "1.00000000";
  row("share price before", preBefore, "FUSD/axFUSD");

  // ─── Step 1: Approve vault to pull FUSD ───────────────────────────────────
  section("STEP 1 — Approve vault to spend FUSD");
  console.log(`  Approving ${fb(DEPOSIT_AMOUNT)} FUSD …`);
  let tx = await baseAsset.approve(c.vault, DEPOSIT_AMOUNT);
  await tx.wait();
  console.log(`  Approved  tx: ${tx.hash}`);

  // ─── Step 2: Deposit ──────────────────────────────────────────────────────
  section("STEP 2 — Deposit 5 000 FUSD → receive axFUSD shares");
  const previewShares = await vault.previewDeposit(DEPOSIT_AMOUNT);
  row("previewDeposit(5000)", fb(previewShares), "axFUSD");
  console.log(`  Depositing … `);
  tx = await vault.deposit(DEPOSIT_AMOUNT, signer.address);
  const rx = await tx.wait();
  console.log(`  Deposited  tx: ${tx.hash}`);

  const sharesAfterDep  = await vault.balanceOf(signer.address);
  const newShares       = sharesAfterDep - sharesBefore;
  const taAfterDep      = await vault.totalAssets();
  const tsAfterDep      = await vault.totalSupply();
  row("shares minted",       fb(newShares),    "axFUSD");
  row("shares match preview",newShares === previewShares ? "YES ✓" : "NO (!)");
  row("totalAssets  (+5000)", fb(taAfterDep),  "FUSD");
  row("totalSupply",          fb(tsAfterDep),  "axFUSD");
  const priceAfterDep = (Number(ethers.formatEther(taAfterDep)) / Number(ethers.formatEther(tsAfterDep))).toFixed(8);
  row("share price", priceAfterDep, "FUSD/axFUSD  (should equal before)");

  // ─── Step 3: convertToAssets ──────────────────────────────────────────────
  section("STEP 3 — Check convertToAssets for redeemable shares");
  const redeemShares  = REDEEM_SHARES < newShares ? REDEEM_SHARES : newShares;
  const expectedFusd  = await vault.convertToAssets(redeemShares);
  row("redeemShares",     fb(redeemShares),  "axFUSD");
  row("expectedFusd",     fb(expectedFusd),  "FUSD");

  // ─── Step 4: Redeem half ──────────────────────────────────────────────────
  section("STEP 4 — Redeem 2 500 axFUSD → get FUSD back");
  const fusdBeforeRedeem = await baseAsset.balanceOf(signer.address);
  console.log(`  Redeeming ${fb(redeemShares)} axFUSD …`);
  tx = await vault.redeem(redeemShares, signer.address, signer.address);
  await tx.wait();
  console.log(`  Redeemed   tx: ${tx.hash}`);

  const fusdAfterRedeem  = await baseAsset.balanceOf(signer.address);
  const fusdReceived     = fusdAfterRedeem - fusdBeforeRedeem;
  const sharesAfterRedeem = await vault.balanceOf(signer.address);
  const taAfterRedeem    = await vault.totalAssets();
  row("FUSD received",     fb(fusdReceived), "FUSD");
  row("matches expected",  fusdReceived >= expectedFusd ? "YES ✓" : "NO (!)");
  row("remaining shares",  fb(sharesAfterRedeem), "axFUSD");
  row("totalAssets",       fb(taAfterRedeem),       "FUSD");

  // ─── Summary ──────────────────────────────────────────────────────────────
  section("SUMMARY");
  const fusdFinal  = await baseAsset.balanceOf(signer.address);
  const delta      = fusdFinal - fusdBefore;
  row("FUSD start",  fb(fusdBefore),  "FUSD");
  row("FUSD end",    fb(fusdFinal),   "FUSD");
  row("net FUSD change (deposit 5k, redeem 2.5k)", fb(delta), "FUSD (expect ≈ -2500)");

  const pass = fusdReceived > 0n && taAfterDep > taBefore && sharesAfterRedeem > 0n;
  console.log(`\n  RESULT: ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
