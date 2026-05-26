import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react'

export interface Project {
  name: string
  path: string
  repoPath: string
  status: string
  source: 'dbht-root' | 'individual'
  rating?: number
  order?: number
  borderColor?: string
  notes?: string
}

export interface ProjectMetadata {
  rating?: number
  order?: number
  borderColor?: string
  notes?: string
}

export interface HFState {
  rootRepoPath: string
  isRootConfigured: boolean
  projects: Project[]
  horseFarmProjectIds: string[]
  horseFarmActiveProject: string | null
  horseFarmActiveSubTab: 'list' | 'settings'
  currentView: 'setup' | 'selector' | 'farm'
  message: string
}

export type HFAction =
  | { type: 'SET_ROOT_REPO_PATH'; payload: string }
  | { type: 'SET_IS_ROOT_CONFIGURED'; payload: boolean }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'ADD_TO_HORSE_FARM'; payload: string[] }
  | { type: 'REMOVE_FROM_HORSE_FARM'; payload: string }
  | { type: 'SET_HORSE_FARM_ACTIVE_PROJECT'; payload: string | null }
  | { type: 'SET_HORSE_FARM_SUB_TAB'; payload: 'list' | 'settings' }
  | { type: 'SET_HORSE_FARM_PROJECT_IDS'; payload: string[] }
  | { type: 'SET_CURRENT_VIEW'; payload: 'setup' | 'selector' | 'farm' }
  | { type: 'SET_MESSAGE'; payload: string }

const initialState: HFState = {
  rootRepoPath: '',
  isRootConfigured: false,
  projects: [],
  horseFarmProjectIds: [],
  horseFarmActiveProject: null,
  horseFarmActiveSubTab: 'list',
  currentView: 'setup',
  message: '',
}

function hfReducer(state: HFState, action: HFAction): HFState {
  switch (action.type) {
    case 'SET_ROOT_REPO_PATH':
      return { ...state, rootRepoPath: action.payload }
    case 'SET_IS_ROOT_CONFIGURED':
      return { ...state, isRootConfigured: action.payload }
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload }
    case 'ADD_PROJECT':
      if (state.projects.find(p => p.path === action.payload.path)) return state
      return { ...state, projects: [...state.projects, action.payload] }
    case 'ADD_TO_HORSE_FARM':
      return {
        ...state,
        horseFarmProjectIds: [...new Set([...state.horseFarmProjectIds, ...action.payload])],
      }
    case 'REMOVE_FROM_HORSE_FARM':
      return {
        ...state,
        horseFarmProjectIds: state.horseFarmProjectIds.filter(id => id !== action.payload),
        horseFarmActiveProject: state.horseFarmActiveProject === action.payload ? null : state.horseFarmActiveProject,
      }
    case 'SET_HORSE_FARM_ACTIVE_PROJECT':
      return { ...state, horseFarmActiveProject: action.payload }
    case 'SET_HORSE_FARM_SUB_TAB':
      return { ...state, horseFarmActiveSubTab: action.payload }
    case 'SET_HORSE_FARM_PROJECT_IDS':
      return { ...state, horseFarmProjectIds: action.payload }
    case 'SET_CURRENT_VIEW':
      return { ...state, currentView: action.payload }
    case 'SET_MESSAGE':
      return { ...state, message: action.payload }
    default:
      return state
  }
}

interface HFContextValue {
  state: HFState
  dispatch: React.Dispatch<HFAction>
}

const HFContext = createContext<HFContextValue | null>(null)

export function HFProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(hfReducer, initialState)
  return (
    <HFContext.Provider value={{ state, dispatch }}>
      {children}
    </HFContext.Provider>
  )
}

export function useHFContext(): [HFState, React.Dispatch<HFAction>] {
  const ctx = useContext(HFContext)
  if (!ctx) throw new Error('useHFContext must be used within HFProvider')
  return [ctx.state, ctx.dispatch]
}
