import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
// 找侧栏新对话按钮的真实文案
const candidates = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('div,button,a,span')) {
    const t = (el.textContent ?? '').trim()
    if (t.length <= 8 && /对话|开启|新建|新/.test(t) && el.children.length <= 2) {
      out.push({ tag: el.tagName, cls: (el.className ?? '').toString().slice(0, 60), text: t })
    }
  }
  return out.slice(0, 10)
})
console.log('候选元素:', JSON.stringify(candidates, null, 1))
for (const sel of ['::-p-text(New chat)', '::-p-text(开启新对话)', '::-p-text(新建对话)']) {
  try {
    const n = await page.$$eval(sel, els => els.length)
    console.log(`选择器 ${sel} 命中数:`, n)
  } catch (e) { console.log(`选择器 ${sel} 报错:`, e.message) }
}
process.exit(0)
