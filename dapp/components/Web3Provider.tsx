'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createWeb3Modal } from '@web3modal/wagmi/react'
import { WagmiProvider } from 'wagmi'
import { config, projectId } from '@/lib/web3'
import { type ReactNode } from 'react'

const queryClient = new QueryClient()

if (projectId && typeof window !== 'undefined') {
  createWeb3Modal({
    wagmiConfig: config,
    projectId,
    themeMode: 'dark',
    themeVariables: {
      '--w3m-color-mix': '#e81cff',
      '--w3m-color-mix-strength': 20,
      '--w3m-accent': '#37FF8B',
      '--w3m-border-radius-master': '12px',
    },
  })
}

export default function Web3Provider({
  children,
}: {
  children: ReactNode
}) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
