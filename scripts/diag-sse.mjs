import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
const comp = await page.evaluate(() => window.__comp ?? [])
const e = comp[0]
console.log('respLen:', e.resp.length)
for (const line of e.resp.split('\n')) {
  if (!line.startsWith('data:')) continue
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') continue
  try {
    const o = JSON.parse(payload)
    const v = typeof o.v === 'string' ? JSON.stringify(o.v.length > 60 ? o.v.slice(0, 60) + '…' : o.v) : JSON.stringify(o.v).slice(0, 60)
    console.log(`p=${JSON.stringify(o.p)} o=${JSON.stringify(o.o)} v=${v}`)
  } catch { console.log('unparsed:', payload.slice(0, 80)) }
}
process.exit(0)
