export type HealthStatus = 'ok' | 'login_required' | 'ui_changed' | 'error'
export interface GenerateRequest { prompt: string; thinking: boolean; timeoutMs?: number }
export interface GenerateChunk { reasoning?: string; content?: string }
export interface Capabilities {
  /** 模型是否产出 reasoning_content 分流 */
  supportsThinking: boolean
  /** 是否支持用 chatSessionId 深链恢复会话 */
  supportsResume: boolean
  /** 上下文墙；compaction 阈值默认取此值 */
  maxContextTokens: number
  /** token 估算器；默认取 core/session/manager.ts 的 chars/2 口径 */
  tokenEstimator?: (text: string) => number
}
export interface Transport {
  generate(req: GenerateRequest): AsyncIterable<GenerateChunk>
  newChat(): Promise<void>
  health(): Promise<HealthStatus>
  lastChatSessionId(): string | null
  resetSession(): void
  /** 中止当前进行中的生成；无进行中生成时为空操作 */
  cancel(): Promise<void>
  getCapabilities(): Capabilities
}
