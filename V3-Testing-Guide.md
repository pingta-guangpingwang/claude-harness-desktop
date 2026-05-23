# DBGHF V3.0 测试指南

> 最后更新: 2026-05-23
> 覆盖: 模块 A/B/D/E/F/G/H 全部功能

---

## 1. 快速开始 — 运行自动化测试

```bash
# 安装依赖（首次）
cd j:\AIProject\DeepBlue\DeepBlueGodHarnessFarm
npm install

# 运行全部测试
npm test

# 监听模式（开发时用）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

**预期结果**: 4 suites, 85 tests, 全部通过

---

## 2. TypeScript 编译验证

```bash
npx tsc --noEmit
```

**预期结果**: 零错误退出（EXIT: 0）

---

## 3. 按模块手动测试

### 3.1 模块 F — Token 预算 + 三层记忆（核心功能）

**测试方法**: 启动驾驭智能体，进行长对话（20轮以上），观察每 5 轮的 token 利用率报告。

**操作步骤**:
1. 启动应用 → 打开驾驭智能体面板
2. 连续发送多条指令（如："检查所有项目状态"、"唤醒项目A"、"让项目B修复一个bug"、"查看项目A的聊天记录"...）
3. 观察第 5、10、15、20 轮时的输出

**验证点**:
- [ ] 每 5 轮出现 `📊 当前使用 XXK/128K tokens (XX%)` 的利用率报告
- [ ] 20 轮对话后不再丢失早期上下文（能准确回忆第 5 轮的项目状态）
- [ ] 上下文利用率从旧版的 ~5% 提升到 50%+
- [ ] 无 OOM 或内存异常增长

**命令行快速验证（单元测试）**:
```bash
npx jest tests/tokenBudget.test.ts --verbose
npx jest tests/memoryStore.test.ts --verbose
```

---

### 3.2 模块 E — LLM 后端解耦

**测试方法**: 切换不同的 LLM Provider，验证 Agent 正常工作。

**操作步骤**:
1. 打开设置 → API Keys 区域
2. 检查 Provider 选项（应显示 DeepSeek / Anthropic / OpenAI）
3. 当前默认 DeepSeek，用现有 API Key 测试一次对话
4. （可选）切换到 Anthropic，配置 Claude API Key，测试一次对话

**验证点**:
- [ ] Provider 选项可正常显示和切换
- [ ] DeepSeek 模式下 Agent 正常工作（现有功能不受影响）
- [ ] 切换 Provider 后 Agent 使用正确的 endpoint 和 header 格式
- [ ] API 错误时有友好的错误提示

**代码验证**:
```bash
# 检查 endpoint 不再硬编码
grep -n "api.deepseek.com" electron/harnessAgent/agentLoop.ts
# 应该只在 provider 相关文件中出现，不在 agentLoop.ts 中硬编码
```

---

### 3.3 模块 A — 上下文 Pipeline

**测试方法**: 对比新旧提示词质量，验证 Pipeline 正确组装。

**操作步骤**:
1. 在驾驭智能体中发送："帮我检查所有项目状态"
2. 观察 Agent 的回复和行为
3. 对比旧版行为：应该更加聚焦、更少冗余询问
4. 发送："只检查项目 X" → 验证范围纪律

**验证点**:
- [ ] Agent 能正确理解"只检查 X"的范围限制
- [ ] 策略思考框架（OBSERVE-DIAGNOSE-DECIDE-VERIFY）被正确注入
- [ ] 心跳纪律正常工作（有活跃任务时不停止）
- [ ] 知识库搜索结果被注入到提示词（离线项目时触发 API 配置知识）

**代码验证**:
```bash
# 观察 Pipeline 输出（开发时可加 console.log 到 buildContext 函数）
node -e "
const { buildContext } = require('./electron/harnessAgent/contextPipeline.js');
// 手动测试 Pipeline 输出
"
```

---

### 3.4 模块 G — 语义记忆

**测试方法**: 记录一些修复经验，验证语义搜索能找到相关内容。

**操作步骤**:
1. 先让智能体诊断并修复一个配置问题（如故意配错 API Key）
2. 修复成功后，修复经验自动记录到冷记忆
3. 下次遇到类似问题时，语义记忆应自动匹配
4. 在对话中提到"API 配置问题"，观察是否自动搜索相关知识

**验证点**:
- [ ] 诊断并修复项目 API 配置后，修复记录被保存
- [ ] 后续遇到类似错误时，语义搜索能找到之前的修复方案
- [ ] Embedding API 不可用时自动降级为 TF-IDF 关键词搜索
- [ ] 降级后有警告日志但不影响主流程

**命令行验证**:
```bash
# 测试 TF-IDF 降级搜索（不需要 API Key）
node -e "
const { ColdMemory } = require('./electron/harnessAgent/memoryStore.js');
const cold = new ColdMemory();
cold.add({
  content: 'API Key 配置错误解决方案：检查 ANTHROPIC_API_KEY 环境变量',
  metadata: { type: 'error_fix', tags: ['api', 'config'], timestamp: new Date().toISOString(), importance: 0.8 }
});
const results = cold.searchByKeywords('API 配置问题');
console.log('搜索结果:', results.length, '条');
console.log(results[0]?.content);
"
```

---

### 3.5 模块 H — 决策追踪 + 动态确认

**测试方法**: 开启 HITL 后观察危险操作是否触发确认。

**操作步骤**:
1. 在设置中开启 enableHITL（需在 permissions 中添加 `"enableHITL": true`）
2. 向 Agent 发送一个会触发危险操作的任务（如"删除项目 X 的配置文件"）
3. 观察 Agent 是否在执行 write_file/shell_exec 前暂停并请求确认
4. 尝试"批准"和"拒绝"两种操作

**验证点**:
- [ ] 危险工具（shell_exec, write_file, stop_projects）执行前触发确认
- [ ] 用户批准后正常执行，拒绝后跳过
- [ ] 同一工具连续失败 3 次后自动暂停请求人工决策
- [ ] 120 秒超时自动拒绝
- [ ] 关闭 HITL 后恢复原有行为（向后兼容）

**代码验证**:
```bash
npx jest tests/decisionTracer.test.ts --verbose
```

---

### 3.6 模块 B — 角色扮演多智能体

**测试方法**: 开启角色系统后发送不同类型的任务，观察自动角色切换。

**操作步骤**:
1. 在设置中开启 enableRoleSystem
2. 发送："帮我开发一个新功能" → 应自动切换到 Worker 角色
3. 发送："帮我审查代码质量" → 应自动切换到 Reviewer 角色
4. 发送："诊断一下为什么项目启动失败" → 应自动切换到 Diagnostician 角色
5. 发送："检查所有项目状态" → 应保持在 CEO 角色

**验证点**:
- [ ] 角色自动切换时有 `🎭 角色切换:` 提示
- [ ] Worker 角色不能使用 broadcast / stop_all / health_report
- [ ] Reviewer 角色不能使用 write_file / shell_exec / stop_projects
- [ ] Diagnostician 角色优先使用 diagnose_project / search_knowledge
- [ ] 关闭角色系统后恢复原有 CEO 行为

**代码验证**:
```bash
npx jest tests/roleManager.test.ts --verbose
```

---

## 4. 回归测试 — 现有功能不受影响

### 4.1 核心工具功能

| 测试项 | 操作 | 预期 |
|--------|------|------|
| wake_projects | 发送"唤醒项目X" | 项目启动，快速 ping 验证 |
| read_project_chat | 发送"查看项目X的聊天" | 返回 📊 状态 + 📡 终端输出 |
| task_project | 发送"让项目X执行npm install" | 任务分派，busy 保护生效 |
| broadcast | 发送"广播: 所有项目运行测试" | busy 的项目跳过，空闲的执行 |
| check_status | 发送"检查状态" | 返回全部项目连接状态 |
| diagnose_project | 发送"诊断项目X" | 自动分诊，返回恢复步骤 |
| search_knowledge | Agent 自动调用 | API 配置配方正确返回 |
| poll_projects | Agent 自动调用 | 最多 3 轮，第 3 轮强制验收 |

### 4.2 IPC 接口

| 测试项 | 验证 |
|--------|------|
| harness:run | 发送消息后 Agent 正常启动循环 |
| harness:abort | 中止按钮正常中断 Agent |
| harness:permission | 权限确认弹窗正常工作 |
| harness:queue | 中途插话消息正确合并 |

---

## 5. 性能验证

| 指标 | 测试方法 | 目标 |
|------|---------|------|
| 首次响应延迟 | 发送简单查询，计时 | < 3 秒 |
| Token 预算计算 | 观察 smartCompress 日志 | < 10ms |
| 40 轮内存增长 | 任务管理器监控 | < 100MB |
| TS 编译 | `npx tsc --noEmit` | 零错误 |
| 单元测试 | `npm test` | 85/85 通过 |

---

## 6. 故障排查

| 问题 | 排查步骤 |
|------|---------|
| Agent 不响应 | 1. 检查 API Key 是否有效 2. 检查 settings.json 配置 3. 查看终端日志 |
| Token 利用率不显示 | 确保已进行 5 轮以上对话，API 返回 usage 数据 |
| 角色不切换 | 确认 enableRoleSystem 已开启，消息中包含明确的触发关键词 |
| HITL 不触发确认 | 确认 enableHITL 已开启，检查操作是否为危险工具 |
| 语义搜索无结果 | 冷记忆可能为空，先执行一次诊断修复操作 |
| 测试失败 | `npm install` 后重试，确保 jest/ts-jest 已安装 |

---

## 7. 一键全量验证脚本

```bash
#!/bin/bash
cd "j:\AIProject\DeepBlue\DeepBlueGodHarnessFarm"

echo "=== 1. TypeScript 编译 ==="
npx tsc --noEmit && echo "✅ 编译通过" || echo "❌ 编译失败"

echo "=== 2. 单元测试 ==="
npx jest --verbose && echo "✅ 测试通过" || echo "❌ 测试失败"

echo "=== 3. 检查新增文件 ==="
ls -la electron/harnessAgent/memoryStore.ts \
       electron/harnessAgent/tokenBudget.ts \
       electron/harnessAgent/llmProviders.ts \
       electron/harnessAgent/contextPipeline.ts \
       electron/harnessAgent/semanticMemory.ts \
       electron/harnessAgent/decisionTracer.ts \
       electron/harnessAgent/hitlManager.ts \
       electron/harnessAgent/roleManager.ts \
       electron/harnessAgent/docToSkill.ts \
       && echo "✅ 所有新文件存在" || echo "❌ 文件缺失"

echo "=== 4. 确认旧功能文件未被修改 ==="
git diff --name-only HEAD~6..HEAD | grep -E "tools\.(ts|js)$|permissionManager|scheduler|taskQueue|ptyManager" \
  && echo "⚠️ 核心工具文件有改动" || echo "✅ 核心工具文件未改动"

echo "=== 验证完成 ==="
```
