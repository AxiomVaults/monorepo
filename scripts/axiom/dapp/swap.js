/**
 * dapp/swap.js — Swap ankrFLOW → WFLOW through Axiom Venue (approval-first style).
 *
 * Frontend integration reference:
 *   This is the standard ERC-20 approval → swap flow (OpenZeppelin / any wallet):
 *   1. ankrFLOW.approve(venue, amount)
 *   2. venue.swapExactTokensForTokens(amountIn, minOut, [ankrFLOW, WFLOW], to, deadline)
 *
 * Venue charges a discount (default 30 bps) so users receive slightly less WFLOW
 * than the 1:1 ankrFLOW peg — this is the fee that accrues to vault shareholders.
 *
 * Usage:
 *   SWAP_AMOUNT=1 npx hardhat run scripts/axiom/dapp/swap.js --network flowFork
 */

const { ethers } = require("hardhat");
const { DEPLOYED, ABIS, fmt, deadline } = require("./_shared");

const SWAP_INPUT = process.env.SWAP_AMOUNT || "1"; // ankrFLOW to swap

async function main() {
  const [signer] = await ethers.getSigners();

  const wflow    = new ethers.Contract(DEPLOYED.wflow,    ABIS.WFLOW,   signer);
  const ankrFLOW = new ethers.Contract(DEPLOYED.ankrFLOW, ABIS.ERC20,   signer);
  const venue    = new ethers.Contract(DEPLOYED.venue,    ABIS.AxiomVenue, signer);

  const amountIn = ethers.parseEther(SWAP_INPUT);

  console.log(`\n─── Axiom Venue Swap (approval-first) ───`);
  console.log(`  Swapper:    ${signer.address}`);
  console.log(`  Selling:    ${SWAP_INPUT} ankrFLOW\n`);

  // ── 1. Check ankrFLOW balance ────────────────────────────────────────────
  const ankrBal = await ankrFLOW.balanceOf(signer.address);
  if (ankrBal < amountIn) {
    console.error(`Insufficient ankrFLOW. Have ${fmt(ankrBal)}, need ${fmt(amountIn)}.`);
    console.error(`Stake FLOW on Ankr at https://www.ankr.com/staking/stake/flow/ or run the Ankr staking step.`);
    process.exit(1);
  }

  // ── 2. Get quote from venue ──────────────────────────────────────────────
  const quote = await venue.getQuote(DEPLOYED.ankrFLOW, amountIn);
  const slippage = 30n; // 30 bps = 0.3% slippage tolerance
  const minOut   = quote * (10000n - slippage) / 10000n;

  console.log(`  Quote:      ${fmt(amountIn)} ankrFLOW → ${fmt(quote)} WFLOW`);
  console.log(`  Min out:    ${fmt(minOut)} WFLOW (30 bps slippage)`);

  // ── 3. Approve venue ─────────────────────────────────────────────────────
  await (await ankrFLOW.approve(DEPLOYED.venue, amountIn)).wait();
  console.log(`  ✓ Approved venue to spend ${SWAP_INPUT} ankrFLOW`);

  // ── 4. Execute swap ──────────────────────────────────────────────────────
  const wflowBefore = await wflow.balanceOf(signer.address);

  const path = [DEPLOYED.ankrFLOW, DEPLOYED.wflow];
  const tx   = await venue.swapExactTokensForTokens(amountIn, minOut, path, signer.address, deadline());
  const rcpt = await tx.wait();

  const wflowAfter    = await wflow.balanceOf(signer.address);
  const wflowReceived = wflowAfter - wflowBefore;

  console.log(`  ✓ Swap executed: tx ${rcpt.hash}`);
  console.log(`  WFLOW received: ${fmt(wflowReceived)} WFLOW`);
  console.log(`  Effective rate: ${(Number(fmt(wflowReceived)) / Number(SWAP_INPUT)).toFixed(6)} WFLOW/ankrFLOW`);
  console.log(`\n  ✓ Swap complete.\n`);
}

main().catch(console.error);
