import type { InfraStatus } from '../../shared/types'
import { Card, Chip, SmallButton } from './parts'
import type { Params } from './useRunner'

/**
 * The one thing to do next.
 *
 * A box gets from bare to *ready to install things* over three steps, and until it is
 * there the rest of this page is a wall of empty cards describing a destination rather
 * than a route. Which step you are on is not a guess — `status.sh` reports the
 * checkout, the tools, the secrets file and its remaining placeholders.
 *
 * Installing is deliberately NOT a step here. Which apps belong on this box is a
 * question about the server split, and the app list is what knows the answer; a setup
 * wizard that ended in "install the first app" had no way to know that the app it was
 * pointing at lives on somebody else's server.
 *
 * Step 3 is deliberately not a button. Filling in an OpenAI key is not something this
 * app can do, and `install.sh` stops at the same point for the same reason: a secret
 * invented at a prompt is a secret that is not in your backups. What it can do is
 * generate everything whose placeholder text is literally the recipe, then list what
 * is left and open an editor on the file.
 */
export function Setup({
  status,
  run,
  onOpenTerminal,
  disabled,
}: {
  status: InfraStatus
  run: (actionId: string, title: string, params?: Params) => void
  onOpenTerminal: (command?: string) => void
  disabled: boolean
}): React.JSX.Element | null {
  const stage = stageOf(status)
  if (stage === 'ready') return null

  return (
    <Card title="Getting started" hint={`Step ${STEPS.indexOf(stage) + 1} of ${STEPS.length}.`}>
      <ol className="flex flex-col gap-1">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={[
              'flex items-center gap-2 text-meta',
              s === stage ? 'text-ink' : i < STEPS.indexOf(stage) ? 'text-ok' : 'text-muted',
            ].join(' ')}
          >
            <span className="w-4 shrink-0 text-center">
              {i < STEPS.indexOf(stage) ? '✓' : i + 1}
            </span>
            {LABELS[s]}
          </li>
        ))}
      </ol>

      <div className="mt-2 rounded-field border border-line bg-ground p-3">
        {stage === 'tools' && (
          <Step
            body="Some of the tools the management view depends on are missing. Re-running the bootstrap installs git, jq, curl and yq — status.sh reads secrets.yaml with yq, so until it is there this screen is largely blind."
            action={
              <SmallButton
                disabled={disabled}
                onClick={() => run('bootstrap', 'Install the prerequisites', { repo: '' })}
              >
                Install prerequisites
              </SmallButton>
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {(['git', 'jq', 'yq', 'docker'] as const).map((tool) => (
                <Chip key={tool} tone={status.tools[tool] ? 'ok' : 'warn'}>
                  {tool} {status.tools[tool] ? '✓' : 'missing'}
                </Chip>
              ))}
            </div>
          </Step>
        )}

        {stage === 'secrets' && (
          <Step
            body={`Every generated .env in the ecosystem is rendered from one file: ${status.secrets.path}. It does not exist yet. This copies the committed example there, 0600 root — it never overwrites an existing one.`}
            action={
              <SmallButton disabled={disabled} onClick={() => run('writeSecrets', 'Create the secrets file')}>
                Create secrets.yaml
              </SmallButton>
            }
          />
        )}

        {stage === 'fill' && (
          <Step
            body="The file is there but still holds placeholders. The random ones can be generated here; the rest are keys only you have."
            action={
              <>
                {status.secrets.placeholders.generatable.length > 0 && (
                  <SmallButton
                    disabled={disabled}
                    onClick={() => run('generateSecrets', 'Generate the random tokens')}
                  >
                    Generate {status.secrets.placeholders.generatable.length} token
                    {status.secrets.placeholders.generatable.length === 1 ? '' : 's'}
                  </SmallButton>
                )}
                <SmallButton
                  onClick={() => onOpenTerminal(`sudo nano ${status.secrets.path}`)}
                  title="Opens a shell on this box with the editor command ready"
                >
                  Edit on the server
                </SmallButton>
              </>
            }
          >
            <ul className="flex flex-col gap-0.5">
              {/* Placeholders belonging to something that is not running are not work
                  in the way the rest of this list is. Say which, so the list can be
                  read for what still blocks you. */}
              {status.apps.some((a) => a.container === 'missing') && (
                <li className="text-meta text-muted">
                  Some of these belong to apps that are declared but not deployed (
                  {status.apps
                    .filter((a) => a.container === 'missing')
                    .map((a) => a.name)
                    .join(', ')}
                  ). Install those below when you are ready, or use Remove declaration if
                  you never will.
                </li>
              )}
              {!status.secrets.acmeEmailSet && (
                <li className="font-mono text-micro text-accent">
                  infra.acme_email — still the example address; Let’s Encrypt needs a real one
                </li>
              )}
              {status.secrets.placeholders.manual.map((path) => (
                <li key={path} className="font-mono text-micro text-accent">
                  {path} — needs a value only you have
                </li>
              ))}
              {status.secrets.placeholders.generatable.map((path) => (
                <li key={path} className="font-mono text-micro text-muted">
                  {path} — can be generated
                </li>
              ))}
              {!status.secrets.readable && (
                <li className="text-meta text-accent">
                  The file cannot be read from here, so its contents are unknown — enter the
                  sudo password above and re-read.
                </li>
              )}
            </ul>
          </Step>
        )}

      </div>
    </Card>
  )
}

const STEPS = ['tools', 'secrets', 'fill'] as const
type Stage = (typeof STEPS)[number] | 'ready'

const LABELS: Record<(typeof STEPS)[number], string> = {
  tools: 'Install the prerequisites (git, jq, yq)',
  secrets: 'Create /etc/amber-infra/secrets.yaml',
  fill: 'Fill in the secrets',
}

/**
 * Which step this box is on.
 *
 * Ordered by dependency, not by preference: nothing can read the secrets file without
 * yq, nothing can be filled in before it exists, and `install.sh` refuses to proceed
 * on a placeholder. So the first unmet condition is the step.
 */
function stageOf(status: InfraStatus): Stage {
  // Ends at "the secrets are filled in". Installing is not a setup step — it is the
  // app list, which knows which apps belong here and which are somebody else's box.
  if (!status.tools.jq || !status.tools.yq || !status.tools.git) return 'tools'
  if (!status.secrets.present) return 'secrets'
  const { generatable, manual } = status.secrets.placeholders
  if (!status.secrets.readable || generatable.length || manual.length || !status.secrets.acmeEmailSet) {
    return 'fill'
  }
  return 'ready'
}

function Step({
  body,
  action,
  children,
}: {
  body: string
  action: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs leading-relaxed text-muted">{body}</p>
      {children}
      <div className="flex flex-wrap items-center gap-2">{action}</div>
    </div>
  )
}
