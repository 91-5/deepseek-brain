/**
 * 包根入口（`exports["."]` → dist/index.js，types → dist/index.d.ts）。
 *
 * 此前本文件是「node dist/index.js 直接起服务」的入口，在模块顶层就调用
 * main()，等于**只要有人 import 就被迫拉起 server 与 Chrome**——那让它没法当
 * 库入口：dist/index.d.ts 只产出一句 `export {}`，`exports["."].types` 承诺的
 * 类型是空的，TS 消费方 `import { loadConfig } from 'deepseek-brain'` 直接报
 * TS2305。现在改为无副作用的再导出，启动能力收敛到 startShim()，
 * 由 bin（dist/cli.js）在 Task 5 负责调用。
 *
 * 复用的第三方主要拿 types 与 loadConfig；纯逻辑层从 'deepseek-brain/core' 取。
 */
export { loadConfig, type AppConfig, type BrowserConfig, type LogConfig } from './config.js'
export type { OpenAIMessage, ToolCall, ToolSpec } from './types.js'
export { createHttpServer, setTransportGetter } from './server/http.js'
export { createWebBridge } from './transports/deepseek-web.js'

import { loadConfig } from './config.js'
import { createHttpServer, setTransportGetter } from './server/http.js'
import { createWebBridge } from './transports/deepseek-web.js'

/**
 * 启动 shim：拉起 WebBridge 并在 127.0.0.1 上监听。
 *
 * 故意不做成顶层副作用——调用方（CLI）需要决定何时启动、以及是否要处理
 * 首次登录的阻塞等待（见 spec §6.1）。
 */
export async function startShim(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = loadConfig(env)
  const bridge = createWebBridge(config)
  setTransportGetter(() => bridge)
  await bridge.start()
  console.log(`[brain] transport health: ${await bridge.health()}`)
  const server = createHttpServer(config)
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`[brain] shim listening on http://127.0.0.1:${config.port}/v1`)
  })
  const shutdown = async () => { server.close(); await bridge.stop(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}