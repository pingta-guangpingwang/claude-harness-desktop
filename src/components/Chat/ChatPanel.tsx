import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useChat, type ChatSession } from '../../context/ChatContext'
import { useTheme } from '../../context/ThemeContext'
import { ChatBubble } from './ChatBubble'
import { ChatInput } from './ChatInput'
import { SessionList } from './SessionList'
import { VirtualList } from '../Shared/VirtualList'

interface FlowStatus {
  middlewareRunning: boolean
  auditCount: number
  dbhtAvailable: boolean
  dbhtVersion?: string
  dbhtCommits?: number
}

interface ChatPanelProps {
  projectPath?: string
  embedded?: boolean
  allProjectPaths?: string[]
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ projectPath, embedded, allProjectPaths }) => {
  const { messages, isConnected, isConnecting, currentProject, rawLogs, launch, send, stop, clear, loadSession, listSessions } = useChat()
  const { themeId, themes, setTheme } = useTheme()
  const logScrollRef = useRef<HTMLDivElement>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showLogViewer, setShowLogViewer] = useState(false)
  const launchedRef = useRef(false)
  const isAtBottomRef = useRef(true)
  const [flowStatus, setFlowStatus] = useState<FlowStatus>({
    middlewareRunning: false,
    auditCount: 0,
    dbhtAvailable: false,
  })

  const displayProject = projectPath || currentProject

  // 定时刷新全流程状态
  const refreshFlowStatus = useCallback(async () => {
    if (!displayProject) return
    const [mwResult, auditResult, dbhtResult] = await Promise.allSettled([
      window.electronAPI.middlewareGetStatus(),
      window.electronAPI.auditGetProjectEvents(displayProject),
      window.electronAPI.getProjectDBHTStatus(displayProject),
    ])
    setFlowStatus({
      middlewareRunning: mwResult.status === 'fulfilled' ? mwResult.value.success && mwResult.value.status?.running : false,
      auditCount: auditResult.status === 'fulfilled' ? (auditResult.value.events?.length || 0) : 0,
      dbhtAvailable: dbhtResult.status === 'fulfilled' ? dbhtResult.value.dbhtAvailable : false,
      dbhtVersion: dbhtResult.status === 'fulfilled' ? dbhtResult.value.dbhtVersion : undefined,
      dbhtCommits: dbhtResult.status === 'fulfilled' ? dbhtResult.value.projectStatus?.commits?.length : undefined,
    })
  }, [displayProject])

  useEffect(() => {
    refreshFlowStatus()
    const interval = setInterval(refreshFlowStatus, 5000)
    return () => clearInterval(interval)
  }, [refreshFlowStatus])

  // 嵌入模式：仅在 projectPath 变化且与当前项目不一致时自动跟随
  useEffect(() => {
    if (embedded && projectPath && currentProject && projectPath !== currentProject && !isConnected && !isConnecting) {
      launchedRef.current = true
      launch(projectPath)
    }
  }, [embedded, projectPath, currentProject, isConnected, isConnecting, launch])

  // 跟踪用户是否在底部（向上翻阅时不再自动滚动）
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  // followBottom: 用户未手动翻阅时自动跟踪底部
  const [followBottom, setFollowBottom] = useState(true)
  // 用户发消息时强制跟随
  useEffect(() => {
    const lastRole = messages[messages.length - 1]?.role
    if (lastRole === 'user') setFollowBottom(true)
  }, [messages.length])
  // 切换项目时强制跟随到底部
  useEffect(() => { setFollowBottom(true) }, [displayProject])

  const handleLoadSession = (session: ChatSession) => {
    loadSession(session)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--app-bg-primary)',
        borderRadius: embedded ? 8 : 0,
        border: embedded ? '1px solid var(--app-border-primary)' : 'none',
        overflow: 'hidden',
      }}
    >
      {/* 头部状态栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: embedded ? '6px 12px' : '8px 14px',
          borderBottom: '1px solid var(--app-border-primary)',
          background: 'var(--app-bg-header)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isConnecting ? 'var(--app-warning)' : isConnected ? 'var(--app-success)' : 'var(--app-text-secondary)',
              flexShrink: 0,
              animation: isConnecting ? 'hf-pulse 1s ease-in-out infinite' : undefined,
            }}
          />
          <span style={{ fontSize: embedded ? 12 : 13, fontWeight: 600, color: 'var(--app-text-primary)' }}>
            {isConnecting
              ? '正在启动 VSCode + Claude Code 终端...'
              : isConnected && displayProject
                ? `Claude Code 终端 — ${displayProject.split('\\').pop() || displayProject}`
                : displayProject
                  ? `历史记录 — ${displayProject.split('\\').pop() || displayProject}`
                  : 'Claude Code (未连接)'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* 主题切换 */}
          <select
            value={themeId}
            onChange={e => setTheme(e.target.value)}
            style={{
              padding: '3px 6px',
              borderRadius: 6,
              border: '1px solid var(--app-border-primary)',
              background: 'var(--app-bg-secondary)',
              color: 'var(--app-text-primary)',
              cursor: 'pointer',
              fontSize: embedded ? 10 : 11,
              fontWeight: 500,
              outline: 'none',
              fontFamily: 'var(--app-font-sans)',
            }}
          >
            {themes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {displayProject && (
            <button
              onClick={() => setShowHistory(true)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-secondary)',
                color: 'var(--app-info)',
                cursor: 'pointer',
                fontSize: embedded ? 11 : 12,
                fontWeight: 500,
              }}
            >
              历史
            </button>
          )}
          {(isConnected || isConnecting) ? (
            <button
              onClick={stop}
              disabled={isConnecting}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--app-danger)',
                background: isConnecting ? 'var(--app-bg-tertiary)' : 'var(--app-bg-secondary)',
                color: 'var(--app-danger)',
                cursor: isConnecting ? 'not-allowed' : 'pointer',
                fontSize: embedded ? 11 : 12,
                opacity: isConnecting ? 0.5 : 1,
              }}
            >
              {isConnecting ? '启动中...' : '停止'}
            </button>
          ) : null}
          {messages.length > 0 && (
            <button
              onClick={clear}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-secondary)',
                color: 'var(--app-text-secondary)',
                cursor: 'pointer',
                fontSize: embedded ? 11 : 12,
              }}
            >
              清空
            </button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      {messages.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--app-text-secondary)',
            gap: 8,
            padding: embedded ? 16 : 0,
          }}
        >
          <div style={{ fontSize: embedded ? 32 : 40 }}>🤖</div>
          <p style={{ fontSize: embedded ? 12 : 14, margin: 0, textAlign: 'center', lineHeight: 1.8 }}>
            {embedded ? '点击 Chat 按钮启动 Claude Code 专用终端' : '点击 Chat 按钮 → VSCode 打开项目 + Claude Code 终端弹出'}
          </p>
        </div>
      ) : (
        <VirtualList
          key={displayProject || 'no-project'}
          items={messages}
          estimateHeight={80}
          overscan={8}
          followBottom={followBottom}
          getItemKey={(msg) => msg.id}
          renderItem={(msg) => <ChatBubble message={msg} embedded={embedded} />}
          style={{
            flex: 1,
            padding: embedded ? '8px 10px' : '12px 14px',
          }}
        />
      )}

      {/* 实时日志行 — 双击展开 */}
      {rawLogs.length > 0 && (
        <div
          ref={logScrollRef}
          onDoubleClick={() => setShowLogViewer(true)}
          title="双击查看完整日志 / Ctrl+C 复制"
          style={{
            padding: embedded ? '2px 10px' : '3px 14px',
            borderTop: '1px solid var(--app-border-secondary)',
            background: 'var(--app-bg-log)',
            color: 'var(--app-text-log)',
            fontSize: embedded ? 9 : 10,
            fontFamily: 'var(--app-font-mono)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: 'pointer',
            flexShrink: 0,
            lineHeight: 1.6,
            userSelect: 'text',
          }}
        >
          {rawLogs[rawLogs.length - 1]}
        </div>
      )}

      {/* 全流程状态栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: embedded ? '4px 10px' : '5px 14px',
        borderTop: '1px solid var(--app-border-secondary)',
        background: 'var(--app-bg-status)',
        fontSize: embedded ? 10 : 11,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {/* MiddlewareBox */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--app-text-secondary)' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: flowStatus.middlewareRunning ? 'var(--app-success)' : 'var(--app-danger)',
            flexShrink: 0,
          }} />
          中间件{flowStatus.middlewareRunning ? '已连接' : '未连接'}
        </span>
        <span style={{ color: 'var(--app-text-secondary)', opacity: 0.4 }}>|</span>
        {/* PTY 状态 */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--app-text-secondary)' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: isConnected ? 'var(--app-success)' : isConnecting ? 'var(--app-warning)' : 'var(--app-text-secondary)',
            flexShrink: 0,
          }} />
          PTY{isConnected ? '已连接' : isConnecting ? '连接中' : '未连接'}
        </span>
        <span style={{ color: 'var(--app-text-secondary)', opacity: 0.4 }}>|</span>
        {/* 审计 */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--app-text-secondary)' }}>
          📊 审计 {flowStatus.auditCount} 条
        </span>
        <span style={{ color: 'var(--app-text-secondary)', opacity: 0.4 }}>|</span>
        {/* DBHT 版本管理 */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--app-text-secondary)' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: flowStatus.dbhtAvailable ? 'var(--app-success)' : 'var(--app-warning)',
            flexShrink: 0,
          }} />
          DBHT{flowStatus.dbhtAvailable
            ? ` v${flowStatus.dbhtVersion || '?'} (${flowStatus.dbhtCommits ?? '?'} commits)`
            : ' 未安装'}
        </span>
        {/* 手动刷新 */}
        <button
          onClick={refreshFlowStatus}
          style={{
            marginLeft: 'auto', padding: '0 4px', border: 'none', background: 'transparent',
            color: 'var(--app-text-secondary)', cursor: 'pointer', fontSize: embedded ? 9 : 10,
          }}
          title="刷新状态"
        >
          🔃
        </button>
      </div>

      {/* 输入框 */}
      <ChatInput
        onSend={send}
        disabled={!isConnected}
        compact={embedded}
        placeholder={
          isConnecting ? 'Claude Code 启动中，稍候...'
            : isConnected ? '输入消息... (Enter 发送)'
            : '点击项目卡片 Chat 按钮启动'
        }
      />

      {/* 会话历史弹窗 */}
      {showHistory && displayProject && (
        <SessionList
          projectPath={displayProject}
          allProjectPaths={allProjectPaths}
          onLoad={handleLoadSession}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* 完整日志查看器 */}
      {showLogViewer && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
        }} onClick={() => setShowLogViewer(false)}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 16px', background: 'var(--app-bg-log)', color: 'var(--app-text-primary)',
            flexShrink: 0,
          }} onClick={e => e.stopPropagation()}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>PTY 原始日志</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => {
                navigator.clipboard.writeText(rawLogs.join('\n'))
              }} style={{
                padding: '4px 12px', borderRadius: 4, border: '1px solid var(--app-border-primary)',
                background: 'var(--app-bg-tertiary)', color: 'var(--app-text-primary)', cursor: 'pointer', fontSize: 11,
              }}>
                复制全部
              </button>
              <button onClick={() => setShowLogViewer(false)} style={{
                padding: '4px 12px', borderRadius: 4, border: 'none',
                background: 'var(--app-danger)', color: '#fff', cursor: 'pointer', fontSize: 11,
              }}>
                关闭
              </button>
            </div>
          </div>
          <div onClick={e => e.stopPropagation()} style={{
            flex: 1, overflow: 'auto', padding: 12,
            background: 'var(--app-bg-log)', margin: '0 40px 40px',
            borderRadius: '0 0 8px 8px', fontFamily: 'var(--app-font-mono)',
            fontSize: 11, lineHeight: 1.7, color: 'var(--app-text-log)',
          }}>
            {rawLogs.map((line, i) => (
              <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
