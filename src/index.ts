import { loadConfig } from './config.js'
import { createHttpServer, setTransportGetter } from './server/http.js'
import { createWebBridge } from './transports/deepseek-web.js'

async function main() {
  const config = loadConfig()
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
main().catch(e => { console.error('[brain] fatal:', e); process.exit(1) })
