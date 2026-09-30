import puppeteer from 'puppeteer-core'
import { bucketSSE } from '../dist/transport/web-bridge.js'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
const comp = await page.evaluate(() => window.__comp ?? [])
console.log('entries:', comp.length)
for (const [i, e] of comp.entries()) {
  console.log(`--- entry ${i}: status=${e.status} done=${e.done} respLen=${e.resp.length}`)
  const paths = new Set()
  for (const line of e.resp.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try { const o = JSON.parse(payload); if (o.p) paths.add(String(o.p)) } catch {}
  }
  console.log('p-paths:', [...paths].slice(0, 12))
  const b = bucketSSE(e.resp)
  console.log('reasoningLen:', b.reasoning.length, 'contentLen:', b.content.length)
  console.log('content head:', JSON.stringify(b.content.slice(0, 200)))
  console.log('content has fence:', b.content.includes('```tool_call'))
  console.log('reasoning has fence:', b.reasoning.includes('```tool_call'))
}
process.exit(0)
