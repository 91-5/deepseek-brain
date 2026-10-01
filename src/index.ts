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

import { loadConfig, type AppConfig } from './config.js'
import { createHttpServer, setTransportGetter } from './server/http.js'
import { createWebBridge } from './transports/deepseek-web.js'

/**
 * 启动 shim：拉起 WebBridge 并在 127.0.0.1 上监听。
 *
 * 故意不做成顶层副作用——调用方（CLI）需要决定何时启动、以及是否要处理
 * 首次登录的阻塞等待（见 spec §6.1）。
 *
 * config 允许外部传入：CLI 已经把 flag 解析成 config（--profile/--headless/--chrome-path
 * 都在里面），这里再 loadConfig(process.env) 等于把它们全丢掉、重新按 env 猜一遍。
 */
export async function startShim(
  env: Record<string, string | undefined> = process.env,
  config: AppConfig = loadConfig(env),
): Promise<void> {
  const bridge = createWebBridge(config)
  setTransportGetter(() => bridge)
  /**
   * (c) 懒启动：**不**在这里 start()。端口先开，Chrome 等首个 generate() 再说。
   * 强行探测 health() 会把 Chrome 立刻拉起来，懒启动就名存实亡了。
   * health 的真实状态由首个请求去揭示；登录态由 CLI 在调用前用文件判据把关。
   */
  console.log(`[brain] shim starting (lazy: Chrome launches on first request)`)
  return startHttpServer(config)
}

/** 单独抽出「只监听」这一步，好让 CLI 在 login 子命令下能整个跳过它。 */
export function startHttpServer(config: AppConfig): Promise<void> {
  const server = createHttpServer(config)
  return new Promise<void>(resolve => {
    server.listen(config.port, '127.0.0.1', () => {
      console.log(`[brain] shim listening on http://127.0.0.1:${config.port}/v1`)
      resolve()
    })
    const shutdown = async () => { server.close(); process.exit(0) }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}

/** CLI 用的纯监听路径：复用同一个 createHttpServer，不另造一套。 */
export function serveOnly(config: AppConfig): Promise<void> {
  return startHttpServer(config)
}