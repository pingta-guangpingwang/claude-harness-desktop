import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { HorseFarmProject } from '../../types/horseFarm'

interface CommandPaletteProps {
  projectIds: string[]
  hfProjects: Record<string, HorseFarmProject>
  apiKey?: string
  model?: string
}

interface CLICommand {
  name: string
  description: string
  summary?: string
  category?: string
  aliases?: string[]
  params?: Array<{ name: string; type: string; description: string; required?: boolean }>
  permission?: string
}

interface CommandResultEntry {
  id: string
  time: string
  command: string
  output: string
  success: boolean
  durationMs?: number
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ projectIds, hfProjects, apiKey, model }) => {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<CommandResultEntry[]>([])
  const [suggestions, setSuggestions] = useState<CLICommand[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [executing, setExecuting] = useState(false)
  const [allCommands, setAllCommands] = useState<CLICommand[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const resultsEndRef = useRef<HTMLDivElement>(null)

  // 加载命令列表
  useEffect(() => {
    window.electronAPI.cliList().then(res => {
      if (res.success) setAllCommands(res.commands)
    }).catch(() => {})
  }, [])

  // 模糊搜索
  const searchCommands = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestions(allCommands.slice(0, 8))
      return
    }
    try {
      const res = await window.electronAPI.cliSearch(query)
      if (res.success) setSuggestions(res.commands.slice(0, 8))
    } catch {
      // 本地过滤兜底
      const q = query.toLowerCase()
      setSuggestions(allCommands.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.summary?.toLowerCase().includes(q) ||
        c.aliases?.some(a => a.includes(q))
      ).slice(0, 8))
    }
  }, [allCommands])

  useEffect(() => {
    searchCommands(input)
    setShowSuggestions(true)
    setSelectedIdx(0)
  }, [input, searchCommands])

  // 执行命令
  const executeCommand = useCallback(async (commandStr: string) => {
    if (!commandStr.trim()) return
    setInput('')
    setShowSuggestions(false)
    setExecuting(true)

    const startTime = Date.now()
    const projectNamesMap: Record<string, string> = {}
    for (const id of projectIds) {
      projectNamesMap[id] = hfProjects[id]?.projectName || id.split('\\').pop() || id
    }

    try {
      const res = await window.electronAPI.cliExecute({
        command: commandStr,
        args: {},
        projectIds,
        projectNames: projectNamesMap,
        apiKey,
        model,
      })
      setResults(prev => [...prev.slice(-199), {
        id: Date.now().toString(36),
        time: new Date().toLocaleTimeString('zh-CN'),
        command: commandStr,
        output: res.output,
        success: res.success,
        durationMs: Date.now() - startTime,
      }])
    } catch (err) {
      setResults(prev => [...prev.slice(-199), {
        id: Date.now().toString(36),
        time: new Date().toLocaleTimeString('zh-CN'),
        command: commandStr,
        output: `执行失败: ${String(err)}`,
        success: false,
        durationMs: Date.now() - startTime,
      }])
    }
    setExecuting(false)
  }, [projectIds, hfProjects, apiKey, model])

  // 键盘交互
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (showSuggestions && suggestions.length > 0) {
        const cmd = suggestions[selectedIdx]
        if (cmd) {
          executeCommand(cmd.name)
          return
        }
      }
      executeCommand(input)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }, [input, showSuggestions, suggestions, selectedIdx, executeCommand])

  // 点击建议
  const selectSuggestion = useCallback((cmd: CLICommand) => {
    setInput(cmd.name + ' ')
    setShowSuggestions(false)
    inputRef.current?.focus()
    // 如果无参数命令，直接执行
    if (!cmd.params?.some(p => p.required)) {
      executeCommand(cmd.name)
    }
  }, [executeCommand])

  // 分类颜色
  const categoryColor = useMemo(() => (cat?: string) => {
    switch (cat) {
      case 'project': return '#10b981'
      case 'git': return '#f59e0b'
      case 'ai': return '#6366f1'
      case 'system': return '#ef4444'
      default: return '#94a3b8'
    }
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '240px',
      background: 'var(--app-bg-primary)',
    }}>
      {/* 命令输出区 */}
      <div ref={listRef} style={{
        flex: 1, overflow: 'auto', padding: '10px 12px', maxHeight: '45vh',
        fontFamily: 'var(--app-font-mono)', fontSize: 11, lineHeight: 1.6,
      }}>
        {results.length === 0 && !executing && (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
            <div>输入命令开始 — 试试 status / wake / git-status / help</div>
            <div style={{ marginTop: 12, fontSize: 10, color: '#475569' }}>
              按 ↑↓ 选择建议 · Enter 执行 · Tab 自动补全
            </div>
          </div>
        )}
        {executing && (
          <div style={{ color: '#6366f1', padding: 4 }}>⏳ 执行中...</div>
        )}
        {results.map(r => (
          <div key={r.id} style={{
            marginBottom: 8, padding: '8px 10px', borderRadius: 6,
            background: r.success ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)',
            borderLeft: `3px solid ${r.success ? '#10b981' : '#ef4444'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#6366f1', fontWeight: 600 }}>❯ {r.command}</span>
              <span style={{ color: '#64748b', fontSize: 10 }}>
                {r.time}{r.durationMs != null ? ` · ${r.durationMs}ms` : ''}
              </span>
            </div>
            <div style={{
              color: 'var(--app-text-primary)', whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>{r.output}</div>
          </div>
        ))}
        <div ref={resultsEndRef} />
      </div>

      {/* 输入区 + 建议弹窗 */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {showSuggestions && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, right: 0,
            margin: '0 12px 4px', background: 'var(--app-bg-primary)',
            border: '1px solid var(--app-border-primary)', borderRadius: 8,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.25)', overflow: 'hidden',
            zIndex: 100,
          }}>
            {suggestions.map((cmd, i) => (
              <div
                key={cmd.name}
                onClick={() => selectSuggestion(cmd)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', cursor: 'pointer',
                  background: i === selectedIdx ? 'rgba(99,102,241,0.1)' : 'transparent',
                  borderLeft: i === selectedIdx ? '2px solid #6366f1' : '2px solid transparent',
                  fontSize: 12,
                }}
              >
                <span style={{
                  padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600,
                  background: categoryColor(cmd.category) + '22',
                  color: categoryColor(cmd.category),
                }}>{cmd.category || 'cmd'}</span>
                <span style={{ color: 'var(--app-text-primary)', fontWeight: 600 }}>{cmd.name}</span>
                {cmd.aliases?.map(a => (
                  <span key={a} style={{ color: '#64748b', fontSize: 10 }}>{a}</span>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ color: '#64748b', fontSize: 11 }}>{cmd.summary || cmd.description}</span>
                {cmd.permission && cmd.permission !== 'user' && (
                  <span style={{
                    padding: '1px 4px', borderRadius: 3, fontSize: 9,
                    background: '#f59e0b22', color: '#f59e0b',
                  }}>{cmd.permission}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{
          display: 'flex', gap: 6, padding: '8px 12px',
          borderTop: '1px solid var(--app-border-primary)',
          background: 'var(--app-bg-header)',
        }}>
          <span style={{
            color: executing ? '#f59e0b' : '#6366f1', fontSize: 14,
            display: 'flex', alignItems: 'center',
          }}>❯</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            disabled={executing}
            placeholder="输入命令... status / wake / git-status / broadcast npm install"
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: 'var(--app-text-primary)', fontSize: 12, outline: 'none',
              fontFamily: 'var(--app-font-mono)',
              opacity: executing ? 0.5 : 1,
            }}
          />
          <button
            onClick={() => setResults([])}
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--app-border-primary)',
              background: 'transparent', color: 'var(--app-text-secondary)',
              cursor: 'pointer', fontSize: 11,
            }}
          >清空</button>
        </div>
      </div>
    </div>
  )
}
