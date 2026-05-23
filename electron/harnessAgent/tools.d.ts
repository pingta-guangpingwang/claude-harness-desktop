export declare function getActiveProjectTasks(): ReadonlyMap<string, {
    task: string;
    startedAt: number;
    lastCheckAt: number;
}>;
export declare function isProjectBusy(projectPath: string): boolean;
export declare function registerAllTools(): void;
