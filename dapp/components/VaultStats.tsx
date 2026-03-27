'use client'

import { useReadContracts } from 'wagmi'
import { parseUnits } from 'viem'
import { ADDRESSES, VAULT_ABI } from '@/lib/contracts'
import { formatTVL, formatSharePrice } from '@/lib/utils'

const SHARE_UNIT = parseUnits('1', 18) // 1 axWFLOW share

const vaultContract = { address: ADDRESSES.VAULT, abi: VAULT_ABI } as const

export default function VaultStats() {
  const { data, isLoading } = useReadContracts({
    contracts: [
      { ...vaultContract, functionName: 'totalAssets' },
      { ...vaultContract, functionName: 'convertToAssets', args: [SHARE_UNIT] },
      { ...vaultContract, functionName: 'totalSupply' },
      { ...vaultContract, functionName: 'totalDeployedToYield' },
    ],
  })

  const totalAssets = data?.[0].result as bigint | undefined
  const sharePrice = data?.[1].result as bigint | undefined
  const totalSupply = data?.[2].result as bigint | undefined
  const deployed  = data?.[3].result as bigint | undefined

  const stats = [
    {
      label: 'Target APY',
      value: '7 – 15%',
      sub: 'spread capture + staking',
      highlight: true,
    },
    {
      label: 'TVL',
      value: isLoading ? '...' : `${formatTVL(totalAssets)} WFLOW`,
      sub: `${formatTVL(deployed)} deployed`,
    },
    {
      label: 'Share Price',
      value: isLoading ? '...' : `${formatSharePrice(sharePrice)} WFLOW`,
      sub: 'per 1 axWFLOW',
    },
    {
      label: 'Total Shares',
      value: isLoading ? '...' : formatTVL(totalSupply),
      sub: 'axWFLOW minted',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="relative rounded-2xl overflow-hidden"
        >
          {/* gradient border wrapper */}
          <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff] to-[#40c9ff]">
            {/* glow */}
            <div className="absolute inset-0 blur-xl bg-gradient-to-br from-[#e81cff] to-[#40c9ff] opacity-10 rounded-2xl pointer-events-none" />
            <div className="relative bg-[#0f0f11] rounded-[14px] px-5 py-4">
              <p className="text-xs text-[#888] uppercase tracking-widest mb-1">{s.label}</p>
              <p
                className={`text-xl font-bold font-mono ${
                  s.highlight ? 'text-[#37FF8B]' : 'text-white'
                }`}
              >
                {s.value}
              </p>
              <p className="text-xs text-[#555] mt-0.5">{s.sub}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
