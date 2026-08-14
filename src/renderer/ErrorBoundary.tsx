import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Without a boundary, a render error unmounts the whole tree and leaves a blank
 * window — or worse, a window that still shows the last good paint while every
 * control is inert, which reads as "the app froze" rather than "the app crashed".
 *
 * This turns that into something you can act on: the message, the component
 * stack, and a way back.
 */
interface State {
  error: Error | null
  stack: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Forwarded to the main-process log by the console-message hook in window.ts.
    console.error('Renderer crashed:', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? null })
  }

  render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto bg-ground p-8 text-ink">
        <div>
          <h1 className="text-base font-medium text-danger">The interface crashed</h1>
          <p className="mt-1 text-sm text-muted">
            Main is unaffected — the Amber connection and any SSH sessions are still
            up. Reloading rebuilds the UI without restarting the app.
          </p>
        </div>

        <pre className="overflow-x-auto rounded-[10px] border border-line bg-raised px-3 py-2 font-mono text-xs whitespace-pre-wrap text-danger">
          {error.message}
        </pre>

        {stack && (
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              Component stack
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-[10px] border border-line bg-raised px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted">
              {stack.trim()}
            </pre>
          </details>
        )}

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="self-start rounded-[10px] border border-amber-deep bg-amber/15 px-3 py-1.5 text-sm text-amber-hi transition hover:bg-amber/25"
        >
          Reload interface
        </button>
      </div>
    )
  }
}
