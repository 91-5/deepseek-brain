export type HealthStatus = 'ok' | 'login_required' | 'ui_changed' | 'error'
export interface GenerateRequest { prompt: string; thinking: boolean; timeoutMs?: number }
export interface GenerateChunk { reasoning?: string; content?: string }
export interface Transport {
  generate(req: GenerateRequest): AsyncIterable<GenerateChunk>
  newChat(): Promise<void>
  health(): Promise<HealthStatus>
  lastChatSessionId(): string | null
  resetSession(): void
}
