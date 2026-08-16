import { useStore } from '../store'
import { Tile } from '../viz/primitives'

/**
 * What this Amber can reach, and which halves of it are switched on.
 *
 * Every value here comes from the `status` frame rather than being inferred. That is
 * the point: before it existed, a client could only deduce a peer's existence from a
 * `bloom__*` tool name it happened to watch go past — and an unlisted peer produces
 * no error of any kind, because it is not a failing tool, it is no tool. The whole
 * class of "why can't she do that" was invisible from here.
 */
export function SystemPanel(): React.JSX.Element {
  const status = useStore((s) => s.status)
  const model = useStore((s) => s.model)

  if (!status) {
    return (
      <p className="text-meta text-muted">
        This Amber doesn&apos;t report its status — it predates the frame.
      </p>
    )
  }

  const features = status.features ?? {}
  const peers = status.peers

  return (
    <div className="flex flex-col gap-3">
      {status.session && (
        <div className="grid grid-cols-2 gap-1">
          <Tile
            label="turns"
            value={`${status.session.turns}/${status.session.max_turns}`}
            tone={
              status.session.turns / Math.max(1, status.session.max_turns) > 0.8
                ? 'warn'
                : 'ok'
            }
            hint="This session's lifetime turn cap."
          />
          <Tile
            label="history"
            value={String(status.session.history)}
            hint="Messages the brain is carrying. This is what silently grows until replies cost more."
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-nano tracking-wide text-muted uppercase">Peers</span>
        {!peers?.known.length && (
          <p className="text-meta text-muted">
            {peers?.enabled
              ? 'Discovery is on, but nothing has registered.'
              : 'None configured, and discovery is off.'}
          </p>
        )}
        {peers?.known.map((peer) => (
          <Tile
            key={peer.name}
            label={peer.name}
            value={peer.tools ? `${peer.tools} tools` : undefined}
            tone={peer.base_url ? 'ok' : 'warn'}
            hint={peer.base_url ?? 'Known by name, but it would not resolve.'}
          />
        ))}
        {peers?.last_error && (
          <p className="text-nano text-warn">Discovery: {peers.last_error}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-nano tracking-wide text-muted uppercase">Running</span>
        <div className="grid grid-cols-2 gap-1">
          {/* Only the ones whose absence changes what the app can do. A feature list
              nobody can act on is just another wall of text. */}
          <Tile label="memory" tone={features.memory ? 'ok' : 'muted'} />
          <Tile label="tools" tone={features.tools ? 'ok' : 'muted'} />
          <Tile label="mcp" tone={features.mcp_server ? 'ok' : 'muted'} />
          <Tile label="maintenance" tone={features.maintenance ? 'ok' : 'muted'} />
          <Tile label="signals" tone={features.signals ? 'ok' : 'muted'} />
          <Tile
            label="sync"
            tone={status.sync?.enabled ? (status.sync.last_error ? 'warn' : 'ok') : 'muted'}
            hint={status.sync?.last_error ?? status.sync?.last_ok ?? undefined}
          />
        </div>
      </div>

      {model?.settings && (
        <div className="flex items-center gap-1.5 text-meta">
          <span className="text-muted">brain</span>
          <span className="text-ink">{model.settings.keyword}</span>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-nano text-muted">
            {model.settings.model}
          </span>
        </div>
      )}
    </div>
  )
}
