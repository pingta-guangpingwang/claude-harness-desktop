// =============================================================================
// Claude Harness Desktop — 主题定义 (VSCode 风格 + 默认浅色)
// =============================================================================

export interface ThemeDefinition {
  id: string
  name: string
  // CSS custom properties — 直接设置到 :root
  colors: Record<string, string>
}

export const THEMES: ThemeDefinition[] = [
  // ===========================================================================
  // VSCode Dark+ (默认)
  // ===========================================================================
  {
    id: 'vscode-dark-plus',
    name: 'VSCode Dark+',
    colors: {
      '--app-bg-primary': '#1e1e1e',
      '--app-bg-secondary': '#252526',
      '--app-bg-tertiary': '#2d2d2d',
      '--app-bg-input': '#3c3c3c',
      '--app-bg-assistant': '#2d2d30',
      '--app-bg-system': '#252526',
      '--app-bg-user': '#007acc',
      '--app-bg-log': '#1a1a1a',
      '--app-bg-status': '#007acc',
      '--app-bg-header': '#252526',

      '--app-text-primary': '#cccccc',
      '--app-text-secondary': '#858585',
      '--app-text-assistant': '#d4d4d4',
      '--app-text-system': '#858585',
      '--app-text-user': '#ffffff',
      '--app-text-log': '#a0a0a0',
      '--app-text-placeholder': '#5a5a5a',

      '--app-border-primary': '#3c3c3c',
      '--app-border-secondary': '#333333',
      '--app-border-input': '#3c3c3c',

      '--app-accent': '#007acc',
      '--app-accent-hover': '#1a8ad4',
      '--app-success': '#4ec9b0',
      '--app-warning': '#cca700',
      '--app-danger': '#f44747',
      '--app-info': '#3794ff',

      '--app-font-mono': '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      '--app-font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      '--app-font-size-sm': '11px',
      '--app-font-size': '13px',
      '--app-font-size-lg': '14px',

      // ANSI 终端色 (VSCode Dark+ terminal)
      '--ansi-black': '#000000',
      '--ansi-red': '#cd3131',
      '--ansi-green': '#0dbc79',
      '--ansi-yellow': '#e5e510',
      '--ansi-blue': '#2472c8',
      '--ansi-magenta': '#bc3fbc',
      '--ansi-cyan': '#11a8cd',
      '--ansi-white': '#e5e5e5',
      '--ansi-bright-black': '#666666',
      '--ansi-bright-red': '#f14c4c',
      '--ansi-bright-green': '#23d18b',
      '--ansi-bright-yellow': '#f5f543',
      '--ansi-bright-blue': '#3b8eea',
      '--ansi-bright-magenta': '#d670d6',
      '--ansi-bright-cyan': '#29b8db',
      '--ansi-bright-white': '#ffffff',

      // 滚动条
      '--scrollbar-thumb': '#424242',
      '--scrollbar-track': 'transparent',
    },
  },

  // ===========================================================================
  // One Dark Pro
  // ===========================================================================
  {
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    colors: {
      '--app-bg-primary': '#282c34',
      '--app-bg-secondary': '#21252b',
      '--app-bg-tertiary': '#2c313c',
      '--app-bg-input': '#1e2127',
      '--app-bg-assistant': '#2c313a',
      '--app-bg-system': '#21252b',
      '--app-bg-user': '#61afef',
      '--app-bg-log': '#1b1d23',
      '--app-bg-status': '#282c34',
      '--app-bg-header': '#21252b',

      '--app-text-primary': '#abb2bf',
      '--app-text-secondary': '#5c6370',
      '--app-text-assistant': '#abb2bf',
      '--app-text-system': '#5c6370',
      '--app-text-user': '#282c34',
      '--app-text-log': '#7f848e',
      '--app-text-placeholder': '#4b5263',

      '--app-border-primary': '#3e4452',
      '--app-border-secondary': '#2c313c',
      '--app-border-input': '#3e4452',

      '--app-accent': '#61afef',
      '--app-accent-hover': '#7ec8f6',
      '--app-success': '#98c379',
      '--app-warning': '#e5c07b',
      '--app-danger': '#e06c75',
      '--app-info': '#61afef',

      '--app-font-mono': '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      '--app-font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      '--app-font-size-sm': '11px',
      '--app-font-size': '13px',
      '--app-font-size-lg': '14px',

      '--ansi-black': '#282c34',
      '--ansi-red': '#e06c75',
      '--ansi-green': '#98c379',
      '--ansi-yellow': '#e5c07b',
      '--ansi-blue': '#61afef',
      '--ansi-magenta': '#c678dd',
      '--ansi-cyan': '#56b6c2',
      '--ansi-white': '#abb2bf',
      '--ansi-bright-black': '#5c6370',
      '--ansi-bright-red': '#e06c75',
      '--ansi-bright-green': '#98c379',
      '--ansi-bright-yellow': '#e5c07b',
      '--ansi-bright-blue': '#61afef',
      '--ansi-bright-magenta': '#c678dd',
      '--ansi-bright-cyan': '#56b6c2',
      '--ansi-bright-white': '#ffffff',

      '--scrollbar-thumb': '#4b5263',
      '--scrollbar-track': 'transparent',
    },
  },

  // ===========================================================================
  // 默认浅色 (保留当前风格)
  // ===========================================================================
  {
    id: 'default-light',
    name: '默认浅色',
    colors: {
      '--app-bg-primary': '#f8fafc',
      '--app-bg-secondary': '#ffffff',
      '--app-bg-tertiary': '#f1f5f9',
      '--app-bg-input': '#ffffff',
      '--app-bg-assistant': '#1e293b',
      '--app-bg-system': '#f3f4f6',
      '--app-bg-user': '#4f46e5',
      '--app-bg-log': '#1e1e1e',
      '--app-bg-status': '#fafafa',
      '--app-bg-header': '#ffffff',

      '--app-text-primary': '#1e293b',
      '--app-text-secondary': '#94a3b8',
      '--app-text-assistant': '#e2e8f0',
      '--app-text-system': '#6b7280',
      '--app-text-user': '#ffffff',
      '--app-text-log': '#c4c4c4',
      '--app-text-placeholder': '#94a3b8',

      '--app-border-primary': '#e2e8f0',
      '--app-border-secondary': '#f3f4f6',
      '--app-border-input': '#d1d5db',

      '--app-accent': '#4f46e5',
      '--app-accent-hover': '#6366f1',
      '--app-success': '#10b981',
      '--app-warning': '#f59e0b',
      '--app-danger': '#dc2626',
      '--app-info': '#6366f1',

      '--app-font-mono': '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
      '--app-font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      '--app-font-size-sm': '10px',
      '--app-font-size': '13px',
      '--app-font-size-lg': '14px',

      '--ansi-black': '#1e293b',
      '--ansi-red': '#dc2626',
      '--ansi-green': '#16a34a',
      '--ansi-yellow': '#d97706',
      '--ansi-blue': '#2563eb',
      '--ansi-magenta': '#9333ea',
      '--ansi-cyan': '#0891b2',
      '--ansi-white': '#e2e8f0',
      '--ansi-bright-black': '#64748b',
      '--ansi-bright-red': '#f87171',
      '--ansi-bright-green': '#4ade80',
      '--ansi-bright-yellow': '#fbbf24',
      '--ansi-bright-blue': '#60a5fa',
      '--ansi-bright-magenta': '#c084fc',
      '--ansi-bright-cyan': '#22d3ee',
      '--ansi-bright-white': '#f8fafc',

      '--scrollbar-thumb': '#cbd5e1',
      '--scrollbar-track': 'transparent',
    },
  },

  // ===========================================================================
  // VSCode Light+
  // ===========================================================================
  {
    id: 'vscode-light-plus',
    name: 'VSCode Light+',
    colors: {
      '--app-bg-primary': '#ffffff',
      '--app-bg-secondary': '#f3f3f3',
      '--app-bg-tertiary': '#ececec',
      '--app-bg-input': '#ffffff',
      '--app-bg-assistant': '#f3f3f3',
      '--app-bg-system': '#ececec',
      '--app-bg-user': '#005fb8',
      '--app-bg-log': '#1e1e1e',
      '--app-bg-status': '#f3f3f3',
      '--app-bg-header': '#f3f3f3',

      '--app-text-primary': '#3b3b3b',
      '--app-text-secondary': '#858585',
      '--app-text-assistant': '#3b3b3b',
      '--app-text-system': '#858585',
      '--app-text-user': '#ffffff',
      '--app-text-log': '#c4c4c4',
      '--app-text-placeholder': '#858585',

      '--app-border-primary': '#e5e5e5',
      '--app-border-secondary': '#ececec',
      '--app-border-input': '#cecece',

      '--app-accent': '#005fb8',
      '--app-accent-hover': '#0071d4',
      '--app-success': '#388a34',
      '--app-warning': '#997000',
      '--app-danger': '#cd3131',
      '--app-info': '#005fb8',

      '--app-font-mono': '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      '--app-font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      '--app-font-size-sm': '11px',
      '--app-font-size': '13px',
      '--app-font-size-lg': '14px',

      '--ansi-black': '#000000',
      '--ansi-red': '#cd3131',
      '--ansi-green': '#00bc00',
      '--ansi-yellow': '#949800',
      '--ansi-blue': '#0451a5',
      '--ansi-magenta': '#bc05bc',
      '--ansi-cyan': '#0598bc',
      '--ansi-white': '#555555',
      '--ansi-bright-black': '#666666',
      '--ansi-bright-red': '#cd3131',
      '--ansi-bright-green': '#14ce14',
      '--ansi-bright-yellow': '#b5ba00',
      '--ansi-bright-blue': '#0451a5',
      '--ansi-bright-magenta': '#bc05bc',
      '--ansi-bright-cyan': '#0598bc',
      '--ansi-bright-white': '#a5a5a5',

      '--scrollbar-thumb': '#c1c1c1',
      '--scrollbar-track': 'transparent',
    },
  },
]

export const DEFAULT_THEME_ID = 'vscode-dark-plus'
