export interface SkillCard {
    id: string;
    sourceFile: string;
    projectPath: string;
    title: string;
    category: 'coding' | 'devops' | 'review' | 'domain' | 'docs';
    summary: string;
    knowledgeSnippet: string;
    applicableRoles: string[];
    tags: string[];
    lastUpdated: string;
}
export declare class DocToSkillLoader {
    private cache;
    /**
     * 扫描项目目录下的知识库文件
     * 每个匹配文件 → 低成本提取 → SkillCard → 缓存
     */
    scanProject(projectPath: string): Promise<SkillCard[]>;
    /** 按角色标签匹配技能卡片 */
    getSkillsForRole(roleId: string, projectPath?: string): SkillCard[];
    /** 获取所有技能卡片 */
    getAllCards(): SkillCard[];
    /** 格式化技能卡片为 LLM 可注入的文本 */
    formatCardsForInjection(cards: SkillCard[], maxTokens?: number): string;
    /** 清除缓存 */
    clearCache(): void;
    private extractFromFile;
    private inferCategory;
    private inferRoles;
    private extractTags;
    private checkFreshness;
    private matchGlob;
    private hashPath;
}
