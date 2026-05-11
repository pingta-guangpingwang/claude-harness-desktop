import type { BrowserWindow } from 'electron';
import { WorkflowEngine } from './engine';
import { WorkflowScheduler } from './scheduler';
/**
 * 注册工作流 IPC 通道：
 *   workflow:register  — 注册/更新工作流定义并启动调度
 *   workflow:unregister — 移除工作流
 *   workflow:run       — 手动触发执行
 *   workflow:abort     — 中止运行
 *   workflow:list      — 列出所有已注册工作流
 *   workflow:get-state — 获取运行状态
 *   workflow:save      — 持久化工作流定义
 *   workflow:load      — 加载所有持久化定义
 *   workflow:delete    — 删除工作流定义
 */
export declare function registerWorkflowIpc(mainWindow: BrowserWindow): void;
export declare function getWorkflowEngine(): WorkflowEngine;
export declare function getWorkflowScheduler(): WorkflowScheduler;
