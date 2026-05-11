interface TemplateDefinition {
    id: string;
    name: string;
    category: string;
    files: Array<{
        path: string;
        content: string;
    }>;
    variables?: string[];
}
export declare class TemplateEngine {
    /** 获取所有模板摘要（不包含文件内容） */
    getTemplateList(): Array<{
        id: string;
        name: string;
        category: string;
        variables?: string[];
    }>;
    /** 获取模板详情 */
    getTemplate(id: string): TemplateDefinition | null;
    /** 应用模板到目标目录 */
    applyTemplate(templateId: string, targetDir: string, variables?: Record<string, string>): {
        success: boolean;
        files: string[];
        error?: string;
    };
}
export {};
