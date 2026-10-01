import { describe, it } from 'vitest'
import { createWebBridge } from '../src/transports/deepseek-web.js'
import { loadConfig } from '../src/config.js'

describe.runIf(process.env.LIVE_TEST === '1')('web-bridge live', () => {
  it('驱动网页版完成一次生成', async () => {
    const config = loadConfig()
    const bridge = createWebBridge(config)
    await bridge.start()
    try {
      expect(await bridge.health()).toBe('ok')
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
