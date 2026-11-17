import { Component, type ErrorInfo, type ReactNode } from 'react'

import { diag } from '../diag'

interface RootErrorBoundaryProps {
  children: ReactNode
  /** Reloads the window; injectable for tests. */
  onReload?: () => void
}

interface RootErrorBoundaryState {
  error: Error | null
  /** Which components were rendering when it failed: the one clue a hook-order error carries. */
  componentStack: string | null
}

/**
 * The last line of defence of a window's React tree. Without it, an error thrown while rendering or
 * in an effect unmounts the whole root and leaves a blank window with no way back. The terminals keep
 * running in the session daemon, so reloading the window reattaches them.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<RootErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack?.trim() || null
    this.setState({ componentStack })
    diag.error('[app] the window crashed while rendering', error, componentStack)
  }

  private reload = () => {
    if (this.props.onReload) this.props.onReload()
    else window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" data-testid="root-error" className="flex h-screen w-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-base font-semibold">OmniTerm hit an unexpected error</h1>
        <p className="max-w-md text-sm opacity-80">
          Your terminal sessions are still running. Reload the window to reconnect to them.
        </p>
        <pre className="max-w-xl overflow-auto whitespace-pre-wrap text-xs opacity-60">{this.state.error.message}</pre>
        {this.state.componentStack && (
          <details className="max-w-xl text-left text-xs opacity-60">
            <summary className="cursor-pointer">Where it happened</summary>
            <pre data-testid="root-error-stack" className="max-h-60 overflow-auto whitespace-pre-wrap">{this.state.componentStack}</pre>
          </details>
        )}
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={this.reload}>
          Reload window
        </button>
      </div>
    )
  }
}
