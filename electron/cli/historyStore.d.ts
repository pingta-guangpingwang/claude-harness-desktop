import type { CommandHistoryEntry, CommandBookmark, CommandGroup } from './types';
export declare class HistoryStore {
    private history;
    private bookmarks;
    private groups;
    private maxHistory;
    constructor();
    private getPaths;
    private load;
    private saveHistory;
    private saveBookmarks;
    private saveGroups;
    addHistory(entry: Omit<CommandHistoryEntry, 'id'>): void;
    getHistory(limit?: number, commandFilter?: string): CommandHistoryEntry[];
    clearHistory(): void;
    addBookmark(bm: Omit<CommandBookmark, 'id' | 'createdAt' | 'usageCount'>): CommandBookmark;
    useBookmark(id: string): CommandBookmark | undefined;
    removeBookmark(id: string): boolean;
    getBookmarks(): CommandBookmark[];
    addGroup(name: string): CommandGroup;
    addToGroup(groupId: string, bookmarkId: string): void;
    removeFromGroup(groupId: string, bookmarkId: string): void;
    deleteGroup(groupId: string): boolean;
    getGroups(): CommandGroup[];
}
