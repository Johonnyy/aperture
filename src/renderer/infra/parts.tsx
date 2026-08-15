/** Small shared pieces for the Infra view. Nothing here holds state. */

const TONE = {
  ok: 'border-ok/40 text-ok',
  warn: 'border-amber-deep text-amber',
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
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${TONE[tone]}`}>
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
        'rounded-lg border px-2 py-1 text-[11px] transition disabled:opacity-40',
        danger
          ? 'border-line text-danger hover:border-danger/50'
          : primary
            ? 'border-amber-deep bg-amber/15 text-amber-hi hover:bg-amber/25'
            : 'border-line text-ink hover:border-amber-deep',
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
      className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-2.5 py-1 font-mono text-[11px] text-ink outline-none focus:border-amber-deep"
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
    <section className="flex flex-col gap-2 rounded-[14px] border border-line bg-raised/50 p-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
