import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import ClientWeb3Provider from '@/components/ClientWeb3Provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Axiom Vault — Automated Yield on Flow',
  description:
    'Deposit WFLOW into Axiom Vault and earn automated yield through spread capture and liquid staking on Flow EVM.',
  icons: {
    icon: '/logo_no_bg.png',
    apple: '/logo_no_bg.png',
  },
  openGraph: {
    title: 'Axiom Vault',
    description: 'Automated yield on Flow EVM. Deposit WFLOW, earn passively.',
    type: 'website',
    images: [{ url: '/logo.png', width: 1200, height: 630, alt: 'Axiom Vault' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Axiom Vault',
    description: 'Automated yield on Flow EVM.',
    images: ['/logo.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased">
        <ClientWeb3Provider>
          {children}
        </ClientWeb3Provider>
      </body>
    </html>
  )
}
