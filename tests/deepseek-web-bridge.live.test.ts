import { describe, it, expect } from 'vitest'
import { createWebBridge } from '../src/transports/deepseek-web.js'
import { loadConfig } from '../src/config.js'

describe.runIf(process.env.LIVE_TEST === '1')('web-bridge live', () => {
  it('驱动网页版完成一次生成', async () => {
    const config = loadConfig()
    const bridge = createWebBridge(config)
    await bridge.start()
    try {
      // health 自 v0.2.0 起返回 { status, loggedIn }
      const h = await bridge.health()
      expect(h.status).toBe('ok')
      expect(h.loggedIn).toBe(true)
      let out = ''
      for await (const c of bridge.generate({ prompt: '只回复两个字：正常', thinking: false, timeoutMs: 120000 })) {
        if (c.content) out += c.content
      }
      expect(out.trim().length).toBeGreaterThan(0)
      expect(bridge.lastChatSessionId()).toMatch(/[0-9a-f-]{36}/)
    } finally {
      await bridge.stop()
    }
  }, 180000)
})
