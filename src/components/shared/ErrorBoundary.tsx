import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryDetails {
  error: Error | null
  componentStack: string | null
}

type FallbackRenderer = (details: ErrorBoundaryDetails) => ReactNode

interface Props {
  fallback?: ReactNode | FallbackRenderer
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught rendering error:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback({
            error: this.state.error,
            componentStack: this.state.componentStack,
          })
        }
        return this.props.fallback
      }
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
          <p className="font-medium">Something went wrong rendering this content.</p>
          {this.state.error && (
            <pre className="mt-2 whitespace-pre-wrap text-[10px] opacity-70">{this.state.error.message}</pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
