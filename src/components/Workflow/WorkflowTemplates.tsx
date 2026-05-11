import { useState } from 'react'
import type { WorkflowDefinition } from '../../types/workflow'
import { DEFAULT_RETRY_POLICY } from '../../types/workflow'
import './Workflow.css'

interface WFTemplate {
  id: string
  name: string
  description: string
  category: string
  icon: string
  build: () => WorkflowDefinition
}

const TEMPLATES: WFTemplate[] = [
  {
    id: 'git-auto-commit',
    name: 'Git Auto Commit',
    description: 'Auto stage, commit, and push changes on schedule. Ideal for backup workflows.',
    category: 'Version Control',
    icon: 'git',
    build: () => ({
      id: 'tpl_' + Date.now().toString(36),
      name: 'Git Auto Commit',
      description: 'Auto git commit + push on schedule',
      nodes: [
        { id: 'start', type: 'control.start', label: 'Start', config: {} },
        { id: 'git_status', type: 'cli.command', label: 'Git Status', config: { command: 'git', args: { status: true } } },
        { id: 'git_add', type: 'cli.command', label: 'Git Add', config: { command: 'git', args: { add: '-A' } } },
        { id: 'git_commit', type: 'cli.command', label: 'Git Commit', config: { command: 'git', args: { commit: '-m', m: 'auto: scheduled backup' } } },
        { id: 'git_push', type: 'cli.command', label: 'Git Push', config: { command: 'git', args: { push: true } } },
        { id: 'end', type: 'control.end', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'git_status' },
        { id: 'e2', source: 'git_status', target: 'git_add' },
        { id: 'e3', source: 'git_add', target: 'git_commit' },
        { id: 'e4', source: 'git_commit', target: 'git_push' },
        { id: 'e5', source: 'git_push', target: 'end' },
      ],
      schedule: { enabled: true, cron: '0 */6 * * *' },
      retryPolicy: { ...DEFAULT_RETRY_POLICY },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'ai-daily-report',
    name: 'AI Daily Report',
    description: 'Generate a daily project summary using AI and save it to a report file.',
    category: 'AI',
    icon: 'ai',
    build: () => ({
      id: 'tpl_' + Date.now().toString(36),
      name: 'AI Daily Report',
      description: 'Daily AI project report generation',
      nodes: [
        { id: 'start', type: 'control.start', label: 'Start', config: {} },
        { id: 'ai_summary', type: 'ai.call', label: 'Generate Summary', config: { aiPrompt: 'Analyze the project at {{projectPath}} and generate a daily summary report covering changes, issues, and next steps.', aiModel: 'deepseek-chat' } },
        { id: 'save_report', type: 'file.write', label: 'Save Report', config: { filePath: '{{projectPath}}/reports/daily-{{date}}.md', fileContent: '{{ai_output}}' } },
        { id: 'notify', type: 'notification', label: 'Notify', config: { notificationMessage: 'Daily report generated' } },
        { id: 'end', type: 'control.end', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ai_summary' },
        { id: 'e2', source: 'ai_summary', target: 'save_report' },
        { id: 'e3', source: 'save_report', target: 'notify' },
        { id: 'e4', source: 'notify', target: 'end' },
      ],
      schedule: { enabled: true, cron: '0 18 * * 1-5' },
      retryPolicy: { ...DEFAULT_RETRY_POLICY },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'npm-build-deploy',
    name: 'NPM Build & Deploy',
    description: 'Install dependencies, run tests, build, and trigger deployment.',
    category: 'CI/CD',
    icon: 'deploy',
    build: () => ({
      id: 'tpl_' + Date.now().toString(36),
      name: 'NPM Build & Deploy',
      description: 'CI/CD pipeline: install → test → build → deploy',
      nodes: [
        { id: 'start', type: 'control.start', label: 'Start', config: {} },
        { id: 'npm_install', type: 'cli.command', label: 'npm install', config: { command: 'npm', args: { install: true } } },
        { id: 'npm_test', type: 'cli.command', label: 'npm test', config: { command: 'npm', args: { test: true } } },
        { id: 'check_tests', type: 'condition', label: 'Tests Pass?', config: { condition: 'lastResult === "success"' } },
        { id: 'npm_build', type: 'cli.command', label: 'npm build', config: { command: 'npm', args: { run: 'build' } } },
        { id: 'deploy', type: 'cli.command', label: 'Deploy', config: { command: 'npm', args: { run: 'deploy' } } },
        { id: 'notify_fail', type: 'notification', label: 'Notify Failure', config: { notificationMessage: 'Build pipeline failed!' } },
        { id: 'notify_ok', type: 'notification', label: 'Notify Success', config: { notificationMessage: 'Build & deploy completed!' } },
        { id: 'end', type: 'control.end', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'npm_install' },
        { id: 'e2', source: 'npm_install', target: 'npm_test' },
        { id: 'e3', source: 'npm_test', target: 'check_tests' },
        { id: 'e4', source: 'check_tests', target: 'npm_build', condition: 'true' },
        { id: 'e5', source: 'check_tests', target: 'notify_fail', condition: 'false' },
        { id: 'e6', source: 'npm_build', target: 'deploy' },
        { id: 'e7', source: 'deploy', target: 'notify_ok' },
        { id: 'e8', source: 'notify_fail', target: 'end' },
        { id: 'e9', source: 'notify_ok', target: 'end' },
      ],
      retryPolicy: { maxRetries: 2, delayMs: 5000, backoffMultiplier: 2 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'file-watcher',
    name: 'File Change Watcher',
    description: 'Watch a directory for changes and trigger actions (e.g., auto-format, lint).',
    category: 'Automation',
    icon: 'watch',
    build: () => ({
      id: 'tpl_' + Date.now().toString(36),
      name: 'File Change Watcher',
      description: 'Auto-format + lint on file changes',
      nodes: [
        { id: 'start', type: 'control.start', label: 'Start', config: {} },
        { id: 'format', type: 'cli.command', label: 'Format', config: { command: 'npx', args: { prettier: true, write: '.' } } },
        { id: 'lint', type: 'cli.command', label: 'Lint', config: { command: 'npx', args: { eslint: true, '.': true, fix: true } } },
        { id: 'end', type: 'control.end', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'format' },
        { id: 'e2', source: 'format', target: 'lint' },
        { id: 'e3', source: 'lint', target: 'end' },
      ],
      triggers: [{ type: 'file_change' }],
      retryPolicy: { ...DEFAULT_RETRY_POLICY },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  },
]

export function WorkflowTemplates({ onApply }: { onApply: (wf: WorkflowDefinition) => void }) {
  const [filter, setFilter] = useState('')
  const [selectedTpl, setSelectedTpl] = useState<WFTemplate | null>(null)

  const filtered = TEMPLATES.filter(t =>
    !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.category.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div className="wf-templates-container">
      <div className="wf-templates-header">
        <h4>Workflow Templates</h4>
        <input
          className="wf-config-input"
          placeholder="Filter templates..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ width: 200 }}
        />
      </div>

      <div className="wf-templates-grid">
        {filtered.map(tpl => (
          <div
            key={tpl.id}
            className={`wf-template-card ${selectedTpl?.id === tpl.id ? 'selected' : ''}`}
            onClick={() => setSelectedTpl(tpl)}
          >
            <div className="wf-template-icon">{iconMap[tpl.icon] || '📋'}</div>
            <div className="wf-template-info">
              <div className="wf-template-name">{tpl.name}</div>
              <div className="wf-template-cat">{tpl.category}</div>
              <div className="wf-template-desc">{tpl.description}</div>
            </div>
          </div>
        ))}
      </div>

      {selectedTpl && (
        <div className="wf-template-detail">
          <h5>{selectedTpl.name}</h5>
          <p>{selectedTpl.description}</p>
          <div className="wf-template-nodes">
            {(selectedTpl.build().nodes || []).map(n => (
              <span key={n.id} className="wf-tpl-node-chip">{n.label}</span>
            ))}
          </div>
          <button className="wf-btn wf-btn-primary" onClick={() => { onApply(selectedTpl.build()); setSelectedTpl(null) }}>
            Apply Template
          </button>
        </div>
      )}
    </div>
  )
}

const iconMap: Record<string, string> = {
  git: '',
  ai: '',
  deploy: '',
  watch: '',
}
