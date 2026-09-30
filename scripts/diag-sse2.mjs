import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
const comp = await page.evaluate(() => window.__comp ?? [])
const e = comp[0]
let lastP = '(none)'
const seq = []
for (const line of e.resp.split('\n')) {
  if (!line.startsWith('data:')) continue
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') continue
  let o
  try { o = JSON.parse(payload) } catch { continue }
  if (o.p !== undefined || o.o !== undefined) {
    lastP = `${o.o} ${o.p}`
    seq.push({ tag: lastP, v: typeof o.v === 'string' ? o.v.slice(0, 40) : JSON.stringify(o.v).slice(0, 60) })
  } else {
    const last = seq[seq.length - 1]
    if (last && typeof o.v === 'string') last.v += o.v
  }
}
console.log('=== op/path sequence (v = accumulated continuation) ===')
for (const s of seq) console.log(`[${s.tag}] len=${s.v.length} :: ${JSON.stringify(s.v.slice(0, 120))}`)
console.log('=== tail of last group ===')
const last = seq[seq.length - 1]
if (last) console.log(JSON.stringify(last.v.slice(-300)))
process.exit(0)
