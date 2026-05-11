import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { THEMES, DEFAULT_THEME_ID, type ThemeDefinition } from '../themes/definitions'

interface ThemeContextValue {
  theme: ThemeDefinition
  themeId: string
  themes: ThemeDefinition[]
  setTheme: (id: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'dbghf-theme'

function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value)
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID
    } catch {
      return DEFAULT_THEME_ID
    }
  })

  const theme = THEMES.find(t => t.id === themeId) || THEMES[0]

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((id: string) => {
    const t = THEMES.find(x => x.id === id)
    if (!t) return
    setThemeId(id)
    applyTheme(t)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* noop */ }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, themeId, themes: THEMES, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
