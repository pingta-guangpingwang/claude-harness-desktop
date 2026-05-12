export type PluginCategory = 'formatter' | 'linter' | 'git' | 'container' | 'api' | 'editor' | 'database' | 'productivity' | 'theme' | 'ai';
export type PkgManager = 'npm' | 'pip' | 'pip3' | 'cargo' | 'go' | 'gem' | 'choco' | 'scoop' | 'winget' | 'brew';
export interface CatalogInstallSpec {
    manager: PkgManager;
    package: string;
    extraArgs?: string[];
    checkBinary?: string;
}
export interface CatalogProvides {
    type: 'command' | 'ai.tool';
    id: string;
    description: string;
    commandTemplate?: string;
    toolParams?: Record<string, unknown>;
}
export interface CatalogPlugin {
    id: string;
    name: string;
    icon: string;
    description: string;
    descriptionZh: string;
    author: string;
    version: string;
    category: PluginCategory;
    rating: number;
    downloads: number;
    tags: string[];
    install: CatalogInstallSpec;
    provides: CatalogProvides[];
}
export declare const PLUGIN_CATALOG: CatalogPlugin[];
/** 按名称/ID模糊搜索插件 */
export declare function searchCatalog(query: string): CatalogPlugin[];
/** 精确查找插件 */
export declare function findPlugin(idOrName: string): CatalogPlugin | undefined;
