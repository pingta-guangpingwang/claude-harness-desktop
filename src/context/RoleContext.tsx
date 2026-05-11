import { createContext, useContext, useReducer, useEffect, type ReactNode, type Dispatch } from 'react'
import type { SkillFragment } from '../roles/fragmentTypes'
import type { SynthesizedRole, IdentityProfile } from '../roles/roleDefinitions'
import { synthesizeRoles, createIdentityProfile, getRoleColor, getRoleRecommendations } from '../roles/RoleSynthesisEngine'
import { fragmentCollector } from '../roles/SkillFragmentCollector'
import { ROLE_DEFINITIONS } from '../roles/roleDefinitions'

interface RoleState {
  identity: IdentityProfile | null
  fragments: SkillFragment[]
  roles: SynthesizedRole[]
  themeColor: string
  displayName: string
}

type RoleAction =
  | { type: 'LOAD_FRAGMENTS'; payload: SkillFragment[] }
  | { type: 'ADD_FRAGMENT'; payload: SkillFragment }
  | { type: 'SWITCH_ROLE'; payload: string }
  | { type: 'SET_DISPLAY_NAME'; payload: string }

function roleReducer(state: RoleState, action: RoleAction): RoleState {
  switch (action.type) {
    case 'LOAD_FRAGMENTS': {
      const identity = createIdentityProfile(state.displayName || '驾驭者', action.payload)
      const roles = synthesizeRoles(action.payload)
      const themeColor = getRoleColor(identity.activeRoleId)
      return { ...state, fragments: action.payload, roles, identity, themeColor }
    }
    case 'ADD_FRAGMENT': {
      const fragments = [...state.fragments, action.payload]
      const identity = createIdentityProfile(state.displayName || '驾驭者', fragments)
      const roles = synthesizeRoles(fragments)
      const themeColor = getRoleColor(identity.activeRoleId)
      return { ...state, fragments, roles, identity, themeColor }
    }
    case 'SWITCH_ROLE': {
      if (!state.identity) return state
      const identity = { ...state.identity, activeRoleId: action.payload }
      const color = getRoleColor(action.payload)
      return { ...state, identity, themeColor: color }
    }
    case 'SET_DISPLAY_NAME': {
      const identity = state.identity
        ? { ...state.identity, displayName: action.payload }
        : null
      return { ...state, displayName: action.payload, identity }
    }
    default:
      return state
  }
}

const initialState: RoleState = {
  identity: null,
  fragments: [],
  roles: [],
  themeColor: '#6366f1',
  displayName: '驾驭者',
}

const RoleContext = createContext<[RoleState, Dispatch<RoleAction>]>([initialState, () => {}])

export function RoleProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roleReducer, initialState)

  useEffect(() => {
    fragmentCollector.load().then(() => {
      const fragments = fragmentCollector.getFragments()
      if (fragments.length > 0) {
        dispatch({ type: 'LOAD_FRAGMENTS', payload: fragments })
      }
    })
    const unsub = fragmentCollector.onFragment((fragment) => {
      dispatch({ type: 'ADD_FRAGMENT', payload: fragment })
    })
    return unsub
  }, [])

  return (
    <RoleContext.Provider value={[state, dispatch]}>
      {children}
    </RoleContext.Provider>
  )
}

export function useRoleContext(): [RoleState, Dispatch<RoleAction>] {
  return useContext(RoleContext)
}

export { ROLE_DEFINITIONS, getRoleColor, getRoleRecommendations }
export type { RoleState, RoleAction, SynthesizedRole, IdentityProfile }
