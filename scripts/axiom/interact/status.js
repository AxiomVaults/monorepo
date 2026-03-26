// scripts/axiom/interact/status.js
// Read-only system dashboard — prints the full state of all Axiom contracts.
//
// Usage:
//   npx hardhat run scripts/axiom/interact/status.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, f, fb, pct, row, section, divider } = require("./_contracts");

async function main() {
  const { signer, c, vault, venue, strategyManager, yieldAdapter, redemptionAdapter,
          baseAsset, redeemableAsset, axiomFactory, pair } = await loadContracts();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║         AXIOM VAULTS — SYSTEM STATUS DASHBOARD      ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Deployer: ${signer.address}`);
  console.log(`  Block:    ${await ethers.provider.getBlockNumber()}`);

  // ─── Deployer wallet balances ─────────────────────────────────────────────
  section("DEPLOYER WALLET BALANCES");
  const fusdBal   = await baseAsset.balanceOf(signer.address);
  const stflowBal = await redeemableAsset.balanceOf(signer.address);
  const sharesBal = await vault.balanceOf(signer.address);
  row("FUSD balance",    fb(fusdBal),   "FUSD");
  row("stFLOW balance",  fb(stflowBal), "stFLOW");
  row("axFUSD shares",   fb(sharesBal), "axFUSD");
  const sharesValue = sharesBal > 0n ? await vault.convertToAssets(sharesBal) : 0n;
  row("  → shares worth", fb(sharesValue), "FUSD");

  // ─── AxiomVault ───────────────────────────────────────────────────────────
  section("AXIOM VAULT  " + c.vault);
  const totalAssets     = await vault.totalAssets();
  const totalSupply     = await vault.totalSupply();
  const onHand          = await baseAsset.balanceOf(c.vault);
  const deployedYield   = await vault.totalDeployedToYield();
  const pendingRedempt  = await vault.totalPendingRedemption();
  const availLiq        = await vault.availableLiquidity();
  const reserveBuf      = await vault.reserveBufferBps();
  const maxDep          = await vault.maxTotalDeposit();
  const sharePrice      = totalSupply > 0n
    ? (Number(ethers.formatEther(totalAssets)) / Number(ethers.formatEther(totalSupply))).toFixed(8)
    : "1.00000000";

  row("totalAssets()",         fb(totalAssets),    "FUSD");
  row("  on-hand FUSD",        fb(onHand),          "FUSD");
  row("  totalDeployedToYield",fb(deployedYield),   "FUSD");
  row("  totalPendingRedempt", fb(pendingRedempt),  "FUSD");
  divider();
  row("totalSupply (shares)",  fb(totalSupply),    "axFUSD");
  row("share price",           sharePrice,          "FUSD/axFUSD");
  divider();
  row("availableLiquidity()",  fb(availLiq),        "FUSD");
  row("reserveBufferBps",      pct(reserveBuf));
  row("maxTotalDeposit",       fb(maxDep),          "FUSD");

  // ─── AxiomVenue ───────────────────────────────────────────────────────────
  section("AXIOM VENUE  " + c.venue);
  const cfg = await venue.swapConfigs(c.redeemableAsset);
  const inventory = await venue.inventoryBalances(c.redeemableAsset);
  row("stFLOW supported",     cfg.supported.toString());
  row("discountBps",          cfg.discountBps.toString() + " bps  (" + pct(cfg.discountBps) + ")");
  row("maxSwapSize",          fb(cfg.maxSwapSize),    "stFLOW");
  row("maxInventory",         fb(cfg.maxInventory),   "stFLOW");
  row("stFLOW inventory",     fb(inventory),          "stFLOW (pending flush)");
  const sampleQuote = await venue.getQuote(c.redeemableAsset, ethers.parseEther("1000"));
  row("getQuote(1000 stFLOW)",fb(sampleQuote),        "FUSD");

  // ─── StrategyManager ─────────────────────────────────────────────────────
  section("STRATEGY MANAGER  " + c.strategyManager);
  const ymSet = await strategyManager.yieldAdapter();
  const rmSet = await strategyManager.redemptionAdapter();
  const targetBuf = await strategyManager.targetReserveBufferBps();
  row("yieldAdapter set",      ymSet === c.yieldAdapter ? "YES" : "NO (!)");
  row("redemptionAdapter set", rmSet === c.redemptionAdapter ? "YES" : "NO (!)");
  row("targetReserveBufferBps",pct(targetBuf));

  // ─── MockYieldAdapter ─────────────────────────────────────────────────────
  section("MOCK YIELD ADAPTER  " + c.yieldAdapter);
  const principal    = await yieldAdapter.principalDeposited();
  const totalUnderly = await yieldAdapter.totalUnderlying();
  const aprBps       = await yieldAdapter.aprBps();
  const lastHarvest  = await yieldAdapter.lastHarvestTimestamp();
  const pendingYield = totalUnderly > principal ? totalUnderly - principal : 0n;
  row("principalDeposited",   fb(principal),    "FUSD");
  row("totalUnderlying()",    fb(totalUnderly), "FUSD");
  row("pending yield (view)", fb(pendingYield), "FUSD");
  row("APR",                  pct(aprBps));
  row("lastHarvest",          new Date(Number(lastHarvest) * 1000).toISOString());

  // ─── MockRedemptionAdapter ────────────────────────────────────────────────
  section("MOCK REDEMPTION ADAPTER  " + c.redemptionAdapter);
  const totalPending = await redemptionAdapter.totalPending();
  const claimDelay  = await redemptionAdapter.claimDelay();
  const adapterFusd = await baseAsset.balanceOf(c.redemptionAdapter);
  const nextReqId   = await redemptionAdapter.nextRequestId();
  row("totalPending (rToken)", fb(totalPending), "stFLOW");
  row("FUSD reserve for claims",fb(adapterFusd), "FUSD");
  row("claimDelay",             claimDelay.toString() + "s");
  row("next requestId",         nextReqId.toString());

  // Print any pending requests
  if (nextReqId > 0n) {
    console.log("\n  Pending redemption requests:");
    for (let i = 0n; i < nextReqId; i++) {
      const req = await redemptionAdapter.requests(i);
      const claimableAt = Number(req.timestamp) + Number(claimDelay);
      const now = Math.floor(Date.now() / 1000);
      const status = req.claimed ? "CLAIMED" : now >= claimableAt ? "READY TO CLAIM ✓" : `locked ${claimableAt - now}s remaining`;
      console.log(`    [${i}] amount=${fb(req.amount)} stFLOW  status=${status}`);
    }
  }

  // ─── AxiomUniV2Pair ───────────────────────────────────────────────────────
  section("AXIOM UNIV2 PAIR  " + c.pair);
  const token0   = await pair.token0();
  const token1   = await pair.token1();
  const reserves = await pair.getReserves();
  const discBps  = await pair.discountBps();
  const impliedPrice = reserves[1] > 0n
    ? (Number(ethers.formatEther(reserves[0])) / Number(ethers.formatEther(reserves[1]))).toFixed(8)
    : "0";
  row("token0 (base, receive)", token0 === c.baseAsset ? "FUSD ✓" : token0);
  row("token1 (rToken, send)",  token1 === c.redeemableAsset ? "stFLOW ✓" : token1);
  row("reserve0 (FUSD)",        fb(reserves[0]),  "FUSD (virtual)");
  row("reserve1 (stFLOW)",      fb(reserves[1]),  "stFLOW (virtual)");
  row("implied price",          impliedPrice,     "FUSD per stFLOW");
  row("discountBps",            discBps.toString() + " bps");

  // ─── AxiomFactory ─────────────────────────────────────────────────────────
  section("AXIOM FACTORY  " + c.axiomFactory);
  const pairCount  = await axiomFactory.allPairsLength();
  const registeredPair = await axiomFactory.getPair(c.baseAsset, c.redeemableAsset);
  row("total pairs registered", pairCount.toString());
  row("getPair(FUSD, stFLOW)",  registeredPair === c.pair ? registeredPair + " ✓" : registeredPair);

  console.log("\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
