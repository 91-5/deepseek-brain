import puppeteer from 'puppeteer-core'
import { bucketSSE } from '../dist/transports/deepseek-web.js'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
const comp = await page.evaluate(() => window.__comp ?? [])
const e = comp[comp.length - 1]
console.log('entries:', comp.length, 'last respLen:', e.resp.length)
// 打一行数组标志的原始形态
for (const line of e.resp.split('\n')) {
  if (line.includes('"response/fragments"') && line.includes('APPEND')) {
    console.log('RAW ARRAY LINE:', line.slice(0, 200))
    break
  }
}
const b = bucketSSE(e.resp)
console.log('reasoningLen:', b.reasoning.length, 'contentLen:', b.content.length)
console.log('content head:', JSON.stringify(b.content.slice(0, 80)))
process.exit(0)
