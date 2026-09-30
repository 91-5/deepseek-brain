import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find(p => p.url().includes('chat.deepseek.com'))
if (!page) { console.log('no deepseek page'); process.exit(1) }

// 1. 看匹配元素的 DOM 结构与可点击祖先
const info = await page.evaluate(() => {
  const els = [...document.querySelectorAll('div,button,span')].filter(el => (el.textContent ?? '').trim() === '开启新对话')
  const dump = els.slice(0, 4).map(el => {
    const chain = []
    let cur = el
    for (let i = 0; cur && i < 5; i++) {
      chain.push(`${cur.tagName}${cur.getAttribute('role') ? '[role=' + cur.getAttribute('role') + ']' : ''}${cur.className ? '.' + String(cur.className).split(' ')[0] : ''}`)
      cur = cur.parentElement
    }
    return chain.join(' < ')
  })
  return { count: els.length, dump }
})
console.log(JSON.stringify(info, null, 1))

// 2. JS 派发点击（冒泡 MouseEvent），看是否触发新会话
const before = page.url()
const clicked = await page.evaluate(() => {
  const els = [...document.querySelectorAll('div,button,span')].filter(el => (el.textContent ?? '').trim() === '开启新对话')
  for (const el of els) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  }
  return els.length
})
console.log('JS 点击元素数:', clicked)
await new Promise(r => setTimeout(r, 2000))
console.log('点击前:', before)
console.log('点击后:', page.url())
console.log('标题:', await page.title())
process.exit(0)
