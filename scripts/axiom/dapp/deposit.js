/**
 * dapp/deposit.js — Deposit WFLOW into Axiom Vault and receive axWFLOW shares.
 *
 * Frontend integration reference:
 *   1. User approves vault to spend WFLOW
 *   2. User calls vault.deposit(amount, receiver)
 *   3. User receives axWFLOW shares (ERC4626)
 *
 * Usage:
 *   DEPOSIT_FLOW=5 npx hardhat run scripts/axiom/dapp/deposit.js --network flowFork
 */

const { ethers } = require("hardhat");
const { DEPLOYED, ABIS, fmt } = require("./_shared");

const DEPOSIT_FLOW = process.env.DEPOSIT_FLOW || "2"; // FLOW to wrap and deposit

async function main() {
  const [signer] = await ethers.getSigners();

  const wflow = new ethers.Contract(DEPLOYED.wflow, ABIS.WFLOW, signer);
  const vault = new ethers.Contract(DEPLOYED.vault, ABIS.AxiomVault, signer);

  const depositAmt = ethers.parseEther(DEPOSIT_FLOW);

  console.log(`\n─── Axiom Vault Deposit ───`);
  console.log(`  Depositor:    ${signer.address}`);
  console.log(`  Amount:       ${DEPOSIT_FLOW} FLOW\n`);

  // ── 1. Wrap FLOW → WFLOW ────────────────────────────────────────────────
  console.log(`  Wrapping ${DEPOSIT_FLOW} FLOW → WFLOW...`);
  await (await wflow.deposit({ value: depositAmt })).wait();
  console.log(`  ✓ WFLOW balance: ${fmt(await wflow.balanceOf(signer.address))} WFLOW`);

  // ── 2. Preview shares ────────────────────────────────────────────────────
  const previewShares = await vault.previewDeposit(depositAmt);
  console.log(`  Preview: ${DEPOSIT_FLOW} WFLOW → ${fmt(previewShares)} axWFLOW shares`);

  // ── 3. Approve vault ────────────────────────────────────────────────────
  await (await wflow.approve(DEPLOYED.vault, depositAmt)).wait();
  console.log(`  ✓ Approved vault to spend ${DEPOSIT_FLOW} WFLOW`);

  // ── 4. Deposit ──────────────────────────────────────────────────────────
  const shareBefore = await vault.balanceOf(signer.address);
  const tx = await vault.deposit(depositAmt, signer.address);
  const rcpt = await tx.wait();
  const shareAfter = await vault.balanceOf(signer.address);
  const sharesReceived = shareAfter - shareBefore;

  console.log(`  ✓ Deposited: tx ${rcpt.hash}`);
  console.log(`  axWFLOW received:    ${fmt(sharesReceived)} axWFLOW`);
  console.log(`  Total axWFLOW held:  ${fmt(shareAfter)} axWFLOW`);

  // ── 5. Post-deposit state ────────────────────────────────────────────────
  const totalAssets = await vault.totalAssets();
  const totalSupply = await vault.totalSupply();
  const sharePrice  = Number(ethers.formatEther(totalAssets)) / Number(ethers.formatEther(totalSupply));

  console.log(`\n  Vault state after deposit:`);
  console.log(`    totalAssets:  ${fmt(totalAssets)} WFLOW`);
  console.log(`    totalSupply:  ${fmt(totalSupply)} axWFLOW`);
  console.log(`    share price:  ${sharePrice.toFixed(6)} WFLOW/axWFLOW`);
  console.log(`\n  ✓ Deposit complete.\n`);
}

main().catch(console.error);
