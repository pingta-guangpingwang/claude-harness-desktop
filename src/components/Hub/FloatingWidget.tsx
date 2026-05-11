import { useState, useEffect } from 'react'
import { QuickCommandPalette } from './QuickCommandPalette'
import './Hub.css'

export function FloatingWidget() {
  const [visible, setVisible] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<'commands' | 'status' | 'actions'>('commands')
  const [projectStatuses, setProjectStatuses] = useState<Array<{ path: string; name: string; online: boolean }>>([])

  useEffect(() => {
    loadStatus()
    const timer = setInterval(loadStatus, 10000)
    return () => clearInterval(timer)
  }, [])

  const loadStatus = async () => {
    try {
      const idsResult = await window.electronAPI.loadHorseFarmProjectIds()
      if (idsResult.success) {
        const items: Array<{ path: string; name: string; online: boolean }> = []
        for (const id of (idsResult.ids || []).slice(0, 10)) {
          const name = (idsResult.individualProjects?.[id] as any)?.name || id.split('\\').pop() || id
          // 简化的在线检测
          const online = Math.random() > 0.3 // 占位：实际应通过 PTY 状态判断
          items.push({ path: id, name, online })
        }
        setProjectStatuses(items)
      }
    } catch { /* ignore */ }
  }

  const handleQuickAction = async (action: string) => {
    try {
      switch (action) {
        case 'check-all':
          window.electronAPI.cliExecute({
            command: 'check_status',
            args: {},
            projectIds: [],
            projectNames: {},
          })
          break
        case 'wake-all':
          window.electronAPI.cliExecute({
            command: 'wake_projects',
            args: {},
            projectIds: [],
            projectNames: {},
          })
          break
        case 'open-main':
          // 通过 IPC 通知主进程显示主窗口
          break
      }
    } catch { /* ignore */ }
  }

  if (!visible) return null

  return (
    <div className="fw-container" data-collapsed={collapsed}>
      <div className="fw-drag-bar">
        <span className="fw-title">CHD</span>
        <div className="fw-actions">
          <button className="fw-btn" onClick={() => setCollapsed(!collapsed)} title="Toggle">
            {collapsed ? '▤' : '▸'}
          </button>
          <button className="fw-btn" onClick={() => setVisible(false)} title="Close">x</button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="fw-tabs">
            <button className={`fw-tab ${activeTab === 'commands' ? 'active' : ''}`} onClick={() => setActiveTab('commands')}>Quick</button>
            <button className={`fw-tab ${activeTab === 'status' ? 'active' : ''}`} onClick={() => setActiveTab('status')}>Status</button>
            <button className={`fw-tab ${activeTab === 'actions' ? 'active' : ''}`} onClick={() => setActiveTab('actions')}>Actions</button>
          </div>

          <div className="fw-body">
            {activeTab === 'commands' && <QuickCommandPalette compact />}
            {activeTab === 'status' && (
              <div className="fw-status-list">
                {projectStatuses.map(p => (
                  <div key={p.path} className="fw-status-item">
                    <span className={`fw-status-dot ${p.online ? 'online' : 'offline'}`} />
                    <span className="fw-status-name">{p.name}</span>
                  </div>
                ))}
                {projectStatuses.length === 0 && <div className="fw-empty">No projects loaded</div>}
              </div>
            )}
            {activeTab === 'actions' && (
              <div className="fw-actions-list">
                <button className="fw-action-btn" onClick={() => handleQuickAction('check-all')}>
                  Check All Status
                </button>
                <button className="fw-action-btn" onClick={() => handleQuickAction('wake-all')}>
                  Wake All Terminals
                </button>
                <button className="fw-action-btn" onClick={() => handleQuickAction('open-main')}>
                  Open Main Window
                </button>
                <button className="fw-action-btn" onClick={() => window.electronAPI.cliExecute({ command: 'stop_projects', args: {}, projectIds: [], projectNames: {} })}>
                  Stop All Terminals
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
