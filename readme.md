Plan:
A Flow-native vault that acts as a liquidity venue, capturing yield from discounted redeemable assets

It combines:

Spread capture (buy below redemption value → redeem at par)
Idle capital yield (lend unused liquidity)

Revenue scales with flow × spread, not just TVL.

Core Mechanism
Aggregator Flow
External routers route swaps into the vault (best price execution)
Spread Engine
Buy discounted asset (e.g. staked derivative)
Redeem via protocol withdrawal queue
Capture delta to par
Capital Recycling
Redeemed base asset returned to vault
Reused for future swaps
Lending Floor
Idle capital allocated to lending strategies
Ensures non-zero yield during low-arb periods


Architecture
Vault (ERC-4626 style)
Handles deposits, shares, accounting
Swap Interface (AMM-compatible)
Allows aggregators to route flow directly
Pricing Engine (off-chain + keeper)
Dynamically updates buy/sell quotes
Strategy Manager
Arb queue allocation
Lending allocation


Yield Model
Primary: Spread from discounted redemptions
Secondary: Lending APY on idle capital

Regime-dependent:

Calm → lending-dominated
Volatile → spread-dominated


Key Design Goals
Plug into aggregators permissionlessly (via standard interface)
Maintain continuous liquidity (not episodic arbitrage)
Optimize capital efficiency across regimes
Avoid TVL dilution via dual-engine allocation


Name Ideas:
AxiomVaults
Nexus Vaults
Parallax Vaults
Parity Vaults