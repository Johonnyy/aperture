import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * A tiny JSON file store, in place of `electron-store`.
 *
 * Deliberate: `electron-store` v9+ is ESM-only and fights the CJS main bundle, and
 * the encrypted key vault needs bespoke handling anyway. Forty lines here removes a
 * dependency and a whole class of packaging risk.
 *
 * Writes go through a temp file + rename so a crash mid-write can't leave a
 * truncated config behind — the previous contents survive intact.
 */
export class JsonStore<T extends object> {
  private readonly file: string
  private cache: T

  constructor(filename: string, private readonly defaults: T) {
    this.file = join(app.getPath('userData'), filename)
    this.cache = this.read()
  }

  private read(): T {
    try {
      if (!existsSync(this.file)) return { ...this.defaults }
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      // Merge over defaults so a config written by an older build gains new keys
      // instead of leaving them undefined.
      return { ...this.defaults, ...parsed }
    } catch {
      return { ...this.defaults }
    }
  }

  get(): T {
    return this.cache
  }

  set(patch: Partial<T>): T {
    this.cache = { ...this.cache, ...patch }
    this.flush()
    return this.cache
  }

  replace(value: T): T {
    this.cache = value
    this.flush()
    return this.cache
  }

  private flush(): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}
