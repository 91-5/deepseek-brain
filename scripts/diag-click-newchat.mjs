import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
console.log('点击前 URL:', page.url())
const els = await page.$$('::-p-text(开启新对话)')
console.log('命中元素数:', els.length)
if (els.length) {
  await els[0].click()
  await new Promise(r => setTimeout(r, 1500))
  console.log('点击后 URL:', page.url())
  const title = await page.title()
  console.log('页面标题:', title)
  const hasTextarea = await page.evaluate(() => !!document.querySelector('textarea'))
  console.log('输入框存在:', hasTextarea)
}
process.exit(0)
