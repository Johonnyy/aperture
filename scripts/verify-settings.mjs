/**
 * Guards the settings tree — the walking, not the drawing.
 *
 * `src/renderer/settings/tree.ts` decides which page you land on, which rows the rail
 * shows, which branches are open and what the filter finds. All of it is pure, and all
 * of it is the kind of logic that fails quietly: a stale remembered page id shows a
 * blank pane, a filter that prunes a matching descendant makes a setting unfindable,
 * and neither is a type error.
 *
 * Two halves:
 *   1. the helpers, against a fixture tree with hidden pages and nesting
 *   2. the real registry, read as source — unique ids, and every page reachable
 *
 * The second half is textual on purpose: bundling `registry.tsx` would drag in every
 * page component and React with it, to check two properties that are visible in the
 * file. Run via `npm run verify:settings`, which esbuilds tree.ts first.
 */

import { readFileSync } from 'node:fs'

import {
  duplicateIds,
  flatten,
  isVisible,
  matches,
  resolvePageId,
  search,
  trailOf,
  visibleSections,
} from '../out/verify/settings-tree.mjs'

const failures = []
const fail = (msg) => failures.push(msg)
const eq = (what, actual, expected) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) fail(`${what}: expected ${b}, got ${a}`)
}

const CTX = { bloomLinked: true, advanced: false }
const NO_BLOOM = { bloomLinked: false, advanced: false }

const Stub = () => null

/** Deliberately awkward: a hidden page, a nested child, a child under a hidden parent. */
const FIXTURE = [
  {
    id: 'one',
    label: 'One',
    pages: [
      { id: 'alpha', label: 'Alpha', keywords: ['aaa'], Content: Stub },
      {
        id: 'beta',
        label: 'Beta',
        Content: Stub,
        children: [
          { id: 'gamma', label: 'Gamma', keywords: ['zzz'], Content: Stub },
          {
            id: 'delta',
            label: 'Delta',
            Content: Stub,
            visible: (ctx) => ctx.advanced,
          },
        ],
      },
    ],
  },
  {
    id: 'two',
    label: 'Two',
    pages: [
      {
        id: 'epsilon',
        label: 'Epsilon',
        Content: Stub,
        visible: (ctx) => ctx.bloomLinked,
        children: [{ id: 'zeta', label: 'Zeta', Content: Stub }],
      },
    ],
  },
]

const ids = (pages) => pages.map((p) => p.id)

// --- visibility -------------------------------------------------------------

eq('isVisible, no predicate', isVisible({ id: 'x', label: 'X' }, CTX), true)
eq('flatten, default ctx', ids(flatten(FIXTURE, CTX)), [
  'alpha',
  'beta',
  'gamma',
  'epsilon',
  'zeta',
])
eq('flatten, advanced reveals delta', ids(flatten(FIXTURE, { ...CTX, advanced: true })), [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
])

// A hidden parent takes its children with it — `zeta` is visible on its own terms and
// must still vanish, or the rail would draw an orphan under no heading.
eq('flatten, hidden parent hides its subtree', ids(flatten(FIXTURE, NO_BLOOM)), [
  'alpha',
  'beta',
  'gamma',
])

// …and the section it emptied goes too, rather than leaving a heading with nothing
// under it.
eq(
  'visibleSections drops an emptied section',
  visibleSections(FIXTURE, NO_BLOOM).map((s) => s.id),
  ['one'],
)

// --- trail ------------------------------------------------------------------

eq('trailOf, nested', ids(trailOf(FIXTURE, 'gamma', CTX)), ['beta', 'gamma'])
eq('trailOf, top level', ids(trailOf(FIXTURE, 'alpha', CTX)), ['alpha'])
eq('trailOf, unknown id', trailOf(FIXTURE, 'nope', CTX), [])
eq('trailOf, hidden page', trailOf(FIXTURE, 'delta', CTX), [])

// --- resolve ----------------------------------------------------------------

eq('resolvePageId keeps a valid id', resolvePageId(FIXTURE, 'gamma', CTX), 'gamma')
eq('resolvePageId falls back on an unknown id', resolvePageId(FIXTURE, 'gone', CTX), 'alpha')
eq('resolvePageId falls back on null', resolvePageId(FIXTURE, null, CTX), 'alpha')
// The regression this function exists for: yesterday's remembered page is hidden today.
eq(
  'resolvePageId falls back on a now-hidden id',
  resolvePageId(FIXTURE, 'zeta', NO_BLOOM),
  'alpha',
)
eq('resolvePageId with nothing visible', resolvePageId([], null, CTX), null)

// --- filtering --------------------------------------------------------------

eq('matches, empty query matches everything', matches({ id: 'a', label: 'A' }, '  '), true)
eq('matches, label', matches({ id: 'a', label: 'Alpha' }, 'PHA'), true)
eq('matches, keyword', matches({ id: 'a', label: 'Alpha', keywords: ['wss'] }, 'wss'), true)
eq('matches, blurb', matches({ id: 'a', label: 'Alpha', blurb: 'bearer token' }, 'bearer'), true)
eq('matches, miss', matches({ id: 'a', label: 'Alpha' }, 'zzz'), false)

const flat = (sections) => sections.flatMap((s) => flatten([s], { ...CTX, advanced: true }))

// A matching parent keeps its whole subtree: "Beta" matching while Gamma vanished
// would read as "Beta has no children".
eq('search keeps a matching page’s subtree', ids(flat(search(FIXTURE, 'beta', CTX))), [
  'beta',
  'gamma',
])

// A non-matching parent is kept as scaffolding when a descendant matches, or the hit
// would be unreachable.
eq('search keeps ancestors of a match', ids(flat(search(FIXTURE, 'zzz', CTX))), [
  'beta',
  'gamma',
])

// A section label is a legitimate thing to search for.
eq(
  'search on a section label keeps the section',
  search(FIXTURE, 'two', CTX).map((s) => s.id),
  ['two'],
)

// Filtering never resurrects something visibility hid.
eq('search respects visibility', ids(flat(search(FIXTURE, 'zeta', NO_BLOOM))), [])
eq('search with no hits', search(FIXTURE, 'qqqq', CTX), [])
eq(
  'search with an empty query is the visible tree',
  search(FIXTURE, '', CTX).map((s) => s.id),
  ['one', 'two'],
)

// --- duplicate ids ----------------------------------------------------------

eq('duplicateIds, clean fixture', duplicateIds(FIXTURE), [])
eq(
  'duplicateIds finds a collision across sections',
  duplicateIds([
    { id: 's1', label: 'S1', pages: [{ id: 'dup', label: 'A', Content: Stub }] },
    {
      id: 's2',
      label: 'S2',
      pages: [
        { id: 'b', label: 'B', Content: Stub, children: [{ id: 'dup', label: 'C', Content: Stub }] },
      ],
    },
  ]),
  ['dup'],
)

// --- the real registry ------------------------------------------------------

const REGISTRY = 'src/renderer/settings/registry.tsx'
const source = readFileSync(REGISTRY, 'utf8')

const declared = [...source.matchAll(/^\s*id: '([^']+)'/gm)].map((m) => m[1])
if (declared.length === 0) fail(`${REGISTRY}: no ids found — did the shape change?`)

const seen = new Set()
for (const id of declared) {
  if (seen.has(id)) fail(`${REGISTRY}: duplicate id '${id}'`)
  seen.add(id)
}

// Every page names a component, and every component named is imported. A page whose
// `Content` is a typo is a blank pane, not a build error.
const contents = [...source.matchAll(/Content: (\w+)/g)].map((m) => m[1])
if (contents.length === 0) fail(`${REGISTRY}: no pages declare a Content component`)
for (const name of new Set(contents)) {
  if (!new RegExp(`import \\{ ${name} \\} from './pages/`).test(source)) {
    fail(`${REGISTRY}: '${name}' is used as a page but never imported from ./pages`)
  }
}

// A page with no way to be found by its own words is a page you have to already know
// about. Cheap to require, and the whole reason the filter is worth having.
const pageBlocks = source.split(/\n\s*\{\s*\n/).filter((b) => b.includes('Content:'))
for (const block of pageBlocks) {
  const label = /label: '([^']+)'/.exec(block)?.[1] ?? '?'
  if (!block.includes('keywords:')) fail(`${REGISTRY}: page '${label}' declares no keywords`)
  if (!block.includes('blurb:')) fail(`${REGISTRY}: page '${label}' declares no blurb`)
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(`verify-settings: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `verify-settings: ok — tree helpers verified, ` +
    `${pageBlocks.length} registry pages with unique ids, blurbs and keywords`,
)
