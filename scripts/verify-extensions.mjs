/**
 * The extension manifests, and the three-way agreement that keeps them honest.
 *
 * A manifest is data four separate things read — the tool bridge, the device announce,
 * the Devices panel and a Settings page — and none of them would fail loudly on a
 * malformed one. An action declared with no implementation announces a capability that
 * always errors; a duplicate key silently shadows; a timeout over budget means Amber
 * gives up before we can answer and the model learns nothing. Every one of those looks
 * like "it just doesn't work" at runtime with nothing in a log.
 *
 * So the guarantee is split in two, and this is the half that doesn't need Electron:
 * `IMPLEMENTED` must equal the manifest key set. The other half is `tsc` — `handlers.ts`
 * types its table as `Record<(typeof IMPLEMENTED)[number], ActionHandler>`, so a missing
 * or extra handler is a compile error. Together: manifest ⟺ IMPLEMENTED ⟺ handlers.
 *
 * `index.ts` imports only JSON and types, which is why it can be bundled here at all.
 */
import {
  allCapabilityKeys,
  capabilitiesFor,
  capabilityKey,
  findAction,
  grantKey,
  isAllowed,
  needsApproval,
  parseCapabilityKey,
  permissionFor,
  summarize,
  toolSpecsFor,
  validateManifests,
  MAX_REGISTERED_TOOLS,
  TARGET_PLATFORMS,
} from '../out/verify/extensions.mjs'
import { IMPLEMENTED, MANIFESTS } from '../out/verify/extension-index.mjs'
import { POWER_ACTIONS } from '../out/verify/system-commands.mjs'

let failures = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  failures++
}

// --- the manifests are structurally valid -----------------------------------

for (const problem of validateManifests(MANIFESTS)) fail(problem)

// --- manifest ⟺ IMPLEMENTED --------------------------------------------------

const declared = new Set(allCapabilityKeys(MANIFESTS))
const implemented = new Set(IMPLEMENTED)

for (const key of declared) {
  if (!implemented.has(key)) {
    fail(`"${key}" is declared in a manifest but missing from IMPLEMENTED — it would ` +
      `be announced as a capability that always errors`)
  }
}
for (const key of implemented) {
  if (!declared.has(key)) {
    fail(`"${key}" is in IMPLEMENTED but no manifest declares it — unreachable code`)
  }
}
if (implemented.size !== IMPLEMENTED.length) fail('duplicate key in IMPLEMENTED')

// The power commands live in their own pure module and list what they cover, so the
// manifest cannot declare a power action `commandFor` has no branch for — the case that
// would announce a capability and then throw on the first call.
const powerKeys = POWER_ACTIONS.map((a) => capabilityKey('system-control', a))
for (const key of powerKeys) {
  if (!declared.has(key)) fail(`commands.ts implements "${key}" but the manifest doesn't declare it`)
}
for (const key of declared) {
  if (key.startsWith('system-control.power.') && !powerKeys.includes(key)) {
    fail(`the manifest declares "${key}" but commands.ts has no command for it`)
  }
}

// --- key parsing splits on the FIRST dot -------------------------------------
//
// An extension id may not contain a dot; an action name may (`power.sleep`). Splitting
// on the last one would route `system-control.power.sleep` to an extension called
// `system-control.power`, which does not exist — so the action would silently 404.
{
  const parsed = parseCapabilityKey('system-control.power.sleep')
  if (parsed?.extensionId !== 'system-control' || parsed?.action !== 'power.sleep') {
    fail(`parseCapabilityKey split on the wrong dot: ${JSON.stringify(parsed)}`)
  }
  for (const bad of ['nodot', '.leading', 'trailing.', '']) {
    if (parseCapabilityKey(bad) !== null) fail(`parseCapabilityKey accepted "${bad}"`)
  }
}

// --- the permission gate actually gates --------------------------------------

{
  const key = 'system-control.power.sleep'
  const found = findAction(MANIFESTS, key)
  if (!found) {
    fail(`findAction could not resolve "${key}"`)
  } else {
    const permission = permissionFor(found.manifest, found.action)
    if (permission !== 'power') fail(`"${key}" should consume "power", got "${permission}"`)

    if (isAllowed(MANIFESTS, [], key)) {
      fail(`"${key}" is allowed with no grants — the gate does nothing`)
    }
    if (!isAllowed(MANIFESTS, [grantKey('system-control', 'power')], key)) {
      fail(`"${key}" is refused even when its permission is granted`)
    }
    // A grant for a *different* extension must not unlock this one.
    if (isAllowed(MANIFESTS, [grantKey('ssh-terminal', 'power')], key)) {
      fail(`a grant on another extension unlocked "${key}"`)
    }
  }

  if (isAllowed(MANIFESTS, [grantKey('system-control', 'power')], 'system-control.nope')) {
    fail('isAllowed accepted an action no manifest declares')
  }
}

// --- the approval gate asks for the right things, and nothing else -----------
//
// Over-asking is the failure mode worth testing for: every needless prompt is one more
// dialog someone learns to click through without reading, which costs the prompts that
// matter. `confirmBeforeExec` is the *SSH* preference ("ask before Amber runs a shell
// command on a server"); applying it to device actions made a volume slider stop and ask.
{
  const cases = [
    // [isDeviceAction, destructive, confirmBeforeExec, expected, what]
    [true, false, false, false, 'setting the volume'],
    [true, false, true, false, 'setting the volume with the SSH preference on'],
    [true, true, false, true, 'sleeping the machine'],
    [true, true, true, true, 'sleeping the machine with the SSH preference on'],
    [false, false, false, false, 'an SSH command with the preference off'],
    [false, false, true, true, 'an SSH command with the preference on'],
  ]
  for (const [isDeviceAction, destructive, confirmBeforeExec, expected, what] of cases) {
    const got = needsApproval({ isDeviceAction, destructive, confirmBeforeExec })
    if (got !== expected) {
      fail(`${what}: needsApproval returned ${got}, expected ${expected}`)
    }
  }

  // Stated as a property, because it is the one that regressed: no non-destructive
  // device action may ever prompt, whatever the settings say.
  for (const manifest of MANIFESTS) {
    for (const action of manifest.actions) {
      if ((action.expose ?? 'device') === 'tool') continue
      if (action.destructive) continue
      for (const confirmBeforeExec of [true, false]) {
        if (needsApproval({ isDeviceAction: true, destructive: false, confirmBeforeExec })) {
          fail(`${capabilityKey(manifest.id, action.name)} would prompt, and it is not ` +
            `destructive — the panel exists so a tap goes straight through`)
        }
      }
    }
  }
}

// --- an upgrade must not silently revoke a capability that already worked -----
//
// SSH shipped before this consent screen existed, so introducing one that starts empty
// took `run_command` away: `register_tools` went out as `[]` and Amber simply stopped
// being able to run commands, with nothing anywhere saying why. `grants.ts` seeds those
// permissions once, on first run. This asserts the seed still covers everything
// ssh-terminal needs — a permission added to that manifest without being added to
// SEEDED_GRANTS would reintroduce exactly the same silent breakage.
{
  const seeded = ['ssh-terminal:pty', 'ssh-terminal:secrets']
  const ssh = MANIFESTS.find((m) => m.id === 'ssh-terminal')
  if (!ssh) {
    fail('ssh-terminal manifest is missing')
  } else {
    for (const permission of ssh.permissions) {
      if (!seeded.includes(grantKey('ssh-terminal', permission))) {
        fail(`ssh-terminal declares "${permission}" but grants.ts does not seed it — an ` +
          `upgrade would silently revoke SSH`)
      }
    }
    const { specs } = toolSpecsFor(MANIFESTS, 'win32', (key) =>
      isAllowed(MANIFESTS, seeded, key),
    )
    if (!specs.some((spec) => spec.name === 'run_command')) {
      fail('run_command is not declared to Amber under the seeded grants — SSH is broken')
    }
  }

  // The other half: powering the machine off is genuinely new, so it must NOT be
  // seeded. A seed that quietly granted it would be a consent screen that never asked.
  const seededCaps = capabilitiesFor(MANIFESTS, 'win32', (key) =>
    isAllowed(MANIFESTS, seeded, key),
  )
  if (seededCaps.length) {
    fail(`the first-run seed announces ${seededCaps.map((c) => c.action).join(', ')} — ` +
      `new capabilities must start ungranted and ask`)
  }
}

// --- ungranted actions are never announced -----------------------------------

for (const platform of TARGET_PLATFORMS) {
  const nothingGranted = capabilitiesFor(MANIFESTS, platform, (key) =>
    isAllowed(MANIFESTS, [], key),
  )
  if (nothingGranted.length !== 0) {
    fail(`${platform}: ${nothingGranted.length} capabilities announced with no grants`)
  }

  const allGranted = MANIFESTS.flatMap((m) => m.permissions.map((p) => grantKey(m.id, p)))
  const announced = capabilitiesFor(MANIFESTS, platform, (key) =>
    isAllowed(MANIFESTS, allGranted, key),
  )
  if (announced.length === 0) fail(`${platform}: nothing announced even when fully granted`)

  // A device action must never leak onto the register_tools surface, and vice versa —
  // that split is what keeps dotted keys off the sanitizer and under the 16-tool cap.
  const { specs } = toolSpecsFor(MANIFESTS, platform, () => true)
  for (const spec of specs) {
    if (spec.name.includes('.')) {
      fail(`${platform}: tool "${spec.name}" carries a dot — Amber's sanitizer destroys it`)
    }
  }
  if (specs.length > MAX_REGISTERED_TOOLS) {
    fail(`${platform}: ${specs.length} tools declared, over Amber's cap of ${MAX_REGISTERED_TOOLS}`)
  }
  const announcedNames = new Set(announced.map((c) => c.action))
  for (const spec of specs) {
    if (announcedNames.has(spec.name)) fail(`${platform}: "${spec.name}" is on both surfaces`)
  }
}

// --- every destructive action says so, and carries a danger control ----------

for (const manifest of MANIFESTS) {
  for (const action of manifest.actions) {
    const key = capabilityKey(manifest.id, action.name)
    if (action.name.startsWith('power.') && !action.destructive) {
      fail(`"${key}" is a power action but is not marked destructive — Amber would offer ` +
        `it through the ungated tool`)
    }
    if (action.destructive && !action.control) {
      fail(`"${key}" is destructive but declares no control — the panel can't render it ` +
        `with the right weight`)
    }
  }
}

// --- validateManifests rejects what it should --------------------------------

const rejects = [
  ['a dotted id', [{ ...MANIFESTS[0], id: 'has.dot' }]],
  ['a duplicate id', [MANIFESTS[0], MANIFESTS[0]]],
  ['an unknown permission', [{ ...MANIFESTS[1], permissions: ['telepathy'] }]],
  ['no actions', [{ ...MANIFESTS[1], actions: [] }]],
  [
    'a timeout over the cap',
    [{ ...MANIFESTS[1], actions: [{ ...MANIFESTS[1].actions[0], timeoutMs: 60_000 }] }],
  ],
  [
    'a destructive action that blows the approval budget',
    [{ ...MANIFESTS[1], actions: [{ ...MANIFESTS[1].actions[0], timeoutMs: 7_500 }] }],
  ],
  [
    'a destructive button without a danger tone',
    [
      {
        ...MANIFESTS[1],
        actions: [
          {
            ...MANIFESTS[1].actions[0],
            control: { kind: 'button', label: 'Sleep' },
          },
        ],
      },
    ],
  ],
]
for (const [what, manifests] of rejects) {
  if (validateManifests(manifests).length === 0) {
    fail(`validateManifests accepted ${what}`)
  }
}

// --- the Settings page has something true to render --------------------------

{
  const granted = [grantKey('system-control', 'power')]
  const summary = summarize(MANIFESTS, granted, 'win32')
  if (summary.length !== MANIFESTS.length) fail('summarize dropped an extension')
  const system = summary.find((s) => s.id === 'system-control')
  if (!system?.permissions.every((p) => p.label && p.label.length > 10)) {
    fail('a permission has no readable label — the consent screen would show a slug')
  }
  if (!system?.permissions.find((p) => p.permission === 'power')?.granted) {
    fail('summarize did not reflect a granted permission')
  }
  const ssh = summary.find((s) => s.id === 'ssh-terminal')
  if (ssh?.actions.some((a) => a.available)) {
    fail('ssh-terminal actions read as available with no grant')
  }
}

if (failures) {
  console.error(`\nverify-extensions: ${failures} problem(s)`)
  process.exit(1)
}
console.log(
  `verify-extensions: ok — ${MANIFESTS.length} manifests, ${declared.size} actions, ` +
    `all implemented, gated and inside the timeout budget`,
)
