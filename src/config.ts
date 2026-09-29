export interface BrowserConfig {
  debugPort: number
  profileDir: string
  headless: boolean
}
export interface LogConfig { level: string; dir: string }
export interface AppConfig {
  port: number
  thinking: boolean
  timeoutMs: number
  thinkingTimeoutMs: number
  sendClickSettleMs: number
  maxFormatRetries: number
  compactTokenThreshold: number
  toolResultMaxChars: number
  browser: BrowserConfig
  log: LogConfig
}
const DEFAULTS: AppConfig = {
  port: 8790,
  thinking: true,
  timeoutMs: 240000,
  thinkingTimeoutMs: 300000,
  sendClickSettleMs: 8000,
  maxFormatRetries: 2,
  compactTokenThreshold: 40000,
  toolResultMaxChars: 4000,
  browser: { debugPort: 9222, profileDir: '.chrome-profile', headless: false },
  log: { level: 'info', dir: 'logs' },
}
function num(v: string | undefined, d: number): number {
  const n = Number(v); return v !== undefined && Number.isFinite(n) && n > 0 ? n : d
}
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    ...DEFAULTS,
    browser: { ...DEFAULTS.browser },
    log: { ...DEFAULTS.log },
    port: num(env.PORT, DEFAULTS.port),
    thinking: env.THINKING ? env.THINKING === 'true' : DEFAULTS.thinking,
    timeoutMs: num(env.TIMEOUT_MS, DEFAULTS.timeoutMs),
    thinkingTimeoutMs: num(env.THINKING_TIMEOUT_MS, DEFAULTS.thinkingTimeoutMs),
    sendClickSettleMs: num(env.SEND_SETTLE_MS, DEFAULTS.sendClickSettleMs),
    maxFormatRetries: num(env.MAX_FORMAT_RETRIES, DEFAULTS.maxFormatRetries),
    compactTokenThreshold: num(env.COMPACT_THRESHOLD, DEFAULTS.compactTokenThreshold),
    toolResultMaxChars: num(env.TOOL_RESULT_MAX_CHARS, DEFAULTS.toolResultMaxChars),
  }
}
