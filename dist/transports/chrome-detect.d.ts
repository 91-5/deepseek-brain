/** Windows Chrome/Chromium/Edge 候选路径，按优先级排列。
 *  LOCALAPPDATA 优先——Windows 上 Chrome 绝大多数是 per-user 安装。 */
export declare function windowsChromeCandidates(env: Record<string, string | undefined>): string[];
export declare function detectWindowsChrome(env?: Record<string, string | undefined>): string | null;
export declare function chromeNotFoundMessage(candidates: string[]): string;
/**
 * bridge 启动时要用的可执行文件：显式值（--chrome-path / config.browser.executablePath）优先。
 *
 * 显式值也要过 existsSync——**复用 detectWindowsChrome 而不是自己再写一遍判据**，
 * 否则「CLI 早失败探测说存在、bridge 启动时说不存在」这种两套真相迟早出现。
 * 与探测的唯一差别就是优先级，不是校验强度。
 */
export declare function resolveChromeExecutable(explicit: string | undefined, env?: Record<string, string | undefined>): string | null;
