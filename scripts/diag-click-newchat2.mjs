import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }
console.log('当前 URL:', page.url())
const t0 = Date.now()
try {
  await page.locator('::-p-text(开启新对话)').click({ timeout: 5000 })
  console.log('locator.click OK,', Date.now() - t0, 'ms')
} catch (e) {
  console.log('locator.click 失败/超时:', e.message.split('\n')[0], Date.now() - t0, 'ms')
}
await new Promise(r => setTimeout(r, 1500))
console.log('点击后 URL:', page.url())
const title = await page.title()
console.log('标题:', title)
process.exit(0)
