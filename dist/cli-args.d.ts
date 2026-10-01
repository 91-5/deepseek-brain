/** CLI 解析结果。默认值是「能跑起来」的保守值，见 spec §6：
 *  headless 关——那是「默认开会功能失败」而非风险规避。 */
export interface CliOptions {
    port: number;
    profile?: string;
    chromePath?: string;
    /** 透传给上层；本版本只解析不实现 headless 行为 */
    headless: boolean;
    verbose: boolean;
    command: 'serve' | 'login';
    help: boolean;
}
export declare const DEFAULT_PORT = 8790;
export declare function helpText(): string;
/**
 * 解析命令行参数。**坏值一律抛错**而不是悄悄降级：
 * 静默的 NaN 会一路传到 server.listen()，用户看到的是网络层报错，
 * 排查方向完全跑偏；在这里抛错能指名道姓说哪个 flag 写错了。
 *
 * 未知 flag 忽略（向前兼容），但未知子命令抛错——否则 `deepseek-brain logout`
 * 会被当成 serve 默默起一个服务，用户以为退出了其实没退。
 */
export declare function parseArgs(argv: string[]): CliOptions;
/**
 * flag → env 覆盖表。**flag 优先于 env**：命令行是更近的一层意图。
 *
 * 单独抽成纯函数是为了可测：cli.ts 在模块顶层就 main()，没法 import 它来测映射。
 * 返回新对象，不改传入的 base。
 */
export declare function cliOptionsToEnv(o: CliOptions, base?: Record<string, string | undefined>): Record<string, string | undefined>;
