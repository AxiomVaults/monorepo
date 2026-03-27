# Axiom Vault - Transaction Log

Verified transactions from Hardhat mainnet fork (chain 747 fork -> local chainId 999).  
All interactions against live Flow EVM mainnet state forked at latest block.

## Deployment — `scripts/interact-real/deployFork.js`

| Contract | Address |
|---|---|
| AxiomVault | `0xCace1b78160AE76398F486c8a18044da0d66d86D` |
| AxiomStrategyManager | `0xD5ac451B0c50B9476107823Af206eD814a2e2580` |
| AnkrYieldAdapter | `0xF8e31cb472bc70500f08Cd84917E5A1912Ec8397` |
| AnkrMOREYieldAdapter | `0xc0F115A19107322cFBf1cDBC7ea011C19EbDB4F8` |
| AnkrRedemptionAdapter | `0xc96304e3c037f81dA488ed9dEa1D8F2a48278a75` |
| AxiomVenue | `0x34B40BA116d5Dec75548a9e9A8f15411461E8c70` |
| AxiomFactory | `0xD0141E899a65C95a556fE2B27e5982A6DE7fDD7A` |
| AxiomUniV2Pair | `0x07882Ae1ecB7429a84f1D53048d35c4bB2056877` |

---

## Test Suite: `testRealFullCycle.js` - 12/12 PASS

Full lifecycle: deposit -> allocate -> yield -> swap -> redemption -> withdraw

| # | Step | Result | Tx Hash (fork) |
|---|---|---|---|
| 1 | Wrap FLOW → WFLOW | ✓ | `0x...` (internal) |
| 2 | Approve vault | ✓ | — |
| 3 | Vault deposit (2 FLOW) | ✓ | verified |
| 4 | Shares received | ✓ | 1.9999 axWFLOW |
| 5 | Allocate to AnkrMOREYieldAdapter | ✓ | Ankr stake + MORE supply |
| 6 | Ankr stake WFLOW → ankrFLOW | ✓ | confirmed on-chain |
| 7 | MORE supply ankrFLOW as collateral | ✓ | `hTokenAnkrFLOW` minted |
| 8 | MORE borrow WFLOW (60% LTV) | ✓ | health factor 1.44+ |
| 9 | Venue swap ankrFLOW → WFLOW (30 bps discount) | ✓ | see below |
| 10 | Venue inventory flushed (auto-redemption) | ✓ | queue advanced |
| 11 | Vault withdraw (redeem shares) | ✓ | WFLOW returned |
| 12 | Share price increased (yield accrued) | ✓ | >1.0000 |

---

## Test Suite: `testRealVenueSwap.js` - 5/5 PASS

Venue exchange: ankrFLOW -> WFLOW via approval-first flow

| # | Step | Result |
|---|---|---|
| 1 | getQuote(1 ankrFLOW) returning 0.997 WFLOW | ✓ |
| 2 | Approve venue to spend ankrFLOW | ✓ |
| 3 | swapExactTokensForTokens | ✓ |
| 4 | WFLOW received matches quote (within slippage) | ✓ |
| 5 | Venue inventory queued for redemption | ✓ |

---

## Test Suite: `testRealRedemption.js` - 6/6 PASS

Ankr native unbonding redemption queue

| # | Step | Result |
|---|---|---|
| 1 | Request redemption (ankrFLOW → queue) | ✓ |
| 2 | Request ID emitted in event | ✓ |
| 3 | isClaimable returns false (pending) | ✓ |
| 4 | Fast-forward time (fork time-travel) | ✓ |
| 5 | isClaimable returns true | ✓ |
| 6 | claimRedemption → WFLOW received | ✓ |

---

## Test Suite: `testEisenSwap.js` - 7/7 PASS

End-to-end Eisen/aggregator permissionless routing

| # | Step | Description | Tx Hash (fork) |
|---|---|---|---|
| 1 | factory.allPairs(0) | Factory discovery → pair address | — read-only |
| 2 | pair.token0/token1/getReserves | Pair metadata read | — read-only |
| 3 | Ankr stake 1 FLOW → ankrFLOW | Get ankrFLOW for swap test | verified |
| 4 | pair.getAmountsOut(0.8745 ankrFLOW) | Flat-rate quote: **0.8727 WFLOW** | — read-only |
| 5 | **Eisen pay-first swap** (transfer → pair.swap with routing bytes) | `0x0b77d6cbd7aa2b4d703e8d293c3aa58351c955daeff945a803ea6f798bf79cbc` | ✓ |
| 6 | venue.swapExactTokensForTokens (router-style) | `0xed7548d9056341e682ce8570733b3ce9abaccf7528ac506de2de3fdcbb097b3f` | ✓ |
| 7 | Inventory auto-flushed, redemption queued | Venue state verified | ✓ |

### Notes from testEisenSwap

- Factory discovery: `factory.allPairs(0)` = `0x07882Ae1ecB7429a84f1D53048d35c4bB2056877` - Eisen can discover pair permissionlessly via factory enumeration
- Pricing: `getAmountsOut` gives flat-rate (exact 30 bps discount), always better than AMM formula for any trade size (no price impact on Axiom side)
- Routing bytes: `ethers.toUtf8Bytes("eisen:v1:route:axiom")` passed as `data` parameter - no longer rejected (fixed in AxiomUniV2Pair)
- Virtual reserves: reserve0 = vault.availableLiquidity() ~1.8 WFLOW, reserve1 = reserve0 x 10000/9970 - AMM-compatible view for sorting

---

## Contract Fix History

| File | Change | Reason |
|---|---|---|
| `AxiomUniV2Pair.sol` | `safeApprove` → `forceApprove` | OZ 4.9.6 deprecation |
| `AxiomUniV2Pair.sol` | Remove `if (data.length != 0) revert` | Eisen passes non-empty routing context |
| `AxiomUniV2Pair.sol` | Add `getAmountsOut`/`getAmountsIn` | Aggregator pair-level quote support |
| `AxiomUniV2Pair.sol` | Add `setDiscountBps` | Sync mirror state with venue config |
| `AnkrMOREYieldAdapter.sol` | Self-healing `withdrawAll()` | Fix InsufficientWFLOWBuffer on accrued interest |

---

## External Protocol Addresses (Flow EVM Mainnet — chain 747)

| Protocol | Contract | Address |
|---|---|---|
| Wrapped FLOW | WFLOW | `0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e` |
| Ankr Liquid Staking | ankrFLOW token | `0x1b97100eA1D7126C4d60027e231EA4CB25314bdb` |
| Ankr Staking Pool | Staking entry | `0xFE8189A3016cb6A3668b8ccdAC520CE572D4287a` |
| MORE Lending | Lending Pool | `0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d` |
| MORE Lending | Data Provider | `0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf` |
| PunchSwap | Router v2 | `0xf45AFe28fd5519d5f8C1d4787a4D5f724C0eFa4d` |
