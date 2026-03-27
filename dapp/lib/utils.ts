import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatUnits } from 'viem'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a bigint amount with 18 decimals to a human-readable string */
export function formatAmount(value: bigint | undefined, decimals = 18, displayDecimals = 4): string {
  if (value === undefined) return '—'
  const formatted = formatUnits(value, decimals)
  const num = parseFloat(formatted)
  if (num === 0) return '0'
  if (num < 0.0001) return '< 0.0001'
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: displayDecimals,
  })
}

/** Format a bigint as a USD-style TVL string (abbreviated) */
export function formatTVL(value: bigint | undefined, decimals = 18): string {
  if (value === undefined) return '—'
  const num = parseFloat(formatUnits(value, decimals))
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`
  return num.toFixed(2)
}

/** Share price: convertToAssets(1e18) / 1e18 expressed as N:1 */
export function formatSharePrice(assets: bigint | undefined, decimals = 18): string {
  if (assets === undefined) return '—'
  const price = parseFloat(formatUnits(assets, decimals))
  return price.toFixed(6)
}

/** Truncate an address to 0x1234...5678 form */
export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}
