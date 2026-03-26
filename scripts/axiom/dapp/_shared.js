/**
 * dapp/_shared.js — Shared config and contract helpers for Axiom dApp scripts.
 *
 * Copy these patterns into your frontend. Replace DEPLOYED with your actual addresses.
 * All ABIs are minimal — add more functions as needed.
 */

// ─── Deployed addresses (Flow EVM mainnet) ─────────────────────────────────
// Update after each deployment. Set DEPLOYED.network = "mainnet" | "testnet" | "fork"
const DEPLOYED = {
  network: "fork",          // change to "mainnet" for production
  chainId: 999,             // 747 = mainnet, 545 = testnet, 999 = local fork

  // Core vault stack
  vault:                "0xCace1b78160AE76398F486c8a18044da0d66d86D",
  strategyManager:      "0xD5ac451B0c50B9476107823Af206eD814a2e2580",
  venue:                "0x34B40BA116d5Dec75548a9e9A8f15411461E8c70",
  axiomFactory:         "0xD0141E899a65C95a556fE2B27e5982A6DE7fDD7A",
  pair:                 "0x07882Ae1ecB7429a84f1D53048d35c4bB2056877",

  // Adapters
  ankrMOREYieldAdapter:  "0xc0F115A19107322cFBf1cDBC7ea011C19EbDB4F8",
  ankrRedemptionAdapter: "0xc96304e3c037f81dA488ed9dEa1D8F2a48278a75",

  // Tokens (same on mainnet + fork)
  wflow:    "0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e",
  ankrFLOW: "0x1b97100eA1D7126C4d60027e231EA4CB25314bdb",  // alias: ankrFlow
  ankrFlow: "0x1b97100eA1D7126C4d60027e231EA4CB25314bdb",

  // External protocols (live mainnet — do not change)
  ankrStaking:     "0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a",
  morePool:        "0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d",
  moreDataProvider:"0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf",
  punchSwapRouter: "0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d",
};

// ─── ABIs (minimal — add functions as needed) ──────────────────────────────
const ABIS = {
  ERC20: [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  ],

  WFLOW: [
    "function name() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function deposit() payable",
    "function withdraw(uint256 amount)",
  ],

  AxiomVault: [
    // ERC4626
    "function asset() view returns (address)",
    "function totalAssets() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address owner) view returns (uint256)",
    "function convertToShares(uint256 assets) view returns (uint256)",
    "function convertToAssets(uint256 shares) view returns (uint256)",
    "function maxDeposit(address) view returns (uint256)",
    "function maxWithdraw(address owner) view returns (uint256)",
    "function previewDeposit(uint256 assets) view returns (uint256)",
    "function previewWithdraw(uint256 assets) view returns (uint256)",
    "function previewRedeem(uint256 shares) view returns (uint256)",
    "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
    "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
    "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
    // Axiom extras
    "function availableLiquidity() view returns (uint256)",
    "function reserveBufferBps() view returns (uint256)",
    "function totalDeployedToYield() view returns (uint256)",
    "function totalPendingRedemption() view returns (uint256)",
    // Events
    "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
    "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  ],

  AxiomVenue: [
    "function getQuote(address tokenIn, uint256 amountIn) view returns (uint256)",
    "function swapConfigs(address asset) view returns (bool supported, uint16 discountBps, uint256 maxSwapSize, uint256 maxInventory, address redemptionAdapter)",
    "function swapRedeemableForBase(address tokenIn, uint256 amountIn, uint256 minAmountOut, address receiver) returns (uint256)",
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
    "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
    "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
    "function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)",
    "function inventoryBalances(address) view returns (uint256)",
    "event SwapExecuted(address indexed tokenIn, address indexed receiver, uint256 amountIn, uint256 amountOut, uint256 discountBps)",
  ],

  AxiomUniV2Pair: [
    "function factory() view returns (address)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)",
    "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
    "function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)",
    "function discountBps() view returns (uint16)",
    "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
  ],

  AxiomFactory: [
    "function allPairsLength() view returns (uint256)",
    "function allPairs(uint256 index) view returns (address)",
    "function getPair(address tokenA, address tokenB) view returns (address)",
  ],

  StrategyManager: [
    "function allocateToYield(address adapter, uint256 amount)",
    "function deallocateFromYield(address adapter, uint256 amount)",
    "function deallocateAll(address adapter)",
    "function requestRedemption(address token, uint256 amount) returns (uint256 requestId)",
    "function adapterInfo(address adapter) view returns (bool registered, uint256 allocated)",
  ],

  AnkrRedemptionAdapter: [
    "function requestRedemption(address requester, uint256 ankrAmount) returns (uint256 requestId)",
    "function claimRedemption(uint256 requestId) returns (uint256 baseAmount)",
    "function isClaimable(uint256 requestId) view returns (bool)",
    "function pendingValue(uint256 requestId) view returns (uint256)",
    "function totalPending() view returns (uint256)",
    "function claimDelay() view returns (uint256)",
    "function nextRequestId() view returns (uint256)",
    "function requests(uint256 id) view returns (address requester, uint256 baseAmount, uint64 unlocksAt, bool claimed)",
    "event RedemptionRequested(uint256 indexed requestId, address indexed requester, uint256 ankrAmount, uint256 baseAmount)",
    "event RedemptionClaimed(uint256 indexed requestId, address indexed claimer, uint256 baseAmount)",
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Format 18-decimal BigInt as a readable float string */
function fmt(n, decimals = 4) {
  return Number(require("ethers").formatEther(n)).toFixed(decimals);
}

/** Deadline timestamp: now + seconds */
function deadline(seconds = 300) {
  return Math.floor(Date.now() / 1000) + seconds;
}

module.exports = { DEPLOYED, ABIS, fmt, deadline };
