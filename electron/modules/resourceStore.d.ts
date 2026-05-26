export type RepoName = 'DeepBluePrompt' | 'DeepBlueCase' | 'DeepBlueKit';
export interface ResourceItem {
    id: string;
    name: string;
    type: string;
    category: string;
    subcategory?: string;
    tech_stack: string[];
    style_tags: string[];
    use_cases: string[];
    score: number;
    rating_count: number;
    usage_count: number;
    source_url: string;
    summary: string;
    summary_en?: string;
    file: string;
    repo: RepoName;
    rawYaml?: Record<string, any>;
    body?: string;
}
export interface QueryParams {
    query: string;
    repo?: RepoName | 'all';
    type?: string;
    category?: string;
    techStack?: string[];
    maxResults?: number;
    minScore?: number;
    useAiIndex?: boolean;
}
export interface ContributionParams {
    repo: RepoName;
    files: string[];
    message: string;
}
declare class ResourceStore {
    private initialized;
    private manifests;
    private aiManifests;
    private aiIndexes;
    private resourceDir;
    constructor();
    /** 检查资源目录是否存在且已初始化 */
    isInitialized(): boolean;
    /** 自动同步所有已克隆仓库到最新，然后重载 manifest */
    autoSyncAll(): Promise<{
        synced: RepoName[];
        message: string;
    }>;
    /** 确保 manifest 已加载到内存（即使 isInitialized 为 true 但内存可能为空） */
    ensureManifestsLoaded(): Promise<void>;
    /** 加载所有仓库的 manifest 索引到内存 */
    loadManifests(): Promise<boolean>;
    /** 获取本地资源目录路径 */
    getResourceDir(): string;
    /** 核心检索接口：按查询参数搜索资源 */
    queryResources(params: QueryParams): ResourceItem[];
    /** 计算关键词匹配度 */
    private calcRelevance;
    /** 按筛选条件过滤 */
    filterResources(filters: {
        repo?: RepoName;
        type?: string;
        category?: string;
        techStack?: string[];
        minScore?: number;
    }): ResourceItem[];
    /** 获取单个资源详情（含正文） */
    getResourceDetail(id: string): Promise<ResourceItem | null>;
    /** 获取全部资源摘要列表 */
    getAllResources(repo?: RepoName): ResourceItem[];
    /** 用户添加资源：接收标准化后的资源对象，写入本地仓库 */
    addResource(resource: Omit<ResourceItem, 'file'> & {
        content: string;
    }, repo: RepoName): Promise<{
        success: boolean;
        path?: string;
    }>;
    /** 执行 git 命令的辅助方法 */
    private git;
    private gitSilent;
    /** 检查仓库是否是 git 仓库 */
    isGitRepo(repo: RepoName): Promise<boolean>;
    /** 获取仓库综合状态 */
    getRepoStatus(repo: RepoName): Promise<{
        exists: boolean;
        isGit: boolean;
        branch: string;
        remote: string;
        behind: number;
        ahead: number;
        changes: Array<{
            path: string;
            status: string;
        }>;
        lastCommit: {
            hash: string;
            message: string;
            date: string;
        } | null;
    }>;
    /** 同步拉取（仅 fast-forward，安全策略） */
    syncRepo(repo: RepoName): Promise<{
        success: boolean;
        message: string;
        pulled: number;
    }>;
    /** 检查是否有远程更新 */
    checkForUpdates(repo: RepoName): Promise<{
        success: boolean;
        hasUpdates: boolean;
        behind: number;
        message: string;
    }>;
    /** 获取本地变更文件列表（git status） */
    getLocalChanges(repo: RepoName): Promise<Array<{
        path: string;
        status: string;
    }>>;
    /** 创建贡献分支 */
    createContributionBranch(repo: RepoName, branchName: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /** 提交变更 */
    commitChanges(repo: RepoName, message: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /** 推送分支 */
    pushBranch(repo: RepoName, branchName: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /** 检查 gh CLI 是否可用 */
    isGhAvailable(): Promise<boolean>;
    /** 检查 gh CLI 是否已登录 GitHub */
    isGitHubAuthenticated(): Promise<boolean>;
    /** 创建 Pull Request（使用 gh CLI） */
    createPullRequest(repo: RepoName, branchName: string, title: string, body: string): Promise<{
        success: boolean;
        message: string;
        url?: string;
    }>;
    /** 克隆仓库到本地 */
    cloneRepo(repo: RepoName, remoteUrl?: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /** 检查 git 是否可用 */
    isGitAvailable(): Promise<boolean>;
    /** 更新资源评分（仅更新本地内存和 manifest 文件） */
    rateResource(id: string, score: number): Promise<void>;
    /** 获取评分排行榜 */
    getLeaderboard(category?: string, limit?: number): ResourceItem[];
    private matchesFilters;
    private toResourceItem;
    private getTypeDir;
}
export declare const resourceStore: ResourceStore;
export {};
