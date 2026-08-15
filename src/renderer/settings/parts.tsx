/**
 * The handful of primitives every settings page draws with.
 *
 * They exist so a new page is a list of controls rather than a list of class strings:
 * the input treatment was already copy-pasted four times in the old single-column
 * page, and four copies is how a settings screen starts looking assembled.
 */

const FIELD =
  'w-full rounded-field border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep disabled:opacity-40'

/** The input/select treatment. A constant rather than a component — `<select>`,
 *  `<input type=range>` and a datalist-backed text field want the same border and
 *  nothing else in common. */
export const field = FIELD

/** A labelled control with an optional explanation under it. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-(--color-accent)"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </span>
    </label>
  )
}

/** A standing explanation — connection state, a server-side lock, a caveat. */
export function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="text-xs text-muted">{children}</p>
}

/** A rule between two groups of controls on the same page. */
export function Divider(): React.JSX.Element {
  return <hr className="border-0 border-t border-line" />
}

/** A subheading inside a page, for the rare page with two distinct halves. */
export function Subhead({
  title,
  blurb,
}: {
  title: string
  blurb?: string
}): React.JSX.Element {
  return (
    <div>
      <h2 className="text-sm font-medium">{title}</h2>
      {blurb && <p className="mt-1 text-xs text-muted">{blurb}</p>}
    </div>
  )
}
