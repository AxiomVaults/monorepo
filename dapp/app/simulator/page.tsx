import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import SimulatorClient from './SimulatorClient'

export const metadata: Metadata = {
  title: 'Yield Simulator — Axiom Vault',
  description:
    'Backtest the Axiom spread-capture strategy on 18 months of Dune on-chain data. Adjust threshold and capital utilisation to see projected returns.',
}

export default function SimulatorPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      {/* Grid bg */}
      <div className="fixed inset-0 bg-grid opacity-100 pointer-events-none" />
      <div className="fixed top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#e81cff]/5 blur-3xl pointer-events-none" />
      <div className="fixed bottom-[-200px] right-1/3 w-[400px] h-[400px] rounded-full bg-[#40c9ff]/5 blur-3xl pointer-events-none" />

      <SimulatorClient />
    </main>
  )
}
