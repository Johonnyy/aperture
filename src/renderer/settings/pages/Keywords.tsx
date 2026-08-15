import { useEffect, useState } from 'react'

import type { CatalogueModel } from '../../../shared/models'
import type { ModelKeyword } from '../../../shared/protocol'
import { useStore } from '../../store'
import { Note } from '../parts'

/**
 * What the keywords mean.
 *
 * **Shared state**, and the only page in Settings that is. It lives in Amber's
 * database and is pushed to the sync store, so re-pointing `coding` here moves every
 * app in the ecosystem. It therefore applies on commit rather than on Save — like the
 * theme picker, and for a stronger reason: a draft of somebody else's state would be a
 * change you could stage, walk away from, and never make. There is nothing local to
 * stage. What comes back in the `model` frame is the only truth about it.
 *
 * That is also why it is its own page hanging off Brain rather than a `<details>`
 * inside it. The save bar does not apply here, and a block that ignores the save bar
 * sitting directly under blocks that obey it was the single most misleading thing on
 * the old page.
 *
 * The model field is free text with suggestions, never a closed list. A model
 * published this morning has to be usable this morning; a picker limited to a fetched
 * catalogue would reintroduce exactly the delay this feature removes.
 */
export function Keywords(): React.JSX.Element {
  const model = useStore((s) => s.model)
  const [catalogue, setCatalogue] = useState<CatalogueModel[]>([])

  const live = Boolean(model?.options)
  const locked = model?.locked === true
  const keywords = model?.options?.keywords ?? []
  const sync = model?.options?.sync

  // Suggestions only; an empty list costs nothing but a shorter dropdown.
  useEffect(() => {
    let alive = true
    void window.aperture.amber.modelCatalogue().then((models) => {
      if (alive) setCatalogue(models)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!live) {
    return (
      <Note>
        Connect to Amber to see and change what these point at. The table lives in her
        database, so there is nothing local to show meanwhile.
      </Note>
    )
  }

  return (
    <fieldset className="flex flex-col gap-4 border-0 p-0" disabled={locked}>
      <legend className="sr-only">Keyword map</legend>

      <Note>
        {sync?.enabled ? (
          <>
            Shared with every app through the sync store, so <code>coding</code> means
            one thing everywhere.{' '}
            {sync.pending
              ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} still waiting to reach it.`
              : sync.last_error
                ? `The store last refused: ${sync.last_error}`
                : 'Everything here is in step with it.'}
          </>
        ) : (
          <>
            Stored in Amber&apos;s own database and applied on the next turn. No sync
            store is configured, so these stay local to this Amber rather than reaching
            the other apps.
          </>
        )}
      </Note>

      {locked && (
        <Note>
          <code>AMBER_FEATURE_MODEL_CONTROL</code> is off on the server, so this table is
          read-only from here.
        </Note>
      )}

      <div className="flex flex-col gap-3">
        {keywords.map((keyword) => (
          <KeywordRow key={keyword.name} keyword={keyword} />
        ))}
      </div>

      <Note>
        Changes here save themselves — they are not part of the draft the bar at the
        bottom commits.
      </Note>

      {/* One datalist for every row. Rendering a few thousand options per keyword
          would be pointless weight, and the suggestions are identical. */}
      <datalist id="openrouter-models">
        {catalogue.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </datalist>
    </fieldset>
  )
}

/**
 * One keyword, and the model it points at.
 *
 * Committed on blur or Enter rather than per keystroke — every commit is a write every
 * app in the ecosystem will read, so `anthropic/c` must never be one of them. The
 * input is re-seeded from the frame whenever Amber's answer changes, which is what
 * makes a refused value visibly snap back instead of appearing to have worked.
 */
function KeywordRow({ keyword }: { keyword: ModelKeyword }): React.JSX.Element {
  const [value, setValue] = useState(keyword.model)

  useEffect(() => setValue(keyword.model), [keyword.model])

  const commit = (next: string | null): void => {
    void window.aperture.amber.remapModel(keyword.name, next)
  }

  const dirty = value.trim() !== keyword.model

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-meta text-ink">{keyword.name}</span>
        {keyword.overridden && (
          <button
            type="button"
            onClick={() => commit(null)}
            className="text-micro text-muted underline decoration-dotted hover:text-ink"
          >
            reset
          </button>
        )}
        {keyword.overridden && !keyword.shared && (
          <span className="text-micro text-muted">not shared yet</span>
        )}
      </div>
      <input
        className="w-full rounded-field border border-line bg-ground px-3 py-1.5 font-mono text-meta text-ink outline-none focus:border-accent-deep"
        list="openrouter-models"
        value={value}
        spellCheck={false}
        placeholder="vendor/model"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => dirty && commit(value.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(value.trim() || null)
          } else if (e.key === 'Escape') {
            setValue(keyword.model)
          }
        }}
      />
      {keyword.description && (
        <span className="text-micro text-muted">{keyword.description}</span>
      )}
    </div>
  )
}
