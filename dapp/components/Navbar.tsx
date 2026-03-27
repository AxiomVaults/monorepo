'use client'

import { useAccount, useDisconnect } from 'wagmi'
import { useWeb3Modal } from '@web3modal/wagmi/react'
import { shortAddress } from '@/lib/utils'

export default function Navbar() {
  const { isConnected, address } = useAccount()
  const { disconnect } = useDisconnect()
  const { open } = useWeb3Modal()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#1a1a1e] bg-[#0a0a0a]/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 flex h-16 items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-axiom-gradient flex items-center justify-center">
            <span className="text-xs font-bold text-black">AX</span>
          </div>
          <span className="text-white font-semibold tracking-tight text-lg">
            Axiom<span className="text-[#37FF8B]">Vault</span>
          </span>
        </div>

        {/* Links */}
        <div className="hidden sm:flex items-center gap-6 text-sm text-[#888]">
          <a href="/" className="hover:text-white transition-colors">
            App
          </a>
          <a href="/docs" className="hover:text-white transition-colors">
            Docs
          </a>
          <a href="/roadmap-page" className="hover:text-white transition-colors">
            Roadmap
          </a>
          <a
            href="https://flowscan.io"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            Explorer
          </a>
        </div>

        {/* Wallet button */}
        {isConnected && address ? (
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs text-[#888] font-mono">
              {shortAddress(address)}
            </span>
            <button
              onClick={() => disconnect()}
              className="relative px-4 py-2 text-sm font-medium text-white rounded-xl border border-[#1a1a1e] hover:border-[#e81cff]/40 transition-all duration-200 hover:bg-[#1a1a1e]"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => open()}
            className="connect-btn relative px-5 py-2.5 text-sm font-semibold text-black rounded-xl bg-[#37FF8B] hover:brightness-110 transition-all duration-200 active:scale-95"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  )
}
