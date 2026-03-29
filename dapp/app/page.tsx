import Navbar from '@/components/Navbar'
import VaultStats from '@/components/VaultStats'
import DepositPanel from '@/components/DepositPanel'
import AllocationBreakdown from '@/components/AllocationBreakdown'
import { ADDRESSES } from '@/lib/contracts'

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      {/* Grid bg */}
      <div className="fixed inset-0 bg-grid opacity-100 pointer-events-none" />

      {/* Ambient orbs */}
      <div className="fixed top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#e81cff]/5 blur-3xl pointer-events-none" />
      <div className="fixed bottom-[-200px] left-1/3 w-[500px] h-[500px] rounded-full bg-[#40c9ff]/5 blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-28 pb-20">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#1a1a1e] bg-[#0f0f11] text-xs text-[#888] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#37FF8B] inline-block animate-pulse" />
            Live on Flow EVM &middot; Chain 747
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4">
            Axiom{' '}
            <span className="text-gradient">Vault</span>
          </h1>

          <p className="text-[#888] max-w-lg mx-auto text-lg leading-relaxed">
            Deposit WFLOW. The vault acts as a UniV2-compatible swap venue on Eisen,
            capturing spread on ankrFLOW ↔ WFLOW trades routed by the aggregator.
            Idle capital earns additional yield through staking, lending, and LP.
          </p>

          <div className="flex items-center justify-center gap-6 mt-6 text-sm">
            <Stat label="Strategy" value="Multi-adapter meta-vault" />
            <div className="w-px h-8 bg-[#1a1a1e]" />
            <Stat label="Asset" value="WFLOW (ERC-4626)" />
            <div className="w-px h-8 bg-[#1a1a1e]" />
            <Stat label="Receipt" value="axWFLOW shares" />
          </div>
        </div>

        {/* Stats */}
        <div className="mb-6">
          <VaultStats />
        </div>

        {/* Allocation breakdown across all yield adapters */}
        <div className="mb-8">
          <AllocationBreakdown />
        </div>

        {/* Main layout: deposit panel + info */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Deposit panel — wider */}
          <div className="lg:col-span-3">
            <DepositPanel />
          </div>

          {/* Info panel */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <InfoCard
              title="How it works"
              items={[
                'Deposit WFLOW and receive axWFLOW shares',
                'MultiStrategyManager routes capital to highest-APY adapter',
                'Keeper bot updates APY hints; autoRebalance() optimises allocation',
                'Yield accrues into share price — no claiming needed',
                'Redeem shares anytime for WFLOW + accumulated yield',
              ]}
            />
            <InfoCard
              title="Contracts"
              items={[
                `Vault: ${short(ADDRESSES.VAULT)}`,
                `WFLOW: ${short(ADDRESSES.WFLOW)}`,
                `ankrFLOW: ${short(ADDRESSES.ANKR_FLOW)}`,
              ]}
              isCode
            />
          </div>
        </div>

        {/* How yield is generated */}
        <div className="mt-10">
          <YieldBreakdown />
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-[#1a1a1e] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#555]">
          <p>Axiom Vault &mdash; Flow EVM</p>
          <div className="flex gap-4">
            <a
              href={`https://flowscan.io/address/${ADDRESSES.VAULT}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#888] transition-colors"
            >
              Contract
            </a>
            <a href="/docs" className="hover:text-[#888] transition-colors">
              Docs
            </a>
            <a href="/roadmap" className="hover:text-[#888] transition-colors">
              Roadmap
            </a>
          </div>
        </footer>
      </div>
    </main>
  )
}

// ── Small helpers ────────────────────────────────────────────────────────────

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[#555] text-xs uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-white text-sm font-medium">{value}</p>
    </div>
  )
}

function InfoCard({
  title,
  items,
  isCode = false,
}: {
  title: string
  items: string[]
  isCode?: boolean
}) {
  return (
    <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/40 to-[#40c9ff]/40">
      <div className="bg-[#0f0f11] rounded-[14px] px-5 py-4">
        <p className="text-xs text-[#888] uppercase tracking-widest mb-3">{title}</p>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[#37FF8B] mt-0.5 shrink-0">›</span>
              <span
                className={`text-sm text-[#aaa] leading-snug ${
                  isCode ? 'font-mono text-xs break-all' : ''
                }`}
              >
                {item}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function YieldBreakdown() {
  const idleSources = [
    {
      name: 'ankrMORE Leveraged',
      desc: 'Stake WFLOW → ankrFLOW, supply to MORE Markets, borrow WFLOW again (60% LTV). Compounds the staking spread through a single loop.',
      pct: 12,
    },
    {
      name: 'ankrFLOW Staking',
      desc: 'Plain liquid staking via Ankr — FLOW earns Proof-of-Stake rewards with no leverage and instant exit via PunchSwap.',
      pct: 7,
    },
    {
      name: 'MORE Lending',
      desc: 'Supply WFLOW directly to MORE Markets and earn variable supply APY. No price risk; fully liquid withdrawal.',
      pct: 6,
    },
    {
      name: 'PunchSwap LP',
      desc: 'Provide liquidity to the ankrFLOW/WFLOW pair on PunchSwap. Earns 0.3% swap fees from arbitrageurs keeping the peg tight.',
      pct: 4,
    },
  ]

  return (
    <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/30 to-[#40c9ff]/30">
      <div className="bg-[#0f0f11] rounded-[14px] px-6 py-5">
        <p className="text-xs text-[#888] uppercase tracking-widest mb-5">Yield sources</p>

        {/* ── Primary: Eisen aggregator venue ── */}
        <div className="mb-6 p-[1px] rounded-xl bg-gradient-to-r from-[#e81cff]/50 to-[#40c9ff]/50">
          <div className="bg-[#111114] rounded-[11px] px-5 py-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-base font-bold text-white">Eisen Aggregator Swap Venue</p>
                  <span className="text-[10px] font-mono text-[#37FF8B] bg-[#37FF8B]/10 px-2 py-0.5 rounded-full uppercase tracking-wide">Primary</span>
                </div>
                <p className="text-[10px] text-[#555] font-mono">UniV2-compatible · auto-discovered · no whitelisting</p>
              </div>
              <span className="shrink-0 text-sm font-mono text-[#37FF8B]">spread on volume</span>
            </div>
            <p className="text-xs text-[#666] leading-relaxed">
              The vault implements a UniV2-compatible swap interface, so{' '}
              <span className="text-[#aaa]">Eisen&apos;s router</span> (Flow EVM&apos;s leading aggregator)
              automatically discovers it as a swap venue — no partnership required.
              When traders swap ankrFLOW ↔ WFLOW, their trade routes through the vault.
              The vault buys ankrFLOW at a slight discount, redeems it at par via the Ankr protocol, and
              pockets the spread. Revenue scales with swap volume, not TVL.
              Idle capital between swaps is deployed into the strategies below.
            </p>
          </div>
        </div>

        {/* ── Secondary: idle capital deployment ── */}
        <p className="text-[10px] text-[#555] uppercase tracking-widest mb-4">Idle capital deployment</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {idleSources.map((s) => (
            <div key={s.name}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-white">{s.name}</p>
                {s.pct > 0 && (
                  <span className="text-xs font-mono text-[#37FF8B]">+{s.pct}%</span>
                )}
              </div>
              {s.pct > 0 && (
                <div className="h-1 rounded-full bg-[#1a1a1e] mb-2">
                  <div
                    className="h-1 rounded-full bg-gradient-to-r from-[#e81cff] to-[#40c9ff]"
                    style={{ width: `${Math.min(s.pct * 6, 100)}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-[#555] leading-snug">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
