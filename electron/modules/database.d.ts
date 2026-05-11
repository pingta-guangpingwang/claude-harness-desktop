export declare const db: {
    getConfig: () => Promise<any>;
    setConfig: (data: any) => Promise<void>;
    getRootPath: () => Promise<string>;
    setRootPath: (rootPath: string) => Promise<void>;
    getProjectIds: () => Promise<any>;
    setProjectIds: (data: any) => Promise<void>;
    getHubSettings: () => Promise<any>;
    setHubSettings: (data: any) => Promise<void>;
    DATA_DIR: string;
};
