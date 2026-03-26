// scripts/axiom/grantVenueRoleToStrategyManager.js
// One-time fix: grant VENUE_ROLE on vault to strategyManager so
// strategyManager.allocateToYield() can call vault.authorizedTransfer().
//
// Usage:
//   npx hardhat run scripts/axiom/grantVenueRoleToStrategyManager.js --network flowTestnet

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [signer] = await ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync(path.join(__dirname, "deployed.json"), "utf8"));
  const c = deployed.contracts;

  const vault = await ethers.getContractAt("AxiomVault", c.vault, signer);
  const VENUE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));

  console.log(`Granting VENUE_ROLE on vault to strategyManager...`);
  console.log(`  vault:           ${c.vault}`);
  console.log(`  strategyManager: ${c.strategyManager}`);
  console.log(`  VENUE_ROLE:      ${VENUE_ROLE}`);

  const alreadyHas = await vault.hasRole(VENUE_ROLE, c.strategyManager);
  if (alreadyHas) {
    console.log("  Already granted — nothing to do.");
    return;
  }

  const tx = await vault.grantRole(VENUE_ROLE, c.strategyManager);
  await tx.wait();
  console.log(`  tx: ${tx.hash}`);

  const confirmed = await vault.hasRole(VENUE_ROLE, c.strategyManager);
  console.log(`  Confirmed: ${confirmed ? "YES ✓" : "NO (!)"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
