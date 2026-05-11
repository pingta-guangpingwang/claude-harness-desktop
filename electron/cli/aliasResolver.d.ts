import type { AliasEntry } from './types';
export declare class AliasResolver {
    private aliases;
    constructor();
    private getPath;
    load(): void;
    save(): void;
    addAlias(entry: AliasEntry): void;
    removeAlias(alias: string): boolean;
    getAll(): AliasEntry[];
    /** 解析输入字符串中的别名，返回展开后的字符串 */
    resolve(input: string): string;
}
