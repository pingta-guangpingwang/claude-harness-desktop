interface RenderedComponent {
    pluginId: string;
    slotId: string;
    html: string;
    css: string;
    script: string;
}
export declare class RendererBridge {
    private slots;
    /** 注册插件渲染组件到指定槽位 */
    registerSlot(pluginId: string, slotId: string, componentId: string, props?: Record<string, unknown>): void;
    /** 注销插件的所有渲染槽位 */
    unregisterPlugin(pluginId: string): void;
    /** 获取指定槽位的所有渲染组件 */
    getSlotComponents(slotId: string): RenderedComponent[];
    /** 获取所有已注册槽位的 ID */
    getSlots(): string[];
    /** 加载插件的渲染组件内容 */
    private loadComponent;
    private getPluginsDir;
}
export {};
