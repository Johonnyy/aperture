import { cn } from '../cn'

/**
 * The small instruments the status panel is built from.
 *
 * Hand-rolled SVG rather than a chart library, and that is a size judgement rather
 * than a principle: at sixteen pixels a charting library is all overhead and no
 * benefit, and every one of them ships a default palette that would have to be
 * overridden token by token anyway. Recharts earns its place in the spend panel,
 * where the charts are real.
 *
 * Everything here takes its colour from a token via `currentColor`, so a caller
 * writes `text-ok` and the instrument follows the theme — including the light one.
 */

/** A status light. The only thing on screen allowed to pulse while work is live. */
export function Dot({
  tone = 'muted',
  pulse = false,
  className,
}: {
  tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'muted'
  pulse?: boolean
  className?: string
}): React.JSX.Element {
  const TONE = {
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    accent: 'bg-accent',
    muted: 'bg-muted',
  } as const
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        TONE[tone],
        pulse && 'animate-pulse-dot',
        className,
      )}
    />
  )
}

/**
 * A progress arc.
 *
 * Used for the connection state and for a retry countdown, where a bar would read as
 * "loading" and an arc reads as "a cycle in progress" — which is what a reconnect
 * backoff actually is.
 */
export function Ring({
  value,
  size = 18,
  className,
  children,
}: {
  /** 0..1. Clamped. */
  value: number
  size?: number
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(1, value))
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <span className={cn('relative inline-grid place-items-center', className)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-line"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="stroke-current transition-[stroke-dashoffset]"
        />
      </svg>
      {children && <span className="absolute">{children}</span>}
    </span>
  )
}

/** A budget bar. `value/max`, with the fill taking its colour from the caller. */
export function Meter({
  value,
  max,
  className,
}: {
  value: number
  max: number
  className?: string
}): React.JSX.Element {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-line">
      <span
        style={{ width: `${pct}%` }}
        className={cn('block h-full bg-current transition-[width]', className)}
      />
    </span>
  )
}

/**
 * A trend, small enough to sit on a row.
 *
 * Deliberately unlabelled: a sparkline answers "is this going up" and nothing else.
 * When the number matters it is written beside it as text.
 */
export function Sparkline({
  points,
  width = 64,
  height = 16,
  className,
}: {
  points: number[]
  width?: number
  height?: number
  className?: string
}): React.JSX.Element | null {
  if (points.length < 2) return null
  const peak = Math.max(...points, 1)
  const step = width / (points.length - 1)
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - (p / peak) * height).toFixed(1)}`)
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <path d={path} fill="none" strokeWidth={1.5} className="stroke-current" />
    </svg>
  )
}

/** A labelled status tile for the system grid. */
export function Tile({
  label,
  value,
  tone = 'muted',
  hint,
}: {
  label: string
  value?: string
  tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'muted'
  hint?: string
}): React.JSX.Element {
  return (
    <div
      title={hint}
      className="flex min-w-0 items-center gap-1.5 rounded-control border border-line px-2 py-1.5"
    >
      <Dot tone={tone} />
      <span className="min-w-0 flex-1 truncate text-nano text-muted uppercase">
        {label}
      </span>
      {value && (
        <span className="shrink-0 font-mono text-nano text-ink tabular-nums">
          {value}
        </span>
      )}
    </div>
  )
}
