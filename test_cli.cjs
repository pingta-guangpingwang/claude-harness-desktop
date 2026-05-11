// CLI 命令驾驭系统测试
const { CommandRegistry } = require('./electron/cli/registry')
const { createBuiltinCommands } = require('./electron/cli/builtinCommands')
const { AliasResolver } = require('./electron/cli/aliasResolver')

async function main() {
  console.log('⚡ CLI 命令系统测试\n')

  // 1. 注册表
  const reg = new CommandRegistry()
  for (const cmd of createBuiltinCommands()) {
    reg.register(cmd)
  }
  console.log(`✅ 注册 ${reg.getAll().length} 个命令`)
  console.log(`   内置: ${reg.getAll().map(c => c.name).join(', ')}\n`)

  // 2. 搜索
  const gitCmds = reg.search('git')
  console.log(`✅ 搜索 "git": ${gitCmds.length} 个结果`)
  gitCmds.forEach(c => console.log(`   ${c.name} — ${c.summary}`))

  const all = reg.search('')
  console.log(`✅ 搜索 "": ${all.length} 个结果（全部）\n`)

  // 3. 解析
  const parsed = reg.parse('git-status')
  console.log(`✅ 解析 "git-status": ${parsed?.name}`)

  const parsed2 = reg.parse('gs')
  console.log(`✅ 解析别名 "gs": ${parsed2?.name}`)

  const parsed3 = reg.parse('git-log --n 5')
  console.log(`✅ 解析 "git-log --n 5": name=${parsed3?.name}, args=${JSON.stringify(parsed3?.rawArgs)}\n`)

  // 4. 别名
  const alias = new AliasResolver()
  alias.addAlias({ alias: 'ws', expandsTo: 'wake', description: '快捷唤醒' })
  console.log(`✅ 别名 "ws" → "${alias.resolve('ws')}"`)
  console.log(`✅ 别名 "ws --project foo" → "${alias.resolve('ws --project foo')}"\n`)

  // 5. 执行内置命令（不需要真实环境的）
  const ctx = {
    projectIds: ['H:\\DeepBlueGodHarnessFarm'],
    projectNames: new Map([['H:\\DeepBlueGodHarnessFarm', 'DBGHF']]),
    apiKey: 'test',
    model: 'deepseek-chat',
  }

  const r1 = await reg.execute('status', {}, ctx)
  console.log(`✅ status: ${r1.success ? '成功' : '失败'} — ${r1.output.slice(0, 80)}`)

  const r2 = await reg.execute('ai-chat', { message: '你好' }, ctx)
  console.log(`✅ ai-chat: ${r2.success ? '成功' : '失败'} — ${r2.output.slice(0, 80)}`)

  // 6. 历史
  const hist = reg.history.getHistory(5)
  console.log(`\n✅ 历史: ${hist.length} 条记录`)
  hist.forEach(h => console.log(`   ${h.success ? '✅' : '❌'} ${h.command} (${h.durationMs}ms)`))

  console.log('\n🏁 CLI 系统测试完成')
}

main().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
