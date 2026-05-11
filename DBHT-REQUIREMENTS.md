# DeepBlueGodHarnessFarm — 需求与实现状态

> 本文档由 DBHT 自动生成，记录项目功能需求和 AI 工作流规范。

## 1. 项目概述

- **项目名称**: DeepBlueGodHarnessFarm
- **创建时间**: 2026-05-07

## 2. 功能需求

<!-- 在此列出项目功能需求 -->

## 3. 技术方案

<!-- 在此记录技术选型和架构决策 -->

## 4. 接口设计

<!-- 在此记录 API 接口设计 -->

## 5. 数据模型

<!-- 在此记录数据结构设计 -->

## 6. 测试计划

<!-- 在此记录测试策略和用例 -->

## 7. 发布计划

<!-- 在此记录版本发布计划 -->

## 8. AI 工作流规范

### 8.1 主动提交规则

AI 智能体在开发过程中必须遵循以下规则：

1. **每完成一个功能/修复后立即提交** — 不要积累大量变更
2. **使用语义化提交信息** — 格式：`<类型>: <描述>`
   - `feat: 新增用户登录页面`
   - `fix: 修复文件上传失败问题`
   - `refactor: 重构数据库连接模块`
   - `docs: 更新 API 文档`
   - `style: 统一代码格式`
   - `test: 新增订单模块单元测试`
3. **提交前检查** — `dbgvs status` 确认变更范围，避免误提交
4. **完成开发后主动提交并推送到远程** — `dbgvs commit` + `dbgvs git-push`
5. **回滚误操作** — 使用 `dbgvs rollback` 恢复到上一个版本

### 8.2 AI 权限配置

首次进入项目时，AI 应检查 `.claude/settings.json` 是否包含以下权限：

```json
{
  "permissions": {
    "allow": [
      "Bash(dbgvs *)",
      "Bash(npm *)",
      "Bash(git *)",
      "Bash(node *)",
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write"
    ]
  }
}
```

若未配置，主动告知用户授权，用户不同意则正常继续。

### 8.3 DBHT 功能实现状态

| 功能模块 | 命令 | 状态 |
|---------|------|------|
| 创建仓库 | create-repository | ✅ 已实现 |
| 初始化项目 | init-repository | ✅ 已实现 |
| 创建项目 | create-project | ✅ 已实现 |
| 导入项目 | import-project | ✅ 已实现 |
| 查看状态 | status | ✅ 已实现 |
| 提交变更 | commit | ✅ 已实现 |
| 更新 | update | ✅ 已实现 |
| 回滚 | rollback | ✅ 已实现 |
| 文件级回滚 | rollback-file | ✅ 已实现 |
| 撤销回滚 | undo-rollback | ✅ 已实现 |
| AI 会话回滚 | rollback-ai | ✅ 已实现 |
| 查看历史 | history / log | ✅ 已实现 |
| 查看差异 | diff | ✅ 已实现 |
| 文件树 | file-tree | ✅ 已实现 |
| Git 远程同步 | git-connect/pull/push | ✅ 已实现 |
| 自动快照 | auto-snapshot | ✅ 已实现 |
| CLI 独立运行 | cli-standalone | ✅ 已实现 |
| 局域网同步 | lan-server | ✅ 已实现 |
| Windows 右键菜单 | context-menu | ✅ 已实现 |
| 验证仓库 | verify | ✅ 已实现 |
