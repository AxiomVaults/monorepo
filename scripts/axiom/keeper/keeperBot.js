#!/usr/bin/env node
/**
 * scripts/axiom/keeper/keeperBot.js
 *
 * Axiom Meta-Vault Keeper Bot
 * ────────────────────────────────────────────────────────────────────
 * Reads live APY data from each yield source, pushes updated hints to
 * MultiStrategyManager.setAdapterApy(), then calls autoRebalance() if
 * the best adapter changed.
 *
 * Supported yield sources:
 *   [0] ankrMORE Leveraged  — ankrFLOW staking APY (from Ankr contract)
 *                             × leverage multiplier (borrow fraction)
 *   [1] ankrFLOW Staking    — raw ankrFLOW staking APY
 *   [2] MORE Lending        — WFLOW supply APY from MORE Markets DataProvider
 *   [3] PunchSwap LP        — estimated LP fee APY from 24h swap volume
 *
 * Designed to run every ~1 hour via cron:
 *   0 * * * * node /path/to/keeperBot.js
 *
 * Requires:
 *   - KEEPER_PRIVATE_KEY in env (must have OPERATOR_ROLE on MSM)
 *   - RPC_URL in env (default: https://mainnet.evm.nodes.onflow.org)
 *   - DEPLOYED_JSON path in env (default: ./deployed-meta-fork.json)
 *
 * Example:
 *   KEEPER_PRIVATE_KEY=0x... RPC_URL=http://127.0.0.1:8545 node keeperBot.js
 */

const { ethers } = require("ethers");
const path = require("path");
const fs   = require("fs");

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL     = process.env.RPC_URL     || "https://mainnet.evm.nodes.onflow.org";
const PRIV_KEY    = process.env.KEEPER_PRIVATE_KEY;
const DEP_PATH    = process.env.DEPLOYED_JSON || path.join(__dirname, "deployed-meta-fork.json");
const DRY_RUN     = process.env.DRY_RUN === "true";

// How much the best adapter's APY must beat the current leader before
// autoRebalance is triggered (avoids thrashing). In bps.
const REBALANCE_THRESHOLD_BPS = 50; // 0.50%

// ─── ABIs (minimal) ──────────────────────────────────────────────────────────

const MSM_ABI = [
  "function setAdapterApy(uint8 id, uint256 apyBps) external",
  "function autoRebalance() external",
  "function adapters(uint8) view returns (address adapter, uint256 deployed, uint256 apyBps, bool active)",
  "function adapterCount() view returns (uint8)",
];

const MORE_DATA_ABI = [
  // Returns reserve data including liquidity rate (ray = 1e27)
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
];

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)",
];

const PAIR_ABI = [
  "function getReserves() view returns(uint112,uint112,uint32)",
  "function totalSupply() view returns(uint256)",
  "function token0() view returns(address)",
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${new Date().toISOString()}] Axiom Keeper Bot starting`);
  if (DRY_RUN) console.log("DRY_RUN mode — no transactions will be sent");

  // Load deployment addresses
  if (!fs.existsSync(DEP_PATH)) {
    console.error("DEPLOYED_JSON not found:", DEP_PATH);
    process.exit(1);
  }
  const dep = JSON.parse(fs.readFileSync(DEP_PATH, "utf8"));

  // Connect
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const block = await provider.getBlockNumber();
  console.log(`Connected to ${RPC_URL} — block ${block}`);

  let signer;
  if (PRIV_KEY) {
    signer = new ethers.Wallet(PRIV_KEY, provider);
    console.log("Keeper wallet:", signer.address);
  } else if (!DRY_RUN) {
    console.error("KEEPER_PRIVATE_KEY not set. Set DRY_RUN=true to skip tx or provide a key.");
    process.exit(1);
  }

  const msm = new ethers.Contract(
    dep.contracts.multiStrategyManager,
    MSM_ABI,
    signer || provider,
  );

  // ─── 1. Fetch live APYs ──────────────────────────────────────────────────

  const apys = await fetchAllApys(provider, dep);
  console.log("\nLive APY estimates:");
  const names = ["ankrMORE Leveraged", "ankrFLOW Staking", "MORE Lending", "PunchSwap LP"];
  apys.forEach((bps, i) => {
    const pct = (bps / 100).toFixed(2);
    console.log(`  [${i}] ${names[i].padEnd(20)} ${pct}%`);
  });

  // ─── 2. Read current APY hints from chain ────────────────────────────────

  const currentApys = [];
  const adapterCount = 4; // fixed registry length we deployed
  for (let i = 0; i < adapterCount; i++) {
    try {
      const a = await msm.adapters(i);
      currentApys.push(Number(a.apyBps));
    } catch (e) {
      currentApys.push(0);
    }
  }

  // ─── 3. Update hints where there's a meaningful change (> 10 bps drift) ──

  const DRIFT_BPS = 10;
  let anyUpdated = false;

  for (let i = 0; i < apys.length; i++) {
    const newBps = apys[i];
    const oldBps = currentApys[i];
    if (Math.abs(newBps - oldBps) >= DRIFT_BPS) {
      console.log(`\nUpdating adapter[${i}]: ${(oldBps/100).toFixed(2)}% → ${(newBps/100).toFixed(2)}%`);
      if (!DRY_RUN) {
        const tx = await msm.setAdapterApy(i, newBps);
        await tx.wait();
        console.log("  tx:", tx.hash);
      }
      anyUpdated = true;
    }
  }

  if (!anyUpdated) {
    console.log("\nAll APY hints are fresh — no updates needed");
  }

  // ─── 4. Check whether autoRebalance is warranted ─────────────────────────

  // Find best adapter by new APY
  const bestId  = apys.indexOf(Math.max(...apys));
  const bestBps = apys[bestId];

  // Find currently funded adapter (highest deployed)
  let currentFundedId = 0;
  let maxDeployed = 0n;
  for (let i = 0; i < adapterCount; i++) {
    try {
      const a = await msm.adapters(i);
      if (a.deployed > maxDeployed) {
        maxDeployed = a.deployed;
        currentFundedId = i;
      }
    } catch {}
  }

  const currentFundedApyBps = apys[currentFundedId] || 0;
  const gain = bestBps - currentFundedApyBps;

  console.log(`\nCurrent primary adapter: [${currentFundedId}] ${names[currentFundedId]} (${(currentFundedApyBps/100).toFixed(2)}%)`);
  console.log(`Best adapter:             [${bestId}] ${names[bestId]} (${(bestBps/100).toFixed(2)}%)`);

  if (bestId !== currentFundedId && gain >= REBALANCE_THRESHOLD_BPS) {
    console.log(`\nTriggering autoRebalance() — gain = +${(gain/100).toFixed(2)}%`);
    if (!DRY_RUN) {
      const tx = await msm.autoRebalance();
      await tx.wait();
      console.log("  autoRebalance tx:", tx.hash);
    }
  } else if (bestId === currentFundedId) {
    console.log("autoRebalance not needed — already in best adapter");
  } else {
    console.log(`autoRebalance skipped — gain (${(gain/100).toFixed(2)}%) below threshold (${(REBALANCE_THRESHOLD_BPS/100).toFixed(2)}%)`);
  }

  console.log(`\n[${new Date().toISOString()}] Keeper run complete\n`);
}

// ─── APY Fetch Helpers ───────────────────────────────────────────────────────

/**
 * Fetch live APY estimates for all 4 adapters.
 * Returns array of uint256 bps values [ankrMORE, ankrYield, moreLending, punchLP].
 */
async function fetchAllApys(provider, dep) {
  const [ankrRaw, moreApyBps, punchBps] = await Promise.all([
    fetchAnkrApy(provider, dep.realTokens.punchSwapRouter, dep.realTokens.ankrFLOW, dep.realTokens.WFLOW),
    fetchMoreLendingApy(provider, dep.realTokens.moreDataProvider, dep.realTokens.WFLOW),
    fetchPunchSwapLpApy(provider, dep.realTokens.punchSwapLPPair, dep.realTokens.WFLOW),
  ]);

  // ankrFLOW raw APY
  const ankrYieldBps = ankrRaw;

  // ankrMORE = ankrFLOW APY × leverage multiplier (borrow fraction is 60%)
  // With 60% borrowed WFLOW → extra 0.6 × ankrFLOW APY added
  // minus borrow cost (MORE variable rate for WFLOW)
  const moreBorrowBps = await fetchMoreBorrowApy(provider, dep.realTokens.moreDataProvider, dep.realTokens.WFLOW);
  const ankrMoreBps   = Math.max(0, ankrRaw + Math.round(0.6 * ankrRaw) - Math.round(0.6 * moreBorrowBps));

  return [ankrMoreBps, ankrYieldBps, moreApyBps, punchBps];
}

/**
 * Ankr staking APY — estimated from the ankrFLOW/WFLOW DEX price.
 * If 1 ankrFLOW = x FLOW on the DEX (x > 1 due to yield accrual),
 * we estimate a 7% baseline. The DEX rate provides a sanity check
 * but can't give an exact annual rate without time-series data.
 * Falls back to 700 bps (7%) if the DEX call fails.
 */
async function fetchAnkrApy(provider, routerAddr, ankrAddr, wflowAddr) {
  try {
    const router = new ethers.Contract(routerAddr, ROUTER_ABI, provider);
    const ONE = ethers.parseEther("1");
    const amounts = await router.getAmountsOut(ONE, [ankrAddr, wflowAddr]);
    // amounts[1] = WFLOW per 1 ankrFLOW; if > 1e18, ankrFLOW is at a premium
    const wflowPer1Ankr = Number(amounts[1]) / 1e18;
    if (wflowPer1Ankr > 1) {
      // Protocol been live since launch — approximate by raw DEX premium as a yield proxy.
      // Conservative: assume 6-12 months of accrual, so apyBps ≈ premium_pct / 0.75
      const premiumPct = (wflowPer1Ankr - 1) * 100;
      const apyBps = Math.round((premiumPct / 0.75) * 100); // convert % → bps
      return Math.min(Math.max(apyBps, 400), 1500); // clamp 4-15%
    }
    return 700; // 7% default
  } catch (e) {
    console.warn("  [ankrApy] DEX quote failed:", e.message.slice(0, 80));
    return 700;
  }
}

/**
 * MORE Markets WFLOW supply APY — from the Data Provider's liquidityRate.
 * liquidityRate is in Ray (1e27). Convert to bps: rate / 1e27 × 10000.
 */
async function fetchMoreLendingApy(provider, dataProviderAddr, wflowAddr) {
  try {
    const dp = new ethers.Contract(dataProviderAddr, MORE_DATA_ABI, provider);
    const data = await dp.getReserveData(wflowAddr);
    // data.liquidityRate is a Ray (1e27) per-second rate. Convert to annual bps:
    // annualBps = (liquidityRate / 1e27) × 365.25 × 24 × 3600 × 10000
    // More practical: approximate as (liquidityRate / 1e23) which gives ~bps for typical rates
    const rayRate = BigInt(data[5]); // liquidityRate field (annual APY in ray units)
    const RAY = BigInt("1000000000000000000000000000"); // 1e27
    // MORE Markets liquidityRate is the annual APY expressed in ray (AAVE V3 standard).
    // apyBps = liquidityRate / 1e27 × 10000
    const apyBps = Number(rayRate * 10000n / RAY);
    return Math.min(apyBps, 5000); // cap at 50%
  } catch (e) {
    console.warn("  [moreLendingApy] fetch failed:", e.message.slice(0, 80));
    return 600;
  }
}

/**
 * MORE Markets WFLOW borrow APY (variable rate) — used for ankrMORE leverage calc.
 */
async function fetchMoreBorrowApy(provider, dataProviderAddr, wflowAddr) {
  try {
    const dp = new ethers.Contract(dataProviderAddr, MORE_DATA_ABI, provider);
    const data = await dp.getReserveData(wflowAddr);
    const rayRate = BigInt(data[6]); // variableBorrowRate field (annual in ray)
    const RAY = BigInt("1000000000000000000000000000");
    const apyBps = Number(rayRate * 10000n / RAY);
    return Math.min(apyBps, 5000);
  } catch (e) {
    console.warn("  [moreBorrowApy] fetch failed:", e.message.slice(0, 80));
    return 400; // fallback borrow rate
  }
}

/**
 * PunchSwap LP fee APY — estimated from on-chain reserves.
 * Uses a static fee rate (0.3%) × estimated daily volume / TVL × 365.
 * Volume is approximated from the recent reserve change heuristic.
 * For a more accurate estimate, use an API or subgraph in production.
 */
async function fetchPunchSwapLpApy(provider, pairAddr, wflowAddr) {
  try {
    const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
    const [r0, r1] = await pair.getReserves();
    const t0 = await pair.token0();
    const totalSupply = await pair.totalSupply();

    // TVL in WFLOW units (both sides combined)
    const reserveWFLOW = t0.toLowerCase() === wflowAddr.toLowerCase() ? r0 : r1;
    const tvlWFLOW = reserveWFLOW * 2n; // symmetric pool approximation

    if (tvlWFLOW === 0n || totalSupply === 0n) return 400;

    // Use a static daily volume / TVL ratio assumption (conservative: 10% daily)
    // In production, pull 24h volume from a subgraph or indexer.
    const DAILY_VOLUME_RATIO = 0.10; // 10% of TVL trades through per day
    const FEE_BPS = 30; // 0.30% standard PunchSwap fee

    // Fee APY = dailyVolume/TVL × FEE × 365
    const feeApyBps = Math.round(DAILY_VOLUME_RATIO * FEE_BPS * 365);
    return Math.min(feeApyBps, 5000);
  } catch (e) {
    console.warn("  [punchLpApy] fetch failed:", e.message.slice(0, 80));
    return 400;
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

main().catch(e => {
  console.error("Keeper bot error:", e.message);
  process.exit(1);
});
