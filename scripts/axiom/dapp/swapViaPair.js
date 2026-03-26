/**
 * dapp/swapViaPair.js — Swap ankrFLOW → WFLOW via AxiomUniV2Pair (Eisen/aggregator style).
 *
 * Frontend integration reference (permissionless, no approval needed for WFLOW):
 *   1. pair.getAmountsOut(amountIn, [ankrFLOW, WFLOW]) — get exact quote
 *   2. ankrFLOW.transfer(pair, amountIn)               — pay first (UniV2 pattern)
 *   3. pair.swap(amount0Out, 0, receiver, '0x')        — pull output
 *
 * This is the canonical Eisen/aggregator routing path. It is entirely permissionless:
 * the user never approves the venue or vault — they simply transfer tokens to the pair
 * and the pair settles the swap internally.
 *
 * token0 = WFLOW (the base / output token for users selling ankrFLOW)
 * token1 = ankrFLOW (the redeemable / input token)
 *
 * Usage:
 *   SWAP_AMOUNT=1 npx hardhat run scripts/axiom/dapp/swapViaPair.js --network flowFork
 */

const { ethers } = require("hardhat");
const { DEPLOYED, ABIS, fmt } = require("./_shared");

const SWAP_INPUT = process.env.SWAP_AMOUNT || "1"; // ankrFLOW to swap

async function main() {
  const [signer] = await ethers.getSigners();

  const wflow    = new ethers.Contract(DEPLOYED.wflow,    ABIS.WFLOW,           signer);
  const ankrFLOW = new ethers.Contract(DEPLOYED.ankrFLOW, ABIS.ERC20,           signer);
  const factory  = new ethers.Contract(DEPLOYED.axiomFactory, ABIS.AxiomFactory, signer);
  const pair     = new ethers.Contract(DEPLOYED.pair,     ABIS.AxiomUniV2Pair,  signer);

  const amountIn = ethers.parseEther(SWAP_INPUT);

  console.log(`\n─── Axiom Pair Swap (permissionless / Eisen-style) ───`);
  console.log(`  Swapper:    ${signer.address}`);
  console.log(`  Selling:    ${SWAP_INPUT} ankrFLOW\n`);

  // ── 1. Discovery — verify factory knows this pair ────────────────────────
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  const numPairs = await factory.allPairsLength();
  console.log(`  Factory pairs: ${numPairs}`);
  console.log(`  Pair: ${DEPLOYED.pair}`);
  console.log(`    token0 (base/output): ${token0}  (WFLOW)`);
  console.log(`    token1 (redeemable):  ${token1}  (ankrFLOW)`);

  // ── 2. Virtual reserves ──────────────────────────────────────────────────
  const [reserve0, reserve1] = await pair.getReserves();
  console.log(`\n  Virtual reserves:`);
  console.log(`    reserve0 (WFLOW):    ${fmt(reserve0)}`);
  console.log(`    reserve1 (ankrFLOW): ${fmt(reserve1)}`);

  // ── 3. Check balance ─────────────────────────────────────────────────────
  const ankrBal = await ankrFLOW.balanceOf(signer.address);
  if (ankrBal < amountIn) {
    console.error(`\nInsufficient ankrFLOW. Have ${fmt(ankrBal)}, need ${fmt(amountIn)}.`);
    process.exit(1);
  }
  console.log(`\n  ankrFLOW balance: ${fmt(ankrBal)}`);

  // ── 4. Get exact quote from pair ─────────────────────────────────────────
  const path = [DEPLOYED.ankrFLOW, DEPLOYED.wflow];
  const [, amountOut] = await pair.getAmountsOut(amountIn, path);
  const slippage      = 30n; // 30 bps
  const minOut        = amountOut * (10000n - slippage) / 10000n;

  console.log(`  Quote:    ${fmt(amountIn)} ankrFLOW → ${fmt(amountOut)} WFLOW`);
  console.log(`  Min out:  ${fmt(minOut)} WFLOW`);

  // ── 5. Pay first: transfer ankrFLOW to pair ──────────────────────────────
  await (await ankrFLOW.transfer(DEPLOYED.pair, amountIn)).wait();
  console.log(`\n  ✓ Transferred ${SWAP_INPUT} ankrFLOW to pair (pay-first)`);

  // ── 6. Call swap — pair settles against venue ───────────────────────────
  const wflowBefore = await wflow.balanceOf(signer.address);

  const tx   = await pair.swap(amountOut, 0n, signer.address, "0x");
  const rcpt = await tx.wait();

  const wflowAfter    = await wflow.balanceOf(signer.address);
  const wflowReceived = wflowAfter - wflowBefore;

  console.log(`  ✓ Swap settled: tx ${rcpt.hash}`);
  console.log(`  WFLOW received: ${fmt(wflowReceived)} WFLOW`);

  if (wflowReceived < minOut) {
    console.error(`  ✗ Slippage exceeded: received ${fmt(wflowReceived)}, min ${fmt(minOut)}`);
  } else {
    console.log(`  Effective rate: ${(Number(fmt(wflowReceived)) / Number(SWAP_INPUT)).toFixed(6)} WFLOW/ankrFLOW`);
    console.log(`\n  ✓ Permissionless swap complete.\n`);
  }
}

main().catch(console.error);
