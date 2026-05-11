import { useState, useEffect, useCallback } from 'react'

interface PluginDetail {
  id: string
  name: string
  version: string
  description: string
  author: string
  permissions: string[]
  provides: Array<{ type: string; id: string; description: string }>
  consumes: Array<{ type: string; id: string }>
  status: string
  error?: string
  installedAt: string
  enabledAt?: string
}

interface VersionEntry {
  version: string
  installedAt: string
  backupPath: string
  checksum?: string
}

interface PluginSettingsProps {
  pluginId: string
}

const PERMISSION_LABELS: Record<string, string> = {
  'filesystem:read': '文件读取',
  'filesystem:write': '文件写入',
  'network': '网络请求',
  'dbht:execute': '执行 DBHT 命令',
  'ai:call': '调用 AI',
  'window:overlay': '窗口覆盖',
  'clipboard': '剪贴板',
  'notifications': '通知',
}

const CAPABILITY_LABELS: Record<string, string> = {
  'command': 'CLI 命令',
  'view.panel': '右侧面板',
  'view.tab': '顶部标签页',
  'ai.tool': '驾驭智能体工具',
  'workflow.step': '工作流节点',
  'menu.action': '菜单项',
}

export const PluginSettings: React.FC<PluginSettingsProps> = ({ pluginId }) => {
  const [plugin, setPlugin] = useState<PluginDetail | null>(null)
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [detail, history] = await Promise.all([
        window.electronAPI.pluginGet(pluginId),
        window.electronAPI.pluginVersionHistory(pluginId),
      ])
      setPlugin(detail)
      setVersions(history)
    } catch (e) {
      console.error('Failed to load plugin detail:', e)
    } finally {
      setLoading(false)
    }
  }, [pluginId])

  useEffect(() => { load() }, [load])

  const handleRollback = async (targetVersion: string) => {
    if (!confirm(`确认回滚到版本 ${targetVersion}？当前版本将被替换。`)) return
    setRollbackMsg(null)
    try {
      const result = await window.electronAPI.pluginRollback(pluginId, targetVersion)
      if (result.success) {
        setRollbackMsg(`已回滚到 ${targetVersion}`)
        await load()
      } else {
        setRollbackMsg(`回滚失败: ${result.error}`)
      }
    } catch (e) {
      setRollbackMsg(`回滚失败: ${String(e)}`)
    }
  }

  if (loading) {
    return <div style={{ color: '#888', textAlign: 'center', padding: '24px' }}>加载中...</div>
  }

  if (!plugin) {
    return <div style={{ color: '#f44336', textAlign: 'center', padding: '24px' }}>插件未找到</div>
  }

  return (
    <div style={{ padding: '16px', height: '100%', overflow: 'auto' }}>
      {/* 基本信息 */}
      <div style={{
        background: '#1e1e2e', borderRadius: '8px', padding: '16px', marginBottom: '12px',
        border: '1px solid #333',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', color: '#e0e0e0' }}>{plugin.name}</h3>
            <div style={{ color: '#888', fontSize: '12px' }}>
              v{plugin.version} · {plugin.author}
            </div>
          </div>
          <span style={{
            padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
            background: plugin.status === 'enabled' ? '#1a3a1a' : plugin.status === 'error' ? '#3a1a1a' : '#333',
            color: plugin.status === 'enabled' ? '#4caf50' : plugin.status === 'error' ? '#f44336' : '#888',
          }}>
            {plugin.status}
          </span>
        </div>
        <p style={{ color: '#bbb', fontSize: '13px', margin: '8px 0 0 0' }}>{plugin.description}</p>
        <div style={{ color: '#666', fontSize: '11px', marginTop: '8px' }}>
          安装时间: {new Date(plugin.installedAt).toLocaleString()}
          {plugin.enabledAt && ` · 最后启用: ${new Date(plugin.enabledAt).toLocaleString()}`}
        </div>
        {plugin.error && (
          <div style={{ color: '#f44336', fontSize: '12px', marginTop: '8px', padding: '6px 10px', background: '#2a1515', borderRadius: '4px' }}>
            {plugin.error}
          </div>
        )}
      </div>

      {/* 权限 */}
      <div style={{
        background: '#1e1e2e', borderRadius: '8px', padding: '12px', marginBottom: '12px',
        border: '1px solid #333',
      }}>
        <h4 style={{ margin: '0 0 8px 0', color: '#ccc', fontSize: '13px' }}>请求的权限</h4>
        {plugin.permissions.length === 0 ? (
          <span style={{ color: '#666', fontSize: '12px' }}>无需额外权限</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {plugin.permissions.map(perm => (
              <span key={perm} style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                background: '#2a2a3e', color: '#aaa', border: '1px solid #444',
              }}>
                {PERMISSION_LABELS[perm] || perm}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 能力 */}
      <div style={{
        background: '#1e1e2e', borderRadius: '8px', padding: '12px', marginBottom: '12px',
        border: '1px solid #333',
      }}>
        <h4 style={{ margin: '0 0 8px 0', color: '#ccc', fontSize: '13px' }}>提供的能力</h4>
        {plugin.provides.length === 0 ? (
          <span style={{ color: '#666', fontSize: '12px' }}>未提供能力</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {plugin.provides.map((cap, i) => (
              <div key={i} style={{ color: '#aaa', fontSize: '12px' }}>
                <span style={{
                  display: 'inline-block', padding: '0 6px', marginRight: '6px',
                  background: '#2a2a3e', borderRadius: '3px', color: '#8b8bff', fontSize: '10px',
                }}>
                  {CAPABILITY_LABELS[cap.type] || cap.type}
                </span>
                <span style={{ color: '#ccc' }}>{cap.id}</span>
                <span style={{ color: '#666', marginLeft: '6px' }}>{cap.description}</span>
              </div>
            ))}
          </div>
        )}
        {plugin.consumes.length > 0 && (
          <>
            <h4 style={{ margin: '10px 0 6px 0', color: '#cc8', fontSize: '13px' }}>依赖的能力</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {plugin.consumes.map((dep, i) => (
                <div key={i} style={{ color: '#aaa', fontSize: '12px' }}>
                  <span style={{
                    display: 'inline-block', padding: '0 6px', marginRight: '6px',
                    background: '#3a3a2e', borderRadius: '3px', color: '#aa8', fontSize: '10px',
                  }}>
                    {CAPABILITY_LABELS[dep.type] || dep.type}
                  </span>
                  <span style={{ color: '#cc8' }}>{dep.id}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 版本历史与回滚 */}
      <div style={{
        background: '#1e1e2e', borderRadius: '8px', padding: '12px',
        border: '1px solid #333',
      }}>
        <h4 style={{ margin: '0 0 8px 0', color: '#ccc', fontSize: '13px' }}>版本历史</h4>
        {versions.length === 0 ? (
          <span style={{ color: '#666', fontSize: '12px' }}>无历史版本</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {versions.map((v, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', background: '#16162a', borderRadius: '4px',
              }}>
                <div>
                  <span style={{ color: '#ccc', fontSize: '12px', fontWeight: 600 }}>v{v.version}</span>
                  <span style={{ color: '#666', fontSize: '11px', marginLeft: '8px' }}>
                    {new Date(v.installedAt).toLocaleString()}
                  </span>
                </div>
                {v.version !== plugin.version && (
                  <button onClick={() => handleRollback(v.version)} style={{
                    background: '#333', color: '#ff9800', border: '1px solid #555',
                    borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '11px',
                  }}>回滚到此版本</button>
                )}
              </div>
            ))}
          </div>
        )}
        {rollbackMsg && (
          <div style={{
            marginTop: '8px', padding: '6px 10px', borderRadius: '4px', fontSize: '12px',
            background: rollbackMsg.includes('失败') ? '#3a1e1e' : '#1e3a1e',
            color: rollbackMsg.includes('失败') ? '#f44336' : '#4caf50',
          }}>
            {rollbackMsg}
          </div>
        )}
      </div>
    </div>
  )
}
