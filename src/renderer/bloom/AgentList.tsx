import type { AgentConfig } from '../../shared/bloom'
import { Chip, SmallButton } from '../infra/parts'

/**
 * Every configured agent.
 *
 * The prompt's first line is the card's subtitle, because that is what an agent
 * actually *is* — the tier and the peer list are settings, the prompt is the thing
 * you wrote. A card that led with "balanced" would be sorted by the least
 * interesting fact about it.
 */
export function AgentList({
  agents,
  loading,
  onRefresh,
  onNew,
  onEdit,
}: {
  agents: AgentConfig[]
  loading: boolean
  onRefresh: () => void
  onNew: () => void
  onEdit: (agent: AgentConfig) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          An agent is a prompt, a model tier, and the servers and accounts it may
          reach. Amber delegates to these by name.
        </p>
        <SmallButton onClick={onRefresh}>{loading ? 'Reading…' : 'Refresh'}</SmallButton>
        <SmallButton primary onClick={onNew}>
          New agent
        </SmallButton>
      </div>

      {!loading && agents.length === 0 && (
        <p className="text-sm text-muted">
          No agents yet. Create one, then test it — Amber can delegate to it by slug
          as soon as it exists.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {agents.map((agent) => (
          <li
            key={agent.id}
            className="flex flex-wrap items-start gap-2 rounded-panel border border-line bg-raised/50 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-body text-ink">{agent.slug}</span>
                {agent.name && agent.name !== agent.slug && (
                  <span className="text-xs text-muted">{agent.name}</span>
                )}
                <Chip>{agent.modelTier}</Chip>
                {agent.mcpServers.map((server) => (
                  <Chip key={server}>{server}</Chip>
                ))}
                {agent.oauthConnections.length > 0 && (
                  <Chip tone="ok">
                    {agent.oauthConnections.length} account
                    {agent.oauthConnections.length === 1 ? '' : 's'}
                  </Chip>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-muted">
                {firstLine(agent.systemPrompt) || 'No instructions yet.'}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <SmallButton onClick={() => onEdit(agent)}>Edit</SmallButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}
