export interface BrowserConfig {
    debugPort: number;
    profileDir: string;
    headless: boolean;
    /** 显式 Chrome 可执行文件（--chrome-path / CHROME_PATH）。不设则自动探测。 */
    executablePath?: string;
}
export interface LogConfig {
    level: string;
    dir: string;
}
export interface AppConfig {
    port: number;
    thinking: boolean;
    timeoutMs: number;
    thinkingTimeoutMs: number;
    sendClickSettleMs: number;
    maxFormatRetries: number;
    compactTokenThreshold: number;
    toolResultMaxChars: number;
    browser: BrowserConfig;
    log: LogConfig;
}
export declare function loadConfig(env?: Record<string, string | undefined>): AppConfig;
