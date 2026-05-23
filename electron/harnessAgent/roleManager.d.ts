import type { AgentTool } from './types.js';
import { RoleScorer, type RoleScore } from './roleScorer.js';
export interface RoleConfig {
    id: string;
    name: string;
    description: string;
    /** 角色专属的系统提示词（注入到 IdentityProcessor） */
    systemPrompt: string;
    /** 允许使用的工具名称列表（空=全部） */
    allowedTools: string[];
    /** 拒绝使用的工具名称列表 */
    deniedTools: string[];
    /** 角色触发关键词 — 用户消息中包含这些词时自动切换到此角色 */
    triggerKeywords: string[];
    /** 角色可以委派给哪些其他角色 */
    canDelegateTo: string[];
    /** 知识库标签 — 加载时匹配相关知识注入 */
    knowledgeTags: string[];
    /** 是否为默认角色 */
    isDefault: boolean;
    /** Agent Card（A2A 兼容） */
    agentCard: {
        capabilities: string[];
        skills: string[];
        maxConcurrentTasks: number;
        preferredTools: string[];
    };
}
export declare const BUILTIN_ROLES: RoleConfig[];
export declare class RoleManager {
    private roles;
    private currentRoleId;
    private roleHistory;
    private scorer;
    /** 自定义角色集合（和内置角色分开管理，内置角色不可删除） */
    private customRoleIds;
    constructor(scorer?: RoleScorer);
    /** 注册自定义角色 */
    registerRole(role: RoleConfig): void;
    /** 获取所有角色 */
    getAllRoles(): RoleConfig[];
    /** 获取当前角色 */
    getCurrentRole(): RoleConfig;
    /** 切换角色 */
    switchTo(roleId: string, reason?: string): {
        success: boolean;
        message: string;
    };
    /** 根据用户消息自动推断最佳角色（含评分加权） */
    inferRole(userMessage: string): {
        roleId: string;
        confidence: number;
        reason: string;
    };
    /** 手动创建自定义角色 */
    createCustomRole(config: {
        id: string;
        name: string;
        description: string;
        systemPrompt: string;
        allowedTools?: string[];
        deniedTools?: string[];
        triggerKeywords?: string[];
        canDelegateTo?: string[];
        knowledgeTags?: string[];
        capabilities?: string[];
        skills?: string[];
    }): {
        success: boolean;
        message: string;
        role?: RoleConfig;
    };
    /**
     * AI 建议创建新角色 — 驾驭智能体发现任务模式不匹配现有角色时调用
     * 返回建议的角色配置草稿，用户审核后可调用 createCustomRole 确认创建
     */
    suggestNewRole(observation: {
        taskPattern: string;
        suggestedName: string;
        suggestedId?: string;
        missingKeywords: string[];
        neededTools: string[];
        neededSkills: string[];
    }): {
        suggestion: Omit<Parameters<RoleManager['createCustomRole']>[0], 'systemPrompt'>;
        systemPromptTemplate: string;
    };
    /** 删除自定义角色（内置角色不可删除） */
    deleteRole(roleId: string): {
        success: boolean;
        message: string;
    };
    /** 获取所有角色及其评分 */
    getRolesWithScores(): Array<{
        role: RoleConfig;
        score: RoleScore | null;
        isCustom: boolean;
    }>;
    /** 获取评分器（供 AgentLoop 记录任务） */
    getScorer(): RoleScorer;
    /** 获取评分排行榜 */
    getLeaderboard(topK?: number): RoleScore[];
    /** 生成评分报告 */
    generateScoreReport(): string;
    /** 是否为自定义角色 */
    isCustomRole(roleId: string): boolean;
    /** 自动切换 — 如果推断置信度足够高则切换 */
    autoSwitch(userMessage: string, minConfidence?: number): {
        switched: boolean;
        roleId: string;
        reason: string;
    };
    /** 获取角色的工具过滤函数 */
    getToolFilter(roleId?: string): (tool: AgentTool) => boolean;
    /** 获取 Agent Card（A2A 兼容） */
    getAgentCard(roleId?: string): RoleConfig['agentCard'] | null;
    /** 导出角色切换历史 */
    getRoleHistory(): typeof this.roleHistory;
    /** 重置到默认角色 */
    reset(): void;
}
