/**
 * 按平台生成候选路径表。
 *
 * `platform` 可注入（默认 `process.platform`），这样测试能在任意平台上覆盖
 * macOS/Linux 分支的**候选表生成逻辑**——但**测不了实际启动**（见 spec §6）。
 *
 * Linux 的 PATH 扫描是**运行时求值**的，不是静态表：把当前 PATH 里命中的结果
 * 附在固定路径之后。传入的 `env.PATH` 决定扫描结果，因此注入 env 即可测试。
 */
export declare function chromeCandidates(env: Record<string, string | undefined>, platform?: NodeJS.Platform): string[];
/**
 * 探测可用的浏览器可执行文件。返回第一个通过的候选，全失败返回 null。
 *
 * 显式值（`CHROME_PATH`）优先，但**必须过同一套 `probe()` 校验**——显式值只提高
 * 优先级，不降低校验强度。「CLI 说存在、bridge 说不存在」的两套真相就是这么来的
 * （见 spec §4.4）。
 */
export declare function detectChrome(env?: Record<string, string | undefined>, platform?: NodeJS.Platform): string | null;
export declare function chromeNotFoundMessage(candidates: string[]): string;
/**
 * bridge 启动时要用的可执行文件：显式值（--chrome-path / config.browser.executablePath）优先。
 *
 * 显式值也要过 probe()——**复用 detectChrome 而不是自己再写一遍判据**，
 * 否则「CLI 早失败探测说存在、bridge 启动时说不存在」这种两套真相迟早出现。
 * 与探测的唯一差别就是优先级，不是校验强度。
 *
 * **签名保持不变**（向后兼容面），内部改调跨平台的 detectChrome。
 */
export declare function resolveChromeExecutable(explicit: string | undefined, env?: Record<string, string | undefined>): string | null;
