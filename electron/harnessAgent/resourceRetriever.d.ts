import type { ContextProcessor } from './contextPipeline.js';
import { type ResourceItem } from '../modules/resourceStore.js';
import type { AgentTool } from './types.js';
export declare const ResourceInjectorProcessor: ContextProcessor;
/** 格式化检索结果给 LLM */
export declare function formatSearchResults(resources: ResourceItem[]): string;
/** 列出资源摘要 */
export declare function formatResourceList(resources: ResourceItem[]): string;
/** search_resources 工具 */
export declare const searchResourcesTool: AgentTool;
/** add_resource 工具 — 用户手动添加资源 */
export declare const addResourceTool: AgentTool;
/** list_resources 工具 */
export declare const listResourcesTool: AgentTool;
/** suggest_resource — AI 将发现的外部资源提交到待审核列表 */
export declare const suggestResourceTool: AgentTool;
/** read_pending_resources — AI 读取待审核列表 */
export declare const readPendingResourcesTool: AgentTool;
/** update_pending_item — AI 写入单条审核结果 */
export declare const updatePendingItemTool: AgentTool;
