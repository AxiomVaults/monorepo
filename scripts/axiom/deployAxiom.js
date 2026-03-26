// scripts/axiom/deployAxiom.js
// Deploy all Axiom Vault contracts to Flow EVM Testnet (or any configured network).
//
// Usage:
//   npx hardhat run scripts/axiom/deployAxiom.js --network flowTestnet
//
// Saves deployed addresses to scripts/axiom/deployed.json for use by configureAxiom.js.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── Deployment config ────────────────────────────────────────────────────────

const CONFIG = {
  baseAsset: {
    name: "Flow USD",
    symbol: "FUSD",
    decimals: 18,
  },
  redeemableAsset: {
    name: "Staked FLOW",
    symbol: "stFLOW",
    decimals: 18,
  },
  vault: {
    name: "Axiom Vault FUSD",
    symbol: "axFUSD",
  },
  yieldAdapter: {
    aprBps: 500, // 5% APR
  },
  redemptionAdapter: {
    claimDelay: 300, // 5 minutes for testnet
  },
  pair: {
    discountBps: 20, // 0.20% discount
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(label, address) {
  console.log(`  ${label.padEnd(28)} ${address}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("\n=== Axiom Vaults — Deploy ===");
  console.log(`  Network:   ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer:  ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:   ${ethers.formatEther(balance)} FLOW\n`);

  const deployed = {};

  // ─── 1. Mock base asset ────────────────────────────────────────────────────
  console.log("» Deploying MockERC20 (FUSD base asset)...");
  const MockERC20Factory = await ethers.getContractFactory("contracts/axiom/mocks/MockERC20.sol:MockERC20");
  const baseAsset = await MockERC20Factory.deploy(
    CONFIG.baseAsset.name,
    CONFIG.baseAsset.symbol,
    CONFIG.baseAsset.decimals
  );
  await baseAsset.waitForDeployment();
  deployed.baseAsset = await baseAsset.getAddress();
  log("FUSD (base asset):", deployed.baseAsset);

  // ─── 2. Mock redeemable asset ─────────────────────────────────────────────
  console.log("\n» Deploying MockRedeemableAsset (stFLOW)...");
  const MockRedeemableFactory = await ethers.getContractFactory("contracts/axiom/mocks/MockRedeemableAsset.sol:MockRedeemableAsset");
  const redeemableAsset = await MockRedeemableFactory.deploy(
    CONFIG.redeemableAsset.name,
    CONFIG.redeemableAsset.symbol,
    CONFIG.redeemableAsset.decimals
  );
  await redeemableAsset.waitForDeployment();
  deployed.redeemableAsset = await redeemableAsset.getAddress();
  log("stFLOW (redeemable):", deployed.redeemableAsset);

  // ─── 3. AxiomVault ────────────────────────────────────────────────────────
  console.log("\n» Deploying AxiomVault...");
  const VaultFactory = await ethers.getContractFactory("AxiomVault");
  const vault = await VaultFactory.deploy(
    deployed.baseAsset,
    CONFIG.vault.name,
    CONFIG.vault.symbol
  );
  await vault.waitForDeployment();
  deployed.vault = await vault.getAddress();
  log("AxiomVault:", deployed.vault);

  // ─── 4. StrategyManager ───────────────────────────────────────────────────
  console.log("\n» Deploying StrategyManager...");
  const ManagerFactory = await ethers.getContractFactory("StrategyManager");
  const strategyManager = await ManagerFactory.deploy(deployed.vault, deployed.baseAsset);
  await strategyManager.waitForDeployment();
  deployed.strategyManager = await strategyManager.getAddress();
  log("StrategyManager:", deployed.strategyManager);

  // ─── 5. MockYieldAdapter ─────────────────────────────────────────────────
  console.log("\n» Deploying MockYieldAdapter (5% APR)...");
  const YieldAdapterFactory = await ethers.getContractFactory("contracts/axiom/mocks/MockYieldAdapter.sol:MockYieldAdapter");
  const yieldAdapter = await YieldAdapterFactory.deploy(
    deployed.baseAsset,
    CONFIG.yieldAdapter.aprBps
  );
  await yieldAdapter.waitForDeployment();
  deployed.yieldAdapter = await yieldAdapter.getAddress();
  log("MockYieldAdapter:", deployed.yieldAdapter);

  // ─── 6. MockRedemptionAdapter ─────────────────────────────────────────────
  console.log("\n» Deploying MockRedemptionAdapter (300s delay)...");
  const RedemptionAdapterFactory = await ethers.getContractFactory("contracts/axiom/mocks/MockRedemptionAdapter.sol:MockRedemptionAdapter");
  const redemptionAdapter = await RedemptionAdapterFactory.deploy(
    deployed.redeemableAsset,
    deployed.baseAsset,
    CONFIG.redemptionAdapter.claimDelay
  );
  await redemptionAdapter.waitForDeployment();
  deployed.redemptionAdapter = await redemptionAdapter.getAddress();
  log("MockRedemptionAdapter:", deployed.redemptionAdapter);

  // ─── 7. AxiomVenue ────────────────────────────────────────────────────────
  console.log("\n» Deploying AxiomVenue...");
  const VenueFactory = await ethers.getContractFactory("AxiomVenue");
  const venue = await VenueFactory.deploy(deployed.vault, deployed.strategyManager);
  await venue.waitForDeployment();
  deployed.venue = await venue.getAddress();
  log("AxiomVenue:", deployed.venue);

  // ─── 8. AxiomFactory ─────────────────────────────────────────────────────
  console.log("\n» Deploying AxiomFactory...");
  const AxiomFactoryContract = await ethers.getContractFactory("AxiomFactory");
  const axiomFactory = await AxiomFactoryContract.deploy();
  await axiomFactory.waitForDeployment();
  deployed.axiomFactory = await axiomFactory.getAddress();
  log("AxiomFactory:", deployed.axiomFactory);

  // ─── 9. AxiomUniV2Pair ────────────────────────────────────────────────────
  console.log("\n» Deploying AxiomUniV2Pair...");
  const PairFactory = await ethers.getContractFactory("AxiomUniV2Pair");
  const pair = await PairFactory.deploy(
    deployed.axiomFactory,
    deployed.baseAsset,      // token0 = base asset (what traders receive)
    deployed.redeemableAsset, // token1 = rToken (what traders send)
    deployed.venue,
    deployed.vault,
    CONFIG.pair.discountBps
  );
  await pair.waitForDeployment();
  deployed.pair = await pair.getAddress();
  log("AxiomUniV2Pair:", deployed.pair);

  // ─── 10. Register pair in factory ────────────────────────────────────────
  console.log("\n» Registering pair in AxiomFactory...");
  const registerTx = await axiomFactory.registerPair(
    deployed.baseAsset,
    deployed.redeemableAsset,
    deployed.pair
  );
  await registerTx.wait();
  console.log(`  Registered pair FUSD/stFLOW -> ${deployed.pair}`);

  // ─── Save deployed addresses ──────────────────────────────────────────────
  const outputPath = path.join(__dirname, "deployed.json");
  const deployedOutput = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployed,
    config: CONFIG,
  };
  fs.writeFileSync(outputPath, JSON.stringify(deployedOutput, null, 2));

  console.log("\n=== Deployment complete ===");
  console.log(`  Addresses saved to: ${outputPath}`);
  console.log("\nAll deployed contracts:");
  for (const [name, addr] of Object.entries(deployed)) {
    log(name + ":", addr);
  }
  console.log("\nNext step:");
  console.log("  npx hardhat run scripts/axiom/configureAxiom.js --network flowTestnet\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
