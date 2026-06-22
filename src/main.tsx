import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { installDevApiGuard } from './lib/devApi'
import { UIProvider } from './context/UIContext'
import { TooltipProvider } from './components/ui/tooltip'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { AppCrashScreen } from './components/shared/AppCrashScreen'
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
          <ErrorBoundary fallback={(details) => <AppCrashScreen {...details} />}>
            <App />
          </ErrorBoundary>
        </TooltipProvider>
      </UIProvider>
    </QueryClientProvider>
  </StrictMode>,
)
