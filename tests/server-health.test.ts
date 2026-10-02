import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHttpServer, setTransportGetter } from '../src/server/http.js'
import { loadConfig } from '../src/config.js'
import { createWebBridge } from '../src/transports/deepseek-web.js'
import type { Transport } from '../src/core/types.js'

/**
 * GET /health 是只读探针。核心语义：**不得触发 Chrome 懒启动**——
 * 运维探活（OpenCode、重启脚本、用户自己 curl）都不该把浏览器从被子里拽出来。
 * 启动与否、登录与否完全由 transport 自己的 health() 判定，server 层只转发。
 */

const cfg = loadConfig({})

/** 记录被调到的成员，用来证明 /health 不会顺手调 start/generate。 */
function spyTransport(inner: Transport): Transport & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async *generate(req) { calls.push('generate'); yield* inner.generate(req) },
    async health() { calls.push('health'); return inner.health() },
    lastChatSessionId() { calls.push('lastChatSessionId'); return inner.lastChatSessionId() },
    resetSession() { calls.push('resetSession') },
    async newChat() { calls.push('newChat') },
    async cancel() { calls.push('cancel') },
    getCapabilities() { calls.push('getCapabilities'); return inner.getCapabilities() },
  }
}

function okTransport(): Transport {
  return {
    async *generate() { yield { content: 'x' } },
    async health() { return { status: 'ok' as const, loggedIn: true } },
    lastChatSessionId() { return null },
    resetSession() {},
    async newChat() {},
    async cancel() {},
    getCapabilities() { return { supportsThinking: true, supportsResume: true, maxContextTokens: 64000 } },
  }
}

describe('GET /health', () => {
  let server: http.Server
  let port: number

  beforeAll(async () => {
    server = createHttpServer(cfg)
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()))
  })

  /** CHROME_PATH 指向不存在的路径：探测必然返回 null，测试里**不可能**误起真实 Chrome。 */
  afterEach(() => {
    delete process.env.CHROME_PATH
  })

  async function get(path: string, method = 'GET'): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method })
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }

  it('未启动：返回 bridge_idle + loggedIn:false，且只调 health（不触发懒启动）', async () => {
    process.env.CHROME_PATH = 'D:\\definitely-not-here\\chrome.exe'
    const spy = spyTransport(createWebBridge(cfg))
    setTransportGetter(() => spy)

    const { status, body } = await get('/health')
    expect(status).toBe(200)
    expect(body).toEqual({ status: 'bridge_idle', loggedIn: false })
    expect(spy.calls).toEqual(['health']) // 没碰 generate/start → Chrome 仍在睡
  })

  it('已启动：原样返回 transport 的 health 结果', async () => {
    setTransportGetter(() => okTransport())
    const { status, body } = await get('/health')
    expect(status).toBe(200)
    expect(body).toEqual({ status: 'ok', loggedIn: true })
  })

  it('transport 未注入时降级为 bridge_idle，而不是 500', async () => {
    setTransportGetter(() => { throw new Error('transport not initialized') })
    const { status, body } = await get('/health')
    expect(status).toBe(200)
    expect(body).toEqual({ status: 'bridge_idle', loggedIn: false })
  })

  it('非 GET 的 /health 落到 404 分支', async () => {
    setTransportGetter(() => okTransport())
    const { status, body } = await get('/health', 'POST')
    expect(status).toBe(404)
    expect(body.error).toEqual({ message: 'not found' })
  })

  it('/health/other 不命中探针分支，仍 404', async () => {
    setTransportGetter(() => okTransport())
    const { status, body } = await get('/health/other')
    expect(status).toBe(404)
    expect(body.error).toEqual({ message: 'not found' })
  })

  it('既有路由不受影响：GET /v1/models 仍 200', async () => {
    setTransportGetter(() => okTransport())
    const { status } = await get('/v1/models')
    expect(status).toBe(200)
  })
})