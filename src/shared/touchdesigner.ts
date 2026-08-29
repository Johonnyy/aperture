/**
 * The TouchDesigner setup, as both processes see it.
 *
 * In `src/shared` rather than beside the extension because the Settings page edits the
 * same record the handlers read, and the renderer cannot import from `src/main`. The
 * store, the normalizers and the resolution all still live in
 * `src/main/extensions/touchdesigner/` — this is only the shape they agree on.
 */

export interface TdProject {
  id: string
  name: string
  /** Absolute path to the `.toe`. Empty until someone fills it in. */
  path: string
}

export interface TdConfig {
  /** Absolute path to TouchDesigner. Empty opens the `.toe` through its OS association,
   *  which works but cannot choose *which* build opens it. */
  executablePath: string
  /** Executable name for `process.close`. Empty falls back to the platform default. */
  processName: string
  bridgePort: number
  projects: TdProject[]
  defaultProjectId: string
  /** Last read from the project. Stale by at most one refresh; never invented here. */
  cachedScenes: string[]
  /** Epoch ms, so the Settings page can say how old that list is. */
  scenesUpdatedAt: number
}

/** What "Test connection" found. `ok` means the project answered, not that it is healthy. */
export interface TdProbeResult {
  ok: boolean
  /** Already phrased as something to act on, whichever way it went. */
  message: string
  scenes: string[]
  /** Whatever the project reported as current, when it reports one. */
  currentScene?: string
}
