/**
 * dapp/redeem.js — Request and claim native ankrFLOW redemption via Ankr unbonding.
 *
 * Frontend integration reference:
 *   1. ankrFLOW.approve(strategyManager, amount)
 *   2. strategyManager.requestRedemption(ankrFLOW, amount) → requestId
 *   3. Poll ankrRedemptionAdapter.isClaimable(requestId) until true (~7 days unbond)
 *   4. ankrRedemptionAdapter.claimRedemption(requestId) → receive FLOW/WFLOW
 *
 * Note: this is for users who want 1:1 FLOW back via Ankr's unbonding queue.
 * For immediate exit (with small discount), use swap.js or swapViaPair.js instead.
 *
 * Usage:
 *   REDEEM_AMOUNT=1 npx hardhat run scripts/axiom/dapp/redeem.js --network flowFork
 *   REQUEST_ID=0    npx hardhat run scripts/axiom/dapp/redeem.js --network flowFork
 */

const { ethers } = require("hardhat");
const { DEPLOYED, ABIS, fmt } = require("./_shared");

const REDEEM_AMOUNT = process.env.REDEEM_AMOUNT || "0.5"; // ankrFLOW to redeem
const FORCE_REQUEST_ID = process.env.REQUEST_ID;           // skip staking — check/claim existing ID

async function main() {
  const [signer] = await ethers.getSigners();

  const ankrFLOW          = new ethers.Contract(DEPLOYED.ankrFLOW,              ABIS.ERC20,                    signer);
  const strategyManager   = new ethers.Contract(DEPLOYED.strategyManager,        ABIS.StrategyManager,          signer);
  const redemptionAdapter = new ethers.Contract(DEPLOYED.ankrRedemptionAdapter,  ABIS.AnkrRedemptionAdapter,    signer);

  console.log(`\n─── ankrFLOW Redemption via Ankr Unbonding ───`);
  console.log(`  User:    ${signer.address}\n`);

  // ── If REQUEST_ID given, just check/claim that request ───────────────────
  if (FORCE_REQUEST_ID !== undefined) {
    const reqId = BigInt(FORCE_REQUEST_ID);
    return await checkAndClaim(redemptionAdapter, reqId, signer.address);
  }

  const amount = ethers.parseEther(REDEEM_AMOUNT);

  // ── 1. Check balance ──────────────────────────────────────────────────────
  const ankrBal = await ankrFLOW.balanceOf(signer.address);
  if (ankrBal < amount) {
    console.error(`Insufficient ankrFLOW. Have ${fmt(ankrBal)}, need ${fmt(amount)}.`);
    process.exit(1);
  }
  console.log(`  ankrFLOW balance: ${fmt(ankrBal)}`);

  // ── 2. Approve strategyManager ───────────────────────────────────────────
  await (await ankrFLOW.approve(DEPLOYED.strategyManager, amount)).wait();
  console.log(`  ✓ Approved strategyManager to spend ${REDEEM_AMOUNT} ankrFLOW`);

  // ── 3. Request redemption ─────────────────────────────────────────────────
  const tx     = await strategyManager.requestRedemption(DEPLOYED.ankrFLOW, amount);
  const rcpt   = await tx.wait();
  console.log(`  ✓ Redemption requested: tx ${rcpt.hash}`);

  // Parse request ID from event
  const iface = new ethers.Interface([
    "event RedemptionRequested(address indexed user, address indexed token, uint256 amount, uint256 indexed requestId)"
  ]);
  let requestId;
  for (const log of rcpt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) { requestId = parsed.args.requestId; break; }
    } catch {}
  }

  if (requestId !== undefined) {
    console.log(`  Request ID: ${requestId}`);
  } else {
    console.log(`  (Could not parse request ID from logs — check tx ${rcpt.hash})`);
  }

  console.log(`\n  ⏳ Unbonding period: ~7 days on mainnet.`);
  console.log(`     Poll claimable with: REQUEST_ID=${requestId} node redeem.js`);
  console.log(`     Or observe: ankrRedemptionAdapter.isClaimable(${requestId})\n`);
}

async function checkAndClaim(redemptionAdapter, requestId, userAddress) {
  console.log(`  Checking request ID: ${requestId}`);
  const claimable = await redemptionAdapter.isClaimable(requestId);
  if (!claimable) {
    console.log(`  ⏳ Not yet claimable. Come back after unbonding period.`);
    return;
  }

  console.log(`  ✓ Claimable! Claiming...`);
  const tx   = await redemptionAdapter.claimRedemption(requestId);
  const rcpt = await tx.wait();
  console.log(`  ✓ Claimed: tx ${rcpt.hash}`);
  console.log(`  Check your WFLOW balance — FLOW has been returned.\n`);
}

main().catch(console.error);
