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

  // ─── 1. AxiomVault (baseAsset = WFLOW) ───────────────────────────────────
  console.log("» Deploying AxiomVault (base=WFLOW)...");
  const Vault = await ethers.getContractFactory("AxiomVault");
  const vault = await deploy(Vault, REAL.WFLOW, CONFIG.vault.name, CONFIG.vault.symbol);
  d.vault = await vault.getAddress();
  log("AxiomVault:", d.vault);

  // ─── 2. StrategyManager ───────────────────────────────────────────────────
  console.log("\n» Deploying StrategyManager...");
  const Manager = await ethers.getContractFactory("StrategyManager");
  const strategyManager = await deploy(Manager, d.vault, REAL.WFLOW);
  d.strategyManager = await strategyManager.getAddress();
  log("StrategyManager:", d.strategyManager);

  // ─── 3. AnkrYieldAdapter (pure staking, no leverage) ─────────────────────
  console.log("\n» Deploying AnkrYieldAdapter (pure Ankr staking)...");
  const AnkrYield = await ethers.getContractFactory(
    "contracts/axiom/adapters/AnkrYieldAdapter.sol:AnkrYieldAdapter"
  );
  const ankrYieldAdapter = await deploy(
    AnkrYield,
    REAL.WFLOW,
    REAL.ANKR_FLOW,
    REAL.ANKR_STAKING,
    REAL.PUNCHSWAP_ROUTER,
    CONFIG.ankrYieldAdapter.maxSlippageBps
  );
  d.ankrYieldAdapter = await ankrYieldAdapter.getAddress();
  log("AnkrYieldAdapter:", d.ankrYieldAdapter);

  // ─── 4. AnkrMOREYieldAdapter (1-loop leveraged) ───────────────────────────
  console.log("\n» Deploying AnkrMOREYieldAdapter (1-loop Ankr+MORE)...");
  const AnkrMOREYield = await ethers.getContractFactory(
    "contracts/axiom/adapters/AnkrMOREYieldAdapter.sol:AnkrMOREYieldAdapter"
  );
  const ankrMOREYieldAdapter = await deploy(
    AnkrMOREYield,
    REAL.WFLOW,
    REAL.ANKR_FLOW,
    REAL.ANKR_STAKING,
    REAL.MORE_POOL,
    REAL.MORE_DATA_PROV,
    REAL.PUNCHSWAP_ROUTER,
    REAL.STG_USDC,
    CONFIG.ankrMOREYieldAdapter.borrowFractionBps,
    CONFIG.ankrMOREYieldAdapter.maxSlippageBps
  );
  d.ankrMOREYieldAdapter = await ankrMOREYieldAdapter.getAddress();
  log("AnkrMOREYieldAdapter:", d.ankrMOREYieldAdapter);

  // ─── 5. AnkrRedemptionAdapter ─────────────────────────────────────────────
  console.log("\n» Deploying AnkrRedemptionAdapter (PunchSwap swap + 1h delay)...");
  const AnkrRedemption = await ethers.getContractFactory(
    "contracts/axiom/adapters/AnkrRedemptionAdapter.sol:AnkrRedemptionAdapter"
  );
  const ankrRedemptionAdapter = await deploy(
    AnkrRedemption,
    REAL.ANKR_FLOW,
    REAL.WFLOW,
    REAL.PUNCHSWAP_ROUTER,
    CONFIG.ankrRedemptionAdapter.claimDelay,
    CONFIG.ankrRedemptionAdapter.maxSlippageBps
  );
  d.ankrRedemptionAdapter = await ankrRedemptionAdapter.getAddress();
  log("AnkrRedemptionAdapter:", d.ankrRedemptionAdapter);

  // ─── 6. AxiomVenue ────────────────────────────────────────────────────────
  console.log("\n» Deploying AxiomVenue...");
  const Venue = await ethers.getContractFactory("AxiomVenue");
  const venue = await deploy(Venue, d.vault, d.strategyManager);
  d.venue = await venue.getAddress();
  log("AxiomVenue:", d.venue);

  // ─── 7. AxiomFactory + Pair ───────────────────────────────────────────────
  console.log("\n» Deploying AxiomFactory...");
  const Factory = await ethers.getContractFactory("AxiomFactory");
  const axiomFactory = await deploy(Factory);
  d.axiomFactory = await axiomFactory.getAddress();
  log("AxiomFactory:", d.axiomFactory);

  console.log("\n» Deploying AxiomUniV2Pair (WFLOW / ankrFLOW)...");
  const Pair = await ethers.getContractFactory("AxiomUniV2Pair");
  const pair = await deploy(
    Pair,
    d.vault,
    d.venue,
    REAL.WFLOW,
    REAL.ANKR_FLOW,
    CONFIG.pair.discountBps
  );
  d.pair = await pair.getAddress();
  log("AxiomUniV2Pair (WFLOW/ankrFLOW):", d.pair);

  // ─── 8. Configure: wire everything together ───────────────────────────────

  console.log("\n\n=== Configuring contracts ===\n");

  // 8a. Vault: grant STRATEGY_MANAGER_ROLE to StrategyManager
  const STRATEGY_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STRATEGY_MANAGER_ROLE"));
  const VENUE_ROLE             = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));

  console.log("» Vault: grant STRATEGY_MANAGER_ROLE → StrategyManager");
  await (await vault.grantRole(STRATEGY_MANAGER_ROLE, d.strategyManager)).wait();

  console.log("» Vault: grant VENUE_ROLE → StrategyManager");
  await (await vault.grantRole(VENUE_ROLE, d.strategyManager)).wait();

  // 8b. StrategyManager: set AnkrMOREYieldAdapter as the active yield adapter
  //     (AnkrYieldAdapter is deployed as a simpler alternative — swap in via setYieldAdapter if needed)
  console.log("» StrategyManager: set AnkrMOREYieldAdapter (active yield strategy)");
  await (await strategyManager.setYieldAdapter(d.ankrMOREYieldAdapter)).wait();

  console.log("» StrategyManager: set AnkrRedemptionAdapter");
  await (await strategyManager.setRedemptionAdapter(d.ankrRedemptionAdapter)).wait();

  // 8c. StrategyManager: grant VENUE_ROLE to AxiomVenue
  const VENUE_ROLE_SM = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));
  console.log("» StrategyManager: grant VENUE_ROLE → AxiomVenue");
  await (await strategyManager.grantRole(VENUE_ROLE_SM, d.venue)).wait();

  // 8d. AxiomVenue: set pair on factory and register it
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
