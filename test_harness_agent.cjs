// 驾驭智能体 Agent Loop 命令行测试
// 用法: node test_harness_agent.cjs

const { AgentLoop } = require('./electron/harnessAgent/agentLoop')
const { PermissionManager } = require('./electron/harnessAgent/permissionManager')
const { registerAllTools } = require('./electron/harnessAgent/tools')

const API_KEY = 'sk-a487d89358b7416b9099c8d773b10af4'
const MODEL = 'deepseek-v4-pro'

// 模拟项目（用实际存在的路径）
const PROJECTS = [
  'H:\\DeepBlueGodHarnessFarm',
  'J:\\gameGitRes\\kimiHorse',
]

async function testAgent(command) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🧪 测试指令: "${command}"`)
  console.log('='.repeat(60))

  const pm = new PermissionManager()
  pm.updatePermissions({
    autoTrustConfirm: true,
    autoApproveReads: true,
    confirmBeforeWrites: false,
    blockDestructive: true,
    autoWakeDead: false,
  })

  registerAllTools()

  const ctx = {
    projectIds: PROJECTS.map(p => p),
    projectNames: new Map(PROJECTS.map(p => [p, p.split('\\').pop()])),
    onlineProjects: new Set(),
    apiKey: API_KEY,
    model: MODEL,
  }

  const agent = new AgentLoop(ctx, pm)

  const startTime = Date.now()
  let textChunks = 0
  let toolCalls = 0

  try {
    const final = await agent.run(command, (event) => {
      switch (event.type) {
        case 'thinking_start':
          process.stdout.write('🧠 ')
          break
        case 'text_delta':
          if (textChunks === 0) process.stdout.write('💬 ')
          process.stdout.write(event.content)
          textChunks++
          break
        case 'tool_call':
          console.log(`\n🔧 调用工具: ${event.name}`)
          toolCalls++
          break
        case 'tool_result':
          console.log(`✅ ${event.name} 完成: ${event.result.output.slice(0, 100)}`)
          break
        case 'tool_error':
          console.log(`❌ ${event.name} 失败: ${event.error}`)
          break
        case 'permission_needed':
          console.log(`🔐 权限请求: ${event.name} — ${event.reason}`)
          agent.resolvePermission('allow_once')
          break
        case 'done':
          console.log(`\n🏁 Agent 完成 (${Date.now() - startTime}ms, ${toolCalls} 个工具调用)`)
          if (event.finalMessage) console.log(`📝 最终回复: ${event.finalMessage.slice(0, 300)}`)
          break
        case 'error':
          console.log(`\n⚠️ 错误: ${event.message}`)
          break
      }
    })
    return final
  } catch (err) {
    console.error(`💥 异常: ${err.message}`)
    return ''
  }
}

async function main() {
  console.log('🤖 驾驭智能体 Agent Loop 测试套件')
  console.log(`API: ${MODEL} | 项目数: ${PROJECTS.length}`)

  // 测试1: 纯对话（不应调用工具）
  await testAgent('你好，请介绍一下你自己的能力')

  // 测试2: 检查状态（应调用 check_status）
  await testAgent('检查一下所有项目当前的状态')

  // 测试3: 读取文件（应调用 read_file）
  await testAgent('读取 H:\\DeepBlueGodHarnessFarm\\package.json 的前 20 行')

  console.log(`\n${'='.repeat(60)}`)
  console.log('✅ 测试完成')
}

main().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
