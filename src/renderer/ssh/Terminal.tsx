import { CanvasAddon } from '@xterm/addon-canvas'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'

import type { ServerConfig } from '../../shared/types'
import { useStore } from '../store'
import { Completer } from './completion'
import { SuggestionPopup, type PopupState } from './completion/SuggestionPopup'
import { SearchBar } from './SearchBar'
import { Typeahead } from './typeahead'

/**
 * An interactive shell, fed by `ssh2`'s `.shell({ pty })` stream over IPC.
 *
 * Three things sit between the raw stream and what you see, in this order:
 *
 * 1. **`Typeahead`** — draws printable keystrokes immediately, dimmed, instead of
 *    waiting a round-trip for the remote pty to echo them. Everything the terminal
 *    receives passes through it so predictions can be reconciled against the truth.
 * 2. **`Completer`** — reads the current input line out of the buffer and offers
 *    history, commands and paths. Purely additive: it only ever writes ordinary
 *    input to the shell, never rewrites the line.
 * 3. **Backpressure** — `term.write`'s callback acks parsed characters back to main,
 *    which pauses the ssh2 stream when the renderer falls behind.
 *
 * The xterm instance is created once per mount and disposed on unmount along with
 * the remote shell — leaving either behind would leak a live SSH connection.
 */
export function Terminal({
  server,
  hidden,
  initialCommand,
  onClose,
}: {
  server: ServerConfig
  /** Kept mounted but off-screen, so navigating away doesn't drop the connection. */
  hidden?: boolean
  /** Typed into the shell once it opens, without a newline — you press Enter. */
  initialCommand?: string
  onClose: () => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<SearchAddon | null>(null)

  const verbose = useStore((s) => s.settings.verboseLogging)
  const localEcho = useStore((s) => s.settings.localEcho)
  const threshold = useStore((s) => s.settings.localEchoThresholdMs)
  const suggestions = useStore((s) => s.settings.terminalSuggestions)

  // Live settings without re-running the effect: tearing down the terminal to
  // change a threshold would drop the session.
  const echoRef = useRef({ localEcho, threshold })
  echoRef.current.localEcho = localEcho
  echoRef.current.threshold = threshold

  const completerRef = useRef<Completer | null>(null)
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions
  // Read through a ref so a later prop change can't retrigger the effect and tear
  // down a live shell.
  const commandRef = useRef(initialCommand)
  useEffect(() => {
    completerRef.current?.setEnabled(suggestions)
  }, [suggestions])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new XTerm({
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10_000,
      // Unicode11Addon is a proposed API. Without this it silently does nothing and
      // wide characters keep the wrong width.
      allowProposedApi: true,
      theme: {
        background: '#14110d',
        foreground: '#f2e9da',
        cursor: '#ffb347',
        selectionBackground: '#322a1f',
      },
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon())
    const unicode = new Unicode11Addon()
    term.loadAddon(unicode)
    term.unicode.activeVersion = '11'
    searchRef.current = search

    term.open(host)

    // The DOM renderer xterm defaults to repaints every cell as an element and is
    // the single largest source of stutter on scrolling output. WebGL is a
    // different order of magnitude; canvas is the fallback when the context is lost
    // (a GPU driver reset, or too many live contexts across windows).
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        term.loadAddon(new CanvasAddon())
      })
      term.loadAddon(webgl)
    } catch {
      term.loadAddon(new CanvasAddon())
    }

    fit.fit()

    let shellId: string | null = null
    let disposed = false

    const typeahead = new Typeahead(term, echoRef.current)
    const completer = new Completer(term, {
      exec: (command) =>
        shellId
          ? window.aperture.ssh.execOnShell(shellId, command)
          : Promise.resolve({ stdout: '', stderr: '', code: null, error: 'no shell' }),
      write: (data) => {
        if (shellId) window.aperture.ssh.writeShell(shellId, data)
      },
      onState: setPopup,
    })
    completer.setEnabled(suggestionsRef.current)
    completerRef.current = completer

    const unsubscribe = window.aperture.ssh.onShellData((message) => {
      if (!shellId || message.id !== shellId) return
      if (message.closed) {
        setClosed(true)
        term.write('\r\n\x1b[2m— connection closed —\x1b[0m\r\n')
        return
      }
      if (!message.data) return

      typeahead.onOutput(message.data)
      setLatency(typeahead.latencyMs)

      // Ack after xterm has actually parsed it, not on arrival — the whole point is
      // to report the renderer's real progress, so main can stop sending when the
      // parser is the bottleneck. `render` owns the write because the prediction
      // erase has to land before these bytes and the redraw after them.
      const chars = message.data.length
      typeahead.render(message.data, () => {
        if (shellId) window.aperture.ssh.ackShell(shellId, chars)
        completer.onOutput()
      })
    })

    void window.aperture.ssh.openShell(server.id).then((res) => {
      if (disposed) {
        // Unmounted while connecting — close the shell we just opened rather than
        // orphaning it.
        if (res.shellId) window.aperture.ssh.closeShell(res.shellId)
        return
      }
      if (!res.ok || !res.shellId) {
        setError(res.error ?? 'Could not open a shell.')
        return
      }
      shellId = res.shellId
      window.aperture.ssh.resizeShell(shellId, term.cols, term.rows)
      void completer.prime()
      // No trailing newline: handing someone a command is helpful, running it for
      // them is not. Delayed past the first prompt, or the shell swallows it.
      if (commandRef.current) {
        const command = commandRef.current
        setTimeout(() => {
          if (!disposed && shellId) window.aperture.ssh.writeShell(shellId, command)
        }, 400)
      }
      term.focus()
    })

    const onData = term.onData((data) => {
      if (!shellId) return
      // The completer gets first refusal so it can swallow the keys that drive its
      // popup; everything it doesn't claim continues to the shell.
      if (completer.handleInput(data)) return
      // The completer reads the line first, while any prediction is still drawn.
      // Typeahead erases its tail on Enter, and a command recorded after that would
      // be missing whatever had not been echoed yet.
      completer.onInput(data)
      typeahead.onInput(data)
      window.aperture.ssh.writeShell(shellId, data)
    })

    /**
     * Ctrl+Shift+C/V for the clipboard, because plain Ctrl+C is SIGINT and must stay
     * that way. Returning false stops xterm forwarding the key to the shell.
     */
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        const selection = term.getSelection()
        if (selection) void navigator.clipboard.writeText(selection)
        return false
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => {
          if (text && shellId) window.aperture.ssh.writeShell(shellId, text)
        })
        return false
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
        setSearching(true)
        return false
      }
      return true
    })

    // A `window` resize is not the only thing that changes this box: collapsing the
    // sidebar or opening the Status Panel does too, and the pty's idea of `cols`
    // would silently go stale. Debounced, because fit() reflows the whole buffer.
    let resizeTimer: number | undefined
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return // hidden
        fit.fit()
        if (shellId) window.aperture.ssh.resizeShell(shellId, term.cols, term.rows)
      }, 50)
    })
    observer.observe(host)

    return () => {
      disposed = true
      window.clearTimeout(resizeTimer)
      observer.disconnect()
      unsubscribe()
      onData.dispose()
      completer.dispose()
      completerRef.current = null
      typeahead.dispose()
      if (shellId) window.aperture.ssh.closeShell(shellId)
      term.dispose()
      searchRef.current = null
    }
  }, [server.id])

  return (
    <div className={hidden ? 'hidden' : 'relative flex min-h-0 flex-1 flex-col'}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <span className="font-mono text-xs text-muted">
          {server.username}@{server.host}
        </span>
        {closed && <span className="text-[11px] text-muted">closed</span>}
        {verbose && latency !== null && (
          <span
            className="font-mono text-[10px] text-muted"
            title="Measured round-trip from keystroke to echo. Local echo turns itself on above the threshold in Settings."
          >
            {Math.round(latency)}ms
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setSearching((s) => !s)}
          title="Find (Ctrl+Shift+F)"
          className="rounded-[8px] border border-line px-2 py-1 text-[11px] transition hover:border-amber-deep"
        >
          Find
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[8px] border border-line px-2 py-1 text-[11px] transition hover:border-amber-deep"
        >
          Close
        </button>
      </div>

      {error && (
        <p className="border-b border-line px-4 py-2 text-xs text-danger">{error}</p>
      )}

      {searching && (
        <SearchBar addon={searchRef} onClose={() => setSearching(false)} />
      )}

      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-2 py-2" />

      {popup && <SuggestionPopup state={popup} />}
    </div>
  )
}
