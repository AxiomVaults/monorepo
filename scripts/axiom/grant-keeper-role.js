// scripts/axiom/grant-keeper-role.js
// Grant OPERATOR_ROLE on MultiStrategyManager to the keeper wallet.
//
// Run AFTER deployMeta.js:
//   node_modules/.bin/hardhat run scripts/axiom/grant-keeper-role.js --network flow_mainnet
//
// Requires: PRIVATE_KEY_FLOW and KEEPER_ADDRESS set in .env

const { ethers } = require("hardhat");
const path = require("path");
const fs   = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  const deployedPath = path.join(__dirname, "deployed-mainnet.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error("deployed-mainnet.json not found — run deployMeta.js first");
  }
  const deployed = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  const keeperAddress = process.env.KEEPER_ADDRESS;
  if (!keeperAddress || !ethers.isAddress(keeperAddress)) {
    throw new Error("KEEPER_ADDRESS not set or invalid in .env");
  }

  console.log(`\nNetwork:   ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Keeper:    ${keeperAddress}`);
  console.log(`MSM:       ${deployed.contracts.multiStrategyManager}\n`);

  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

  const msm = await ethers.getContractAt(
    "MultiStrategyManager",
    deployed.contracts.multiStrategyManager,
    deployer
  );

  const alreadyHas = await msm.hasRole(OPERATOR_ROLE, keeperAddress);
  if (alreadyHas) {
    console.log("✓ Keeper already has OPERATOR_ROLE — nothing to do.");
    return;
  }

  console.log("» Granting OPERATOR_ROLE to keeper...");
  const tx = await msm.grantRole(OPERATOR_ROLE, keeperAddress);
  await tx.wait();
  console.log(`✓ OPERATOR_ROLE granted. Tx: ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
