/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // WalletConnect / web3modal use browser-only APIs (indexedDB, pino-pretty, lokijs).
    // Marking them as externals prevents Next.js SSR from trying to bundle/execute them.
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    return config
  },
}

export default nextConfig
