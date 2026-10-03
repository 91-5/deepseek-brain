import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { Browser, Page } from 'puppeteer-core'
import { createWebBridge } from '../src/transports/deepseek-web.js'
import { loadConfig } from '../src/config.js'
import type { Health } from '../src/core/types.js'

/**
 * 「browser 活着但 page 是坏页」这一路的回归测试（评审 COND-2）。
 *
 * ## 为什么不直接测
 *
 * 故障发生在**两阶段之间**：`launch()` 成功（browser 已 connected），
 * `openChatPage()` 里 `page = …newPage()` 的赋值发生在 `goto` **之前**，
 * 于是导航失败会留下一个非 null 的坏页。旧代码的复用判据只看「活着」，
 * 于是永久早退、每个请求 502 且永不重试。
 *
 * 而生产启动链是 `spawn 真 Chrome → retryConnect(15 次 ×1s) → openChatPage`，
 * 没有注入点就无法在 CI 里造出「已连接但不健康」这个状态。
 * `createWebBridge` 的 `browserFactory` 选项整段替换掉第一段，
 * `openChatPage` / `startBridge` / `teardownBridge` / `health` **全部是真实代码**，
 * 所以测的是真实组合，不是被单独调用的某个阶段。
 *
 * ## 这个测试证明什么、不证明什么（请勿越界引用）
 *
 * 证明：`launch` 成功而导航抛错时，状态会坍缩、错误可观测、**下一次 start 仍会重试**。
 *
 * 不证明（明确的假通过清单）：
 *
 * - **F1 `isConnected` 恒为 true**。真实世界还有「返回 false」与「直接抛」两路
 *   （`isBridgeAlive()` 的 try/catch 正是为后者写的），本测试全没走到。
 * - **F2 抛错形态被简化**。fake 的 `goto` 是同步抛出可控字符串；真实失败是 30s
 *   超时、被重定向到登录页、或 `openResumed` 吞错后回退 `openHome()` 再失败。
 *   本测试证明的是「抛错即重试」，不是「DeepSeek 改版即重试」。
 * - **F3 杀进程树与 close 超时完全没测**。factory 路径下 `chromeProc` 恒为 null，
 *   故 `killChromeTree()` 的 `taskkill /T /F` 一行都不执行；fake `close()` 瞬时
 *   resolve，`Promise.race([close, sleep(3000)])` 的超时分支也走不到。
 *   **「每次重试泄漏一个 Chrome」这个最贵的风险，本测试一个字都没验**，
 *   只能靠 live 门（`tests/deepseek-web-bridge.live.test.ts` 那套）覆盖。
 * - **F4 锁不住顺序**。若后人把 `page =` 挪到 `goto` 之后（另一种修法），本测试
 *   照样绿——它不断言「page 曾为坏页」。第三条断言（close 被调 + factory 计数为 2）
 *   是对此的补偿：至少把「活着但不可用走 teardown 而非早退」锁死。
 * - **F5 fs 副作用受控**。本测试让 `goto` 在 `openHome()` 内抛出，而 `openHome`
 *   没有 try/catch，所以不会触发 `dumpDom`（那会写 `logs/dom-*.html`）；
 *   `sessionsFile` 也指向临时目录。fake Page 只需 stub 三个方法——
 *   **故意不 stub 其余**：将来若代码路径变了，让它响亮地失败，
 *   而不是用一个「什么都能接」的 fake 把回归悄悄吞掉。
 *
 * 维护税：下面的 fake 靠 `as unknown as Browser/Page` 转型，
 * puppeteer 大版本升级时这里最先碎。升级后请连带检查本文件。
 */

const cfg = loadConfig({})

/** start() 不在 Transport 接口上（CLI 用它做显式预热），测试里按需取。 */
type Bridge = ReturnType<typeof createWebBridge> & { start(): Promise<void> }

interface Counters {
  /** browserFactory 被调用的次数——旧代码永久早退时它会停在 1 */
  factoryCalls: number
  /** browser.close() 被调用的次数——证明走了 teardown 而不是早退 */
  closeCalls: number
}

interface Fake {
  browser: Browser
  counters: Counters
}

function makeFake(opts: { failMessage: string }): Fake {
  // 可变计数器用普通对象持有，不要用 getter——getter 只有读接口，
  // 而 factoryCalls++ 是写操作，会在运行时抛 "Cannot set property"。
  const counters: Counters = { factoryCalls: 0, closeCalls: 0 }

  // 只 stub 会被用到的方法：url() 用于 pages().find 的匹配，on() 用于注册
  // framenavigated 处理器（处理器本身不会被触发），goto() 抛错模拟导航失败。
  const fakePage = {
    url: () => 'about:blank',
    on: () => { /* 注册 framenavigated 即可，不触发 */ },
    goto: async () => { throw new Error(opts.failMessage) },
  } as unknown as Page

  const fakeBrowser = {
    // 返回空数组，强制走 newPage() 分支——于是 page 一定被赋成 fakePage（非 null）
    pages: async () => [] as Page[],
    newPage: async () => fakePage,
    isConnected: () => true,
    close: async () => { counters.closeCalls += 1 },
  } as unknown as Browser

  return { browser: fakeBrowser, counters }
}

function makeBridge(fake: Fake): Bridge {
  const sessionsFile = path.join(os.tmpdir(), 'dsb-badpage-sessions.json')
  const bridge = createWebBridge(cfg, {
    sessionsFile,
    browserFactory: async () => { fake.counters.factoryCalls += 1; return fake.browser },
  })
  return bridge as Bridge
}

describe('坏页路径：launch 成功但导航失败（COND-2）', () => {
  const FAIL = 'simulated-nav-failure'

  // 护栏（不是测试逻辑，是防灾）：若注入点哪天失效、本文件被改回走真实
  // launch()，没有这行就会**真的 spawn 一个 Chrome**——测试不该有能力启动浏览器。
  // 指一条不存在的路径，失效时会快速失败，而不是在本机拉起进程。
  beforeAll(() => {
    process.env.CHROME_PATH = 'D:\\definitely-not-here\\chrome.exe'
  })
  afterAll(() => {
    delete process.env.CHROME_PATH
  })

  it('抛错时原错误透出，且 health 报 bridge_idle 并带失败原因', async () => {
    const fake = makeFake({ failMessage: FAIL })
    const bridge = makeBridge(fake)

    // 原始错误必须透出，不能被 teardown 吞掉
    await expect(bridge.start()).rejects.toThrow(FAIL)

    const h: Health = await bridge.health()
    expect(h.status).toBe('bridge_idle')
    expect(h.loggedIn).toBe(false)
    expect(h.error).toContain(FAIL)
  })

  it('走 teardown 真关 browser，而不是早退', async () => {
    const fake = makeFake({ failMessage: FAIL })
    const bridge = makeBridge(fake)
    await expect(bridge.start()).rejects.toThrow(FAIL)

    // 关键断言：进程还「活着」时必须走 teardownBridge()——它要真关，否则每次
    // 重试留下一个孤儿 Chrome，而它们各持同一个 .chrome-profile 的锁。
    expect(fake.counters.closeCalls).toBeGreaterThanOrEqual(1)
  })

  it('下一次 start() 仍会重试（判别力所在：旧代码此处永久早退静默 resolve）', async () => {
    const fake = makeFake({ failMessage: FAIL })
    const bridge = makeBridge(fake)

    await expect(bridge.start()).rejects.toThrow(FAIL)
    expect(fake.counters.factoryCalls).toBe(1)

    // 这是本文件的核心断言：第二次 start 必须**再走一遍**启动路径。
    // 旧代码 `if (isBridgeAlive()) return` 会让 factoryCalls 停在 1 且直接 resolve，
    // 于是 bridge 被永久砖化——本断言在旧代码下必须变红。
    await expect(bridge.start()).rejects.toThrow(FAIL)
    expect(fake.counters.factoryCalls).toBe(2)
    // 重试同样要关掉上一个「活着但不可用」的 browser
    expect(fake.counters.closeCalls).toBeGreaterThanOrEqual(2)
  })
})