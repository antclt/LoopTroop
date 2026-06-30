import { createContext } from 'react'

export interface UIState {
  selectedTicketId: string | null
  selectedTicketExternalId: string | null
  sidebarOpen: boolean
  activeView: 'kanban' | 'ticket' | 'project' | 'config'
  logPanelHeight: number
  filters: {
    projectId: number | null
    status: string | null
    search: string
    priority: number[] | null
    stuckDays: number | null
    onlyErrors: boolean
    sortBy: string
  }
  theme: 'light' | 'dark' | 'system'
  showTriageBar: boolean
}

export type UIAction =
  | { type: 'SELECT_TICKET'; ticketId: string | null; externalId?: string | null }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_VIEW'; view: UIState['activeView'] }
  | { type: 'SET_LOG_PANEL_HEIGHT'; height: number }
  | { type: 'SET_FILTER'; filter: Partial<UIState['filters']> }
  | { type: 'SET_THEME'; theme: UIState['theme'] }
  | { type: 'CLOSE_TICKET' }
  | { type: 'TOGGLE_TRIAGE_BAR' }

export interface UIContextValue {
  state: UIState
  dispatch: React.Dispatch<UIAction>
}

export const UIContext = createContext<UIContextValue | null>(null)
