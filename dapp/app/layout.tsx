import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { headers } from 'next/headers'
import { cookieToInitialState } from 'wagmi'
import { config } from '@/lib/web3'
import Web3Provider from '@/components/Web3Provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Axiom Vault — Automated Yield on Flow',
  description:
    'Deposit WFLOW into Axiom Vault and earn automated yield through spread capture and liquid staking on Flow EVM.',
  openGraph: {
    title: 'Axiom Vault',
    description: 'Automated yield on Flow EVM. Deposit WFLOW, earn passively.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Axiom Vault',
    description: 'Automated yield on Flow EVM.',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const initialState = cookieToInitialState(config, headersList.get('cookie'))

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased">
        <Web3Provider initialState={initialState}>
          {children}
        </Web3Provider>
      </body>
    </html>
  )
}
