/**
 * dapp/withdraw.js — Redeem axWFLOW shares from Axiom Vault for WFLOW.
 *
 * Frontend integration reference:
 *   • vault.redeem(shares, receiver, owner) — burn shares, receive assets
 *   • vault.previewRedeem(shares) — get WFLOW expected without executing
 *
 * Usage:
 *   REDEEM_SHARES=all  npx hardhat run scripts/axiom/dapp/withdraw.js --network flowFork
 *   REDEEM_SHARES=1.5  npx hardhat run scripts/axiom/dapp/withdraw.js --network flowFork
 */

const { ethers } = require("hardhat");
const { DEPLOYED, ABIS, fmt } = require("./_shared");

async function main() {
  const [signer] = await ethers.getSigners();

  const wflow = new ethers.Contract(DEPLOYED.wflow, ABIS.WFLOW, signer);
  const vault = new ethers.Contract(DEPLOYED.vault, ABIS.AxiomVault, signer);

  const userShares = await vault.balanceOf(signer.address);
  if (userShares === 0n) {
    console.log("No axWFLOW shares to redeem. Run deposit.js first.");
    return;
  }

  let redeemAmt;
  const env = process.env.REDEEM_SHARES || "all";
  if (env === "all") {
    redeemAmt = userShares;
  } else {
    redeemAmt = ethers.parseEther(env);
    if (redeemAmt > userShares) {
      console.error(`Insufficient shares: have ${fmt(userShares)}, requested ${fmt(redeemAmt)}`);
      process.exit(1);
    }
  }

  console.log(`\n─── Axiom Vault Withdraw ───`);
  console.log(`  User:          ${signer.address}`);
  console.log(`  Shares held:   ${fmt(userShares)} axWFLOW`);
  console.log(`  Redeeming:     ${fmt(redeemAmt)} axWFLOW\n`);

  // ── 1. Preview WFLOW to be received ─────────────────────────────────────
  const expectedAssets = await vault.previewRedeem(redeemAmt);
  console.log(`  Preview:  ${fmt(redeemAmt)} axWFLOW → ${fmt(expectedAssets)} WFLOW`);

  // ── 2. Check vault has enough liquid buffer ──────────────────────────────
  const liquid = await vault.availableLiquidity();
  if (expectedAssets > liquid) {
    console.warn(`  ⚠  Vault liquid buffer (${fmt(liquid)} WFLOW) is less than requested.`);
    console.warn(`     Consider a partial withdrawal or waiting for deallocation.`);
  }

  // ── 3. Redeem shares ─────────────────────────────────────────────────────
  const wflowBefore = await wflow.balanceOf(signer.address);
  const tx = await vault.redeem(redeemAmt, signer.address, signer.address);
  const rcpt = await tx.wait();
  const wflowAfter = await wflow.balanceOf(signer.address);
  const wflowReceived = wflowAfter - wflowBefore;

  console.log(`  ✓ Redeemed: tx ${rcpt.hash}`);
  console.log(`  WFLOW received:   ${fmt(wflowReceived)} WFLOW`);
  console.log(`  WFLOW balance:    ${fmt(wflowAfter)} WFLOW`);

  // ── 4. Post-withdraw state ───────────────────────────────────────────────
  const sharesLeft    = await vault.balanceOf(signer.address);
  const totalAssets   = await vault.totalAssets();
  const totalSupply   = await vault.totalSupply();

  console.log(`\n  Vault state after withdraw:`);
  console.log(`    totalAssets:  ${fmt(totalAssets)} WFLOW`);
  console.log(`    totalSupply:  ${fmt(totalSupply)} axWFLOW`);
  console.log(`    Your shares:  ${fmt(sharesLeft)} axWFLOW`);
  console.log(`\n  ✓ Withdrawal complete.\n`);
}

main().catch(console.error);
