import { useState } from 'react'

interface PluginPermissionPromptProps {
  manifest: {
    id: string
    name: string
    version: string
    description: string
    author: string
    permissions?: string[]
    provides?: Array<{ type: string; id: string; description: string }>
    consumes?: Array<{ type: string; id: string }>
  }
  onConfirm: () => void
  onCancel: () => void
}

const PERMISSION_LABELS: Record<string, string> = {
  'filesystem:read': '读取插件目录下的文件',
  'filesystem:write': '写入插件目录下的文件',
  'network': '发起 HTTP 网络请求',
  'dbht:execute': '执行 DBHT 版本控制命令',
  'ai:call': '调用 AI 接口（DeepSeek 等）',
  'window:overlay': '创建覆盖窗口',
  'clipboard': '读取/写入剪贴板',
  'notifications': '发送系统通知',
}

const PERMISSION_ICONS: Record<string, string> = {
  'filesystem:read': '\u{1F4C4}',
  'filesystem:write': '\u{1F4DD}',
  'network': '\u{1F310}',
  'dbht:execute': '\u{2699}\u{FE0F}',
  'ai:call': '\u{1F916}',
  'window:overlay': '\u{1FA9F}',
  'clipboard': '\u{1F4CB}',
  'notifications': '\u{1F514}',
}

export const PluginPermissionPrompt: React.FC<PluginPermissionPromptProps> = ({
  manifest, onConfirm, onCancel,
}) => {
  const [accepted, setAccepted] = useState(false)

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 1000,
    }}>
      <div style={{
        background: '#1e1e2e', borderRadius: '12px', padding: '24px', width: '460px',
        maxHeight: '80vh', overflow: 'auto', border: '1px solid #333',
      }}>
        <h2 style={{ margin: '0 0 4px 0', color: '#e0e0e0', fontSize: '18px' }}>安装插件</h2>
        <div style={{ color: '#888', fontSize: '12px', marginBottom: '16px' }}>
          {manifest.name} v{manifest.version} · {manifest.author}
        </div>

        <p style={{ color: '#bbb', fontSize: '13px', margin: '0 0 16px 0' }}>{manifest.description}</p>

        {/* 权限列表 */}
        <h3 style={{ margin: '0 0 10px 0', color: '#e0b040', fontSize: '14px' }}>
          {'⚠'} 此插件请求以下权限：
        </h3>
        <div style={{
          background: '#16162a', borderRadius: '8px', padding: '12px',
          marginBottom: '16px',
        }}>
          {(manifest.permissions || []).length === 0 ? (
            <div style={{ color: '#4caf50', fontSize: '12px' }}>此插件无需额外权限</div>
          ) : (
            (manifest.permissions || []).map(perm => (
              <div key={perm} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '6px 0', borderBottom: '1px solid #2a2a3e',
              }}>
                <span style={{ fontSize: '18px' }}>{PERMISSION_ICONS[perm] || '\u{2753}'}</span>
                <div>
                  <div style={{ color: '#ccc', fontSize: '13px' }}>{perm}</div>
                  <div style={{ color: '#888', fontSize: '11px' }}>{PERMISSION_LABELS[perm] || '未知权限'}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 能力 */}
        {(manifest.provides || []).length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <h3 style={{ margin: '0 0 6px 0', color: '#8b8bff', fontSize: '13px' }}>提供的能力</h3>
            {(manifest.provides || []).map((cap, i) => (
              <div key={i} style={{ color: '#aaa', fontSize: '12px', padding: '2px 0' }}>
                {cap.type}: {cap.id} — {cap.description}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            color: '#ccc', fontSize: '13px', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
              style={{ accentColor: '#7c3aed' }}
            />
            我信任此插件，允许上述权限
          </label>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            background: '#333', color: '#ccc', border: '1px solid #555',
            borderRadius: '6px', padding: '8px 20px', cursor: 'pointer', fontSize: '13px',
          }}>取消</button>
          <button onClick={onConfirm} disabled={!accepted} style={{
            background: accepted ? '#7c3aed' : '#444', color: '#fff', border: 'none',
            borderRadius: '6px', padding: '8px 20px', cursor: accepted ? 'pointer' : 'default',
            fontSize: '13px', fontWeight: 600,
          }}>确认安装</button>
        </div>
      </div>
    </div>
  )
}
