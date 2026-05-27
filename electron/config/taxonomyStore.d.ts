export interface FacetValue {
    code: string;
    label: string;
    parents: string[];
    aliases: string[];
    status?: string;
}
export interface FacetDef {
    prefix: string;
    label: string;
    labelEn: string;
    multi: boolean;
    description: string;
    allowCustom?: boolean;
    customFormat?: string;
    values: FacetValue[];
}
export interface TaxonomyData {
    version: string;
    updated: string;
    description: string;
    facets: Record<string, FacetDef>;
}
export interface ResourceFacets {
    occupation?: string[];
    skill?: string[];
    knowledge?: string[];
    transversal?: string[];
    format?: string;
    level?: string;
    [key: string]: any;
}
declare class TaxonomyStore {
    private data;
    private codeIndex;
    private aliasIndex;
    constructor();
    load(): void;
    private buildIndex;
    getVersion(): string;
    getFacets(): Record<string, FacetDef>;
    getFacet(name: string): FacetDef | undefined;
    getFacetNames(): string[];
    /** 编码 → 标签 */
    getLabel(code: string): string;
    /** 批量编码 → 标签 */
    getLabels(codes: string[]): string[];
    /** 别名 → 编码 */
    resolveAlias(alias: string): string | undefined;
    /** 获取某个维度的所有可选值 */
    getValues(facetName: string): FacetValue[];
    /** 将编码展开为可读文本（用于向量搜索/展示） */
    expand(facets: ResourceFacets): string;
    /** 获取某个维度下指定编码的子节点 */
    getChildren(facetName: string, parentCode: string): FacetValue[];
    /** 获取某个维度的根节点（无 parents 或 parents 为空） */
    getRoots(facetName: string): FacetValue[];
    /** 将 facets 编码转换为标签展示结构 */
    resolve(facets: ResourceFacets | null | undefined): Record<string, {
        label: string;
        values: Array<{
            code: string;
            label: string;
        }>;
    }>;
}
export declare const taxonomyStore: TaxonomyStore;
export {};
