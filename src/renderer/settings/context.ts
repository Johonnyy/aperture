/**
 * What every settings page gets, and the only thing it has to know about the shell.
 *
 * The draft lives here rather than on each page because it is *one* draft: Save
 * writes the whole `Settings` object in a single IPC call, exactly as the old
 * single-column page did. Splitting the screen into pages must not split that — you
 * should be able to change the voice, wander over to Terminal, change a threshold and
 * save both, and the save bar has to stay visible while you do. A per-page draft
 * would quietly discard the first change the moment you clicked the second page.
 *
 * `saved` is here too, and is not redundant: several controls compare against what is
 * actually committed rather than against the draft ("Save & reconnect" only matters
 * when the URL itself moved).
 */

import { createContext, useContext } from 'react'

import type { Settings } from '../../shared/types'

export interface SettingsContextValue {
  /** On screen, not yet committed. */
  draft: Settings
  /** Committed. What `dirty` is measured against. */
  saved: Settings
  /** The common case: overwrite a few keys. */
  set: (patch: Partial<Settings>) => void
  /** When the next value depends on the current one. */
  update: (fn: (draft: Settings) => Settings) => void
  /** Commit now, out of band — the theme picker's escape from the draft discipline. */
  commit: (patch: Partial<Settings>) => void
  /** Which page is showing. */
  current: string | null
  /** Go to another page by id. Lets a page link to its own child. */
  go: (pageId: string) => void
}

const Ctx = createContext<SettingsContextValue | null>(null)

export const SettingsProvider = Ctx.Provider

export function useSettings(): SettingsContextValue {
  const value = useContext(Ctx)
  if (!value) throw new Error('useSettings() outside the settings shell')
  return value
}
