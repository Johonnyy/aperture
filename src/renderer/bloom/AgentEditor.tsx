import { useState } from 'react'

import {
  MODEL_TIERS,
  SLUG_PATTERN,
  type AgentConfig,
  type AgentConfigInput,
} from '../../shared/bloom'
import { Field, SmallButton } from '../infra/parts'

/**
 * Creating and editing an agent.
 *
 * Local draft, dirty check, explicit Save — the same idiom as `SettingRow` and
 * `SettingsView`, because a field that saves as you type is a field you cannot
 * abandon halfway.
 *
 * Two validation stances, deliberately different:
 *
 * * **The slug is checked here**, because Bloom's rule is simple, stable, and worth
 *   catching before a round trip.
 * * **The tier is not.** Bloom resolves it against a table that can gain entries
 *   without this app knowing, and a literal `vendor/model` id is a documented escape
 *   hatch. Rejecting locally would mean a valid value refused by a stale client — so
 *   it goes to the server, and the server's sentence is what gets shown.
 *
 * The ceilings say "at most" because that is what they are: Bloom clamps a config
 * down to its own limits and never up, silently. Labelling them as targets would
 * promise something the backend does not honour.
 */
export function AgentEditor({
  agent,
  onClose,
  onSaved,
}: {
  agent: AgentConfig | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [slug, setSlug] = useState(agent?.slug ?? '')
  const [name, setName] = useState(agent?.name ?? '')
  const [prompt, setPrompt] = useState(agent?.systemPrompt ?? '')
  const [tier, setTier] = useState(agent?.modelTier ?? 'balanced')
  const [servers, setServers] = useState((agent?.mcpServers ?? []).join(', '))
  const [maxSteps, setMaxSteps] = useState(agent?.maxSteps?.toString() ?? '')
  const [maxCost, setMaxCost] = useState(agent?.maxCostUsd?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slugOk = SLUG_PATTERN.test(slug)
  const dirty =
    slug !== (agent?.slug ?? '') ||
    name !== (agent?.name ?? '') ||
    prompt !== (agent?.systemPrompt ?? '') ||
    tier !== (agent?.modelTier ?? 'balanced') ||
    servers !== (agent?.mcpServers ?? []).join(', ') ||
    maxSteps !== (agent?.maxSteps?.toString() ?? '') ||
    maxCost !== (agent?.maxCostUsd?.toString() ?? '')

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const input: AgentConfigInput = {
      slug,
      name,
      systemPrompt: prompt,
      modelTier: tier,
      mcpServers: servers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      // Empty means "use Bloom's own ceiling", which is null rather than zero.
      maxSteps: maxSteps.trim() === '' ? null : Number(maxSteps),
      maxCostUsd: maxCost.trim() === '' ? null : Number(maxCost),
    }
    const result = agent
      ? await window.aperture.bloom.updateAgent(agent.id, input)
      : await window.aperture.bloom.createAgent(input)
    setBusy(false)
    if (result.ok) onSaved()
    // The server's own sentence, not a code: it names the field and the fix.
    else setError(result.error)
  }

  const remove = async (): Promise<void> => {
    if (!agent) return
    if (!window.confirm(`Delete ${agent.slug}? Its run history stays, but the agent is gone.`)) {
      return
    }
    setBusy(true)
    const result = await window.aperture.bloom.deleteAgent(agent.id)
    setBusy(false)
    if (result.ok) onSaved()
    else setError(result.error)
  }

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-raised/50 p-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-medium">
          {agent ? `Editing ${agent.slug}` : 'New agent'}
        </h3>
        <SmallButton onClick={onClose}>Back</SmallButton>
      </div>

      {error && <p className="text-meta text-danger">{error}</p>}

      <Row label="Slug" hint="How Amber names it when delegating. Lowercase, no spaces.">
        <Field value={slug} onChange={setSlug} placeholder="spotify-dj" />
      </Row>
      {slug !== '' && !slugOk && (
        <p className="pl-24 text-meta text-danger">
          Lowercase letters, digits and hyphens, starting with a letter.
        </p>
      )}

      <Row label="Name" hint="Optional. Defaults to the slug.">
        <Field value={name} onChange={setName} placeholder="Spotify DJ" />
      </Row>

      <label className="flex flex-col gap-1.5">
        <span className="text-meta text-muted">Instructions</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={10}
          placeholder="You pick music. Prefer albums over singles, and never interrupt a track that is already playing."
          className="w-full resize-y rounded-field border border-line bg-ground px-3 py-2 font-mono text-meta text-ink outline-none focus:border-accent-deep"
        />
        <span className="text-xs text-muted">
          The whole of what this agent is. Written for a model, so say what it should
          do and what it should never do.
        </span>
      </label>

      <Row label="Model" hint="A named tier, or a literal vendor/model id.">
        <select
          value={MODEL_TIERS.includes(tier) ? tier : '__literal'}
          onChange={(e) => setTier(e.target.value === '__literal' ? '' : e.target.value)}
          className="rounded-control border border-line bg-raised px-2.5 py-1 text-meta text-ink outline-none focus:border-accent-deep"
        >
          {MODEL_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="__literal">a specific model…</option>
        </select>
        {!MODEL_TIERS.includes(tier) && (
          <Field value={tier} onChange={setTier} placeholder="anthropic/claude-sonnet-4.6" />
        )}
      </Row>

      <Row label="Servers" hint="Peer MCP servers it may call, comma separated.">
        <Field value={servers} onChange={setServers} placeholder="amber, finance" />
      </Row>

      <Row label="At most" hint="Blank uses Bloom's own ceiling. Bloom never raises these.">
        <Field value={maxSteps} onChange={setMaxSteps} placeholder="steps" />
        <Field value={maxCost} onChange={setMaxCost} placeholder="USD" />
      </Row>

      <div className="flex items-center gap-2">
        <SmallButton
          primary
          disabled={busy || !dirty || !slugOk}
          title={
            !slugOk ? 'The slug is not valid yet.' : !dirty ? 'Nothing has changed.' : undefined
          }
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </SmallButton>
        {agent && (
          <SmallButton danger disabled={busy} onClick={() => void remove()}>
            Delete
          </SmallButton>
        )}
      </div>
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-meta text-muted" title={hint}>
        {label}
      </span>
      {children}
    </div>
  )
}
