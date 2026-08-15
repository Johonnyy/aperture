import { useStore } from '../../store'
import { useSettings } from '../context'
import { Field, Note, Toggle, field } from '../parts'

/**
 * Where Amber is and how to prove you may talk to her.
 *
 * The only page whose settings do not take effect on Save — a URL and a token are
 * read when the socket dials, so the save bar grows a "Save & reconnect" the moment
 * either of these two fields moves. That button used to live at the bottom of the one
 * long page, where it was offered for every setting and needed by two.
 */
export function Connection(): React.JSX.Element {
  const { draft, saved, set } = useSettings()
  const connState = useStore((s) => s.connection.state)
  const status = useStore((s) => s.connection)

  const willReconnect =
    draft.amberUrl !== saved.amberUrl || draft.authToken !== saved.authToken

  return (
    <>
      <Field
        label="Amber URL"
        hint={
          <>
            Local dev is <code>ws://localhost:8000/ws</code>; a deployed instance uses{' '}
            <code>wss://</code>.
          </>
        }
      >
        <input
          className={field}
          value={draft.amberUrl}
          onChange={(e) => set({ amberUrl: e.target.value })}
          placeholder="ws://localhost:8000/ws"
          spellCheck={false}
        />
      </Field>

      <Field
        label="Auth token"
        hint={
          <>
            Sent as a bearer header. Leave empty when Amber runs without{' '}
            <code>AMBER_AUTH_SECRET</code>.
          </>
        }
      >
        <input
          className={field}
          type="password"
          value={draft.authToken}
          onChange={(e) => set({ authToken: e.target.value })}
          placeholder="AMBER_AUTH_SECRET (leave empty if unset)"
          spellCheck={false}
        />
      </Field>

      <Toggle
        label="Reconnect automatically"
        hint="Retry with backoff when the connection drops, resuming the session."
        checked={draft.autoReconnect}
        onChange={(autoReconnect) => set({ autoReconnect })}
      />

      {willReconnect && connState === 'open' ? (
        <Note>
          Connected to <code>{saved.amberUrl}</code> right now. These apply on the next
          dial, so use <strong>Save &amp; reconnect</strong> below to move immediately.
        </Note>
      ) : (
        <Note>
          {connState === 'open' ? (
            <>
              Connected{status.sessionId ? <> · session {status.sessionId}</> : null}.
            </>
          ) : (
            <>
              Not connected{status.detail ? <> — {status.detail}</> : null}. The
              connection control is at the foot of the sidebar.
            </>
          )}
        </Note>
      )}
    </>
  )
}
