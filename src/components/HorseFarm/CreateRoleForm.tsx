// 角色管理 — 创建自定义角色表单
import React, { useState } from 'react'

interface CreateRoleFormProps {
  onCreated: () => void
  onCancel: () => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '13px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: '#374151',
  marginBottom: '4px',
}

const fieldStyle: React.CSSProperties = {
  marginBottom: '12px',
}

const CreateRoleForm: React.FC<CreateRoleFormProps> = ({ onCreated, onCancel }) => {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [allowedTools, setAllowedTools] = useState('')
  const [deniedTools, setDeniedTools] = useState('')
  const [triggerKeywords, setTriggerKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setError('')
    if (!id.trim() || !/^[a-z0-9_-]+$/i.test(id.trim())) {
      setError('ID 只能包含字母、数字、下划线和连字符')
      return
    }
    if (!name.trim()) {
      setError('角色名称不能为空')
      return
    }

    setLoading(true)
    try {
      const result = await window.electronAPI.harnessRolesCreate({
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        allowedTools: allowedTools.split(',').map(s => s.trim()).filter(Boolean),
        deniedTools: deniedTools.split(',').map(s => s.trim()).filter(Boolean),
        triggerKeywords: triggerKeywords.split(',').map(s => s.trim()).filter(Boolean),
      })

      if (result.success) {
        onCreated()
      } else {
        setError(result.message || '创建失败')
      }
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: '#f9fafb',
      border: '1px solid #e5e7eb',
      borderRadius: '10px',
      padding: '16px 20px',
      marginTop: '12px',
    }}>
      <h4 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>
        创建自定义角色
      </h4>

      {error && (
        <div style={{
          padding: '8px 12px',
          marginBottom: '12px',
          background: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          color: '#991b1b',
          fontSize: '12px',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div style={fieldStyle}>
          <label style={labelStyle}>角色 ID *</label>
          <input style={inputStyle} value={id} onChange={e => setId(e.target.value)}
            placeholder="my-custom-role" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>角色名称 *</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
            placeholder="我的角色" />
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>描述</label>
        <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)}
          placeholder="角色的职责描述" />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>系统提示词</label>
        <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
          value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
          placeholder="角色的专属系统提示词..." />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div style={fieldStyle}>
          <label style={labelStyle}>允许工具（逗号分隔，留空=全部）</label>
          <input style={inputStyle} value={allowedTools} onChange={e => setAllowedTools(e.target.value)}
            placeholder="task_project, read_file" />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>禁止工具（逗号分隔）</label>
          <input style={inputStyle} value={deniedTools} onChange={e => setDeniedTools(e.target.value)}
            placeholder="broadcast, stop_all" />
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>触发关键词（逗号分隔）</label>
        <input style={inputStyle} value={triggerKeywords} onChange={e => setTriggerKeywords(e.target.value)}
          placeholder="测试, 覆盖率, jest" />
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          padding: '8px 16px',
          fontSize: '12px',
          background: '#fff',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          cursor: 'pointer',
          color: '#374151',
        }}>
          取消
        </button>
        <button onClick={handleSubmit} disabled={loading} style={{
          padding: '8px 16px',
          fontSize: '12px',
          background: loading ? '#93c5fd' : '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: loading ? 'default' : 'pointer',
        }}>
          {loading ? '创建中...' : '创建角色'}
        </button>
      </div>
    </div>
  )
}

export default CreateRoleForm
