interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    isResponse?: boolean;
}
/** Chat UI 已处理消息缓存（key = 规范化项目路径）。
 *  供 getRecentPtyOutput 直接读取，Agent 看到的内容 = Chat UI 显示的内容。 */
export declare const chatMessages: Map<string, ChatMessage[]>;
export declare function registerSessionIpc(): void;
export {};
