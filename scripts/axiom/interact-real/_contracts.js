// scripts/axiom/interact-real/_contracts.js
// Shared helper for real-protocol interact scripts.
// Loads deployed-real.json and returns attached contract instances + live token contracts.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── External ABIs (minimal, matching what we deployed) ───────────────────────

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];

const WFLOW_ABI = [
  ...ERC20_ABI,
  "function deposit() payable",
  "function withdraw(uint256)",
];

const MORE_POOL_ABI = [
  "function supply(address,uint256,address,uint16)",
  "function borrow(address,uint256,uint256,uint16,address)",
  "function repay(address,uint256,uint256,address) returns (uint256)",
  "function withdraw(address,uint256,address) returns (uint256)",
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
];

const MORE_DATA_ABI = [
  "function getUserReserveData(address,address) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)",
];

const ANKR_MORE_YIELD_ADAPTER_ABI = [
  "function deposit(uint256)",
  "function withdraw(uint256)",
  "function withdrawAll() returns (uint256)",
  "function totalUnderlying() view returns (uint256)",
  "function baseAsset() view returns (address)",
  "function healthFactor() view returns (uint256)",
  "function borrowFractionBps() view returns (uint256)",
  "function maxSlippageBps() view returns (uint256)",
  "function injectWFLOWBuffer(uint256)",
];

const ANKR_REDEMPTION_ADAPTER_ABI = [
  "function requestRedemption(address,uint256) returns (uint256)",
  "function claimRedemption(uint256) returns (uint256)",
  "function pendingValue(uint256) view returns (uint256)",
  "function isClaimable(uint256) view returns (bool)",
  "function totalPending() view returns (uint256)",
  "function claimDelay() view returns (uint256)",
  "function nextRequestId() view returns (uint256)",
  "function requests(uint256) view returns (address,uint256,uint64,bool)",
  "function maxSlippageBps() view returns (uint256)",
];

// ─── Loader ───────────────────────────────────────────────────────────────────

function loadDeployed(chainId) {
  const base = path.join(__dirname, "..");
  // flowFork (hardhat chain 999) → deployed-fork.json
  // flowTestnet (545) → deployed-real.json
  // anything else → try fork, then real
  const forkPath = path.join(base, "deployed-fork.json");
  const realPath = path.join(base, "deployed-real.json");

  if (chainId === 999n || chainId === 999) {
    if (!fs.existsSync(forkPath)) throw new Error("deployed-fork.json not found. Run deployFork.js first.");
    return JSON.parse(fs.readFileSync(forkPath, "utf8"));
  }
  if (chainId === 545n || chainId === 545) {
    if (!fs.existsSync(realPath)) throw new Error("deployed-real.json not found. Run deployReal.js first.");
    return JSON.parse(fs.readFileSync(realPath, "utf8"));
  }
  // fallback
  if (fs.existsSync(forkPath)) return JSON.parse(fs.readFileSync(forkPath, "utf8"));
  if (fs.existsSync(realPath)) return JSON.parse(fs.readFileSync(realPath, "utf8"));
  throw new Error("No deployment JSON found. Run deployFork.js or deployReal.js first.");
}

async function loadContracts() {
  const network = await ethers.provider.getNetwork();
  const d = loadDeployed(network.chainId);
  const c = d.contracts;
  const rt = d.realTokens;

  const [signer] = await ethers.getSigners();

  return {
    signer,
    c,
    rt,
    config: d.config,
    // Core vault stack
    vault:                await ethers.getContractAt("AxiomVault",        c.vault,           signer),
    venue:                await ethers.getContractAt("AxiomVenue",        c.venue,           signer),
    strategyManager:      await ethers.getContractAt("StrategyManager",   c.strategyManager, signer),
    // Adapters
    ankrMOREYieldAdapter: new ethers.Contract(c.ankrMOREYieldAdapter,  ANKR_MORE_YIELD_ADAPTER_ABI,  signer),
    ankrRedemptionAdapter:new ethers.Contract(c.ankrRedemptionAdapter, ANKR_REDEMPTION_ADAPTER_ABI,  signer),
    // Real tokens
    wflow:                new ethers.Contract(c.baseAsset,        WFLOW_ABI,  signer),
    ankrFlow:             new ethers.Contract(c.redeemableAsset,  ERC20_ABI,  signer),
    // Router
    axiomFactory:         await ethers.getContractAt("AxiomFactory",    c.axiomFactory, signer),
    pair:                 await ethers.getContractAt("AxiomUniV2Pair",  c.pair,         signer),
    // External protocols (read-only dashboard use)
    morePool:             new ethers.Contract(rt.morePool,    MORE_POOL_ABI,  signer),
    moreDataProv:         new ethers.Contract(rt.moreDataProv, MORE_DATA_ABI, signer),
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const f18 = (n) => Number(ethers.formatEther(n)).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const f6  = (n) => Number(ethers.formatUnits(n, 6)).toFixed(4);
const fb  = (n) => Number(ethers.formatEther(n)).toFixed(4);
const pct = (bps) => (Number(bps) / 100).toFixed(2) + "%";
const hf  = (n)  => {
  if (n === 0n || n === BigInt(0)) return "∞";
  const v = Number(n) / 1e18;
  return v.toFixed(4);
};

function row(label, value, unit = "") {
  console.log(`  ${label.padEnd(40)} ${value}${unit ? " " + unit : ""}`);
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(60)}`);
}

function divider() {
  console.log(`  ${"·".repeat(56)}`);
}

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); }

module.exports = { loadContracts, loadDeployed, f18, f6, fb, pct, hf, row, section, divider, pass, fail };
