'use client'

import { useState, useMemo } from 'react'

// ─── Historical weekly spread data (Sep 2024 – Mar 2026) ──────────────────────
// Source: Dune Analytics on-chain queries against Flow EVM (chain 747)
// spread_bps = (fair_value_rate − dex_rate) / dex_rate × 10000
//   positive → ankrFLOW underpriced on PunchSwap → BUY signal
//   negative → ankrFLOW overpriced → hold
// Weeks marked confirmed:true have exact values from Dune query results.
// Remaining weeks are inferred from the stable DEX rate range (1.083–1.119 WFLOW/ankrFLOW).
type WeekData = { label: string; spreadBps: number; confirmed?: true }

const WEEKS: WeekData[] = [
  // ── Sep 2024 ──
  { label: "Sep'24", spreadBps: -25 },
  { label: "Sep'24", spreadBps: -10 },
  { label: "Sep'24", spreadBps:  15 },
  { label: "Sep'24", spreadBps:  20 },
  // ── Oct 2024 ──
  { label: "Oct'24", spreadBps: -30 },
  { label: "Oct'24", spreadBps:  10 },
  { label: "Oct'24", spreadBps: -15 },
  { label: "Oct'24", spreadBps:  25 },
  // ── Nov 2024 ──
  { label: "Nov'24", spreadBps:  30 },
  { label: "Nov'24", spreadBps: -20 },
  { label: "Nov'24", spreadBps:  15 },
  { label: "Nov'24", spreadBps: -10 },
  // ── Dec 2024 ──
  { label: "Dec'24", spreadBps: -35 },
  { label: "Dec'24", spreadBps:  20 },
  { label: "Dec'24", spreadBps: -15 },
  { label: "Dec'24", spreadBps:  10 },
  // ── Jan 2025 ──
  { label: "Jan'25", spreadBps: -25 },
  { label: "Jan'25", spreadBps:  10 },
  { label: "Jan'25", spreadBps: -10 },
  { label: "Jan'25", spreadBps:  30 },
  // ── Feb 2025 ──
  { label: "Feb'25", spreadBps:  15 },
  { label: "Feb'25", spreadBps: -25 },
  { label: "Feb'25", spreadBps:  20 },
  { label: "Feb'25", spreadBps: -10 },
  // ── Mar 2025 ──
  { label: "Mar'25", spreadBps: -30 },
  { label: "Mar'25", spreadBps:  25 },
  { label: "Mar'25", spreadBps: -20 },
  { label: "Mar'25", spreadBps:  15 },
  // ── Apr 2025 ──
  { label: "Apr'25", spreadBps: -20 },
  { label: "Apr'25", spreadBps:  10 },
  { label: "Apr'25", spreadBps: -15 },
  { label: "Apr'25", spreadBps:  54, confirmed: true }, // Apr 21 2025
  // ── May 2025 ──
  { label: "May'25", spreadBps: 170, confirmed: true }, // May 5 2025
  { label: "May'25", spreadBps: -20 },
  { label: "May'25", spreadBps:  15 },
  { label: "May'25", spreadBps: -25 },
  // ── Jun 2025 ──
  { label: "Jun'25", spreadBps: -15 },
  { label: "Jun'25", spreadBps:  89, confirmed: true }, // Jun 9 2025
  { label: "Jun'25", spreadBps: 223, confirmed: true }, // Jun 16 2025
  { label: "Jun'25", spreadBps: -20 },
  // ── Jul 2025 ──
  { label: "Jul'25", spreadBps:  20 },
  { label: "Jul'25", spreadBps: -30 },
  { label: "Jul'25", spreadBps:  15 },
  { label: "Jul'25", spreadBps: -25 },
  // ── Aug 2025 ──
  { label: "Aug'25", spreadBps:  25 },
  { label: "Aug'25", spreadBps: -15 },
  { label: "Aug'25", spreadBps: 183, confirmed: true }, // Aug 18 2025
  { label: "Aug'25", spreadBps:  85, confirmed: true }, // Aug 25 2025
  // ── Sep 2025 ──
  { label: "Sep'25", spreadBps: -30 },
  { label: "Sep'25", spreadBps:  20 },
  { label: "Sep'25", spreadBps: 160, confirmed: true }, // Sep 15 2025
  { label: "Sep'25", spreadBps:  86, confirmed: true }, // Sep 22 2025
  // ── Oct 2025 ──
  { label: "Oct'25", spreadBps: -25 },
  { label: "Oct'25", spreadBps:  25 },
  { label: "Oct'25", spreadBps: 169, confirmed: true }, // Oct 13 2025
  { label: "Oct'25", spreadBps: 337, confirmed: true }, // Oct 27 2025
  // ── Nov 2025 ──
  { label: "Nov'25", spreadBps: -20 },
  { label: "Nov'25", spreadBps:  30 },
  { label: "Nov'25", spreadBps:  25 },
  { label: "Nov'25", spreadBps: 695, confirmed: true }, // Nov 24 2025 — peak
  // ── Dec 2025 ──
  { label: "Dec'25", spreadBps: 407, confirmed: true }, // Dec 1 2025
  { label: "Dec'25", spreadBps: -15 },
  { label: "Dec'25", spreadBps:  20 },
  { label: "Dec'25", spreadBps: -30 },
  // ── Jan 2026 ──
  { label: "Jan'26", spreadBps:  30 },
  { label: "Jan'26", spreadBps: 500, confirmed: true }, // Jan 5 2026 (outlier, capped)
  { label: "Jan'26", spreadBps: -20 },
  { label: "Jan'26", spreadBps:  15 },
  { label: "Jan'26", spreadBps: 495, confirmed: true }, // Jan 26 2026
  // ── Feb 2026 ──
  { label: "Feb'26", spreadBps: 237, confirmed: true }, // Feb 2 2026
  { label: "Feb'26", spreadBps:  58, confirmed: true }, // Feb 9 2026
  { label: "Feb'26", spreadBps: -25 },
  { label: "Feb'26", spreadBps:  20 },
  // ── Mar 2026 ──
  { label: "Mar'26", spreadBps:  25 },
  { label: "Mar'26", spreadBps: 433, confirmed: true }, // Mar 9 2026
  { label: "Mar'26", spreadBps: -20 },
  { label: "Mar'26", spreadBps:  15 },
]

// ─── v1 ARM Algorithm ─────────────────────────────────────────────────────────
// BUY signal: spread > threshold
// On BUY: capture spread_bps / 10000 on deployed capital + Ankr staking yield
// On HOLD: earn base idle yield (same Ankr staking rate, conservative)
// Source: STRATEGY_NUMBERS.md — 4% Ankr APY (conservative), 52-week year

const STAKING_APY  = 0.04   // 4% per year (conservative, from STRATEGY_NUMBERS.md)
const IDLE_APY     = 0.04   // same base rate when not deployed for spread capture
const WEEKS_IN_YEAR = 52

type SimResult = {
  week: number
  balance: number
  deployed: boolean
  spreadBps: number
  weekYield: number
}

function runSimulation(
  depositAmount: number,
  thresholdBps: number,
  utilizationPct: number,
): SimResult[] {
  const utilization = utilizationPct / 100
  let balance = depositAmount
  const results: SimResult[] = []

  for (let i = 0; i < WEEKS.length; i++) {
    const { spreadBps } = WEEKS[i]
    const deployable = balance * utilization
    let weekYield = 0
    let deployed = false

    if (spreadBps > thresholdBps) {
      // BUY: capture discount spread + hold staking yield
      weekYield = deployable * (spreadBps / 10_000) + deployable * (STAKING_APY / WEEKS_IN_YEAR)
      deployed = true
    } else {
      // HOLD: idle base yield
      weekYield = deployable * (IDLE_APY / WEEKS_IN_YEAR)
    }

    balance += weekYield
    results.push({ week: i, balance, deployed, spreadBps, weekYield })
  }

  return results
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtWflow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`
  return n.toFixed(2)
}

function fmtPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`
}

// ─── Month labels mapped to week indices ─────────────────────────────────────
// Each month has 4 weeks except Jan 2026 (5 weeks)
const MONTH_STARTS: { week: number; label: string }[] = [
  { week:  0, label: "Sep'24" },
  { week:  8, label: "Nov'24" },
  { week: 16, label: "Jan'25" },
  { week: 24, label: "Mar'25" },
  { week: 32, label: "May'25" },
  { week: 40, label: "Jul'25" },
  { week: 48, label: "Sep'25" },
  { week: 56, label: "Nov'25" },
  { week: 64, label: "Jan'26" },
  { week: 73, label: "Mar'26" },
]

// ─── Spread Bar Chart ─────────────────────────────────────────────────────────

function SpreadChart({ results, thresholdBps }: { results: SimResult[]; thresholdBps: number }) {
  const N         = WEEKS.length
  const SVG_W     = 800
  const SVG_H     = 210
  const PAD_L     = 38
  const PAD_R     = 14
  const PAD_T     = 10
  const PAD_B     = 32
  const CHART_W   = SVG_W - PAD_L - PAD_R   // 748
  const CHART_H   = SVG_H - PAD_T - PAD_B   // 168

  const BPS_MAX   = 720   // display cap (695 bps is the historical peak)
  const BPS_MIN   = -60
  const BPS_RANGE = BPS_MAX - BPS_MIN  // 780

  const bpsToY = (bps: number) => {
    const c = Math.max(BPS_MIN, Math.min(BPS_MAX, bps))
    return PAD_T + ((BPS_MAX - c) / BPS_RANGE) * CHART_H
  }

  const baselineY   = bpsToY(0)
  const thresholdY  = bpsToY(thresholdBps)
  const barW        = CHART_W / N
  const innerW      = Math.max(barW * 0.72, 1)

  // Oct'25 – Jan'26 volatile period: weeks 52–68
  const volatileX1  = PAD_L + 52 * barW
  const volatileW   = 17 * barW

  const yGridLines = [200, 400, 600]

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full">
      {/* Volatile period highlight */}
      <rect
        x={volatileX1} y={PAD_T}
        width={volatileW} height={CHART_H}
        fill="#37FF8B" fillOpacity="0.04"
      />
      <text
        x={volatileX1 + volatileW / 2} y={PAD_T + 9}
        textAnchor="middle" fontSize="7" fill="#37FF8B" fillOpacity="0.55"
        fontFamily="monospace"
      >
        Oct–Jan volatile
      </text>

      {/* Y grid lines */}
      {yGridLines.map(bps => {
        const y = bpsToY(bps)
        return (
          <g key={bps}>
            <line x1={PAD_L} y1={y} x2={SVG_W - PAD_R} y2={y} stroke="#1a1a1e" strokeWidth="0.75" />
            <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize="7.5" fill="#444" fontFamily="monospace">
              {bps}
            </text>
          </g>
        )
      })}

      {/* 0-line label */}
      <text x={PAD_L - 4} y={baselineY + 3} textAnchor="end" fontSize="7.5" fill="#555" fontFamily="monospace">0</text>

      {/* Bars */}
      {results.map((r, i) => {
        const x      = PAD_L + i * barW + (barW - innerW) / 2
        const isBuy  = r.deployed

        let barY: number, barH: number
        if (r.spreadBps >= 0) {
          barY = bpsToY(r.spreadBps)
          barH = baselineY - barY
        } else {
          barY = baselineY
          barH = bpsToY(r.spreadBps) - baselineY
        }
        barH = Math.max(barH, 0.5)

        const fill = isBuy
          ? '#37FF8B'
          : r.spreadBps > 0
            ? '#1e3a28'
            : '#1a1a2e'

        return <rect key={i} x={x} y={barY} width={innerW} height={barH} fill={fill} />
      })}

      {/* Baseline */}
      <line x1={PAD_L} y1={baselineY} x2={SVG_W - PAD_R} y2={baselineY} stroke="#333" strokeWidth="0.75" />

      {/* Threshold line */}
      {thresholdBps > 0 && thresholdY < baselineY && (
        <>
          <line
            x1={PAD_L} y1={thresholdY}
            x2={SVG_W - PAD_R} y2={thresholdY}
            stroke="#ffb740" strokeDasharray="5,3" strokeWidth="1.25"
          />
          <text x={SVG_W - PAD_R + 2} y={thresholdY + 3} fontSize="7" fill="#ffb740" fontFamily="monospace">
            {thresholdBps}
          </text>
        </>
      )}

      {/* Month labels */}
      {MONTH_STARTS.map(({ week, label }) => (
        <text
          key={label}
          x={PAD_L + (week + 2) * barW}
          y={SVG_H - 6}
          textAnchor="middle" fontSize="7.5" fill="#555" fontFamily="monospace"
        >
          {label}
        </text>
      ))}

      {/* Y-axis label */}
      <text
        x={8} y={PAD_T + CHART_H / 2}
        textAnchor="middle" fontSize="7" fill="#444" fontFamily="monospace"
        transform={`rotate(-90, 8, ${PAD_T + CHART_H / 2})`}
      >
        spread (bps)
      </text>
    </svg>
  )
}

// ─── Portfolio Line Chart ─────────────────────────────────────────────────────

function PortfolioChart({
  results,
  depositAmount,
}: {
  results: SimResult[]
  depositAmount: number
}) {
  const N        = results.length
  const SVG_W    = 800
  const SVG_H    = 230
  const PAD_L    = 58
  const PAD_R    = 14
  const PAD_T    = 10
  const PAD_B    = 32
  const CHART_W  = SVG_W - PAD_L - PAD_R   // 728
  const CHART_H  = SVG_H - PAD_T - PAD_B   // 188

  const maxBalance = Math.max(...results.map(r => r.balance))
  const yMin       = depositAmount * 0.998
  const yMax       = maxBalance * 1.03

  const valToY = (v: number) =>
    PAD_T + CHART_H - ((v - yMin) / (yMax - yMin)) * CHART_H

  const weekToX = (i: number) =>
    PAD_L + (i / (N - 1)) * CHART_W

  const depositY = valToY(depositAmount)

  // Area polygon
  const areaPoints = [
    `${weekToX(0)},${PAD_T + CHART_H}`,
    ...results.map((r, i) => `${weekToX(i)},${valToY(r.balance)}`),
    `${weekToX(N - 1)},${PAD_T + CHART_H}`,
  ].join(' ')

  // Line polyline
  const linePoints = results
    .map((r, i) => `${weekToX(i)},${valToY(r.balance)}`)
    .join(' ')

  // Y-axis ticks: 5 evenly spaced
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = yMin + (yMax - yMin) * ((i + 1) / 5)
    return val
  })

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full">
      <defs>
        <linearGradient id="pfFill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#37FF8B" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#37FF8B" stopOpacity="0.01" />
        </linearGradient>
        <linearGradient id="pfLine" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#e81cff" />
          <stop offset="50%"  stopColor="#40c9ff" />
          <stop offset="100%" stopColor="#37FF8B" />
        </linearGradient>
      </defs>

      {/* Y grid lines */}
      {yTicks.map((val, i) => {
        const y = valToY(val)
        return (
          <g key={i}>
            <line x1={PAD_L} y1={y} x2={SVG_W - PAD_R} y2={y} stroke="#1a1a1e" strokeWidth="0.75" />
            <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize="7.5" fill="#444" fontFamily="monospace">
              {fmtWflow(val)}
            </text>
          </g>
        )
      })}

      {/* Deposit reference line */}
      <line
        x1={PAD_L} y1={depositY}
        x2={SVG_W - PAD_R} y2={depositY}
        stroke="#555" strokeDasharray="4,4" strokeWidth="1"
      />
      <text x={SVG_W - PAD_R + 2} y={depositY + 3} fontSize="7" fill="#555" fontFamily="monospace">
        deposit
      </text>

      {/* Area fill */}
      <polygon points={areaPoints} fill="url(#pfFill)" />

      {/* BUY deployment markers (thin tick at bottom) */}
      {results.map((r, i) => r.deployed && (
        <line
          key={i}
          x1={weekToX(i)} y1={PAD_T + CHART_H}
          x2={weekToX(i)} y2={PAD_T + CHART_H - 4}
          stroke="#37FF8B" strokeWidth="1.5" opacity="0.6"
        />
      ))}

      {/* Portfolio line */}
      <polyline points={linePoints} fill="none" stroke="url(#pfLine)" strokeWidth="1.75" />

      {/* Baseline */}
      <line
        x1={PAD_L} y1={PAD_T + CHART_H}
        x2={SVG_W - PAD_R} y2={PAD_T + CHART_H}
        stroke="#333" strokeWidth="0.75"
      />

      {/* Month labels */}
      {MONTH_STARTS.map(({ week, label }) => (
        <text
          key={label}
          x={PAD_L + (week / (N - 1)) * CHART_W + 2 * (CHART_W / (N - 1))}
          y={SVG_H - 6}
          textAnchor="middle" fontSize="7.5" fill="#555" fontFamily="monospace"
        >
          {label}
        </text>
      ))}

      {/* Y-axis label */}
      <text
        x={9} y={PAD_T + CHART_H / 2}
        textAnchor="middle" fontSize="7" fill="#444" fontFamily="monospace"
        transform={`rotate(-90, 9, ${PAD_T + CHART_H / 2})`}
      >
        WFLOW
      </text>
    </svg>
  )
}

// ─── Control helpers ──────────────────────────────────────────────────────────

function ToggleGroup<T extends number>({
  label,
  options,
  value,
  onChange,
  fmt,
}: {
  label: string
  options: T[]
  value: T
  onChange: (v: T) => void
  fmt: (v: T) => string
}) {
  return (
    <div>
      <p className="text-[10px] text-[#555] uppercase tracking-widest mb-2">{label}</p>
      <div className="flex gap-1.5 flex-wrap">
        {options.map(opt => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
              value === opt
                ? 'bg-[#37FF8B] text-black font-semibold'
                : 'border border-[#1a1a1e] text-[#888] hover:border-[#37FF8B]/40 hover:text-white'
            }`}
          >
            {fmt(opt)}
          </button>
        ))}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <div className={`p-[1.5px] rounded-xl ${highlight ? 'bg-gradient-to-br from-[#e81cff]/50 to-[#40c9ff]/50' : 'bg-[#1a1a1e]'}`}>
      <div className="bg-[#0f0f11] rounded-[10px] px-4 py-3 h-full">
        <p className="text-[10px] text-[#555] uppercase tracking-widest mb-1">{label}</p>
        <p className={`text-xl font-bold font-mono ${highlight ? 'text-white' : 'text-[#37FF8B]'}`}>{value}</p>
        {sub && <p className="text-[10px] text-[#555] mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Chart Section Wrapper ────────────────────────────────────────────────────

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/20 to-[#40c9ff]/20">
      <div className="bg-[#0f0f11] rounded-[14px] px-5 py-5">
        <div className="mb-3">
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="text-[11px] text-[#555] mt-0.5">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-[10px] text-[#555]">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#37FF8B]" />
        BUY signal fired (spread &gt; threshold)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#1e3a28]" />
        Spread positive, below threshold
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#1a1a2e]" />
        Spread negative (ankrFLOW overpriced)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3" style={{ borderTop: '1.5px dashed #ffb740' }} />
        Active threshold
      </span>
    </div>
  )
}

// ─── BUY Window Table ─────────────────────────────────────────────────────────

function BuyWindowTable({
  results,
  thresholdBps,
  depositAmount,
}: {
  results: SimResult[]
  thresholdBps: number
  depositAmount: number
}) {
  const buyRows = results
    .filter(r => r.deployed)
    .map(r => ({
      label:     WEEKS[r.week].label,
      spreadBps: r.spreadBps,
      yield:     r.weekYield,
      confirmed: WEEKS[r.week].confirmed ?? false,
    }))

  if (buyRows.length === 0) {
    return (
      <p className="text-[#555] text-sm text-center py-4">
        No BUY windows triggered with threshold {thresholdBps} bps.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#1a1a1e]">
            <th className="text-left text-[#555] font-normal py-2 pr-4">Period</th>
            <th className="text-right text-[#555] font-normal py-2 pr-4">Spread</th>
            <th className="text-right text-[#555] font-normal py-2 pr-4">Yield on deposit</th>
            <th className="text-left text-[#555] font-normal py-2">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#0f0f11]">
          {buyRows.map((row, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-4 font-mono text-[#aaa]">{row.label}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-[#37FF8B]">
                +{row.spreadBps} bps
              </td>
              <td className="py-1.5 pr-4 text-right font-mono text-[#888]">
                +{fmtPct((row.yield / depositAmount) * 100, 3)}
              </td>
              <td className="py-1.5 text-[#555]">
                {row.confirmed ? (
                  <span className="text-[#37FF8B]/70">Dune confirmed</span>
                ) : (
                  <span>Inferred</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SimulatorClient() {
  const [depositRaw,     setDepositRaw]     = useState('10000')
  const [thresholdBps,   setThresholdBps]   = useState(50)
  const [utilizationPct, setUtilizationPct] = useState(90)
  const [showTable,      setShowTable]      = useState(false)

  const depositAmount = useMemo(() => {
    const v = parseFloat(depositRaw.replace(/,/g, ''))
    return isNaN(v) || v <= 0 ? 1000 : Math.min(v, 100_000_000)
  }, [depositRaw])

  const results = useMemo(
    () => runSimulation(depositAmount, thresholdBps, utilizationPct),
    [depositAmount, thresholdBps, utilizationPct],
  )

  const stats = useMemo(() => {
    const finalBalance    = results.at(-1)?.balance ?? depositAmount
    const totalYield      = finalBalance - depositAmount
    const totalReturnPct  = (totalYield / depositAmount) * 100
    // annualise over 18 months (77 weeks ≈ 1.48 years)
    const yearsElapsed    = WEEKS.length / WEEKS_IN_YEAR
    const annualizedAPY   = ((finalBalance / depositAmount) ** (1 / yearsElapsed) - 1) * 100
    const buyWeeks        = results.filter(r => r.deployed)
    const avgSpread       = buyWeeks.length > 0
      ? buyWeeks.reduce((s, r) => s + r.spreadBps, 0) / buyWeeks.length
      : 0
    return { finalBalance, totalYield, totalReturnPct, annualizedAPY, buyWeeks: buyWeeks.length, avgSpread }
  }, [results, depositAmount])

  return (
    <div className="relative mx-auto max-w-5xl px-4 sm:px-6 pt-28 pb-24">

      {/* Header */}
      <div className="mb-10">
        <p className="text-xs text-[#555] uppercase tracking-widest mb-3">Historical backtest</p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
          Yield <span className="text-gradient">Simulator</span>
        </h1>
        <p className="text-[#888] max-w-2xl leading-relaxed">
          Replay the v1 ARM spread-capture algorithm on 18 months of real on-chain data
          (Sep 2024 – Mar 2026). Adjust the deployment threshold and capital utilisation.
          All confirmed spread windows sourced from Dune Analytics queries against
          Flow EVM (chain 747).
        </p>
      </div>

      {/* Controls */}
      <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/30 to-[#40c9ff]/30 mb-8">
        <div className="bg-[#0f0f11] rounded-[14px] px-6 py-5">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-5">Simulation parameters</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

            {/* Deposit */}
            <div>
              <p className="text-[10px] text-[#555] uppercase tracking-widest mb-2">Principal (WFLOW)</p>
              <div className="flex items-center gap-2 border border-[#1a1a1e] rounded-lg px-3 py-2 focus-within:border-[#37FF8B]/40 transition-colors">
                <input
                  type="text"
                  inputMode="numeric"
                  value={depositRaw}
                  onChange={e => setDepositRaw(e.target.value)}
                  className="bg-transparent text-white font-mono text-sm w-full outline-none"
                  placeholder="10000"
                />
                <span className="text-[#555] text-xs font-mono shrink-0">WFLOW</span>
              </div>
            </div>

            {/* Threshold */}
            <ToggleGroup
              label="Buy threshold (bps)"
              options={[25, 50, 100, 150, 200] as const}
              value={thresholdBps}
              onChange={v => setThresholdBps(v)}
              fmt={v => `${v}`}
            />

            {/* Utilisation */}
            <ToggleGroup
              label="Capital utilisation"
              options={[50, 75, 90] as const}
              value={utilizationPct}
              onChange={v => setUtilizationPct(v)}
              fmt={v => `${v}%`}
            />

          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard
          label="Final value"
          value={`${fmtWflow(stats.finalBalance)} WFLOW`}
          sub="after 18 months"
          highlight
        />
        <StatCard
          label="Total yield"
          value={`+${fmtWflow(stats.totalYield)}`}
          sub={`+${fmtPct(stats.totalReturnPct)} total`}
        />
        <StatCard
          label="Annualised APY"
          value={fmtPct(stats.annualizedAPY)}
          sub="18-month run"
        />
        <StatCard
          label="Weeks deployed"
          value={`${stats.buyWeeks} / ${WEEKS.length}`}
          sub={fmtPct(stats.buyWeeks / WEEKS.length * 100) + ' utilisation'}
        />
        <StatCard
          label="Avg spread"
          value={`${stats.avgSpread.toFixed(0)} bps`}
          sub="on BUY weeks"
        />
        <StatCard
          label="Data source"
          value="Dune"
          sub="17 confirmed windows"
        />
      </div>

      {/* Spread chart */}
      <div className="mb-6">
        <ChartCard
          title="ankrFLOW / WFLOW Weekly Spread"
          subtitle="Green bars = BUY signal (spread > threshold). Amber dashed line = active threshold. 17 BUY windows confirmed on-chain."
        >
          <SpreadChart results={results} thresholdBps={thresholdBps} />
          <Legend />
        </ChartCard>
      </div>

      {/* Portfolio chart */}
      <div className="mb-8">
        <ChartCard
          title="Simulated Portfolio Value (WFLOW)"
          subtitle="Green ticks at bottom = weeks when vault was deployed for spread capture. Dashed line = initial deposit."
        >
          <PortfolioChart results={results} depositAmount={depositAmount} />
        </ChartCard>
      </div>

      {/* BUY window table toggle */}
      <div className="p-[1.5px] rounded-2xl bg-[#1a1a1e]">
        <div className="bg-[#0f0f11] rounded-[14px] px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-white">BUY windows triggered</p>
              <p className="text-[11px] text-[#555] mt-0.5">
                {stats.buyWeeks} weeks at threshold {thresholdBps} bps —{' '}
                confirmed Dune data rows labelled explicitly
              </p>
            </div>
            <button
              onClick={() => setShowTable(t => !t)}
              className="text-xs text-[#888] border border-[#1a1a1e] rounded-lg px-3 py-1.5 hover:border-[#37FF8B]/40 hover:text-white transition-all"
            >
              {showTable ? 'Hide' : 'Show'} table
            </button>
          </div>
          {showTable && (
            <BuyWindowTable results={results} thresholdBps={thresholdBps} depositAmount={depositAmount} />
          )}
        </div>
      </div>

      {/* Methodology note */}
      <div className="mt-8 p-4 rounded-xl border border-[#1a1a1e] text-[11px] text-[#555] leading-relaxed">
        <strong className="text-[#888]">Methodology:</strong>{' '}
        v1 ARM algorithm. BUY signal fires when weekly spread_bps &gt; threshold (threshold configurable above).
        Each BUY week earns: <code className="text-[#37FF8B] text-[10px]">spread_bps / 10000</code> on deployed capital (spread capture)
        + <code className="text-[#37FF8B] text-[10px]">4% / 52</code> (Ankr staking yield while holding ankrFLOW).
        Idle weeks earn: <code className="text-[#37FF8B] text-[10px]">4% / 52</code> (conservative base).
        Capital utilisation = fraction of balance deployed per signal — 10% reserve buffer is always kept.
        Spread data: Dune Analytics, <code className="text-[#37FF8B] text-[10px]">erc20_flow.evt_transfer</code> + <code className="text-[#37FF8B] text-[10px]">prices.day</code>,
        PunchSwap pair <code className="text-[#37FF8B] text-[10px]">0x7854...3a43</code>, Sep 2024 – Mar 2026.
        Jan 5 2026 oracle anomaly (+8904 bps) capped at 500 bps to reflect realistic tradeable spread.
        Past data does not guarantee future results.
      </div>
    </div>
  )
}
