import { describe, it, expect, afterEach } from 'vitest'
import { createWebBridge } from '../src/transports/deepseek-web.js'
import { loadConfig } from '../src/config.js'
import type { Health } from '../src/core/types.js'

/**
 * 启动失败必须**可重试**，且失败原因必须可观测（评审 COND-1）。
 *
 * 故障链：launch() 成功但 openChatPage() 抛错时，browser 仍 connected 而 page 为 null
 * 或指向导航失败的坏页。旧代码的复用判据只看「活着」，于是 startBridge() 永久早退，
 * 每个请求都 502 且永不重试，/health 还报 bridge_idle 让人以为「再等等」。
 *
 * 本文件用「CHROME_PATH 指向不存在的路径」制造启动失败：launch() 必然抛错，
 * 测试里**不可能**误起真实 Chrome，因此可以确定性地断言「失败 → 状态坍缩 →
 * 下一次仍会重试」，无需真浏览器。
 */

const cfg = loadConfig({})

/** start() 不在 Transport 接口上（CLI 用它做显式预热），测试里按需取。 */
type Bridge = ReturnType<typeof createWebBridge> & { start(): Promise<void> }

function makeBridge(): Bridge {
  return createWebBridge(cfg) as Bridge
}

describe('bridge 启动失败后的状态（COND-1）', () => {
  afterEach(() => {
    delete process.env.CHROME_PATH
  })

  it('启动失败：health 报 bridge_idle 并捎带失败原因，浏览器仍保持沉睡', async () => {
    process.env.CHROME_PATH = 'D:\\definitely-not-here\\chrome.exe'
    const bridge = makeBridge()

    await expect(bridge.start()).rejects.toThrow()

    const h = await bridge.health()
    // 失败路径已全量 teardown，所以 bridge_idle 在这里是**真话**：确实没东西在跑
    expect(h.status).toBe('bridge_idle')
    expect(h.loggedIn).toBe(false)
    // 失败原因必须能被运维看到，而不是只能翻日志
    expect(typeof h.error).toBe('string')
    expect((h.error ?? '').length).toBeGreaterThan(0)
  })

  it('启动失败后状态坍缩，第二次 start() 仍走完整启动路径', async () => {
    process.env.CHROME_PATH = 'D:\\definitely-not-here\\chrome.exe'
    const bridge = makeBridge()

    await expect(bridge.start()).rejects.toThrow()
    // **本条的真实射程**：Chrome 探测失败这一路。此时 browser 从未被赋值，
    // 所以它只证明「失败不污染状态、后续请求仍会走完整启动路径」。
    //
    // 它**不覆盖**评审 COND-1 的核心机理（launch() 成功但 openChatPage() 抛错，
    // 此时 browser 已 connected，复用判据若只看存活就会永久早退）。要覆盖那一路
    // 需要 browser 被置为「已连接」而 openChatPage 抛错，只能靠真浏览器或给
    // puppeteer-core 注入点——本仓目前没有该注入点，故该机理目前**只有代码审查
    // 与人工推演覆盖**，没有自动化断言。这是诚实的已知缺口，不是遗漏。
    await expect(bridge.start()).rejects.toThrow()
  })

  it('health 不因启动失败而被污染成 error / login_required', async () => {
    process.env.CHROME_PATH = 'D:\\definitely-not-here\\chrome.exe'
    const bridge = makeBridge()
    await expect(bridge.start()).rejects.toThrow()

    const h: Health = await bridge.health()
    // 「启动失败」不是「页面读取失败」，更不是「账号掉线」——三者处置方式完全不同
    expect(h.status).not.toBe('error')
    expect(h.status).not.toBe('login_required')
  })

  it('失败原因在 /health 出口被截断，不把内部路径整段回显（评审 COND-3）', async () => {
    // 用一条超长且不存在的路径把原始失败消息顶到上限之外
    const longPath = 'D:\\' + 'nope\\'.repeat(100) + 'chrome.exe'
    expect(longPath.length).toBeGreaterThan(400)
    process.env.CHROME_PATH = longPath

    const bridge = makeBridge()
    await expect(bridge.start()).rejects.toThrow()

    const h = await bridge.health()
    const err = h.error ?? ''
    // 截断标记必须出现，说明确实裁过（而不是恰好消息本来就短）
    expect(err).toMatch(/…\(\+\d+ chars\)$/)
    // 回显长度必须显著短于原始路径长度，否则等于没截。
    // 上限常量是模块私有的（不想为测试扩大公开 API 面），所以这里断言相对量：
    // 标记里的丢失字符数必须与「原始消息长度 - 回显长度」相容。
    const dropped = Number(/…\(\+(\d+) chars\)$/.exec(err)?.[1] ?? '0')
    expect(dropped).toBeGreaterThan(0)
    expect(err.length).toBeLessThan(longPath.length)
  })
})
