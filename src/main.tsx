import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { installDevApiGuard } from './lib/devApi'
import { UIProvider } from './context/UIContext'
import { TooltipProvider } from './components/ui/tooltip'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import App from './App'
import './index.css'

installDevApiGuard()

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found in DOM')
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <TooltipProvider>
          <ErrorBoundary fallback={(
            <div className="flex min-h-screen items-center justify-center p-8 text-center">
              <div>
                <h1 className="text-2xl font-bold text-destructive">App crashed</h1>
                <p className="mt-2 text-muted-foreground">Something went wrong. Please refresh the page.</p>
              </div>
            </div>
          )}>
            <App />
          </ErrorBoundary>
        </TooltipProvider>
      </UIProvider>
    </QueryClientProvider>
  </StrictMode>,
)
