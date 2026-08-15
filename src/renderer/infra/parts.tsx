/** Small shared pieces for the Infra view. Nothing here holds state. */

/* Status tones are their own colours, deliberately not the accent — the accent *is*
 * the theme, so borrowing it for "warning" makes the two unreadable together. */
const TONE = {
  ok: 'border-ok/40 text-ok',
  warn: 'border-warn/50 text-warn',
  danger: 'border-danger/50 text-danger',
  muted: 'border-line text-muted',
} as const

export function Chip({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode
  tone?: keyof typeof TONE
}): React.JSX.Element {
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-micro ${TONE[tone]}`}>
      {children}
    </span>
  )
}

export function SmallButton({
  children,
  onClick,
  disabled,
  danger,
  primary,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  /** The one action that moves you forward. Reserve it — two primaries is none. */
  primary?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'rounded-control border px-2 py-1 text-meta transition disabled:opacity-40',
        danger
          ? 'border-line text-danger hover:border-danger/50'
          : primary
            ? 'border-accent-deep bg-accent/15 text-accent-hi hover:bg-accent/25'
            : 'border-line text-ink hover:border-accent-deep',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function Field({
  value,
  onChange,
  placeholder,
  type,
  onEnter,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  onEnter?: () => void
}): React.JSX.Element {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter?.()
      }}
      className="min-w-0 flex-1 rounded-control border border-line bg-raised px-2.5 py-1 font-mono text-meta text-ink outline-none focus:border-accent-deep"
    />
  )
}

export function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2 rounded-panel border border-line bg-raised/50 p-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
