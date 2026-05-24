'use client'
import { useState } from 'react'

export type DonutSlice = { name: string; color: string; value: number }

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function TreasuryDonut({
  slices,
  totalUsd,
  size = 280,
  thickness = 42,
}: {
  slices: DonutSlice[]
  totalUsd: number
  size?: number
  thickness?: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const r = size / 2 - thickness / 2 - 2
  const C = 2 * Math.PI * r
  const total = slices.reduce((s, x) => s + x.value, 0)
  const paths = slices.reduce<Array<(typeof slices)[0] & { dashOff: number; len: number; i: number }>>(
    (acc, s, i) => {
      const len = total > 0 ? (s.value / total) * C : 0
      const dashOff = acc.length > 0 ? (acc[acc.length - 1]?.dashOff ?? 0) + (acc[acc.length - 1]?.len ?? 0) : 0
      acc.push({ ...s, dashOff, len, i })
      return acc
    },
    [],
  )
  const active = hovered !== null ? slices[hovered] : null

  return (
    <div>
      <div className="relative mx-auto" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={thickness}
          />
          {paths.map(({ name, color, dashOff, len, i }) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={hovered === i ? thickness + 5 : thickness}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-dashOff}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ cursor: 'pointer', transition: 'stroke-width 0.12s ease' }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              aria-label={`${name}: ${fmtUSD(slices[i].value)}`}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-fg)]">
            {active ? active.name : 'Total value'}
          </div>
          <div
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: 34, letterSpacing: '-0.02em' }}
          >
            {fmtUSD(active ? active.value : totalUsd)}
          </div>
          <div className="text-[12px] text-[var(--muted-fg)]">
            {active
              ? `${((active.value / totalUsd) * 100).toFixed(1)}% of treasury`
              : `across ${slices.length} asset${slices.length !== 1 ? 's' : ''}`}
          </div>
        </div>
      </div>
      <div className="mt-[22px] flex flex-col gap-2.5 text-left">
        {slices.map((s, i) => (
          <div
            key={i}
            className="grid items-center gap-2.5 text-[13.5px]"
            style={{ gridTemplateColumns: '14px 1fr auto' }}
          >
            <span
              className="h-3 w-3 shrink-0 rounded-[3px]"
              style={{ background: s.color }}
            />
            <span>{s.name}</span>
            <span className="font-mono text-xs text-[var(--muted-fg)]">
              {((s.value / totalUsd) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
