// scripts/axiom/deployMetaFork.js
// Deploy the Axiom meta-vault system on a Flow EVM mainnet fork.
//
// What this deploys (in order):
//   1.  AxiomVault               — ERC-4626 capital owner
//   2.  MultiStrategyManager     — multi-adapter yield router (replaces StrategyManager)
//   3.  AnkrYieldAdapter         — plain ankrFLOW staking (~7% APY)
//   4.  AnkrMOREYieldAdapter     — leveraged staking via MORE Markets (~12% APY)
//   5.  MORELendingAdapter       — plain WFLOW supply on MORE Markets (~6% APY)
//   6.  PunchSwapLPAdapter       — ankrFLOW/WFLOW LP farming on PunchSwap (~4% APY)
//   7.  AnkrRedemptionAdapter    — handles async ankrFLOW redemptions
//   8.  AxiomVenue               — spread-capture router (user-facing swap pair front-end)
//   9.  AxiomFactory             — pair registry
//   10. AxiomUniV2Pair           — WFLOW/ankrFLOW pair (venue integration)
//
// Usage:
//   # Start fork:
//   node_modules/.bin/hardhat node --fork https://mainnet.evm.nodes.onflow.org
//   # Deploy:
//   node_modules/.bin/hardhat run scripts/axiom/deployMetaFork.js --network flowFork
//
// Output saved to scripts/axiom/deployed-meta-fork.json

const { ethers } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// ─── Mainnet addresses (also live on fork) ────────────────────────────────────

const REAL = {
  WFLOW:              "0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e",
  ANKR_FLOW:          "0x1b97100eA1D7126C4d60027e231EA4CB25314bdb",
  ANKR_STAKING:       "0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a",
  MORE_POOL:          "0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d",
  MORE_DATA_PROV:     "0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf",
  PUNCHSWAP_ROUTER:   "0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d",
  PUNCHSWAP_LP_PAIR:  "0x442aE0F33d66F617AF9106e797fc251B574aEdb3", // ankrFLOW/WFLOW V2 pair (PunchSwap factory: 0x29372c22459a4e373851798bFd6808e71EA34A71)
  STG_USDC:           "0xF1815bd50389c46847f0Bda824eC8da914045D14",
};

const CONFIG = {
  vault: { name: "Axiom Vault WFLOW", symbol: "axWFLOW" },
  ankrMORE: { borrowFractionBps: 6_000, maxSlippageBps: 100 },
  ankrYield: { maxSlippageBps: 100 },
  moreLending: {},
  punchSwapLP: { maxSlippageBps: 200 }, // slightly higher for LP entry/exit
  redemption:  { claimDelay: 120, maxSlippageBps: 100 }, // 120s for fork testing
  pair: { discountBps: 20 },

  // Initial APY hints (bps) — updated by keeper bot in production
  apy: {
    ankrMORE:   1_200, // 12.00% — leveraged staking + borrow spread
    ankrYield:    700, //  7.00% — plain ankrFLOW staking
    moreLending:  600, //  6.00% — WFLOW supply on MORE Markets
    punchSwapLP:  400, //  4.00% — LP fees (net of impermanent loss)
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(label, address) {
  console.log(`  ${label.padEnd(36)} ${address}`);
}

async function deploy(factory, ...args) {
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     Axiom Meta-Vault Deploy — Flow EVM mainnet fork          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Network:   ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer:  ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance:   ${ethers.formatEther(bal)} FLOW\n`);

  const d = {};

  // ─── 1. AxiomVault ──────────────────────────────────────────────────────
  console.log("» [1/10] Deploying AxiomVault...");
  const Vault = await ethers.getContractFactory("AxiomVault");
  const vault = await deploy(Vault, REAL.WFLOW, CONFIG.vault.name, CONFIG.vault.symbol);
  d.vault = await vault.getAddress();
  log("AxiomVault:", d.vault);

  // ─── 2. MultiStrategyManager ────────────────────────────────────────────
  console.log("» [2/10] Deploying MultiStrategyManager...");
  const MSM = await ethers.getContractFactory("MultiStrategyManager");
  const msm = await deploy(MSM, d.vault, REAL.WFLOW);
  d.multiStrategyManager = await msm.getAddress();
  log("MultiStrategyManager:", d.multiStrategyManager);

  // ─── 3. AnkrYieldAdapter ────────────────────────────────────────────────
  console.log("» [3/10] Deploying AnkrYieldAdapter...");
  const AYA = await ethers.getContractFactory("AnkrYieldAdapter");
  const aya = await deploy(
    AYA,
    REAL.WFLOW, REAL.ANKR_FLOW, REAL.ANKR_STAKING, REAL.PUNCHSWAP_ROUTER,
    CONFIG.ankrYield.maxSlippageBps
  );
  d.ankrYieldAdapter = await aya.getAddress();
  log("AnkrYieldAdapter:", d.ankrYieldAdapter);

  // ─── 4. AnkrMOREYieldAdapter ────────────────────────────────────────────
  console.log("» [4/10] Deploying AnkrMOREYieldAdapter...");
  const AMYA = await ethers.getContractFactory("AnkrMOREYieldAdapter");
  const amya = await deploy(
    AMYA,
    REAL.WFLOW, REAL.ANKR_FLOW, REAL.ANKR_STAKING,
    REAL.MORE_POOL, REAL.MORE_DATA_PROV, REAL.PUNCHSWAP_ROUTER, REAL.STG_USDC,
    CONFIG.ankrMORE.borrowFractionBps,
    CONFIG.ankrMORE.maxSlippageBps
  );
  d.ankrMOREYieldAdapter = await amya.getAddress();
  log("AnkrMOREYieldAdapter:", d.ankrMOREYieldAdapter);

  // ─── 5. MORELendingAdapter ──────────────────────────────────────────────
  console.log("» [5/10] Deploying MORELendingAdapter...");
  const MLA = await ethers.getContractFactory("MORELendingAdapter");
  const mla = await deploy(MLA, REAL.WFLOW, REAL.MORE_POOL, REAL.MORE_DATA_PROV);
  d.moreLendingAdapter = await mla.getAddress();
  log("MORELendingAdapter:", d.moreLendingAdapter);

  // ─── 6. PunchSwapLPAdapter ──────────────────────────────────────────────
  console.log("» [6/10] Deploying PunchSwapLPAdapter...");
  const PSLA = await ethers.getContractFactory("PunchSwapLPAdapter");
  const psla = await deploy(
    PSLA,
    REAL.WFLOW, REAL.ANKR_FLOW, REAL.PUNCHSWAP_LP_PAIR, REAL.PUNCHSWAP_ROUTER,
    CONFIG.punchSwapLP.maxSlippageBps
  );
  d.punchSwapLPAdapter = await psla.getAddress();
  log("PunchSwapLPAdapter:", d.punchSwapLPAdapter);

  // ─── 7. AnkrRedemptionAdapter ───────────────────────────────────────────
  console.log("» [7/10] Deploying AnkrRedemptionAdapter...");
  const ARA = await ethers.getContractFactory("AnkrRedemptionAdapter");
  const ara = await deploy(
    ARA,
    REAL.ANKR_FLOW, REAL.WFLOW, REAL.PUNCHSWAP_ROUTER,
    CONFIG.redemption.claimDelay,
    CONFIG.redemption.maxSlippageBps
  );
  d.ankrRedemptionAdapter = await ara.getAddress();
  log("AnkrRedemptionAdapter:", d.ankrRedemptionAdapter);

  // ─── 8. AxiomVenue ──────────────────────────────────────────────────────
  console.log("» [8/10] Deploying AxiomVenue...");
  const Venue = await ethers.getContractFactory("AxiomVenue");
  const venue = await deploy(Venue, d.vault, d.multiStrategyManager);
  d.venue = await venue.getAddress();
  log("AxiomVenue:", d.venue);

  // ─── 9. AxiomFactory ────────────────────────────────────────────────────
  console.log("» [9/10] Deploying AxiomFactory...");
  const Factory = await ethers.getContractFactory("AxiomFactory");
  const factory = await deploy(Factory);
  d.axiomFactory = await factory.getAddress();
  log("AxiomFactory:", d.axiomFactory);

  // ─── 10. AxiomUniV2Pair ─────────────────────────────────────────────────
  console.log("» [10/10] Deploying AxiomUniV2Pair (WFLOW/ankrFLOW)...");
  const Pair = await ethers.getContractFactory("AxiomUniV2Pair");
  const pair = await deploy(
    Pair,
    d.axiomFactory, REAL.WFLOW, REAL.ANKR_FLOW,
    d.venue, d.vault,
    CONFIG.pair.discountBps
  );
  d.pair = await pair.getAddress();
  log("AxiomUniV2Pair:", d.pair);

  // ─── Configure ──────────────────────────────────────────────────────────
  console.log("\n=== Configuring roles, adapters, ownership ===\n");

  const STRATEGY_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("STRATEGY_MANAGER_ROLE"));
  const VENUE_ROLE            = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));
  const OPERATOR_ROLE         = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

  const vaultC   = await ethers.getContractAt("AxiomVault",           d.vault,                deployer);
  const msmC     = await ethers.getContractAt("MultiStrategyManager",  d.multiStrategyManager, deployer);
  const factoryC = await ethers.getContractAt("AxiomFactory",          d.axiomFactory,         deployer);
  const ayaC     = await ethers.getContractAt("AnkrYieldAdapter",      d.ankrYieldAdapter,     deployer);
  const amyaC    = await ethers.getContractAt("AnkrMOREYieldAdapter",  d.ankrMOREYieldAdapter, deployer);
  const mlaC     = await ethers.getContractAt("MORELendingAdapter",     d.moreLendingAdapter,   deployer);
  const pslaC    = await ethers.getContractAt("PunchSwapLPAdapter",     d.punchSwapLPAdapter,   deployer);

  // Vault roles
  console.log("» Vault: grant STRATEGY_MANAGER_ROLE → MultiStrategyManager");
  await (await vaultC.grantRole(STRATEGY_MANAGER_ROLE, d.multiStrategyManager)).wait();

  console.log("» Vault: grant VENUE_ROLE → MultiStrategyManager");
  await (await vaultC.grantRole(VENUE_ROLE, d.multiStrategyManager)).wait();

  // Transfer adapter ownership to MultiStrategyManager so it can call deposit/withdraw
  // (AnkrYieldAdapter and AnkrMOREYieldAdapter use AccessControl, not Ownable — handled via roles below)
  console.log("» MORELendingAdapter: transfer ownership → MultiStrategyManager");
  await (await mlaC.transferOwnership(d.multiStrategyManager)).wait();

  console.log("» PunchSwapLPAdapter: transfer ownership → MultiStrategyManager");
  await (await pslaC.transferOwnership(d.multiStrategyManager)).wait();

  // For AnkrYieldAdapter and AnkrMOREYieldAdapter (which use AccessControl):
  // Grant OPERATOR_ROLE to MultiStrategyManager so it can call deposit/withdraw
  // (Check which role controls deposit on these adapters)
  try {
    const ADAPTER_OPERATOR = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    console.log("» AnkrYieldAdapter: grant OPERATOR_ROLE → MultiStrategyManager");
    await (await ayaC.grantRole(ADAPTER_OPERATOR, d.multiStrategyManager)).wait();

    console.log("» AnkrMOREYieldAdapter: grant OPERATOR_ROLE → MultiStrategyManager");
    await (await amyaC.grantRole(ADAPTER_OPERATOR, d.multiStrategyManager)).wait();
  } catch {
    // If adapters are Ownable rather than AccessControl, transfer ownership instead
    console.log("  (adapters appear Ownable — transferring ownership)");
    try {
      await (await ayaC.transferOwnership(d.multiStrategyManager)).wait();
      await (await amyaC.transferOwnership(d.multiStrategyManager)).wait();
    } catch (e2) {
      console.warn("  Warning: could not transfer ankr adapter ownership:", e2.message);
    }
  }

  // MultiStrategyManager: grant VENUE_ROLE → AxiomVenue
  console.log("» MultiStrategyManager: grant VENUE_ROLE → AxiomVenue");
  await (await msmC.grantRole(VENUE_ROLE, d.venue)).wait();

  // MultiStrategyManager: set redemption adapter
  console.log("» MultiStrategyManager: set AnkrRedemptionAdapter");
  await (await msmC.setRedemptionAdapter(d.ankrRedemptionAdapter)).wait();

  // Register all adapters
  console.log("\n» MultiStrategyManager: register adapters...");
  const tx0 = await msmC.registerAdapter(d.ankrMOREYieldAdapter, "ankrMORE Leveraged",   CONFIG.apy.ankrMORE);
  await tx0.wait();
  log("  [0] ankrMORE Leveraged:", d.ankrMOREYieldAdapter);

  const tx1 = await msmC.registerAdapter(d.ankrYieldAdapter, "ankrFLOW Staking", CONFIG.apy.ankrYield);
  await tx1.wait();
  log("  [1] ankrFLOW Staking:", d.ankrYieldAdapter);

  const tx2 = await msmC.registerAdapter(d.moreLendingAdapter, "MORE Lending", CONFIG.apy.moreLending);
  await tx2.wait();
  log("  [2] MORE Lending:", d.moreLendingAdapter);

  const tx3 = await msmC.registerAdapter(d.punchSwapLPAdapter, "PunchSwap LP", CONFIG.apy.punchSwapLP);
  await tx3.wait();
  log("  [3] PunchSwap LP:", d.punchSwapLPAdapter);

  // AxiomFactory: register pair
  console.log("\n» AxiomFactory: register pair (WFLOW/ankrFLOW)");
  await (await factoryC.registerPair(REAL.WFLOW, REAL.ANKR_FLOW, d.pair)).wait();

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              ✓ Meta-Vault Deploy Complete                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  console.log("\n─── Real Token Addresses ────────────────────────────────────");
  log("WFLOW:",              REAL.WFLOW);
  log("ankrFLOW:",           REAL.ANKR_FLOW);
  log("Ankr Staking:",       REAL.ANKR_STAKING);
  log("MORE Pool:",          REAL.MORE_POOL);
  log("MORE DataProvider:",  REAL.MORE_DATA_PROV);
  log("PunchSwap Router:",   REAL.PUNCHSWAP_ROUTER);
  log("PunchSwap LP Pair:",  REAL.PUNCHSWAP_LP_PAIR);

  console.log("\n─── Deployed Contracts ──────────────────────────────────────");
  log("AxiomVault:",             d.vault);
  log("MultiStrategyManager:",   d.multiStrategyManager);
  log("AnkrYieldAdapter:",       d.ankrYieldAdapter);
  log("AnkrMOREYieldAdapter:",   d.ankrMOREYieldAdapter);
  log("MORELendingAdapter:",      d.moreLendingAdapter);
  log("PunchSwapLPAdapter:",      d.punchSwapLPAdapter);
  log("AnkrRedemptionAdapter:",   d.ankrRedemptionAdapter);
  log("AxiomVenue:",              d.venue);
  log("AxiomFactory:",            d.axiomFactory);
  log("AxiomUniV2Pair:",          d.pair);

  console.log("\n─── Adapter Registry ────────────────────────────────────────");
  console.log("  ID  Name                    APY Hint   Address");
  console.log("  ─── ─────────────────────── ────────── ─────────────────────────────────────────────");
  console.log(`  [0] ankrMORE Leveraged      ${String(CONFIG.apy.ankrMORE / 100).padEnd(6)}%    ${d.ankrMOREYieldAdapter}`);
  console.log(`  [1] ankrFLOW Staking        ${String(CONFIG.apy.ankrYield / 100).padEnd(6)}%    ${d.ankrYieldAdapter}`);
  console.log(`  [2] MORE Lending            ${String(CONFIG.apy.moreLending / 100).padEnd(6)}%    ${d.moreLendingAdapter}`);
  console.log(`  [3] PunchSwap LP            ${String(CONFIG.apy.punchSwapLP / 100).padEnd(6)}%    ${d.punchSwapLPAdapter}`);

  // ─── Save output ────────────────────────────────────────────────────────
  const output = {
    network:   network.name,
    chainId:   network.chainId.toString(),
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    realTokens: {
      WFLOW:             REAL.WFLOW,
      ankrFLOW:          REAL.ANKR_FLOW,
      ankrStaking:       REAL.ANKR_STAKING,
      morePool:          REAL.MORE_POOL,
      moreDataProvider:  REAL.MORE_DATA_PROV,
      punchSwapRouter:   REAL.PUNCHSWAP_ROUTER,
      punchSwapLPPair:   REAL.PUNCHSWAP_LP_PAIR,
      stgUSDC:           REAL.STG_USDC,
    },
    contracts: {
      vault:                  d.vault,
      multiStrategyManager:   d.multiStrategyManager,
      ankrYieldAdapter:       d.ankrYieldAdapter,
      ankrMOREYieldAdapter:   d.ankrMOREYieldAdapter,
      moreLendingAdapter:      d.moreLendingAdapter,
      punchSwapLPAdapter:      d.punchSwapLPAdapter,
      ankrRedemptionAdapter:   d.ankrRedemptionAdapter,
      venue:                   d.venue,
      axiomFactory:            d.axiomFactory,
      pair:                    d.pair,
    },
    adapterRegistry: [
      { id: 0, name: "ankrMORE Leveraged", apyBps: CONFIG.apy.ankrMORE,   address: d.ankrMOREYieldAdapter },
      { id: 1, name: "ankrFLOW Staking",  apyBps: CONFIG.apy.ankrYield,   address: d.ankrYieldAdapter },
      { id: 2, name: "MORE Lending",       apyBps: CONFIG.apy.moreLending, address: d.moreLendingAdapter },
      { id: 3, name: "PunchSwap LP",       apyBps: CONFIG.apy.punchSwapLP, address: d.punchSwapLPAdapter },
    ],
    config: CONFIG,
  };

  const outPath = path.join(__dirname, "deployed-meta-fork.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved → ${outPath}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
