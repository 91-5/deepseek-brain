export type HealthStatus = 'ok' | 'login_required' | 'ui_changed' | 'error';
/**
 * health() 的返回值。
 *
 * v0.2.0 起 health 从裸字符串改为带 loggedIn 的对象（spec §6.1）：CLI 需要在
 * 启动阶段**阻塞等待登录完成**才监听端口，只有 status 分不清「没登录」和
 * 「页面还没加载出来」，而这两种情况的正确处置完全不同。
 */
export interface Health {
    status: HealthStatus;
    /** 是否已鉴权成功。以聊天输入框是否渲染为主判据，见 transports/deepseek-web.ts */
    loggedIn: boolean;
}
export interface GenerateRequest {
    prompt: string;
    thinking: boolean;
    timeoutMs?: number;
}
export interface GenerateChunk {
    reasoning?: string;
    content?: string;
}
export interface Capabilities {
    /** 模型是否产出 reasoning_content 分流 */
    supportsThinking: boolean;
    /** 是否支持用 chatSessionId 深链恢复会话 */
    supportsResume: boolean;
    /** 上下文墙；compaction 阈值默认取此值 */
    maxContextTokens: number;
    /** token 估算器；默认取 core/session/manager.ts 的 chars/2 口径 */
    tokenEstimator?: (text: string) => number;
}
export interface Transport {
    generate(req: GenerateRequest): AsyncIterable<GenerateChunk>;
    newChat(): Promise<void>;
    health(): Promise<Health>;
    lastChatSessionId(): string | null;
    resetSession(): void;
    /** 中止当前进行中的生成；无进行中生成时为空操作 */
    cancel(): Promise<void>;
    getCapabilities(): Capabilities;
}
