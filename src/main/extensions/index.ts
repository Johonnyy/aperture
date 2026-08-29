/**
 * The installed extensions. **Compiled in, not installed.**
 *
 * This is the whole loader, and the shape is a decision worth reading before changing
 * it. electron-vite bundles `src/main` into one CJS file at `out/main/index.js`, and
 * `electron-builder.yml` ships `out/**` — so a runtime `readdir` over
 * `src/main/extensions/*` finds nothing in a packaged build. That failure passes every
 * `npm run dev` and fails every installer, which is the worst shape a bug can have.
 *
 * So manifests are **statically imported** and Rollup inlines them. `resolveJsonModule`
 * is already on in `tsconfig.node.json`, so this typechecks; nothing is read from disk at
 * runtime; `electron-builder.yml` needs no change at all.
 *
 * They stay JSON rather than becoming TypeScript objects deliberately. A manifest is
 * data read by four different things — the bridge, the Devices panel, a Settings page and
 * a verify script — so if out-of-tree extensions ever ship, moving these same bytes into
 * `extraResources` is a config change rather than a rewrite.
 *
 * Adding an extension is three edits here: import the manifest, add it to `MANIFESTS`,
 * and add its keys to `IMPLEMENTED`. Drift between those and the handler table is a
 * `tsc` error (see `handlers.ts`); drift between them and the manifests is caught by
 * `verify:extensions`.
 */

import type { ExtensionManifest } from '../../shared/extensions'
import sshManifest from './ssh-terminal/manifest.json'
import systemManifest from './system-control/manifest.json'
import tdManifest from './touchdesigner/manifest.json'

export const MANIFESTS: ExtensionManifest[] = [
  sshManifest as ExtensionManifest,
  systemManifest as ExtensionManifest,
  tdManifest as ExtensionManifest,
]

/**
 * Every capability key this build can actually run.
 *
 * Kept beside the manifests rather than derived from them, because it is the *other*
 * half of a two-sided guarantee: `handlers.ts` types its table as
 * `Record<(typeof IMPLEMENTED)[number], ActionHandler>`, so a missing or extra handler
 * is a type error, and `verify:extensions` asserts this list equals the manifest key
 * set. Together those give "every declared action has an implementation" without any
 * runtime reflection — and without the verify script needing to bundle Electron.
 */
export const IMPLEMENTED = [
  'ssh-terminal.run_command',
  'system-control.power.sleep',
  'system-control.power.shutdown',
  'system-control.audio.get_volume',
  'system-control.audio.set_volume',
  'system-control.audio.mute',
  'system-control.process.list',
  'system-control.process.close',
  'system-control.process.launch',
  'touchdesigner.process.launch',
  'touchdesigner.process.close',
  'touchdesigner.switch_scene',
  'touchdesigner.list_scenes',
  'touchdesigner.send_command',
] as const

export type ImplementedKey = (typeof IMPLEMENTED)[number]
