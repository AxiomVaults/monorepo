// scripts/axiom/interact-real/setupVenue.js
// Configure AxiomVenue to accept ankrFLOW swaps.
// Pairs the venue with the real WFLOW/ankrFLOW market.
//
// Usage:
//   npx hardhat run scripts/axiom/interact-real/setupVenue.js --network flowTestnet

const { ethers } = require("hardhat");
const { loadContracts, row, section, pass } = require("./_contracts");

async function main() {
  const { signer, c, vault, venue, pair } = await loadContracts();

  console.log("\n=== SETUP AXIOM VENUE (real ankrFLOW) ===\n");

  // ─── 1. Configure ankrFLOW swap on venue ──────────────────────────────────
  section("STEP 1: CONFIGURE SWAP (ankrFLOW → WFLOW @ 20bps discount)");

  // Check if already configured
  const cfg = await venue.swapConfigs(c.redeemableAsset);
  if (cfg.supported) {
    console.log("  Already configured. Current settings:");
    row("discountBps",  cfg.discountBps.toString() + " bps");
    row("maxSwapSize",  ethers.formatEther(cfg.maxSwapSize) + " ankrFLOW");
    row("maxInventory", ethers.formatEther(cfg.maxInventory) + " ankrFLOW");

    // If discountBps already matches target, skip
    if (cfg.discountBps.toString() === "20") {
      console.log("  Already configured correctly — skipping.\n");
      return;
    }
  }

  // configureSwap(asset, discountBps, maxSwapSize, maxInventory)
  const tx = await venue.configureSwap(
    c.redeemableAsset,
    20,                                // 0.20% discount
    ethers.parseEther("10000"),        // max single swap: 10,000 ankrFLOW
    ethers.parseEther("100000")        // max inventory before flush: 100,000 ankrFLOW
  );
  await tx.wait();
  pass("Venue configured: ankrFLOW accepted at 20bps discount");

  // ─── 2. Grant VENUE_ROLE on vault to AxiomVenue (if not already) ──────────
  section("STEP 2: CHECK VENUE_ROLE ON VAULT");
  const VENUE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VENUE_ROLE"));
  const hasRole = await vault.hasRole(VENUE_ROLE, c.venue);
  if (!hasRole) {
    await (await vault.grantRole(VENUE_ROLE, c.venue)).wait();
    pass("Granted VENUE_ROLE to AxiomVenue on vault");
  } else {
    pass("VENUE_ROLE already granted");
  }

  // ─── 3. Read back config ──────────────────────────────────────────────────
  section("STEP 3: VERIFY");
  const cfgNow = await venue.swapConfigs(c.redeemableAsset);
  row("ankrFLOW supported",  cfgNow.supported.toString());
  row("discountBps",         cfgNow.discountBps.toString() + " bps");
  row("maxSwapSize",         ethers.formatEther(cfgNow.maxSwapSize) + " ankrFLOW");
  row("maxInventory",        ethers.formatEther(cfgNow.maxInventory) + " ankrFLOW");

  // Test quote
  try {
    const q = await venue.getQuote(c.redeemableAsset, ethers.parseEther("1"));
    row("getQuote(1 ankrFLOW)", ethers.formatEther(q) + " WFLOW");
    pass("Quote working");
  } catch (e) {
    console.log("  Note: getQuote requires vault to have WFLOW liquidity.");
  }

  console.log("\n  ✓ Venue setup complete — ready for ankrFLOW swaps.\n");
}

main().catch(console.error);
