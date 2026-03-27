import Navbar from '@/components/Navbar'
import VaultStats from '@/components/VaultStats'
import DepositPanel from '@/components/DepositPanel'
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
            Deposit WFLOW. Earn automated yield through spread capture and
            liquid staking — no active management required.
          </p>

          <div className="flex items-center justify-center gap-6 mt-6 text-sm">
            <Stat label="Strategy" value="ankrFLOW spread + staking" />
            <div className="w-px h-8 bg-[#1a1a1e]" />
            <Stat label="Asset" value="WFLOW (ERC-4626)" />
            <div className="w-px h-8 bg-[#1a1a1e]" />
            <Stat label="Receipt" value="axWFLOW shares" />
          </div>
        </div>

        {/* Stats */}
        <div className="mb-8">
          <VaultStats />
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
                'Vault allocates to ankrFLOW staking when spread is favorable',
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
  const sources = [
    {
      name: 'ankrFLOW Staking',
      desc: 'FLOW deposited into Ankr earns native staking rewards (~7% base APY)',
      pct: 7,
    },
    {
      name: 'DEX Spread Capture',
      desc: 'Vault buys ankrFLOW at discount on PunchSwap when spread > 50 bps and redeems at fair value',
      pct: 8,
    },
    {
      name: 'Idle WFLOW Buffer',
      desc: 'Reserve buffer kept liquid for instant withdrawals; earns zero but ensures solvency',
      pct: 0,
    },
  ]

  return (
    <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/30 to-[#40c9ff]/30">
      <div className="bg-[#0f0f11] rounded-[14px] px-6 py-5">
        <p className="text-xs text-[#888] uppercase tracking-widest mb-5">Yield sources</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {sources.map((s) => (
            <div key={s.name}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-white">{s.name}</p>
                {s.pct > 0 && (
                  <span className="text-xs font-mono text-[#37FF8B]">+{s.pct}%</span>
                )}
              </div>
              {/* Bar */}
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
