export interface UserContribution {
    id: string;
    name: string;
    repo: string;
    type: string;
    addedAt: string;
    committed: boolean;
    committedAt?: string;
    pushed: boolean;
    pushedAt?: string;
}
declare class UserContributionStore {
    private data;
    private savePath;
    constructor();
    get contributions(): UserContribution[];
    /** 记录一条新的用户贡献 */
    record(params: {
        id: string;
        name: string;
        repo: string;
        type: string;
    }): void;
    /** 标记为已提交 */
    markCommitted(ids: string[]): void;
    /** 标记为已推送 */
    markPushed(ids: string[]): void;
    /** 获取某资源的贡献状态 */
    getStatus(id: string): UserContribution | undefined;
    /** 获取有未提交变更的贡献 ID 集合 */
    getUncommittedIds(): Set<string>;
    /** 所有贡献 ID 集合 */
    getAllIds(): Set<string>;
    private getSavePath;
    private load;
    private save;
}
export declare const userContributionStore: UserContributionStore;
export {};
