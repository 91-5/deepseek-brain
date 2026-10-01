const DEFAULTS = {
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
};
function num(v, d) {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) && n > 0 ? n : d;
}
export function loadConfig(env = process.env) {
    return {
        ...DEFAULTS,
        // LOG_LEVEL 之前只被 CLI 写、没人读——log.level 恒为 'info'，--verbose 形同虚设
        log: { ...DEFAULTS.log, level: env.LOG_LEVEL || DEFAULTS.log.level },
        port: num(env.PORT, DEFAULTS.port),
        thinking: env.THINKING ? env.THINKING === 'true' : DEFAULTS.thinking,
        timeoutMs: num(env.TIMEOUT_MS, DEFAULTS.timeoutMs),
        thinkingTimeoutMs: num(env.THINKING_TIMEOUT_MS, DEFAULTS.thinkingTimeoutMs),
        sendClickSettleMs: num(env.SEND_SETTLE_MS, DEFAULTS.sendClickSettleMs),
        maxFormatRetries: num(env.MAX_FORMAT_RETRIES, DEFAULTS.maxFormatRetries),
        compactTokenThreshold: num(env.COMPACT_THRESHOLD, DEFAULTS.compactTokenThreshold),
        toolResultMaxChars: num(env.TOOL_RESULT_MAX_CHARS, DEFAULTS.toolResultMaxChars),
        // 空串等同于「没给」：探测时 CHROME_PATH='' 会被 existsSync 否掉，用户看到的却是 null 而非候选列表
        browser: {
            ...DEFAULTS.browser,
            executablePath: env.CHROME_PATH ? env.CHROME_PATH : undefined,
        },
    };
}
