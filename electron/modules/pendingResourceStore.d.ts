export interface PendingResourceItem {
    id: string;
    name: string;
    resourceType: string;
    targetRepo: string;
    category: string;
    techStack: string[];
    sourceUrl: string;
    summary: string;
    rawContent: string;
    status: 'pending' | 'audited' | 'approved' | 'rejected';
    auditScore: number;
    auditNotes: string;
    formattedContent: string;
    auditedAt: string;
    createdAt: string;
}
interface PendingResourcesData {
    items: PendingResourceItem[];
    updatedAt: string;
}
declare class PendingResourceStore {
    private data;
    private savePath;
    constructor();
    get items(): PendingResourceItem[];
    getPendingCount(): number;
    getAuditedCount(): number;
    getItem(id: string): PendingResourceItem | undefined;
    getItemsByStatus(status: string): PendingResourceItem[];
    addItem(item: PendingResourceItem): void;
    removeItem(id: string): boolean;
    updateItem(id: string, updates: Partial<PendingResourceItem>): boolean;
    getConfig(): PendingResourcesData;
    private getSavePath;
    private load;
    private save;
}
export declare const pendingResourceStore: PendingResourceStore;
export {};
