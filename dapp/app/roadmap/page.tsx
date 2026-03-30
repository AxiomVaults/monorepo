import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'

export const metadata: Metadata = {
  title: 'Roadmap -- Axiom Vault',
  description: 'What comes next for Axiom Vault on Flow EVM.',
}

const phases = [
  {
    phase: 'Now',
    title: 'Mainnet live',
    items: [
      'ERC-4626 vault deployed on Flow EVM (chain 747)',
      'Eisen aggregator auto-routing active -- no whitelisting required',
      'Four yield adapters: ankrMORE leveraged, ankrFLOW staking, MORE lending, PunchSwap LP',
      'Keeper bot live: APY hints + autoRebalance()',
    ],
  },
  {
    phase: 'Next',
    title: 'Security and scale',
    items: [
      'Independent smart contract audit',
      'Formally verify adapter accounting invariants',
      'Increase TVL cap and onboard larger LPs',
      'Multi-sig upgrade path via timelock',
    ],
  },
  {
    phase: 'Soon',
    title: 'axWFLOW utility',
    items: [
      'List axWFLOW as collateral on MORE Markets',
      'Enable loop strategies: deposit WFLOW, borrow against axWFLOW, re-deposit',
      'Governance token design for protocol fee distribution',
      'Additional redeemable asset pairs as Flow LST ecosystem grows',
    ],
  },
]

export default function RoadmapPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <div className="fixed inset-0 bg-grid opacity-100 pointer-events-none" />
      <div className="fixed top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#e81cff]/5 blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 pt-28 pb-24">
        <div className="mb-14">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">What&apos;s next</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Axiom <span className="text-gradient">Roadmap</span>
          </h1>
          <p className="text-[#888] text-lg max-w-2xl leading-relaxed">
            Axiom Vault is live on Flow EVM mainnet. Below is what comes after initial launch.
          </p>
        </div>

        <div className="space-y-4">
          {phases.map((row) => (
            <div key={row.phase} className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/30 to-[#40c9ff]/30">
              <div className="bg-[#0f0f11] rounded-[14px] px-6 py-5">
                <div className="flex items-baseline gap-3 mb-4">
                  <span className="text-[10px] font-mono text-[#37FF8B] bg-[#37FF8B]/10 px-2 py-0.5 rounded-full uppercase tracking-wide">
                    {row.phase}
                  </span>
                  <h2 className="text-lg font-bold text-white">{row.title}</h2>
                </div>
                <ul className="space-y-2">
                  {row.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-[#aaa]">
                      <span className="text-[#37FF8B] mt-0.5 shrink-0">›</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
