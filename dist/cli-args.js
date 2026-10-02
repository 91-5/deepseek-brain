export const DEFAULT_PORT = 8790;
export function helpText() {
    return `deepseek-brain v0.2.0 — 把 DeepSeek 网页版包装成 OpenAI 兼容接口（Windows 已实测；Linux/macOS 路径未验证）

用法：
  deepseek-brain [serve]        启动 shim 并在 127.0.0.1 监听（默认）
  deepseek-brain login          只走登录流程，登录成功后退出，不监听端口
  deepseek-brain --help         显示本帮助

选项：
  --port <n>            监听端口（默认 ${DEFAULT_PORT}）
  --profile <dir>       Chrome profile 目录（默认 .chrome-profile）
  --chrome-path <exe>   指定 Chrome 可执行文件，跳过自动探测
  --headless            无头模式，默认关闭；很多站点会当场拒绝服务
  --verbose             打开调试日志

首次运行需要在弹出的 Chrome 里手动登录 chat.deepseek.com（登录态会持久化），
启动会阻塞等待登录完成后才开始监听端口。

注意：自动化网页版可能违反 DeepSeek 服务条款，账号风险自担。`;
}
/** 需要取值的 flag → 报错时展示的名字 */
const VALUE_FLAGS = new Set(['--port', '--profile', '--chrome-path']);
/**
 * 解析命令行参数。**坏值一律抛错**而不是悄悄降级：
 * 静默的 NaN 会一路传到 server.listen()，用户看到的是网络层报错，
 * 排查方向完全跑偏；在这里抛错能指名道姓说哪个 flag 写错了。
 *
 * 未知 flag 忽略（向前兼容），但未知子命令抛错——否则 `deepseek-brain logout`
 * 会被当成 serve 默默起一个服务，用户以为退出了其实没退。
 */
export function parseArgs(argv) {
    const o = {
        port: DEFAULT_PORT,
        headless: false,
        verbose: false,
        command: 'serve',
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === 'login') {
            o.command = 'login';
            continue;
        }
        if (a === 'serve') {
            o.command = 'serve';
            continue;
        }
        if (a === '--help' || a === '-h') {
            o.help = true;
            continue;
        }
        if (a === '--headless') {
            o.headless = true;
            continue;
        }
        if (a === '--verbose') {
            o.verbose = true;
            continue;
        }
        if (a === '--port' || a === '--profile' || a === '--chrome-path') {
            const raw = argv[++i];
            if (raw === undefined)
                throw new Error(`${a} 需要一个值`);
            if (a === '--port')
                o.port = parsePort(raw);
            else if (a === '--profile')
                o.profile = raw;
            else
                o.chromePath = raw;
            continue;
        }
        if (a.startsWith('-'))
            continue; // 未知 flag：忽略
        throw new Error(`unknown command: ${a}（只支持 serve / login）`);
    }
    return o;
}
/** 端口必须是 1..65535 的整数。用 Number() 会把 '0x10' 解析成 16、把 '' 变成 0 */
function parsePort(raw) {
    if (!/^\d+$/.test(raw))
        throw new Error(`--port 需要一个整数端口，收到 "${raw}"`);
    const n = Number(raw);
    if (n < 1 || n > 65535)
        throw new Error(`--port 超出范围 1-65535，收到 "${raw}"`);
    return n;
}
/**
 * flag → env 覆盖表。**flag 优先于 env**：命令行是更近的一层意图。
 *
 * 单独抽成纯函数是为了可测：cli.ts 在模块顶层就 main()，没法 import 它来测映射。
 * 返回新对象，不改传入的 base。
 */
export function cliOptionsToEnv(o, base = process.env) {
    const env = { ...base };
    if (o.port !== undefined)
        env.PORT = String(o.port);
    if (o.verbose)
        env.LOG_LEVEL = 'debug';
    // --chrome-path 必须落进 env：早失败探测和 bridge 真正的启动都读它，
    // 只在 CLI 里拿来看一眼等于用户指定的浏览器被无声忽略。
    if (o.chromePath)
        env.CHROME_PATH = o.chromePath;
    return env;
}
