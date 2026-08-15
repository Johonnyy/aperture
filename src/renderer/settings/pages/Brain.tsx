import { FALLBACK_KEYWORDS } from '../../../shared/models'
import { useStore } from '../../store'
import { useSettings } from '../context'
import { Field, Note, field } from '../parts'

/**
 * Which brain answers.
 *
 * This is **this machine's** preference — a keyword, saved locally, re-sent on every
 * connection, `''` meaning "whatever Amber is configured for". Same shape, same
 * sentinel and same draft discipline as the voice controls.
 *
 * What a keyword *points at* is emphatically not this, which is why it is a separate
 * page rather than a block further down: that is shared state living in Amber's
 * database and pushed to the sync store, so re-pointing `coding` moves every app in
 * the ecosystem. Two settings that look like one, on two pages, one of which says so.
 */
export function Brain(): React.JSX.Element {
  const { draft, set, go } = useSettings()
  const model = useStore((s) => s.model)
  const connState = useStore((s) => s.connection.state)

  const live = Boolean(model?.options)
  const locked = model?.locked === true
  const effective = model?.settings
  const keywords = model?.options?.keywords ?? FALLBACK_KEYWORDS
  const chosen = keywords.find((k) => k.name === draft.llmKeyword)

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0" disabled={locked}>
      <legend className="sr-only">Brain</legend>

      {!live && (
        <Note>
          {connState === 'open' ? (
            <>
              This Amber never sent a model catalogue, so it is running a build from
              before model control — update it and these will start applying. Choices
              made here are saved and re-sent on every connection meanwhile.
            </>
          ) : (
            <>
              Not connected, so these are the keywords Amber is expected to know rather
              than the ones it named — and what each points at is only readable from
              Amber itself.
            </>
          )}
        </Note>
      )}
      {locked && (
        <Note>
          Pinned on the server — <code>AMBER_FEATURE_MODEL_CONTROL</code> is off, so
          Amber ignores what this app asks for. It is currently answering with{' '}
          <strong>{effective?.keyword}</strong> (<code>{effective?.model}</code>).
        </Note>
      )}

      <Field
        label="Answer with"
        hint={
          chosen?.model ? (
            <>
              Currently <code>{chosen.model}</code>. Applies to the next turn after you
              save — nothing reconnects.
            </>
          ) : (
            <>You pick a model by describing it, not by naming it.</>
          )
        }
      >
        <select
          className={field}
          value={draft.llmKeyword}
          onChange={(e) => set({ llmKeyword: e.target.value })}
        >
          <option value="">
            Amber&apos;s default{effective ? ` (${effective.default_keyword})` : ''}
          </option>
          {keywords.map((keyword) => (
            <option key={keyword.name} value={keyword.name}>
              {keyword.name}
              {keyword.description ? ` — ${keyword.description}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <Note>
        What each word points at is shared with every app in the ecosystem —{' '}
        <button
          type="button"
          onClick={() => go('keywords')}
          className="text-accent-hi underline decoration-dotted underline-offset-2"
        >
          Keywords
        </button>{' '}
        is where that lives.
      </Note>
    </fieldset>
  )
}
