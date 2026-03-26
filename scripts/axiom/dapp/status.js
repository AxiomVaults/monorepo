/**
 * dapp/status.js — Read all protocol state without executing any transactions.
 *
 * Shows:
 *   • Vault: TVL, share price, available liquidity, deployed capital
 *   • Pair:  virtual reserves, discount BPS
 *   • User:  FLOW, WFLOW, ankrFLOW, axWFLOW balances
 *   • Yield: MORE health factor, borrow/collateral positions
 *
 * Usage:
 *   npx hardhat run scripts/axiom/dapp/status.js --network flowFork
 *   USER=0xabc... npx hardhat run scripts/axiom/dapp/status.js --network flowFork
 */

const { ethers } = require("hardhat");
const { DEPLOYED, ABIS, fmt } = require("./_shared");

async function main() {
  const [defaultSigner] = await ethers.getSigners();
  const userAddr = process.env.USER || defaultSigner.address;

  const provider = ethers.provider;

  const wflow    = new ethers.Contract(DEPLOYED.wflow,             ABIS.WFLOW,         provider);
  const ankrFLOW = new ethers.Contract(DEPLOYED.ankrFLOW,          ABIS.ERC20,         provider);
  const vault    = new ethers.Contract(DEPLOYED.vault,             ABIS.AxiomVault,    provider);
  const venue    = new ethers.Contract(DEPLOYED.venue,             ABIS.AxiomVenue,    provider);
  const pair     = new ethers.Contract(DEPLOYED.pair,              ABIS.AxiomUniV2Pair, provider);
  const factory  = new ethers.Contract(DEPLOYED.axiomFactory,      ABIS.AxiomFactory,  provider);

  console.log(`\n════════════════════════════════════════`);
  console.log(`  Axiom Vault — Protocol Status`);
  console.log(`════════════════════════════════════════\n`);

  // ── Vault metrics ─────────────────────────────────────────────────────────
  const [totalAssets, totalSupply, liquid] = await Promise.all([
    vault.totalAssets(),
    vault.totalSupply(),
    vault.availableLiquidity(),
  ]);
  const deployed    = totalAssets - liquid;
  const sharePriceN = totalSupply > 0n
    ? Number(ethers.formatEther(totalAssets)) / Number(ethers.formatEther(totalSupply))
    : 1.0;
  const bufferPct = totalAssets > 0n
    ? (Number(ethers.formatEther(liquid)) / Number(ethers.formatEther(totalAssets)) * 100).toFixed(1)
    : "0";

  console.log(`  Vault  ${DEPLOYED.vault}`);
  console.log(`    totalAssets:    ${fmt(totalAssets)} WFLOW`);
  console.log(`    totalSupply:    ${fmt(totalSupply)} axWFLOW`);
  console.log(`    share price:    ${sharePriceN.toFixed(8)} WFLOW/axWFLOW`);
  console.log(`    liquid buffer:  ${fmt(liquid)} WFLOW  (${bufferPct}%)`);
  console.log(`    deployed:       ${fmt(deployed)} WFLOW`);

  // ── Pair / venue metrics ─────────────────────────────────────────────────
  const [reserve0, reserve1] = await pair.getReserves();
  const numPairs = await factory.allPairsLength();
  const quoteUnit = await venue.getQuote(DEPLOYED.ankrFLOW, ethers.parseEther("1")).catch(() => 0n);

  console.log(`\n  Pair   ${DEPLOYED.pair}  (factory has ${numPairs} pair(s))`);
  console.log(`    token0 (WFLOW):    ${DEPLOYED.wflow}`);
  console.log(`    token1 (ankrFLOW): ${DEPLOYED.ankrFLOW}`);
  console.log(`    reserve0:          ${fmt(reserve0)} WFLOW`);
  console.log(`    reserve1:          ${fmt(reserve1)} ankrFLOW`);
  if (quoteUnit > 0n) {
    console.log(`    1 ankrFLOW quote:  ${fmt(quoteUnit)} WFLOW`);
  }

  // ── User balances ─────────────────────────────────────────────────────────
  const [flowBal, wflowBal, ankrBal, sharesBal] = await Promise.all([
    provider.getBalance(userAddr),
    wflow.balanceOf(userAddr),
    ankrFLOW.balanceOf(userAddr),
    vault.balanceOf(userAddr),
  ]);
  const sharesInAssets = sharesBal > 0n ? await vault.previewRedeem(sharesBal) : 0n;

  console.log(`\n  User   ${userAddr}`);
  console.log(`    FLOW:     ${fmt(flowBal)}`);
  console.log(`    WFLOW:    ${fmt(wflowBal)}`);
  console.log(`    ankrFLOW: ${fmt(ankrBal)}`);
  console.log(`    axWFLOW:  ${fmt(sharesBal)}  (≈ ${fmt(sharesInAssets)} WFLOW if redeemed)`);

  // ── Deployed strategy position (MORE pool) ────────────────────────────────
  try {
    const moreDataProvider = new ethers.Contract(
      DEPLOYED.moreDataProvider,
      ["function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"],
      provider
    );
    const adapter = DEPLOYED.ankrMOREYieldAdapter;
    const [totalCollateral, totalDebt, availableBorrows, , , healthFactor] =
      await moreDataProvider.getUserAccountData(adapter);
    const hfNum = Number(ethers.formatEther(healthFactor));

    console.log(`\n  MORE Pool  (adapter: ${adapter})`);
    console.log(`    collateral:   ${fmt(totalCollateral)} (ankrFLOW)`);
    console.log(`    debt:         ${fmt(totalDebt)} (WFLOW)`);
    console.log(`    borrow room:  ${fmt(availableBorrows)} WFLOW`);
    console.log(`    health factor: ${hfNum > 999 ? "∞ (no debt)" : hfNum.toFixed(4)}`);
    if (hfNum < 1.3 && hfNum < 999) {
      console.log(`    ⚠  Health factor below safe threshold (1.30) — consider deleveraging`);
    }
  } catch (e) {
    console.log(`\n  MORE Pool: (data unavailable — ${e.message.slice(0, 60)})`);
  }

  console.log(`\n════════════════════════════════════════\n`);
}

main().catch(console.error);
