// scripts/axiom/configureAxiom.js
// Configure all Axiom Vault contracts after deployment.
// Reads deployed addresses from scripts/axiom/deployed.json.
//
// Usage:
//   npx hardhat run scripts/axiom/configureAxiom.js --network flowTestnet
//
// What this script does:
//   1.  Grant STRATEGY_MANAGER_ROLE on vault to strategyManager
//   2.  Grant VENUE_ROLE on vault to venue
//   3.  Grant VENUE_ROLE on strategyManager to venue
//   4.  Grant OPERATOR_ROLE on strategyManager to deployer (already set in constructor, but explicit)
//   5.  Set yieldAdapter on strategyManager
//   6.  Set redemptionAdapter on strategyManager
//   7.  Configure stFLOW as supported asset on venue
//   8.  Set reserve buffer (10%) and max deposit cap on vault
//   9.  Mint initial FUSD to deployer for testing
//   10. Mint stFLOW to deployer for testing
//   11. Fund redemptionAdapter with FUSD so it can pay out claims
//   12. Approve vault to use deployer FUSD and make a test deposit
//   13. Print summary of all config

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── Config ───────────────────────────────────────────────────────────────────

const INITIAL_MINT_FUSD   = ethers.parseEther("1000000");  // 1M FUSD
const INITIAL_MINT_STFLOW = ethers.parseEther("500000");   // 500k stFLOW
const ADAPTER_FUND_FUSD   = ethers.parseEther("200000");   // 200k FUSD for adapter payouts
const TEST_DEPOSIT_FUSD   = ethers.parseEther("100000");   // 100k FUSD initial vault deposit

const VENUE_SWAP_CONFIG = {
  discountBps: 20,                              // 0.20%
  maxSwapSize: ethers.parseEther("50000"),      // 50k stFLOW max per swap
  maxInventory: ethers.parseEther("500000"),    // 500k stFLOW max inventory
};

const VAULT_CONFIG = {
  reserveBufferBps: 1000,                        // 10%
  maxTotalDeposit: ethers.parseEther("10000000"), // 10M FUSD cap
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(label, value) {
  console.log(`  ${label.padEnd(36)} ${value}`);
}

async function confirm(tx, label) {
  const receipt = await tx.wait();
  console.log(`  [OK] ${label}`);
  return receipt;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("\n=== Axiom Vaults — Configure ===");
  console.log(`  Network:  ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer: ${deployer.address}\n`);

  // Load deployed addresses
  const deployedPath = path.join(__dirname, "deployed.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error(
      `deployed.json not found at ${deployedPath}. Run deployAxiom.js first.`
    );
  }
  const { contracts: c } = JSON.parse(fs.readFileSync(deployedPath, "utf8"));

  console.log("» Loaded deployed addresses:");
  for (const [name, addr] of Object.entries(c)) {
    log(name + ":", addr);
  }
  console.log("");

  // Attach to contracts
  const vault             = await ethers.getContractAt("AxiomVault",             c.vault);
  const strategyManager   = await ethers.getContractAt("StrategyManager",        c.strategyManager);
  const venue             = await ethers.getContractAt("AxiomVenue",             c.venue);
  const baseAsset         = await ethers.getContractAt("MockERC20",              c.baseAsset);
  const redeemableAsset   = await ethers.getContractAt("MockRedeemableAsset",    c.redeemableAsset);
  const redemptionAdapter = await ethers.getContractAt("MockRedemptionAdapter",  c.redemptionAdapter);

  // ─── Role constants ───────────────────────────────────────────────────────
  const STRATEGY_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STRATEGY_MANAGER_ROLE"));
  const VENUE_ROLE            = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));
  const OPERATOR_ROLE         = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

  // ─── 1. Grant STRATEGY_MANAGER_ROLE on vault ─────────────────────────────
  console.log("» Granting roles on AxiomVault...");
  await confirm(
    await vault.grantRole(STRATEGY_MANAGER_ROLE, c.strategyManager),
    "vault.grantRole(STRATEGY_MANAGER_ROLE, strategyManager)"
  );
  await confirm(
    await vault.grantRole(VENUE_ROLE, c.venue),
    "vault.grantRole(VENUE_ROLE, venue)"
  );

  // ─── 2. Grant roles on StrategyManager ───────────────────────────────────
  console.log("\n» Granting roles on StrategyManager...");
  await confirm(
    await strategyManager.grantRole(VENUE_ROLE, c.venue),
    "strategyManager.grantRole(VENUE_ROLE, venue)"
  );
  // OPERATOR_ROLE for deployer already granted in constructor; make it explicit
  const hasOpRole = await strategyManager.hasRole(OPERATOR_ROLE, deployer.address);
  if (!hasOpRole) {
    await confirm(
      await strategyManager.grantRole(OPERATOR_ROLE, deployer.address),
      "strategyManager.grantRole(OPERATOR_ROLE, deployer)"
    );
  } else {
    console.log("  [OK] strategyManager OPERATOR_ROLE already set for deployer");
  }

  // ─── 3. StrategyManager: set adapters ────────────────────────────────────
  console.log("\n» Configuring StrategyManager adapters...");
  await confirm(
    await strategyManager.setYieldAdapter(c.yieldAdapter),
    `setYieldAdapter(${c.yieldAdapter})`
  );
  await confirm(
    await strategyManager.setRedemptionAdapter(c.redemptionAdapter),
    `setRedemptionAdapter(${c.redemptionAdapter})`
  );

  // ─── 4. AxiomVenue: configure stFLOW as supported asset ──────────────────
  console.log("\n» Configuring AxiomVenue swap config for stFLOW...");
  await confirm(
    await venue.setSupportedAsset(
      c.redeemableAsset,          // stFLOW
      true,                        // supported
      VENUE_SWAP_CONFIG.discountBps,
      VENUE_SWAP_CONFIG.maxSwapSize,
      VENUE_SWAP_CONFIG.maxInventory,
      c.redemptionAdapter
    ),
    `setSupportedAsset(stFLOW, enabled, discount=${VENUE_SWAP_CONFIG.discountBps}bps)`
  );

  // ─── 5. AxiomVault: set reserve buffer and deposit cap ───────────────────
  console.log("\n» Configuring AxiomVault parameters...");
  await confirm(
    await vault.setReserveBufferBps(VAULT_CONFIG.reserveBufferBps),
    `setReserveBufferBps(${VAULT_CONFIG.reserveBufferBps})`
  );
  await confirm(
    await vault.setMaxTotalDeposit(VAULT_CONFIG.maxTotalDeposit),
    `setMaxTotalDeposit(${ethers.formatEther(VAULT_CONFIG.maxTotalDeposit)} FUSD)`
  );

  // ─── 6. Mint tokens ───────────────────────────────────────────────────────
  console.log("\n» Minting tokens...");
  await confirm(
    await baseAsset.mint(deployer.address, INITIAL_MINT_FUSD),
    `Minted ${ethers.formatEther(INITIAL_MINT_FUSD)} FUSD to deployer`
  );
  await confirm(
    await redeemableAsset.mint(deployer.address, INITIAL_MINT_STFLOW),
    `Minted ${ethers.formatEther(INITIAL_MINT_STFLOW)} stFLOW to deployer`
  );

  // ─── 7. Fund redemptionAdapter ────────────────────────────────────────────
  console.log("\n» Funding MockRedemptionAdapter with FUSD...");
  await confirm(
    await baseAsset.approve(c.redemptionAdapter, ADAPTER_FUND_FUSD),
    `Approved redemptionAdapter to spend ${ethers.formatEther(ADAPTER_FUND_FUSD)} FUSD`
  );
  await confirm(
    await redemptionAdapter.fundWithBase(ADAPTER_FUND_FUSD),
    `Funded adapter with ${ethers.formatEther(ADAPTER_FUND_FUSD)} FUSD`
  );

  // ─── 8. Initial vault deposit ─────────────────────────────────────────────
  console.log("\n» Making initial deposit to AxiomVault...");
  await confirm(
    await baseAsset.approve(c.vault, TEST_DEPOSIT_FUSD),
    `Approved vault for ${ethers.formatEther(TEST_DEPOSIT_FUSD)} FUSD`
  );
  const depositTx = await vault.deposit(TEST_DEPOSIT_FUSD, deployer.address);
  const depositReceipt = await depositTx.wait();
  const sharesBalance = await vault.balanceOf(deployer.address);
  console.log(`  [OK] Deposited ${ethers.formatEther(TEST_DEPOSIT_FUSD)} FUSD`);
  console.log(`       Received ${ethers.formatEther(sharesBalance)} axFUSD shares`);

  // ─── 9. Verify configuration ──────────────────────────────────────────────
  console.log("\n» Verifying post-config state...");

  const totalAssets = await vault.totalAssets();
  const availLiquidity = await vault.availableLiquidity();
  log("vault.totalAssets():", `${ethers.formatEther(totalAssets)} FUSD`);
  log("vault.availableLiquidity():", `${ethers.formatEther(availLiquidity)} FUSD`);

  const swapCfg = await venue.swapConfigs(c.redeemableAsset);
  log("venue.swapConfig.supported:", swapCfg.supported.toString());
  log("venue.swapConfig.discountBps:", swapCfg.discountBps.toString());

  const hasStratRole = await vault.hasRole(STRATEGY_MANAGER_ROLE, c.strategyManager);
  const hasVenueRole = await vault.hasRole(VENUE_ROLE, c.venue);
  log("vault: STRATEGY_MANAGER_ROLE set:", hasStratRole.toString());
  log("vault: VENUE_ROLE set:", hasVenueRole.toString());

  console.log("\n=== Configuration complete ===");
  console.log("\nYou can now:");
  console.log("  • Call venue.swapRedeemableForBase(stFLOW, amount, minOut, receiver)");
  console.log("  • Call strategyManager.allocateToYield(amount)");
  console.log("  • Wait 300s, then call strategyManager.claimRedemption(requestId)");
  console.log("  • Point Eisen at AxiomFactory:", c.axiomFactory);
  console.log(`    getPair(${c.baseAsset}, ${c.redeemableAsset}) => ${c.pair}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
