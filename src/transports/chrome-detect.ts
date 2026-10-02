import fs from 'node:fs'
import path from 'node:path'

/**
 * 浏览器探测：按平台分派候选路径，用 `accessSync(X_OK)` 逐个校验。
 *
 * **平台支持是分级的，不是「全平台可用」**——本文件只保证「给出正确的候选路径、
 * 用正确的方式判可执行」，**不保证目标平台真能把 Chrome 拉起来**。可执行性检查
 * 之后还有一整段启动期（缺共享库、无 display、sandbox 拒绝）是这里的判据覆盖不到的。
 * 详见 spec §6 与 README 的平台分级。
 */

/**
 * 探测单个路径是否可用。
 *
 * `X_OK` 三平台通用：Unix 查可执行位，**Windows 上按 Node 官方文档退化为
 * `F_OK`**（`X_OK` has no effect on Windows）。这正是我们要的——Windows 没有
 * 可执行位概念，存在性就是它能给出的最强信号。
 *
 * 注意：通过 ≠ 能启动。见文件头声明。
 */
function probe(p: string): string | null {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return p
  } catch {
    return null
  }
}

/**
 * Windows 候选路径，按优先级排列。
 *
 * **模块内部函数，不 export**：平台分派是唯一的公共入口，调用点不得绕过它直接
 * 使用平台专属表——那正是「非 Windows 用户看到 Windows 路径」这条 bug 的来源
 * （见 spec §4.4）。
 *
 * `LOCALAPPDATA` 优先——Windows 上 Chrome 绝大多数是 per-user 安装。
 * `ProgramW6432` 排在 `PROGRAMFILES(X86)` **之前**：它只在「32 位 Node 跑在 64 位
 * Windows」时有意义，此时 `PROGRAMFILES` 指向 (x86)，该变量指向真正的 64 位目录，
 * 应当优先于 (x86)。
 */
function windowsCandidates(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  const local = env.LOCALAPPDATA
  const pf = env.PROGRAMFILES
  const pf64 = env.ProgramW6432
  const pf86 = env['PROGRAMFILES(X86)']
  if (local) {
    out.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(local, 'Chromium', 'Application', 'chrome.exe'))
  }
  if (pf) {
    out.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  if (pf64) {
    out.push(path.join(pf64, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(pf64, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  if (pf86) {
    out.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  return out
}

/**
 * POSIX 路径拼接。**不用 `path.join`**：宿主是 Windows 时它会产出
 * `\Users\x\...`（反斜杠、无盘符），而 macOS/Linux 的路径无论测试跑在哪台机器上
 * 都必须用正斜杠。用 `path.join` 会让「注入 platform 参数」这个可测性设计失效——
 * 测出来的结果取决于宿主平台，而不是被测平台。
 */
function posixJoin(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(p => p !== '')
    .join('/')
}

/**
 * macOS 候选路径。
 *
 * `.app` 包内可执行文件位于 `Contents/MacOS/`——该结构由 puppeteer / playwright /
 * karma / chrome-launcher 四家独立项目源码交叉佐证。
 * `~/Applications` 排在 `/Applications` 之后（chrome-launcher 给前者权重 50、后者 100）。
 */
function macCandidates(env: Record<string, string | undefined>): string[] {
  const out: string[] = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]
  const home = env.HOME
  if (home) {
    out.push(posixJoin(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
  }
  return out
}

/** Linux 固定路径。官方 deb/rpm 的真实二进制位置，不依赖 PATH。 */
function linuxFixedCandidates(): string[] {
  return [
    '/opt/google/chrome/chrome',
    '/opt/microsoft/msedge/msedge',
  ]
}

/**
 * Linux PATH 扫描的命令名顺序。
 *
 * **`chromium-browser` 必须在 `chromium` 之前**：Debian 上 `chromium` 这个名字
 * 一度被游戏包 `chromium-bsu` 占用（karma 源码注释明确记载）。
 */
const LINUX_PATH_NAMES = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']

/**
 * 扫描 PATH 找第一个可用的浏览器。
 *
 * **纯 Node 实现，不调用 `which`**：部分最小化镜像没有 `which`。
 *
 * 分隔符**硬编码 `:`**，不用 `path.delimiter`——后者在 Windows 宿主上是 `;`，
 * 会让「注入 platform 参数」在 Windows 上测 Linux 分支时得到错误结果。
 * Linux/macOS 的 PATH 分隔符恒为 `:`，与宿主平台无关。
 */
function probeOnPath(env: Record<string, string | undefined>): string | null {
  const dirs = (env.PATH ?? '').split(':').filter(Boolean)
  for (const name of LINUX_PATH_NAMES) {
    for (const dir of dirs) {
      const hit = probe(posixJoin(dir, name))
      if (hit) return hit
    }
  }
  return null
}

/**
 * 按平台生成候选路径表。
 *
 * `platform` 可注入（默认 `process.platform`），这样测试能在任意平台上覆盖
 * macOS/Linux 分支的**候选表生成逻辑**——但**测不了实际启动**（见 spec §6）。
 *
 * Linux 的 PATH 扫描是**运行时求值**的，不是静态表：把当前 PATH 里命中的结果
 * 附在固定路径之后。传入的 `env.PATH` 决定扫描结果，因此注入 env 即可测试。
 */
export function chromeCandidates(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'win32') return windowsCandidates(env)

  if (platform === 'darwin') return macCandidates(env)

  if (platform === 'linux') {
    const out = linuxFixedCandidates()
    const onPath = probeOnPath(env)
    if (onPath && !out.includes(onPath)) out.push(onPath)
    return out
  }

  // 未知平台（freebsd / aix / android 等）：给 PATH 扫描一个机会，至少不是空表。
  // 不承诺可用——见文件头分级声明。
  const onPath = probeOnPath(env)
  return onPath ? [onPath] : []
}

/**
 * 探测可用的浏览器可执行文件。返回第一个通过的候选，全失败返回 null。
 *
 * 显式值（`CHROME_PATH`）优先，但**必须过同一套 `probe()` 校验**——显式值只提高
 * 优先级，不降低校验强度。「CLI 说存在、bridge 说不存在」的两套真相就是这么来的
 * （见 spec §4.4）。
 */
export function detectChrome(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const explicit = env.CHROME_PATH
  if (explicit) return probe(explicit)
  for (const c of chromeCandidates(env, platform)) {
    if (probe(c)) return c
  }
  return null
}

export function chromeNotFoundMessage(candidates: string[]): string {
  return [
    '[brain] chrome not found. Set CHROME_PATH or --chrome-path, or install Chrome/Edge.',
    'Checked candidates:',
    ...candidates.map(c => `  - ${c}`),
  ].join('\n')
}

/**
 * bridge 启动时要用的可执行文件：显式值（--chrome-path / config.browser.executablePath）优先。
 *
 * 显式值也要过 probe()——**复用 detectChrome 而不是自己再写一遍判据**，
 * 否则「CLI 早失败探测说存在、bridge 启动时说不存在」这种两套真相迟早出现。
 * 与探测的唯一差别就是优先级，不是校验强度。
 *
 * **签名保持不变**（向后兼容面），内部改调跨平台的 detectChrome。
 */
export function resolveChromeExecutable(explicit: string | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (explicit) return detectChrome({ CHROME_PATH: explicit })
  return detectChrome(env)
}
