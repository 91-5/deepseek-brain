import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
const comp = await page.evaluate(() => window.__comp ?? [])
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')
fs.mkdirSync(dir, { recursive: true })
for (const [i, e] of comp.entries()) {
  const f = path.join(dir, `deepseek-sse-entry${i}.txt`)
  fs.writeFileSync(f, e.resp, 'utf-8')
  console.log(`entry${i}: status=${e.status} len=${e.resp.length} -> ${f}`)
}
process.exit(0)
