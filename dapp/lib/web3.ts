import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { injected, walletConnect } from 'wagmi/connectors'

export const flowEVM = defineChain({
  id: 747,
  name: 'Flow EVM',
  nativeCurrency: { name: 'Flow', symbol: 'FLOW', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://mainnet.evm.nodes.onflow.org'] },
  },
  blockExplorers: {
    default: { name: 'FlowScan', url: 'https://flowscan.io' },
  },
})

export const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? ''

export const config = createConfig({
  chains: [flowEVM],
  connectors: [
    injected(),
    walletConnect({ projectId }),
  ],
  transports: {
    [flowEVM.id]: http('https://mainnet.evm.nodes.onflow.org'),
  },
  ssr: true,
})
