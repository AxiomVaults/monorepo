'use client'

import { useReadContract } from 'wagmi'
import { formatEther } from 'viem'
import { ADDRESSES, MULTI_STRATEGY_MANAGER_ABI } from '@/lib/contracts'

// Adapter colour palette — one per possible slot (max 8)
const ADAPTER_COLORS = [
  { from: '#e81cff', to: '#40c9ff' }, // 0 — ankrMORE Leveraged
  { from: '#37FF8B', to: '#40c9ff' }, // 1 — ankrFLOW Staking
  { from: '#40c9ff', to: '#0099ff' }, // 2 — MORE Lending
  { from: '#ffb740', to: '#ff6b40' }, // 3 — PunchSwap LP
  { from: '#e81cff', to: '#ff6b40' }, // 4
  { from: '#37FF8B', to: '#ffb740' }, // 5
  { from: '#40c9ff', to: '#e81cff' }, // 6
  { from: '#ff6b40', to: '#37FF8B' }, // 7
]

function fmtWflow(raw: bigint | undefined): string {
  if (raw === undefined) return '—'
  const n = Number(formatEther(raw))
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toFixed(2)
}

function fmtApy(bps: bigint | undefined): string {
  if (bps === undefined || bps === 0n) return '—'
  return `${(Number(bps) / 100).toFixed(2)}%`
}

export default function AllocationBreakdown() {
  const { data, isLoading, isError } = useReadContract({
    address: ADDRESSES.MULTI_STRATEGY_MANAGER,
    abi: MULTI_STRATEGY_MANAGER_ABI,
    functionName: 'allAdaptersStatus',
  })

  const isPlaceholder =
    ADDRESSES.MULTI_STRATEGY_MANAGER === '0x0000000000000000000000000000000000000000'

  // ─── Static fallback while contract isn't deployed ────────────────────────
  const placeholderRows = [
    { name: 'ankrMORE Leveraged', apyBps: 1200n, pct: 60, active: true },
    { name: 'ankrFLOW Staking',   apyBps:  700n, pct: 20, active: true },
    { name: 'MORE Lending',        apyBps:  600n, pct: 10, active: true },
    { name: 'PunchSwap LP',        apyBps:  400n, pct: 10, active: true },
  ]

  // ─── Parse live data ───────────────────────────────────────────────────────
  let rows: {
    name: string
    deployed: bigint
    underlying: bigint
    apyBps: bigint
    active: boolean
    pct: number
  }[] = []

  if (!isPlaceholder && data) {
    const [names, deployed, underlying, apyBps, active] = data as [
      string[],
      bigint[],
      bigint[],
      bigint[],
      boolean[],
    ]

    const totalDeployed = deployed.reduce((a, b) => a + b, 0n)

    rows = names.map((name, i) => ({
      name,
      deployed:   deployed[i],
      underlying: underlying[i],
      apyBps:     apyBps[i],
      active:     active[i],
      pct:
        totalDeployed > 0n
          ? Math.round((Number(deployed[i]) / Number(totalDeployed)) * 100)
          : 0,
    }))
  }

  const showPlaceholder = isPlaceholder || isError || (!isLoading && rows.length === 0)

  return (
    <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/30 to-[#40c9ff]/30">
      <div className="bg-[#0f0f11] rounded-[14px] px-6 py-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <p className="text-xs text-[#888] uppercase tracking-widest">
            Allocation Breakdown
          </p>
          {isPlaceholder ? (
            <span className="text-[10px] text-[#555] font-mono">preview</span>
          ) : isLoading ? (
            <span className="inline-block w-2 h-2 rounded-full bg-[#37FF8B] animate-pulse" />
          ) : (
            <span className="text-[10px] text-[#37FF8B] font-mono">live</span>
          )}
        </div>

        {/* Rows */}
        {showPlaceholder ? (
          <div className="space-y-4">
            {placeholderRows.map((r, i) => (
              <AdapterRow
                key={r.name}
                index={i}
                name={r.name}
                deployedLabel={null}
                underlyingLabel={null}
                apyBps={r.apyBps}
                active={r.active}
                pct={r.pct}
                isPlaceholder
              />
            ))}
          </div>
        ) : isLoading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-[#1a1a1e] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((r, i) => (
              <AdapterRow
                key={r.name}
                index={i}
                name={r.name}
                deployedLabel={fmtWflow(r.deployed)}
                underlyingLabel={fmtWflow(r.underlying)}
                apyBps={r.apyBps}
                active={r.active}
                pct={r.pct}
              />
            ))}
          </div>
        )}

        {/* Footnote */}
        <p className="mt-4 text-[10px] text-[#444] leading-snug">
          APY hints are set by the keeper bot based on live protocol rates.
          Actual yield accrues into axWFLOW share price continuously.
        </p>
      </div>
    </div>
  )
}

// ─── Single adapter row ────────────────────────────────────────────────────

function AdapterRow({
  index,
  name,
  deployedLabel,
  underlyingLabel,
  apyBps,
  active,
  pct,
  isPlaceholder = false,
}: {
  index: number
  name: string
  deployedLabel: string | null
  underlyingLabel: string | null
  apyBps: bigint
  active: boolean
  pct: number
  isPlaceholder?: boolean
}) {
  const color = ADAPTER_COLORS[index % ADAPTER_COLORS.length]

  return (
    <div className="group">
      {/* Name + APY row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {/* Active indicator dot */}
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              active ? 'bg-[#37FF8B]' : 'bg-[#444]'
            }`}
          />
          <span className="text-sm text-white font-medium">{name}</span>
          {isPlaceholder && (
            <span className="text-[10px] text-[#444]">(preview)</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {underlyingLabel && (
            <span className="text-xs text-[#555] font-mono tabular-nums">
              {underlyingLabel} WFLOW
            </span>
          )}
          <span className="text-sm font-mono font-semibold text-[#37FF8B]">
            {fmtApy(apyBps)}
          </span>
        </div>
      </div>

      {/* Allocation bar */}
      <div className="h-1.5 rounded-full bg-[#1a1a1e] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(to right, ${color.from}, ${color.to})`,
            minWidth: pct > 0 ? '4px' : '0',
          }}
        />
      </div>

      {/* Deployed label below bar */}
      <div className="flex items-center justify-between mt-1">
        {deployedLabel ? (
          <span className="text-[11px] text-[#444] font-mono">
            {deployedLabel} deployed
          </span>
        ) : (
          <span />
        )}
        <span className="text-[11px] text-[#444] font-mono">{pct}%</span>
      </div>
    </div>
  )
}
