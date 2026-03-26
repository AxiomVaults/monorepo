/**
 * allocationBot.js — Axiom Vault smart keeper bot.
 *
 * Inspired by Origin ARM but adapted for Axiom's architecture:
 *   • Monitors vault buffer ratio and rebalances capital into/out of yield strategies
 *   • Monitors MORE health factor and deleverages if approaching liquidation
 *   • Claims matured ankrFLOW redemption requests automatically
 *   • Logs all decisions with timestamps and on-chain tx hashes
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────┐
 *   │ allocationBot                                        │
 *   │                                                     │
 *   │  checkLoop()  ─── every CHECK_INTERVAL_MS           │
 *   │    ├── checkBuffer()   → allocate / deallocate      │
 *   │    ├── checkHealth()   → deleverage if needed       │
 *   │    └── checkRedemptions() → claim matured requests  │
 *   └─────────────────────────────────────────────────────┘
 *
 * Configuration (env overrides):
 *   TARGET_BUFFER_BPS=1000    10% reserve (must match vault config)
 *   REBALANCE_THRESHOLD_BPS=500   only rebalance if >5% off target
 *   SAFE_HF=130               deleverage below 1.30 HF (× 100)
 *   CRITICAL_HF=110           emergency deallocateAll below 1.10 HF (× 100)
 *   CHECK_INTERVAL_MS=30000   poll every 30 seconds
 *   DRY_RUN=true              log decisions without sending transactions
 *   MAX_CLAIM_PER_RUN=5       max redemption claims per cycle
 *
 * Usage:
 *   npx hardhat run scripts/axiom/dapp/allocationBot.js --network flowFork
 *   DRY_RUN=true npx hardhat run scripts/axiom/dapp/allocationBot.js --network flowMainnet
 */

const { ethers } = require("hardhat");
const { DEPLOYED, ABIS, fmt } = require("./_shared");

// ── Configuration ────────────────────────────────────────────────────────────
const TARGET_BUFFER_BPS       = BigInt(process.env.TARGET_BUFFER_BPS       || "1000");  // 10%
const REBALANCE_THRESHOLD_BPS = BigInt(process.env.REBALANCE_THRESHOLD_BPS || "500");   // 5%
const SAFE_HF_100             = Number(process.env.SAFE_HF                 || "130");   // 1.30
const CRITICAL_HF_100         = Number(process.env.CRITICAL_HF             || "110");   // 1.10
const CHECK_INTERVAL_MS       = Number(process.env.CHECK_INTERVAL_MS       || "30000"); // 30s
const DRY_RUN                 = process.env.DRY_RUN === "true";
const MAX_CLAIM_PER_RUN       = Number(process.env.MAX_CLAIM_PER_RUN       || "5");

// Keeper tracks the next request ID to check for claimability
let nextClaimCheckId   = 0n;
let totalCycles        = 0;
let lastAllocatedBlock = 0n;

// ── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function logAction(action, detail, txHash) {
  const tag = DRY_RUN ? "DRY_RUN" : "ACTION";
  log(`[${tag}] ${action}: ${detail}${txHash ? `  tx=${txHash}` : ""}`);
}

// ── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  const [keeper] = await ethers.getSigners();

  const vault           = new ethers.Contract(DEPLOYED.vault,               ABIS.AxiomVault,          keeper);
  const strategyManager = new ethers.Contract(DEPLOYED.strategyManager,     ABIS.StrategyManager,      keeper);
  const redemptionAdapt = new ethers.Contract(DEPLOYED.ankrRedemptionAdapter, ABIS.AnkrRedemptionAdapter, keeper);

  log(`Axiom Allocation Bot starting`);
  log(`  Keeper:      ${keeper.address}`);
  log(`  Vault:       ${DEPLOYED.vault}`);
  log(`  Target buf:  ${Number(TARGET_BUFFER_BPS) / 100}%`);
  log(`  Rebal thr:   ${Number(REBALANCE_THRESHOLD_BPS) / 100}%`);
  log(`  Safe HF:     ${SAFE_HF_100 / 100}`);
  log(`  Critical HF: ${CRITICAL_HF_100 / 100}`);
  log(`  Interval:    ${CHECK_INTERVAL_MS / 1000}s`);
  log(`  Mode:        ${DRY_RUN ? "DRY RUN (no txns)" : "LIVE"}\n`);

  // Warm-up: read current nextRequestId so we don't scan from 0 every time
  try {
    nextClaimCheckId = await redemptionAdapt.nextRequestId();
    // Scan backward a reasonable window to catch unclaimed requests
    nextClaimCheckId = nextClaimCheckId > 20n ? nextClaimCheckId - 20n : 0n;
    log(`  Starting redemption scan from request ID ${nextClaimCheckId}`);
  } catch {
    log(`  (Could not read nextRequestId — will scan from 0)`);
  }

  // Run immediately, then on interval
  await checkLoop(vault, strategyManager, redemptionAdapt, keeper);
  setInterval(() => checkLoop(vault, strategyManager, redemptionAdapt, keeper), CHECK_INTERVAL_MS);
}

async function checkLoop(vault, strategyManager, redemptionAdapt, keeper) {
  totalCycles++;
  log(`── cycle #${totalCycles} ──────────────`);

  try {
    await checkBuffer(vault, strategyManager);
    await checkHealth(strategyManager);
    await checkRedemptions(redemptionAdapt, keeper);
  } catch (err) {
    log(`[ERROR] cycle failed: ${err.message}`);
  }
}

// ── Buffer management ─────────────────────────────────────────────────────────
async function checkBuffer(vault, strategyManager) {
  const totalAssets = await vault.totalAssets();
  const liquid      = await vault.availableLiquidity();

  if (totalAssets === 0n) {
    log(`  Buffer: vault empty, skipping`);
    return;
  }

  const liquidBps  = liquid * 10000n / totalAssets;
  const liqPct     = (Number(liquidBps) / 100).toFixed(2);

  log(`  Buffer: ${fmt(liquid)} / ${fmt(totalAssets)} WFLOW liquid (${liqPct}% of TVL)`);

  const excessBps = liquidBps > TARGET_BUFFER_BPS ? liquidBps - TARGET_BUFFER_BPS : 0n;
  const shortBps  = liquidBps < TARGET_BUFFER_BPS ? TARGET_BUFFER_BPS - liquidBps : 0n;

  // ── Allocate: buffer is too large → deploy excess capital ────────────────
  if (excessBps >= REBALANCE_THRESHOLD_BPS) {
    // Allocate down to TARGET_BUFFER_BPS, keeping exact target in reserve
    const excessWei = (excessBps - 0n) * totalAssets / 10000n; // amount above target
    // We want to allocate so buffer lands at TARGET_BUFFER_BPS
    const targetLiquid = TARGET_BUFFER_BPS * totalAssets / 10000n;
    const allocateAmt  = liquid - targetLiquid;

    logAction("ALLOCATE", `${fmt(allocateAmt)} WFLOW to yield strategy (buffer at ${liqPct}%, target ${Number(TARGET_BUFFER_BPS)/100}%)`);

    if (!DRY_RUN) {
      const tx   = await strategyManager.allocateToYield(DEPLOYED.ankrMOREYieldAdapter, allocateAmt);
      const rcpt = await tx.wait();
      logAction("ALLOCATED", fmt(allocateAmt), rcpt.hash);
      const block = await ethers.provider.getBlockNumber();
      lastAllocatedBlock = BigInt(block);
    }
    return;
  }

  // ── Deallocate: buffer is too small → withdraw capital ───────────────────
  if (shortBps >= REBALANCE_THRESHOLD_BPS) {
    const targetLiquid = TARGET_BUFFER_BPS * totalAssets / 10000n;
    const deallocAmt   = targetLiquid - liquid; // how much we need to pull back

    logAction("DEALLOCATE", `${fmt(deallocAmt)} WFLOW from yield strategy (buffer at ${liqPct}%, target ${Number(TARGET_BUFFER_BPS)/100}%)`);

    if (!DRY_RUN) {
      const tx   = await strategyManager.deallocateFromYield(DEPLOYED.ankrMOREYieldAdapter, deallocAmt);
      const rcpt = await tx.wait();
      logAction("DEALLOCATED", fmt(deallocAmt), rcpt.hash);
    }
    return;
  }

  log(`  Buffer OK — within ${Number(REBALANCE_THRESHOLD_BPS)/100}% threshold`);
}

// ── Health factor monitoring ──────────────────────────────────────────────────
async function checkHealth(strategyManager) {
  let healthFactor;
  try {
    const moreDataProvider = new ethers.Contract(
      DEPLOYED.moreDataProvider,
      ["function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"],
      ethers.provider
    );
    const [, , , , , hf] = await moreDataProvider.getUserAccountData(DEPLOYED.ankrMOREYieldAdapter);
    healthFactor = hf;
  } catch {
    // Adapter not in MORE pool (no debt), health is ∞
    log(`  Health: no MORE position (∞ HF)`);
    return;
  }

  const hfNum    = Number(ethers.formatEther(healthFactor));
  const hfInt100 = Math.floor(hfNum * 100);
  log(`  Health factor: ${hfNum.toFixed(4)}`);

  // ── Critical: emergency deallocate all ───────────────────────────────────
  if (hfInt100 < CRITICAL_HF_100) {
    logAction("EMERGENCY_DEALLOCATE_ALL", `HF=${hfNum.toFixed(4)} < critical ${CRITICAL_HF_100/100}`);
    if (!DRY_RUN) {
      const tx   = await strategyManager.deallocateAll(DEPLOYED.ankrMOREYieldAdapter);
      const rcpt = await tx.wait();
      logAction("EMERGENCY_DEALLOCATED_ALL", "", rcpt.hash);
    }
    return;
  }

  // ── Soft deleverage: bring HF to safe level ───────────────────────────────
  if (hfInt100 < SAFE_HF_100) {
    // Target: raise HF from current to SAFE_HF * 1.15 (15% headroom after action)
    const targetHF      = (SAFE_HF_100 / 100) * 1.15;
    // Approximate: deleverage ratio = 1 - (currentHF / targetHF)
    // This assumes linear relationship (conservative — actual may require less)
    const delevRatio    = Math.max(0, 1 - (hfNum / targetHF));
    const deployed      = (await vault.totalAssets()) - (await vault.availableLiquidity());
    const deallocAmtWei = BigInt(Math.floor(Number(deployed) * delevRatio));

    if (deallocAmtWei > 0n) {
      logAction("DELEVERAGE", `${fmt(deallocAmtWei)} WFLOW (HF=${hfNum.toFixed(4)}, target ${targetHF.toFixed(2)})`);
      if (!DRY_RUN) {
        const tx   = await strategyManager.deallocateFromYield(DEPLOYED.ankrMOREYieldAdapter, deallocAmtWei);
        const rcpt = await tx.wait();
        logAction("DELEVERAGED", fmt(deallocAmtWei), rcpt.hash);
      }
    }
    return;
  }

  log(`  Health OK`);
}

// ── Redemption queue monitoring ───────────────────────────────────────────────
async function checkRedemptions(redemptionAdapt, keeper) {
  let maxId;
  try {
    maxId = await redemptionAdapt.nextRequestId();
  } catch {
    log(`  Redemptions: (adapter unavailable)`);
    return;
  }

  if (maxId === 0n) {
    log(`  Redemptions: none queued`);
    return;
  }

  log(`  Redemptions: scanning IDs ${nextClaimCheckId}–${maxId - 1n}`);

  let claimed = 0;
  for (let id = nextClaimCheckId; id < maxId && claimed < MAX_CLAIM_PER_RUN; id++) {
    let claimable = false;
    try {
      claimable = await redemptionAdapt.isClaimable(id);
    } catch {
      continue;
    }

    if (claimable) {
      logAction("CLAIM_REDEMPTION", `request ID ${id}`);
      if (!DRY_RUN) {
        try {
          const tx   = await redemptionAdapt.claimRedemption(id);
          const rcpt = await tx.wait();
          logAction("CLAIMED", `request ID ${id}`, rcpt.hash);
          claimed++;
        } catch (e) {
          log(`  [WARN] claim failed for ID ${id}: ${e.message.slice(0, 80)}`);
        }
      } else {
        claimed++;
      }
    }
  }

  // Advance scan window past what we've checked
  if (nextClaimCheckId < maxId) {
    nextClaimCheckId = maxId;
  }

  if (claimed === 0) {
    log(`  Redemptions: none claimable`);
  } else {
    log(`  Redemptions: ${claimed} claimed this cycle`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
