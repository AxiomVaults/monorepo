// scripts/axiom/interact-real/status.js
// Read-only dashboard — full state of the real Axiom deployment.
//
// Usage:
//   npx hardhat run scripts/axiom/interact-real/status.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, fb, pct, hf, row, section, divider } = require("./_contracts");

async function main() {
  const { signer, c, rt, vault, venue, strategyManager,
          ankrMOREYieldAdapter, ankrRedemptionAdapter,
          wflow, ankrFlow, pair, morePool, moreDataProv } = await loadContracts();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║        AXIOM VAULTS (REAL) — SYSTEM STATUS DASHBOARD      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`  Deployer:   ${signer.address}`);
  console.log(`  Block:      ${await ethers.provider.getBlockNumber()}`);

  // ─── Wallet balances ──────────────────────────────────────────────────────
  section("DEPLOYER WALLET BALANCES");
  const flowBal     = await ethers.provider.getBalance(signer.address);
  const wflowBal    = await wflow.balanceOf(signer.address);
  const ankrBal     = await ankrFlow.balanceOf(signer.address);
  const sharesBal   = await vault.balanceOf(signer.address);
  row("Native FLOW",        fb(flowBal),       "FLOW");
  row("WFLOW",              fb(wflowBal),       "WFLOW");
  row("ankrFLOW",           fb(ankrBal),        "ankrFLOW");
  row("axWFLOW shares",     fb(sharesBal),      "axWFLOW");
  if (sharesBal > 0n) {
    const worth = await vault.convertToAssets(sharesBal);
    row("  → shares worth", fb(worth),          "WFLOW");
  }

  // ─── AxiomVault ───────────────────────────────────────────────────────────
  section("AXIOM VAULT  " + c.vault);
  const totalAssets    = await vault.totalAssets();
  const totalSupply    = await vault.totalSupply();
  const onHand         = await wflow.balanceOf(c.vault);
  const deployedYield  = await vault.totalDeployedToYield();
  const pendingRed     = await vault.totalPendingRedemption();
  const availLiq       = await vault.availableLiquidity();
  const reserveBuf     = await vault.reserveBufferBps();
  const sharePrice     = totalSupply > 0n
    ? (Number(ethers.formatEther(totalAssets)) / Number(ethers.formatEther(totalSupply))).toFixed(8)
    : "1.00000000";
  row("totalAssets()",           fb(totalAssets),   "WFLOW");
  row("  on-hand WFLOW",         fb(onHand),         "WFLOW");
  row("  totalDeployedToYield",  fb(deployedYield),  "WFLOW");
  row("  totalPendingRedemption",fb(pendingRed),      "WFLOW");
  divider();
  row("totalSupply (shares)",    fb(totalSupply),    "axWFLOW");
  row("share price",             sharePrice,          "WFLOW/axWFLOW");
  divider();
  row("availableLiquidity()",    fb(availLiq),        "WFLOW");
  row("reserveBufferBps",        pct(reserveBuf));

  // ─── AxiomVenue ───────────────────────────────────────────────────────────
  section("AXIOM VENUE  " + c.venue);
  const cfg = await venue.swapConfigs(c.redeemableAsset);
  const inventory = await venue.inventoryBalances(c.redeemableAsset);
  row("ankrFLOW supported",    cfg.supported.toString());
  row("discountBps",           cfg.discountBps.toString() + " bps");
  row("ankrFLOW inventory",    fb(inventory),        "ankrFLOW (pending flush)");
  if (cfg.supported) {
    try {
      const q = await venue.getQuote(c.redeemableAsset, ethers.parseEther("1"));
      row("getQuote(1 ankrFLOW)", fb(q),              "WFLOW");
    } catch { row("getQuote", "not configured yet"); }
  }

  // ─── StrategyManager ─────────────────────────────────────────────────────
  section("STRATEGY MANAGER  " + c.strategyManager);
  const ymSet  = await strategyManager.yieldAdapter();
  const rmSet  = await strategyManager.redemptionAdapter();
  const tgtBuf = await strategyManager.targetReserveBufferBps();
  row("yieldAdapter",       ymSet === c.ankrMOREYieldAdapter ? "AnkrMOREYieldAdapter ✓" : ymSet);
  row("redemptionAdapter",  rmSet === c.ankrRedemptionAdapter ? "AnkrRedemptionAdapter ✓" : rmSet);
  row("targetReserveBufferBps", pct(tgtBuf));

  // ─── AnkrMOREYieldAdapter ─────────────────────────────────────────────────
  section("ANKR-MORE YIELD ADAPTER  " + c.ankrMOREYieldAdapter);
  try {
    const tu      = await ankrMOREYieldAdapter.totalUnderlying();
    const hfVal   = await ankrMOREYieldAdapter.healthFactor();
    const bfBps   = await ankrMOREYieldAdapter.borrowFractionBps();
    const slipBps = await ankrMOREYieldAdapter.maxSlippageBps();
    const wflowBuf= await wflow.balanceOf(c.ankrMOREYieldAdapter);
    const ankrHeld= await ankrFlow.balanceOf(c.ankrMOREYieldAdapter);

    row("totalUnderlying()",  fb(tu),     "WFLOW");
    row("WFLOW buffer (repay)", fb(wflowBuf), "WFLOW");
    row("ankrFLOW held",     fb(ankrHeld), "ankrFLOW");
    row("healthFactor()",    hfVal === 0n ? "∞ (no position)" : hf(hfVal));
    row("borrowFractionBps", pct(bfBps));
    row("maxSlippageBps",    pct(slipBps));

    // MORE position details
    const [ankrAToken,,,,,,,,] = await moreDataProv.getUserReserveData(c.redeemableAsset, c.ankrMOREYieldAdapter);
    const [,, wflowDebt,,,,,,] = await moreDataProv.getUserReserveData(c.baseAsset, c.ankrMOREYieldAdapter);
    divider();
    row("  ankrFLOW in MORE (aToken)", fb(ankrAToken), "ankrFLOW");
    row("  variable WFLOW debt",       fb(wflowDebt),   "WFLOW");
  } catch (e) {
    row("status", "no position opened yet");
  }

  // ─── AnkrRedemptionAdapter ────────────────────────────────────────────────
  section("ANKR REDEMPTION ADAPTER  " + c.ankrRedemptionAdapter);
  const totalPend  = await ankrRedemptionAdapter.totalPending();
  const claimDelay = await ankrRedemptionAdapter.claimDelay();
  const nextId     = await ankrRedemptionAdapter.nextRequestId();
  const adapterBal = await wflow.balanceOf(c.ankrRedemptionAdapter);
  row("totalPending()",    fb(totalPend),   "WFLOW");
  row("WFLOW balance",     fb(adapterBal),  "WFLOW (locked for claims)");
  row("totalRequests",     nextId.toString());
  row("claimDelay",        claimDelay.toString() + "s  (" + (Number(claimDelay) / 3600).toFixed(2) + "h)");

  // ─── AxiomUniV2Pair ───────────────────────────────────────────────────────
  section("AXIOM UNIV2 PAIR (WFLOW/ankrFLOW)  " + c.pair);
  try {
    const [r0, r1] = await pair.getReserves();
    const d0 = await pair.discountBps();
    row("reserve0 (WFLOW)",   fb(r0),  "WFLOW");
    row("reserve1 (ankrFLOW)",fb(r1),  "ankrFLOW");
    row("discountBps",        d0.toString() + " bps");
  } catch {
    row("reserves", "not yet initialized");
  }

  // ─── MORE position summary for adapter ───────────────────────────────────
  section("MORE ACCOUNT DATA (ADAPTER)");
  try {
    const [col, debt, avail,,, hfRaw] = await morePool.getUserAccountData(c.ankrMOREYieldAdapter);
    row("totalCollateralBase (USD·1e8)", col.toString());
    row("totalDebtBase (USD·1e8)",       debt.toString());
    row("availableBorrowsBase",          avail.toString());
    row("healthFactor",   hfRaw === 0n ? "∞" : hf(hfRaw));
  } catch {
    row("no position", "open yet");
  }

  console.log("");
}

main().catch(console.error);
