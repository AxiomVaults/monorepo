// scripts/axiom/interact/_contracts.js
// Shared helper — loads deployed.json and returns attached contract instances.
// All interact scripts require() this instead of duplicating setup.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

function loadDeployed() {
  const p = path.join(__dirname, "..", "deployed.json");
  if (!fs.existsSync(p)) throw new Error(`deployed.json not found at ${p}. Run deployAxiom.js first.`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function loadContracts() {
  const d = loadDeployed();
  const c = d.contracts;

  const [signer] = await ethers.getSigners();

  return {
    signer,
    c,
    config: d.config,
    // Core
    vault:             await ethers.getContractAt("AxiomVault",             c.vault,             signer),
    venue:             await ethers.getContractAt("AxiomVenue",             c.venue,             signer),
    strategyManager:   await ethers.getContractAt("StrategyManager",        c.strategyManager,   signer),
    // Adapters
    yieldAdapter:      await ethers.getContractAt("contracts/axiom/mocks/MockYieldAdapter.sol:MockYieldAdapter",         c.yieldAdapter,      signer),
    redemptionAdapter: await ethers.getContractAt("contracts/axiom/mocks/MockRedemptionAdapter.sol:MockRedemptionAdapter", c.redemptionAdapter, signer),
    // Tokens
    baseAsset:         await ethers.getContractAt("contracts/axiom/mocks/MockERC20.sol:MockERC20",                       c.baseAsset,         signer),
    redeemableAsset:   await ethers.getContractAt("contracts/axiom/mocks/MockRedeemableAsset.sol:MockRedeemableAsset",   c.redeemableAsset,   signer),
    // Router
    axiomFactory:      await ethers.getContractAt("AxiomFactory",           c.axiomFactory,      signer),
    pair:              await ethers.getContractAt("AxiomUniV2Pair",         c.pair,              signer),
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const f = (n) => Number(ethers.formatEther(n)).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fb = (n) => Number(ethers.formatEther(n)).toFixed(2);
const pct = (bps) => (Number(bps) / 100).toFixed(2) + "%";

function row(label, value, unit = "") {
  console.log(`  ${label.padEnd(38)} ${value}${unit ? " " + unit : ""}`);
}

function section(title) {
  console.log(`\n${"─".repeat(56)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(56)}`);
}

function divider() {
  console.log(`  ${"·".repeat(52)}`);
}

module.exports = { loadContracts, loadDeployed, f, fb, pct, row, section, divider };
