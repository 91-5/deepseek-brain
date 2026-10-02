#!/usr/bin/env node
/**
 * CLI 入口。
 *
 * 首行 shebang 是硬要求：tsc 不会自动补 shebang，也不会设执行位。
 * 丢了它，装好的包用 npx 跑会报 SyntaxError: invalid character '#'。
 * 仅用 ESM import——项目是 "type": "module"，CJS 的导入语法会直接崩。
 */
import { parseArgs, helpText, cliOptionsToEnv } from './cli-args.js'
import { loadConfig } from './config.js'
import { createWebBridge } from './transports/deepseek-web.js'
import { detectChrome, chromeNotFoundMessage, chromeCandidates } from './transports/chrome-detect.js'
import { profileSeeded } from './transports/lazy-start.js'
import { startShim, serveOnly } from './index.js'

/** 登录轮询节奏。3 秒是「用户切窗口登录」的合理粒度：再密只是白烧 CPU。 */
const POLL_INTERVAL_MS = 3000
/** 等多久放弃。首登要输密码、过 2FA，30 分钟足够；到点仍没登录就退出，
 *  而不是继续占着端口假装还活着。 */
const LOGIN_TIMEOUT_MS = 30 * 60_000

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function applyFlags(o: ReturnType<typeof parseArgs>): ReturnType<typeof loadConfig> {
  const env = cliOptionsToEnv(o)
  const config = loadConfig(env)
  if (o.profile) config.browser.profileDir = o.profile
  if (o.headless) config.browser.headless = true
  return config
}

/** 启动 Chrome 并轮询到登录完成。返回是否成功。 */
async function waitForLogin(
  bridge: ReturnType<typeof createWebBridge>,
  probe: () => Promise<{ loggedIn: boolean; status: string }>,
): Promise<boolean> {
  console.log('[brain] 首次运行：请在弹出的 Chrome 窗口里登录 chat.deepseek.com')
  console.log('[brain] 等待登录完成…（登录态会持久化到 profile，之后重启无需再登）')
  await bridge.start()
  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  while (Date.now() < deadline) {
    const h = await probe()
    if (h.loggedIn) return true
    if (h.status === 'ui_changed') {
      // 页面在但没有输入框也没有登录提示：继续等没有意义，多半是选择器过期。
      console.error('[brain] ui_changed：页面结构已变，既没有输入框也没有登录入口。')
      console.error('[brain] 请更新 selectors.json / 裸标签 textarea 判据后再试。')
      return false
    }
    await sleep(POLL_INTERVAL_MS)
  }
  console.error(`[brain] 等待登录超时（${LOGIN_TIMEOUT_MS / 60_000} 分钟），退出。`)
  return false
}

async function main(): Promise<void> {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`[brain] 参数错误: ${(e as Error).message}`)
    console.error('运行 deepseek-brain --help 查看用法')
    process.exit(1)
  }

  if (opts.help) { console.log(helpText()); process.exit(0) }

  // 早失败：探测不到浏览器就立刻退出，不等第一次请求。
  // 懒启动 + 无浏览器 = 用户等到超时才知道自己没装 Chrome。
  //
  // 显式值（--chrome-path）也要过同一套校验，**不能零校验直通**：此前显式值
  // 被直接信任、跳过了探测，于是不存在的
  // 路径能一路打印 `[brain] browser: <ghost>` 通过早检查，直到 bridge 启动阶段
  // 才炸——「CLI 说存在、bridge 说不存在」的两套真相。现在两者共用 detectChrome
  // 这一个判据来源，显式值只是提高优先级，不降低校验强度。
  const chrome = detectChrome(
    opts.chromePath ? { ...process.env, CHROME_PATH: opts.chromePath } : process.env,
  )
  if (!chrome) {
    console.error(chromeNotFoundMessage(chromeCandidates(process.env, process.platform)))
    process.exit(1)
  }
  console.log(`[brain] browser: ${chrome}`)

  const config = applyFlags(opts)

  if (opts.command === 'login') {
    // 只登录，不监听端口。
    const bridge = createWebBridge(config)
    const ok = await waitForLogin(bridge, () => bridge.health())
    await bridge.stop()
    if (!ok) process.exit(1)
    console.log('[brain] 登录成功。profile 已持久化，现在可以运行 deepseek-brain 启动服务。')
    process.exit(0)
  }

  // serve：先判断能不能跳过登录等待。
  //
  // (c) 懒启动：profile 播种过（有 Cookies）说明以前登录过 → 不必阻塞等待，
  // Chrome 推迟到首个 generate() 请求再拉起。端口可以立刻开。
  // 未播种 → 维持 Task 5 的阻塞登录流程（必须先把 Chrome 拉起来登录）。
  const seeded = profileSeeded(config.browser.profileDir)
  if (!seeded) {
    console.log('[brain] 未检测到登录态，需要先登录。')
    const bridge = createWebBridge(config)
    const ok = await waitForLogin(bridge, () => bridge.health())
    await bridge.stop()
    if (!ok) process.exit(1)
  } else {
    console.log('[brain] profile 已播种，跳过登录等待；Chrome 将在首个请求时启动')
  }

  await startShim(process.env, config)
}

main().catch(e => { console.error('[brain] fatal:', e); process.exit(1) })

// serveOnly 从 index.ts 导出，供将来 Task 6 的 serve 路径复用；
// 这里显式引用一次，避免它在构建时被摇掉（也不让 lint 报未使用）。
void serveOnly