// 手动 smoke：npm run build && node scripts/smoke.mjs
// 路径随 Task 2 的三层拆分改过：transport/ → transports/，web-bridge.js → deepseek-web.js
import { createWebBridge } from '../dist/transports/deepseek-web.js'
import { loadConfig } from '../dist/config.js'

const bridge = createWebBridge(loadConfig())
await bridge.start()
// health 自 v0.2.0 起返回 { status, loggedIn }，不是裸字符串
console.log('health:', await bridge.health())
try {
  for await (const c of bridge.generate({ prompt: '只回复四个字：桥接正常', thinking: false, timeoutMs: 120000 })) {
    if (c.reasoning) process.stdout.write('[R] ' + c.reasoning + '\n')
    if (c.content) process.stdout.write('[C] ' + c.content + '\n')
  }
  console.log('session:', bridge.lastChatSessionId())
} catch (e) {
  console.error('SMOKE FAIL:', e.message)
  process.exitCode = 1
} finally {
  await bridge.stop()
}
