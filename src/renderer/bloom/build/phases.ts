/**
 * The shape of a build, recovered from the tools it calls.
 *
 * A build is 12–25 steps, and rendered flat that is 60–75 rows of tool name, raw
 * JSON arguments and untruncated results — the wall of text this replaces. But the
 * steps are not shapeless: the builder always works through the same arc. It looks
 * at what already exists, researches the service if it has to, creates and wires
 * things up, then writes the checklist. Naming those four phases turns a list into a
 * progress bar.
 *
 * Deliberately derived from the tool name rather than announced by Bloom. Bloom
 * emits no phase and should not have to — the mapping is a *presentation* choice,
 * and putting it here means a new tool shows up in the timeline the day it ships,
 * with no coordinated release. Anything unrecognised falls into `work`, which
 * renders as an ordinary row rather than vanishing.
 */

export type PhaseId = 'inspect' | 'research' | 'build' | 'finish' | 'work'

export interface Phase {
  id: PhaseId
  label: string
  /** What this phase is for, one line, for a tooltip. */
  hint: string
}

/** In order. `work` is not here — it is the fallback, not a stage of the arc. */
export const PHASES: readonly Phase[] = [
  {
    id: 'inspect',
    label: 'Inspect',
    hint: 'Checking what already exists — agents, providers, connections, keywords.',
  },
  {
    id: 'research',
    label: 'Research',
    hint: 'Reading up on the service, and looking for an MCP server worth reusing.',
  },
  {
    id: 'build',
    label: 'Build',
    hint: 'Creating the agent and wiring its connections up.',
  },
  {
    id: 'finish',
    label: 'Finish',
    hint: 'Writing the setup checklist that makes it usable.',
  },
] as const

const BY_TOOL: Record<string, PhaseId> = {
  bloom_list_agents: 'inspect',
  bloom_list_providers: 'inspect',
  bloom_list_connections: 'inspect',
  bloom_list_keywords: 'inspect',

  web_search: 'research',
  read_url: 'research',
  mcp_registry_search: 'research',
  mcp_registry_get: 'research',

  bloom_create_agent: 'build',
  bloom_create_connection: 'build',
  bloom_attach_connection: 'build',
  bloom_test_connection: 'build',

  bloom_set_setup_checklist: 'finish',
}

/** Which phase a tool belongs to. Unknown tools are honest about being unknown. */
export function phaseOf(toolName: string | null | undefined): PhaseId {
  if (!toolName) return 'work'
  return BY_TOOL[toolName] ?? 'work'
}

/** A human label for a builder tool, so a row reads as a sentence. */
const LABELS: Record<string, string> = {
  bloom_list_agents: 'Checked which agents exist',
  bloom_list_providers: 'Checked which services Bloom ships',
  bloom_list_connections: 'Checked the connection library',
  bloom_list_keywords: 'Checked the model keywords',
  web_search: 'Searched the web',
  read_url: 'Read a page',
  mcp_registry_search: 'Searched the MCP registry',
  mcp_registry_get: 'Looked up an MCP server',
  bloom_create_agent: 'Created the agent',
  bloom_create_connection: 'Created a connection',
  bloom_attach_connection: 'Attached a connection',
  bloom_test_connection: 'Tested a connection',
  bloom_set_setup_checklist: 'Wrote the setup checklist',
}

export function labelOf(toolName: string | null | undefined): string {
  if (!toolName) return 'Worked'
  return LABELS[toolName] ?? toolName.replace(/_/g, ' ')
}

export type PhaseState = 'pending' | 'active' | 'done'

/**
 * How far along each phase is, from the tools seen so far.
 *
 * A phase is `done` once a *later* phase has started, not when its own last tool
 * returns — there is no marker for "finished inspecting", and waiting for one would
 * leave the rail permanently one step behind what is actually happening.
 */
export function phaseStates(
  toolNames: readonly (string | null | undefined)[],
  finished: boolean,
): Record<PhaseId, PhaseState> {
  const order = PHASES.map((p) => p.id)
  const seen = new Set(toolNames.map(phaseOf))
  const furthest = order.reduce(
    (acc, id, i) => (seen.has(id) ? i : acc),
    -1,
  )

  const states = {} as Record<PhaseId, PhaseState>
  order.forEach((id, i) => {
    if (i < furthest || (finished && seen.has(id))) states[id] = 'done'
    else if (i === furthest) states[id] = finished ? 'done' : 'active'
    else states[id] = 'pending'
  })
  states.work = 'pending'
  return states
}
