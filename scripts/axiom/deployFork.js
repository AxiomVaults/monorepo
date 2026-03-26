// scripts/deployFork.js
// Fresh deploy of Axiom Vaults on the Flow EVM mainnet fork.
// All real protocol addresses (ankrFLOW, MORE, PunchSwap) are live on the fork.
//
// Usage:
//   # With fork running (node_modules/.bin/hardhat node --fork https://mainnet.evm.nodes.onflow.org):
//   node_modules/.bin/hardhat run scripts/deployFork.js --network flowFork
//
// Saves output to scripts/deployed-fork.json

const { ethers } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// ─── Real addresses (Flow EVM mainnet, also live on the fork) ─────────────────

const REAL = {
  WFLOW:            "0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e",
  ANKR_FLOW:        "0x1b97100eA1D7126C4d60027e231EA4CB25314bdb",
  ANKR_STAKING:     "0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a",
  MORE_POOL:        "0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d",
  MORE_DATA_PROV:   "0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf",
  PUNCHSWAP_ROUTER: "0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d",
  STG_USDC:         "0xF1815bd50389c46847f0Bda824eC8da914045D14",
};

const CONFIG = {
  vault:                 { name: "Axiom Vault WFLOW", symbol: "axWFLOW" },
  ankrYieldAdapter:      { maxSlippageBps: 100 },
  ankrMOREYieldAdapter:  { borrowFractionBps: 6_000, maxSlippageBps: 100 },
  ankrRedemptionAdapter: { claimDelay: 120, maxSlippageBps: 100 }, // 120s for fork testing
  pair:                  { discountBps: 20 },
};

function log(label, address) {
  console.log(`  ${label.padEnd(34)} ${address}`);
}

async function deploy(factory, ...args) {
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log("\n=== Axiom Vaults — Fork Deploy (Flow EVM mainnet fork) ===");
  console.log(`  Network:   ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer:  ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:   ${ethers.formatEther(bal)} FLOW\n`);

  const d = {};

  // ─── 1. AxiomVault ──────────────────────────────────────────────────────
  console.log("» Deploying AxiomVault...");
  const Vault = await ethers.getContractFactory("AxiomVault");
  const vault = await deploy(Vault, REAL.WFLOW, CONFIG.vault.name, CONFIG.vault.symbol);
  d.vault = await vault.getAddress();
  log("AxiomVault:", d.vault);

  // ─── 2. StrategyManager ─────────────────────────────────────────────────
  console.log("» Deploying StrategyManager...");
  const SM = await ethers.getContractFactory("StrategyManager");
  const sm = await deploy(SM, d.vault, REAL.WFLOW);
  d.strategyManager = await sm.getAddress();
  log("StrategyManager:", d.strategyManager);

  // ─── 3. AnkrYieldAdapter ────────────────────────────────────────────────
  console.log("» Deploying AnkrYieldAdapter...");
  const AYA = await ethers.getContractFactory("AnkrYieldAdapter");
  const aya = await deploy(
    AYA,
    REAL.WFLOW, REAL.ANKR_FLOW, REAL.ANKR_STAKING, REAL.PUNCHSWAP_ROUTER,
    CONFIG.ankrYieldAdapter.maxSlippageBps
  );
  d.ankrYieldAdapter = await aya.getAddress();
  log("AnkrYieldAdapter:", d.ankrYieldAdapter);

  // ─── 4. AnkrMOREYieldAdapter ────────────────────────────────────────────
  console.log("» Deploying AnkrMOREYieldAdapter...");
  const AMYA = await ethers.getContractFactory("AnkrMOREYieldAdapter");
  const amya = await deploy(
    AMYA,
    REAL.WFLOW, REAL.ANKR_FLOW, REAL.ANKR_STAKING,
    REAL.MORE_POOL, REAL.MORE_DATA_PROV, REAL.PUNCHSWAP_ROUTER, REAL.STG_USDC,
    CONFIG.ankrMOREYieldAdapter.borrowFractionBps,
    CONFIG.ankrMOREYieldAdapter.maxSlippageBps
  );
  d.ankrMOREYieldAdapter = await amya.getAddress();
  log("AnkrMOREYieldAdapter:", d.ankrMOREYieldAdapter);

  // ─── 5. AnkrRedemptionAdapter ───────────────────────────────────────────
  console.log("» Deploying AnkrRedemptionAdapter...");
  const ARA = await ethers.getContractFactory("AnkrRedemptionAdapter");
  const ara = await deploy(
    ARA,
    REAL.ANKR_FLOW, REAL.WFLOW, REAL.PUNCHSWAP_ROUTER,
    CONFIG.ankrRedemptionAdapter.claimDelay,
    CONFIG.ankrRedemptionAdapter.maxSlippageBps
  );
  d.ankrRedemptionAdapter = await ara.getAddress();
  log("AnkrRedemptionAdapter:", d.ankrRedemptionAdapter);

  // ─── 6. AxiomVenue ──────────────────────────────────────────────────────
  console.log("» Deploying AxiomVenue...");
  const Venue = await ethers.getContractFactory("AxiomVenue");
  const venue = await deploy(Venue, d.vault, d.strategyManager);
  d.venue = await venue.getAddress();
  log("AxiomVenue:", d.venue);

  // ─── 7. AxiomFactory ────────────────────────────────────────────────────
  console.log("» Deploying AxiomFactory...");
  const Factory = await ethers.getContractFactory("AxiomFactory");
  const factory = await deploy(Factory);
  d.axiomFactory = await factory.getAddress();
  log("AxiomFactory:", d.axiomFactory);

  // ─── 8. AxiomUniV2Pair ──────────────────────────────────────────────────
  console.log("» Deploying AxiomUniV2Pair (WFLOW/ankrFLOW)...");
  const Pair = await ethers.getContractFactory("AxiomUniV2Pair");
  const pair = await deploy(
    Pair,
    d.axiomFactory, REAL.WFLOW, REAL.ANKR_FLOW,
    d.venue, d.vault,
    CONFIG.pair.discountBps
  );
  d.pair = await pair.getAddress();
  log("AxiomUniV2Pair:", d.pair);

  // ─── 9. Configure ───────────────────────────────────────────────────────
  console.log("\n=== Configuring roles & adapters ===\n");

  const STRATEGY_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STRATEGY_MANAGER_ROLE"));
  const VENUE_ROLE            = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));

  const vaultC   = await ethers.getContractAt("AxiomVault",      d.vault,           deployer);
  const smC      = await ethers.getContractAt("StrategyManager", d.strategyManager,  deployer);
  const factoryC = await ethers.getContractAt("AxiomFactory",    d.axiomFactory,    deployer);

  console.log("» Vault: grant STRATEGY_MANAGER_ROLE → StrategyManager");
  await (await vaultC.grantRole(STRATEGY_MANAGER_ROLE, d.strategyManager)).wait();

  console.log("» Vault: grant VENUE_ROLE → StrategyManager");
  await (await vaultC.grantRole(VENUE_ROLE, d.strategyManager)).wait();

  console.log("» StrategyManager: set AnkrMOREYieldAdapter");
  await (await smC.setYieldAdapter(d.ankrMOREYieldAdapter)).wait();

  console.log("» StrategyManager: set AnkrRedemptionAdapter");
  await (await smC.setRedemptionAdapter(d.ankrRedemptionAdapter)).wait();

  console.log("» StrategyManager: grant VENUE_ROLE → AxiomVenue");
  await (await smC.grantRole(VENUE_ROLE, d.venue)).wait();

  console.log("» AxiomFactory: register pair (WFLOW/ankrFLOW)");
  await (await factoryC.registerPair(REAL.WFLOW, REAL.ANKR_FLOW, d.pair)).wait();

  console.log("\n=== ✓ All done ===\n");

  // ─── 10. Print summary ─────────────────────────────────────────────────
  console.log("─── Real Token Addresses (Flow EVM mainnet / fork) ───");
  log("WFLOW:",            REAL.WFLOW);
  log("ankrFLOW:",         REAL.ANKR_FLOW);
  log("Ankr Staking:",     REAL.ANKR_STAKING);
  log("MORE Pool:",        REAL.MORE_POOL);
  log("MORE DataProvider:",REAL.MORE_DATA_PROV);
  log("PunchSwap Router:", REAL.PUNCHSWAP_ROUTER);
  log("stgUSDC:",          REAL.STG_USDC);

  console.log("\n─── Deployed Contracts ───");
  log("AxiomVault:",            d.vault);
  log("StrategyManager:",       d.strategyManager);
  log("AnkrYieldAdapter:",      d.ankrYieldAdapter);
  log("AnkrMOREYieldAdapter:",  d.ankrMOREYieldAdapter);
  log("AnkrRedemptionAdapter:", d.ankrRedemptionAdapter);
  log("AxiomVenue:",            d.venue);
  log("AxiomFactory:",          d.axiomFactory);
  log("AxiomUniV2Pair:",        d.pair);

  console.log("\n─── Strategy ───");
  console.log("  baseAsset:   WFLOW (real wrapped FLOW)");
  console.log("  yield:       AnkrMOREYieldAdapter — 60% borrow fraction / 1-loop leverage");
  console.log("  redemption:  AnkrRedemptionAdapter — PunchSwap + 120s delay (fork test)");

  // ─── 11. Save output ──────────────────────────────────────────────────
  const outPath = path.join(__dirname, "deployed-fork.json");
  const output = {
    network:   network.name,
    chainId:   network.chainId.toString(),
    deployer:  deployer.address,
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
      baseAsset:             REAL.WFLOW,
      redeemableAsset:       REAL.ANKR_FLOW,
      vault:                 d.vault,
      strategyManager:       d.strategyManager,
      ankrYieldAdapter:      d.ankrYieldAdapter,
      ankrMOREYieldAdapter:  d.ankrMOREYieldAdapter,
      ankrRedemptionAdapter: d.ankrRedemptionAdapter,
      venue:                 d.venue,
      axiomFactory:          d.axiomFactory,
      pair:                  d.pair,
    },
    config: {
      vault:                 CONFIG.vault,
      ankrYieldAdapter:      CONFIG.ankrYieldAdapter,
      ankrMOREYieldAdapter:  CONFIG.ankrMOREYieldAdapter,
      ankrRedemptionAdapter: CONFIG.ankrRedemptionAdapter,
      pair:                  CONFIG.pair,
    },
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved → ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
