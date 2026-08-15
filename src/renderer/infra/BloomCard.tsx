import { useState } from 'react'

import { containerExists } from '../../shared/bloom'
import type { InfraStatus } from '../../shared/types'
import { useStore } from '../store'
import { Card, Chip, SmallButton } from './parts'

/**
 * Linking Bloom, from the box it runs on.
 *
 * This lives in the Servers tab rather than beside Bloom's own settings for one
 * reason: reading the admin key means reading a root-only file, and the sudo
 * password exists here — held in this view's state for as long as it is open, sent
 * per action, never stored. Putting a Link button anywhere else would mean either
 * persisting a root password or asking for it in a second place with a second
 * lifetime.
 *
 * The domain comes from the status document rather than being derived here. That
 * document reports `apps.bloom.domain` already, and grepping secrets.yaml for it
 * would be a second, worse YAML parser for a value we are holding.
 *
 * What the probe adds is the one thing the status document is designed *never* to
 * carry: a secret. `EnvVar.value` is null for anything classified as one, precisely
 * so the document stays safe to poll and log.
 */
export function BloomCard({
  status,
  serverId,
  sudoPassword,
  needsPassword,
}: {
  status: InfraStatus
  serverId: string
  sudoPassword: () => string | undefined
  needsPassword: boolean
}): React.JSX.Element | null {
  const link = useStore((s) => s.bloomLink)
  const setBloomLink = useStore((s) => s.setBloomLink)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const app = status.apps.find((a) => a.name === 'bloom')
  // Nothing to say on a box that has never heard of Bloom. The Catalogue card next
  // door is what offers to install it.
  if (!app) return null

  const deployed = containerExists(app.container)
  const linkedHere = link.serverId === serverId && link.state !== 'unlinked'

  const doLink = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.aperture.bloom.discover(
      serverId,
      app.domain ?? '',
      sudoPassword(),
    )
    setBusy(false)
    if (result.link) setBloomLink(result.link)
    if (!result.ok) setError(result.error ?? 'Could not link Bloom.')
  }

  return (
    <Card
      title="Bloom"
      hint="Reads the admin key off this box so the Bloom tab can manage its agents."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={deployed ? (app.container === 'running' ? 'ok' : 'warn') : 'muted'}>
          {app.container}
        </Chip>
        {app.domain && <span className="font-mono text-meta text-muted">{app.domain}</span>}
        {linkedHere && <Chip tone={link.state === 'linked' ? 'ok' : 'warn'}>{link.state}</Chip>}
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      {!deployed ? (
        <p className="text-xs text-muted">
          Declared but not deployed here. Install it first, then link.
        </p>
      ) : !app.domain ? (
        <p className="text-xs text-muted">
          No domain recorded for Bloom on this box, so there is no address to reach it
          on. Set <code>apps.bloom.domain</code> in secrets.yaml and re-read.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SmallButton
            primary={!linkedHere}
            disabled={busy || needsPassword}
            title={
              needsPassword
                ? 'Enter the sudo password above — the admin key is in a root-only file.'
                : undefined
            }
            onClick={() => void doLink()}
          >
            {busy ? 'Reading…' : linkedHere ? 'Re-link' : 'Link Bloom'}
          </SmallButton>
          <span className="text-xs text-muted">
            {linkedHere
              ? 'Re-read the key if it has been rotated.'
              : 'Adds the Bloom tab to the sidebar.'}
          </span>
        </div>
      )}
    </Card>
  )
}
