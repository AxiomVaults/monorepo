// scripts/axiom/redeployPair.js
// Deploys a new AxiomUniV2Pair with the fixed swap() implementation,
// registers it in AxiomFactory, and updates deployed.json.
//
// Usage:
//   npx hardhat run scripts/axiom/redeployPair.js --network flowTestnet

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`\nRedeploying AxiomUniV2Pair with signer: ${signer.address}`);

  const deployedPath = path.join(__dirname, "deployed.json");
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const c = deployed.contracts;

  // Need to get discountBps from venue's swapConfig
  const venue = await ethers.getContractAt("AxiomVenue", c.venue, signer);
  const swapCfg = await venue.swapConfigs(c.redeemableAsset);
  const discountBps = swapCfg.discountBps;
  console.log(`  discountBps: ${discountBps}`);

  // Deploy new pair
  console.log("\nDeploying new AxiomUniV2Pair...");
  const PairFactory = await ethers.getContractFactory("AxiomUniV2Pair");
  const pair = await PairFactory.deploy(c.axiomFactory, c.baseAsset, c.redeemableAsset, c.venue, c.vault, discountBps);
  await pair.waitForDeployment();
  const pairAddr = await pair.getAddress();
  console.log(`  ✓ AxiomUniV2Pair deployed: ${pairAddr}`);

  // Register new pair in factory (replaces old pair)
  const factory = await ethers.getContractAt("AxiomFactory", c.axiomFactory, signer);
  console.log("\nRegistering new pair in factory...");
  // Check if old pair already registered — use updatePair if so
  const existingPair = await factory.getPair(c.baseAsset, c.redeemableAsset);
  let tx;
  if (existingPair !== ethers.ZeroAddress && existingPair !== pairAddr) {
    console.log(`  Old pair: ${existingPair}, updating...`);
    tx = await factory.updatePair(c.baseAsset, c.redeemableAsset, pairAddr);
  } else {
    tx = await factory.registerPair(c.baseAsset, c.redeemableAsset, pairAddr);
  }
  await tx.wait();
  console.log(`  ✓ Pair registered  tx: ${tx.hash}`);

  // Verify registration
  const registeredPair = await factory.getPair(c.baseAsset, c.redeemableAsset);
  console.log(`  getPair → ${registeredPair} ${registeredPair === pairAddr ? "✓" : "MISMATCH!"}`);

  // Update deployed.json
  deployed.contracts.pair = pairAddr;
  deployed.contracts.oldPair = c.pair; // keep for reference
  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));
  console.log(`\n  deployed.json updated  (old pair: ${c.pair})`);
  console.log(`  new pair: ${pairAddr}`);
  console.log("\nDone.\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
