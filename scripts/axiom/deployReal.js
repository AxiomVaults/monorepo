// scripts/axiom/deployReal.js
// Deploy Axiom Vaults with REAL protocol integrations on Flow EVM Testnet.
//
// Uses:
//   - WFLOW as base asset (real wrapped FLOW token)
//   - ankrFLOW as redeemable asset (real Ankr liquid staking token)
//   - AnkrMOREYieldAdapter: 1-loop leveraged Ankr staking + MORE lending
//   - AnkrRedemptionAdapter: ankrFLOW → WFLOW via PunchSwap
//   - Same core vault stack (AxiomVault, StrategyManager, AxiomVenue, AxiomFactory)
//
// Usage:
//   npx hardhat run scripts/axiom/deployReal.js --network flowTestnet
//
// Saves output to scripts/axiom/deployed-real.json

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── Live contract addresses (Flow EVM Testnet, chainId 545) ─────────────────

const REAL = {
  WFLOW:            "0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e",
  ANKR_FLOW:        "0x1b97100eA1D7126C4d60027e231EA4CB25314bdb",
  ANKR_STAKING:     "0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a",
  MORE_POOL:        "0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d",
  MORE_DATA_PROV:   "0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf",
  PUNCHSWAP_ROUTER: "0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d",
  STG_USDC:         "0xF1815bd50389c46847f0Bda824eC8da914045D14",
};

// ─── Deployment parameters ────────────────────────────────────────────────────

const CONFIG = {
  vault: {
    name:   "Axiom Vault WFLOW",
    symbol: "axWFLOW",
  },
  ankrYieldAdapter: {
    maxSlippageBps: 100, // 1%
  },
  ankrMOREYieldAdapter: {
    borrowFractionBps: 6_000, // 60% of available capacity (conservative, HF > 2.0)
    maxSlippageBps:    100,   // 1%
  },
  ankrRedemptionAdapter: {
    claimDelay:    3_600, // 1 hour — configurable, not a 14-day unbonding wait
    maxSlippageBps: 100,  // 1%
  },
  pair: {
    discountBps: 20, // 0.20% discount on AxiomVenue swap
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(label, address) {
  console.log(`  ${label.padEnd(32)} ${address}`);
}

async function deploy(factory, ...args) {
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("\n=== Axiom Vaults — Real Protocol Deploy ===");
  console.log(`  Network:   ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer:  ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:   ${ethers.formatEther(balance)} FLOW\n`);

  const d = {}; // deployed addresses

  // Addresses already deployed in the first run (reuse to save gas)
  d.vault                = "0x1cE43d3E45303569BafaBA4C4DdEF9baf1D7a73f";
  d.strategyManager      = "0x57ed94DA86c49672c715F3e85c082A0dCee04C2d";
  d.ankrYieldAdapter     = "0x5bB2D3fe59bE0A68243d4fc8f8DD87205DeA3B18";
  d.ankrMOREYieldAdapter = "0xc78a634705663425Ed3897D655a0e2c56847aE9f";
  d.ankrRedemptionAdapter= "0x0d7Bc897aA0DD00d7C0Daed446e3A7f56d8ef8cf";
  d.venue                = "0xa1A38Caff9CfA5Bf4c54ce3C4d2A60bD5476802B";
  d.axiomFactory         = "0x9188Fd6262C8a8cd7561dE56d7C97714E1EcA89A";
  console.log("» Reusing already-deployed contracts (7/9 addresses from first run)");
  log("AxiomVault:",            d.vault);
  log("StrategyManager:",       d.strategyManager);
  log("AnkrYieldAdapter:",      d.ankrYieldAdapter);
  log("AnkrMOREYieldAdapter:",  d.ankrMOREYieldAdapter);
  log("AnkrRedemptionAdapter:", d.ankrRedemptionAdapter);
  log("AxiomVenue:",            d.venue);
  log("AxiomFactory:",          d.axiomFactory);

  console.log("\n» Deploying AxiomUniV2Pair (WFLOW / ankrFLOW)...");
  const Pair = await ethers.getContractFactory("AxiomUniV2Pair");
  const pair = await deploy(
    Pair,
    d.axiomFactory,   // factory_
    REAL.WFLOW,       // token0_  (base)
    REAL.ANKR_FLOW,   // token1_  (redeemable)
    d.venue,          // venue_
    d.vault,          // vault_
    CONFIG.pair.discountBps
  );
  d.pair = await pair.getAddress();
  log("AxiomUniV2Pair (WFLOW/ankrFLOW):", d.pair);

  // ─── 8. Configure: wire everything together ───────────────────────────────

  console.log("\n\n=== Configuring contracts ===\n");

  // Attach contract instances for config calls
  const vault           = await ethers.getContractAt("AxiomVault",      d.vault,          deployer);
  const strategyManager = await ethers.getContractAt("StrategyManager", d.strategyManager, deployer);
  const axiomFactory    = await ethers.getContractAt("AxiomFactory",    d.axiomFactory,    deployer);

  // 8a. Vault: grant STRATEGY_MANAGER_ROLE to StrategyManager
  const STRATEGY_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STRATEGY_MANAGER_ROLE"));
  const VENUE_ROLE             = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));

  console.log("» Vault: grant STRATEGY_MANAGER_ROLE → StrategyManager");
  await (await vault.grantRole(STRATEGY_MANAGER_ROLE, d.strategyManager)).wait();

  console.log("» Vault: grant VENUE_ROLE → StrategyManager");
  await (await vault.grantRole(VENUE_ROLE, d.strategyManager)).wait();

  // 8b. StrategyManager: set AnkrMOREYieldAdapter as the active yield adapter
  console.log("» StrategyManager: set AnkrMOREYieldAdapter (active yield strategy)");
  await (await strategyManager.setYieldAdapter(d.ankrMOREYieldAdapter)).wait();

  console.log("» StrategyManager: set AnkrRedemptionAdapter");
  await (await strategyManager.setRedemptionAdapter(d.ankrRedemptionAdapter)).wait();

  // 8c. StrategyManager: grant VENUE_ROLE to AxiomVenue
  const VENUE_ROLE_SM = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));
  console.log("» StrategyManager: grant VENUE_ROLE → AxiomVenue");
  await (await strategyManager.grantRole(VENUE_ROLE_SM, d.venue)).wait();

  // 8d. AxiomFactory: register pair
  console.log("» AxiomFactory: register pair (WFLOW/ankrFLOW)");
  await (await axiomFactory.registerPair(REAL.WFLOW, REAL.ANKR_FLOW, d.pair)).wait();

  console.log("\n=== All done ===\n");

  // ─── 9. Save deployment ───────────────────────────────────────────────────

  const output = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    realTokens: {
      WFLOW:        REAL.WFLOW,
      ankrFLOW:     REAL.ANKR_FLOW,
      ankrStaking:  REAL.ANKR_STAKING,
      morePool:     REAL.MORE_POOL,
      moreDataProv: REAL.MORE_DATA_PROV,
      punchSwap:    REAL.PUNCHSWAP_ROUTER,
      stgUSDC:      REAL.STG_USDC,
    },
    contracts: {
      baseAsset:             REAL.WFLOW,     // using real WFLOW directly
      redeemableAsset:       REAL.ANKR_FLOW, // using real ankrFLOW directly
      vault:                 d.vault,
      strategyManager:       d.strategyManager,
      ankrYieldAdapter:      d.ankrYieldAdapter,    // simple (no leverage)
      ankrMOREYieldAdapter:  d.ankrMOREYieldAdapter, // active (1-loop leveraged)
      ankrRedemptionAdapter: d.ankrRedemptionAdapter,
      venue:                 d.venue,
      axiomFactory:          d.axiomFactory,
      pair:                  d.pair,
    },
    config: CONFIG,
  };

  const outPath = path.join(__dirname, "deployed-real.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Deployment saved → ${outPath}`);

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("\n─── Key addresses ───────────────────────────────────────");
  for (const [k, v] of Object.entries(output.contracts)) {
    log(k + ":", v);
  }

  console.log("\n─── Strategy ────────────────────────────────────────────");
  console.log(`  baseAsset:      WFLOW  (real wrapped FLOW)`);
  console.log(`  redeemable:     ankrFLOW (real Ankr liquid staking token)`);
  console.log(`  yield:          AnkrMOREYieldAdapter — Ankr 1-loop + MORE borrow (${CONFIG.ankrMOREYieldAdapter.borrowFractionBps / 100}% borrow fraction)`);
  console.log(`  redemption:     AnkrRedemptionAdapter — instant swap on PunchSwap + ${CONFIG.ankrRedemptionAdapter.claimDelay}s delay`);
  console.log(`  simpleYield:    AnkrYieldAdapter — pure staking (no leverage, available as fallback)`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
