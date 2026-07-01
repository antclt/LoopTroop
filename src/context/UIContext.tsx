import { useReducer, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { UIContext, type UIState, type UIAction, type TriagePreset, type ErrorStateFilter } from './uiContextDef'
import type { WorkflowGroupId } from '@shared/workflowMeta'

const STORAGE_KEY = 'looptroop-ui-state'
const useBrowserLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const defaultState: UIState = {
  selectedTicketId: null,
  selectedTicketExternalId: null,
  sidebarOpen: true,
  activeView: 'kanban',
  logPanelHeight: 300,
  filters: {
    projectId: null,
    status: null,
    phase: null,
    search: '',
    priority: null,
    stuckDays: null,
    errorState: 'none',
    sortBy: 'updatedAt_desc',
  },
  presetsByProject: {},
  theme: 'system',
  showTriageBar: false,
}

const VALID_VIEWS: UIState['activeView'][] = ['kanban', 'ticket', 'project', 'config']

function normalizeFilters(value: Record<string, unknown> | undefined): UIState['filters'] {
  const merged = {
    ...defaultState.filters,
    ...(value ?? {}),
  } as UIState['filters'] & Record<string, unknown>

  // Legacy migration: the pre-tri-state binary `onlyErrors: true` becomes `errorState: 'blocked'`.
  let errorState: ErrorStateFilter =
    merged.errorState === 'past' || merged.errorState === 'blocked' ? merged.errorState : 'none'
  if (merged.onlyErrors === true) errorState = 'blocked'

  // Legacy migration: `status` was a single string in older persisted state; only arrays are kept.
  const rawStatus = merged.status
  const status: string[] | null = Array.isArray(rawStatus)
    ? rawStatus.filter((v): v is string => typeof v === 'string')
    : null

  const rawPhase = merged.phase
  const phase: WorkflowGroupId[] | null = Array.isArray(rawPhase)
    ? rawPhase.filter((v): v is WorkflowGroupId => typeof v === 'string')
    : null

  return {
    projectId: merged.projectId,
    status,
    phase,
    search: merged.search,
    priority: merged.priority,
    stuckDays: merged.stuckDays,
    errorState,
    sortBy: merged.sortBy,
  }
}

const LEGACY_PRESET_KEY_PREFIX = 'looptroop-presets-'

function normalizePreset(raw: unknown): TriagePreset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  const priority = Array.isArray(p.priority)
    ? p.priority.filter((v): v is number => typeof v === 'number')
    : null
  const stuckDays = typeof p.stuckDays === 'number' ? p.stuckDays : null
  const status = Array.isArray(p.status)
    ? p.status.filter((v): v is string => typeof v === 'string')
    : null
  const phase = Array.isArray(p.phase)
    ? p.phase.filter((v): v is WorkflowGroupId => typeof v === 'string')
    : null
  let errorState: ErrorStateFilter = 'none'
  if (p.errorState === 'past' || p.errorState === 'blocked') errorState = p.errorState
  else if (p.onlyErrors === true) errorState = 'blocked' // legacy migration
  const sortBy = typeof p.sortBy === 'string' ? p.sortBy : 'updatedAt_desc'
  return { priority, stuckDays, status, phase, errorState, sortBy }
}

function normalizePresetsByProject(value: unknown): Record<string, Record<string, TriagePreset>> {
  if (typeof value !== 'object' || value === null) return {}
  const obj = value as Record<string, unknown>
  const result: Record<string, Record<string, TriagePreset>> = {}
  for (const [scopeKey, presets] of Object.entries(obj)) {
    if (typeof presets !== 'object' || presets === null) continue
    const normalized: Record<string, TriagePreset> = {}
    for (const [name, preset] of Object.entries(presets as Record<string, unknown>)) {
      const n = normalizePreset(preset)
      if (n) normalized[name] = n
    }
    if (Object.keys(normalized).length) result[scopeKey] = normalized
  }
  return result
}

/**
 * One-time migration of legacy per-project `looptroop-presets-*` localStorage keys into
 * `UIState.presetsByProject`. Legacy keys are left in place (harmless, read-only) so older
 * app builds in other tabs keep working; the migrated presets become the durable source.
 */
function migrateLegacyPresets(existing: Record<string, Record<string, TriagePreset>>): Record<string, Record<string, TriagePreset>> {
  if (typeof window === 'undefined') return existing
  const merged: Record<string, Record<string, TriagePreset>> = { ...existing }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(LEGACY_PRESET_KEY_PREFIX)) continue
      if (merged[key]) continue
      const stored = localStorage.getItem(key)
      if (!stored) continue
      const parsed = JSON.parse(stored) as unknown
      const normalized: Record<string, TriagePreset> = {}
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [name, preset] of Object.entries(parsed as Record<string, unknown>)) {
          const n = normalizePreset(preset)
          if (n) normalized[name] = n
        }
      }
      if (Object.keys(normalized).length) merged[key] = normalized
    }
  } catch {
    // ignore migration errors; legacy presets simply won't be carried over
  }
  return merged
}

function normalizeUIState(value: Partial<UIState>): UIState {
  const activeView = VALID_VIEWS.includes(value.activeView as UIState['activeView'])
    ? value.activeView
    : defaultState.activeView

  return {
    ...defaultState,
    ...value,
    activeView: activeView ?? defaultState.activeView,
    filters: normalizeFilters(value.filters as Record<string, unknown> | undefined),
    presetsByProject: normalizePresetsByProject(value.presetsByProject),
  }
}

function isValidUIState(value: unknown): value is Partial<UIState> {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (obj.logPanelHeight !== undefined && (typeof obj.logPanelHeight !== 'number' || obj.logPanelHeight < 100)) return false
  if (obj.sidebarOpen !== undefined && typeof obj.sidebarOpen !== 'boolean') return false
  if (obj.showTriageBar !== undefined && typeof obj.showTriageBar !== 'boolean') return false
  if (obj.theme !== undefined && !['light', 'dark', 'system'].includes(obj.theme as string)) return false
  if (obj.activeView !== undefined && !VALID_VIEWS.includes(obj.activeView as UIState['activeView'])) return false
  if (obj.filters !== undefined) {
    const filters = obj.filters as Record<string, unknown>
    if (typeof filters !== 'object' || filters === null) return false
    if (filters.projectId !== undefined && filters.projectId !== null && typeof filters.projectId !== 'number') return false
    if (filters.status !== undefined && filters.status !== null && typeof filters.status !== 'string' && !Array.isArray(filters.status)) return false
    if (filters.phase !== undefined && filters.phase !== null && !Array.isArray(filters.phase)) return false
    if (filters.search !== undefined && typeof filters.search !== 'string') return false
    if (filters.priority !== undefined && filters.priority !== null && !Array.isArray(filters.priority)) return false
    if (filters.stuckDays !== undefined && filters.stuckDays !== null && typeof filters.stuckDays !== 'number') return false
    if (filters.errorState !== undefined && !['none', 'past', 'blocked'].includes(filters.errorState as string)) return false
    if (filters.onlyErrors !== undefined && typeof filters.onlyErrors !== 'boolean') return false // legacy
    if (filters.sortBy !== undefined && typeof filters.sortBy !== 'string') return false
  }
  if (obj.presetsByProject !== undefined && (typeof obj.presetsByProject !== 'object' || obj.presetsByProject === null)) return false
  return true
}

function getInitialState(): UIState {
  let initialState = defaultState
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as unknown
        if (!isValidUIState(parsed)) return { ...defaultState, presetsByProject: migrateLegacyPresets({}) }
        const normalized = normalizeUIState(parsed)
        initialState = normalized
      }
    } catch {
      // ignore parse errors
    }
  }
  return { ...initialState, presetsByProject: migrateLegacyPresets(initialState.presetsByProject) }
}

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SELECT_TICKET':
      return { ...state, selectedTicketId: action.ticketId, selectedTicketExternalId: action.externalId ?? null, activeView: action.ticketId ? 'ticket' : 'kanban' }
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen }
    case 'SET_VIEW':
      return { ...state, activeView: action.view }
    case 'SET_LOG_PANEL_HEIGHT':
      return { ...state, logPanelHeight: action.height }
    case 'SET_FILTER':
      return { ...state, filters: normalizeFilters({ ...state.filters, ...action.filter }) }
    case 'SET_PRESETS':
      return { ...state, presetsByProject: { ...state.presetsByProject, [action.presetKey]: action.presets } }
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    case 'CLOSE_TICKET':
      return { ...state, selectedTicketId: null, selectedTicketExternalId: null, activeView: 'kanban' }
    case 'TOGGLE_TRIAGE_BAR':
      return { ...state, showTriageBar: !state.showTriageBar }
    default:
      return state
  }
}


export function UIProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, undefined, getInitialState)

  // Persist to localStorage before the browser can paint the updated UI, so quick refreshes
  // after actions like saving a preset cannot outrun the durable write.
  useBrowserLayoutEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore storage errors
    }
  }, [state])

  // Sync URL with state
  useEffect(() => {
    const currentPath = window.location.pathname
    let targetPath = '/'

    if (state.activeView === 'ticket' && state.selectedTicketId) {
      targetPath = `/ticket/${state.selectedTicketExternalId ?? state.selectedTicketId}`
    } else if (state.activeView === 'config') {
      targetPath = '/config'
    } else if (state.activeView === 'project') {
      targetPath = '/project'
    }

    if (currentPath !== targetPath) {
      window.history.pushState(null, '', targetPath)
    }
  }, [state.activeView, state.selectedTicketId, state.selectedTicketExternalId])

  // Apply theme and listen for system changes
  useEffect(() => {
    const applyTheme = () => {
      const isDark = state.theme === 'dark' ||
        (state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', isDark)
    }
    applyTheme()

    if (state.theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      mql.addEventListener('change', applyTheme)
      return () => mql.removeEventListener('change', applyTheme)
    }
  }, [state.theme])

  return (
    <UIContext.Provider value={{ state, dispatch }}>
      {children}
    </UIContext.Provider>
  )
}
