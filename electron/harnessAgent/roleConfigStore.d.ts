import type { RoleConfig } from './roleManager.js';
import { type RoleScore } from './roleScorer.js';
export interface RoleConfigData {
    roleSystemEnabled: boolean;
    enabledRoleIds: string[];
    customRoles: RoleConfig[];
    updatedAt: string;
}
declare class RoleConfigStore {
    private data;
    private savePath;
    constructor();
    get systemEnabled(): boolean;
    get enabledRoleIds(): string[];
    get customRoles(): RoleConfig[];
    isRoleEnabled(roleId: string): boolean;
    setSystemEnabled(v: boolean): void;
    setRoleEnabled(roleId: string, v: boolean): void;
    addCustomRole(role: RoleConfig): void;
    removeCustomRole(roleId: string): boolean;
    /** 获取所有角色（内置+自定义）带评分和启用状态 */
    getRolesWithScores(): Array<{
        role: RoleConfig;
        score: RoleScore | null;
        isCustom: boolean;
        enabled: boolean;
    }>;
    /** 获取排行榜 */
    getLeaderboard(topK?: number): RoleScore[];
    /** 生成评分报告 */
    generateScoreReport(): string;
    getConfig(): RoleConfigData;
    private getSavePath;
    private load;
    /** 重置为默认配置（测试用） */
    reset(): void;
    private save;
}
export declare const roleConfigStore: RoleConfigStore;
export {};
