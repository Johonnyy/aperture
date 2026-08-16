/**
 * The pure functions behind the build timeline.
 *
 * `phaseOf` and `phaseStates` decide what the phase rail shows, which is the single
 * thing that turns 60-odd flat rows into a legible arc. They are pure and total, so
 * they are worth pinning here rather than only exercising them by looking at a
 * finished build and squinting.
 */

import assert from 'node:assert/strict'

import { PHASES, labelOf, phaseOf, phaseStates } from '../out/verify/phases.mjs'

let checks = 0
const ok = (label, fn) => {
  fn()
  checks++
  console.log(`  ok   ${label}`)
}

console.log('\nphaseOf — every builder tool lands somewhere\n')

ok('inspection tools group together', () => {
  assert.equal(phaseOf('bloom_list_agents'), 'inspect')
  assert.equal(phaseOf('bloom_list_providers'), 'inspect')
  assert.equal(phaseOf('bloom_list_keywords'), 'inspect')
})

ok('research tools group together', () => {
  assert.equal(phaseOf('web_search'), 'research')
  assert.equal(phaseOf('mcp_registry_search'), 'research')
})

ok('the tools that actually change something group together', () => {
  assert.equal(phaseOf('bloom_create_agent'), 'build')
  assert.equal(phaseOf('bloom_attach_connection'), 'build')
})

ok('the checklist is its own phase', () => {
  assert.equal(phaseOf('bloom_set_setup_checklist'), 'finish')
})

ok('an unknown tool is honest rather than hidden', () => {
  // The mapping is a presentation choice made here, not announced by Bloom, so a
  // tool shipped tomorrow has to render *today* rather than vanish from the trace.
  assert.equal(phaseOf('bloom_invented_tomorrow'), 'work')
  assert.equal(phaseOf(null), 'work')
  assert.equal(phaseOf(undefined), 'work')
})

ok('a label always reads as words', () => {
  assert.equal(labelOf('bloom_create_agent'), 'Created the agent')
  assert.equal(labelOf('bloom_invented_tomorrow'), 'bloom invented tomorrow')
  assert.equal(labelOf(null), 'Worked')
})

console.log('\nphaseStates — the rail fills forward and never rewinds\n')

ok('nothing run yet means nothing lit', () => {
  const states = phaseStates([], false)
  assert.equal(states.inspect, 'pending')
  assert.equal(states.finish, 'pending')
})

ok('the phase in progress is the furthest one reached', () => {
  const states = phaseStates(['bloom_list_agents'], false)
  assert.equal(states.inspect, 'active')
  assert.equal(states.research, 'pending')
})

ok('an earlier phase is done once a later one starts', () => {
  // There is no "finished inspecting" marker, and waiting for one would leave the
  // rail permanently a step behind what is actually happening.
  const states = phaseStates(['bloom_list_agents', 'bloom_create_agent'], false)
  assert.equal(states.inspect, 'done')
  assert.equal(states.build, 'active')
})

ok('a skipped phase is not falsely marked done', () => {
  const states = phaseStates(['bloom_list_agents', 'bloom_create_agent'], false)
  assert.equal(states.research, 'done', 'phases before the furthest read as done')
  assert.equal(states.finish, 'pending')
})

ok('a finished run leaves nothing spinning', () => {
  const states = phaseStates(['bloom_list_agents', 'bloom_set_setup_checklist'], true)
  for (const phase of PHASES) {
    assert.notEqual(states[phase.id], 'active', `${phase.id} still active after finish`)
  }
})

ok('an unknown tool cannot light the rail', () => {
  const states = phaseStates(['something_new'], false)
  for (const phase of PHASES) {
    assert.equal(states[phase.id], 'pending')
  }
})

ok('every phase has a label and a hint', () => {
  for (const phase of PHASES) {
    assert.ok(phase.label, `${phase.id} has no label`)
    assert.ok(phase.hint, `${phase.id} has no hint`)
  }
})

console.log(`\nverify-activity: ok — ${checks} checks, ${PHASES.length} phases\n`)
