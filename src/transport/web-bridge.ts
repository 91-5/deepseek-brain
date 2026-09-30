import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import type { AppConfig } from '../config.js'
import type { GenerateChunk, HealthStatus, Transport } from './types.js'
import {
  DEFAULT_SESSIONS_FILE,
  loadSessionSnapshot,
  saveSessionSnapshot,
  type SessionSnapshot,
} from '../session/store.js'

const CHROME = process.env.CHROME_PATH ?? 'C:\\Users\\15812\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const NUPHUS_PROFILE = path.join(os.homedir(), 'AppData', 'Roaming', 'Nuphus', 'browser_profile_v2')
const CHAT_URL = 'https://chat.deepseek.com/'
const SESSION_URL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROGRESS_LOG_MS = 30000

/** 页内探针：包裹 XHR，捕获 /chat/completion 的 body 与流式 responseText。
 *  幂等：重复注入（整页刷新后 framenavigated 重注）不会双重包裹 */
const PROBE = `(() => {
  if (window.__probeInstalled) return 'probe-ok'
  window.__probeInstalled = true
  window.__comp = window.__comp || [];
  const oOpen = XMLHttpRequest.prototype.open;
  const oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u, ...r) { this.__u = u; return oOpen.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function(b, ...r) {
    try {
      if (/completion/.test(this.__u || '')) {
        const entry = { url: this.__u, body: b, t0: Date.now(), status: null, resp: '', done: false };
        window.__comp.push(entry);
        this.addEventListener('progress', () => { entry.resp = this.responseText; });
        this.addEventListener('loadend', () => { entry.status = this.status; entry.done = true; entry.resp = this.responseText; });
      }
    } catch (e) {}
    return oSend.call(this, b, ...r);
  };
  return 'probe-ok';
})()`

export interface WebBridge extends Transport {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface WebBridgeOptions {
  /** 会话持久化文件路径；默认读 env.SESSIONS_FILE，再退化到仓库根 .sessions.json */
  sessionsFile?: string
}

export interface ResumeEntry { key: string; chatSessionId: string; sentCount: number }

/**
 * 从持久化快照里挑可续接的 DeepSeek 会话：仅当**恰好一个**可用条目时才深链恢复。
 * 多会话并存时返回 null——v0.1 单 brain 假设，宁可开新会话（delta 自带上下文）
 * 也不把 A 会话的轮次打进 B 会话的网页聊天造成串台。
 */
export function pickResumeEntry(snapshot: SessionSnapshot): ResumeEntry | null {
  let best: ResumeEntry | null = null
  for (const [key, rec] of Object.entries(snapshot)) {
    const chatSessionId = sanitizeChatSessionId(rec?.chatSessionId)
    if (!chatSessionId) continue
    if (best) return null
    best = { key, chatSessionId, sentCount: rec.sentCount }
  }
  return best
}

/** 纯函数：__comp 长度超过发送前基线 → 新请求下标（= preLen）；否则 -1（尚未捕获到请求）。
 *  防止点击未触发请求时误读上一轮已完成 entry（会静默返回旧答案并屏蔽 no_request 检测） */
export function resolveEntryIndex(currentLen: number, preLen: number): number {
  return currentLen > preLen ? preLen : -1
}

/** done 后的状态判定：HTTP≥400 或 status===0（网络中止时 loadend 也置 done）→ 传输错误 */
export function completionError(status: number | null): string | null {
  if (status === null) return null
  if (status === 0) return 'transport_error: completion aborted (network interrupted)'
  if (status >= 400) return `transport_error: completion HTTP ${status}${status === 401 || status === 403 ? ' (login expired?)' : ''}`
  return null
}

/** connect 重试：Chrome 冷启动可能超过固定 sleep，最多 attempts 次、间隔 delayMs（T8①） */
export async function retryConnect<T>(fn: () => Promise<T>, attempts = 15, delayMs = 1000): Promise<T> {
  let lastErr: unknown = new Error('retryConnect: no attempts')
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (e) { lastErr = e; if (i < attempts - 1) await sleep(delayMs) }
  }
  throw lastErr
}

export function chatUrlFor(chatSessionId: string): string {
  return `https://chat.deepseek.com/a/chat/s/${chatSessionId}`
}

/** 只有形如 UUID 的 chatSessionId 才允许拼进 URL（防路径/查询注入） */
export function sanitizeChatSessionId(v: unknown): string | null {
  return typeof v === 'string' && SESSION_URL_RE.test(v) ? v : null
}

/** 纯函数：有可续接会话 → 深链；否则首页。无浏览器即可单测 */
export function resolveStartUrl(entry: ResumeEntry | null): string {
  return entry ? chatUrlFor(entry.chatSessionId) : CHAT_URL
}

export function bucketSSE(sse: string): { reasoning: string; content: string } {
  let reasoning = '', content = ''
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let obj: { p?: string; v?: unknown }
    try { obj = JSON.parse(payload) } catch { continue }
    const v = obj.v
    if (typeof v !== 'string') continue
    const p = String(obj.p ?? '')
    if (/thinking|reason/i.test(p)) reasoning += v
    else if (!/status/i.test(p)) content += v // response/status SET 等元数据不是正文
  }
  return { reasoning, content }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

const SELECTORS_PATH = fileURLToPath(new URL('../../selectors.json', import.meta.url))

let selectorsCache: { send: string; newChat: string } | null = null
function readSelectors(): { send: string; newChat: string } {
  if (!selectorsCache) {
    selectorsCache = JSON.parse(fs.readFileSync(SELECTORS_PATH, 'utf-8')) as { send: string; newChat: string }
  }
  return selectorsCache
}

export function createWebBridge(config: AppConfig, opts: WebBridgeOptions = {}): WebBridge {
  const sessionsFile = opts.sessionsFile ?? process.env.SESSIONS_FILE ?? DEFAULT_SESSIONS_FILE
  let browser: Browser | null = null
  let page: Page | null = null
  let chromeProc: ReturnType<typeof spawn> | null = null
  let generating = false
  let chatSessionId: string | null = null

  async function ensureProfileDir(): Promise<void> {
    const dest = path.resolve(config.browser.profileDir)
    if (fs.existsSync(path.join(dest, 'Default', 'Cookies'))) return
    fs.mkdirSync(dest, { recursive: true })
    try {
      fs.cpSync(NUPHUS_PROFILE, dest, { recursive: true, errorOnExist: false })
      console.log('[web-bridge] copied Nuphus profile (login reused)')
    } catch (e) {
      console.log('[web-bridge] fresh profile; manual login required on first run:', e instanceof Error ? e.message : e)
    }
  }

  /** 选择器失效/UI 异常时把 DOM 快照落 logs/（design §4.3/§9） */
  async function dumpDom(reason: string): Promise<void> {
    if (!page) return
    try {
      fs.mkdirSync(config.log.dir, { recursive: true })
      const f = path.join(config.log.dir, `dom-${reason}-${Date.now()}.html`)
      fs.writeFileSync(f, await page.content(), 'utf-8')
      console.log(`[web-bridge] DOM snapshot saved: ${f}`)
    } catch { /* 快照失败不掩盖原始错误 */ }
  }

  function dropPersistedEntry(key: string): void {
    try {
      const snap = loadSessionSnapshot(sessionsFile)
      delete snap[key]
      saveSessionSnapshot(sessionsFile, snap)
      console.log(`[web-bridge] dropped stale session entry ${key}`)
    } catch (e) {
      console.log('[web-bridge] failed to drop stale session entry:', e instanceof Error ? e.message : e)
    }
  }

  async function launch(): Promise<void> {
    await ensureProfileDir()
    if (!fs.existsSync(CHROME)) throw new Error(`chrome not found: ${CHROME}`)
    chromeProc = spawn(CHROME, [
      `--remote-debugging-port=${config.browser.debugPort}`,
      `--user-data-dir=${path.resolve(config.browser.profileDir)}`,
      '--no-first-run', '--no-default-browser-check',
      ...(config.browser.headless ? ['--headless=new'] : []),
    ], { detached: true, stdio: 'ignore' })
    browser = await retryConnect(() => puppeteer.connect({ browserURL: `http://127.0.0.1:${config.browser.debugPort}`, defaultViewport: null }))
  }

  /** 首页路径：导航 + 注入探针 + 从 URL 提取新会话 id */
  async function openHome(): Promise<void> {
    if (!page) throw new Error('browser not launched')
    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(2000)
    await page.evaluate(PROBE)
    const m = page.url().match(/\/a\/chat\/s\/([0-9a-f-]{36})/)
    if (m) chatSessionId = m[1]
  }

  /** 续接路径：深链到持久化的 chat URL；无效/加载失败 → 回退首页并清除该条目 */
  async function openResumed(resume: ResumeEntry): Promise<void> {
    if (!page) throw new Error('browser not launched')
    try {
      await page.goto(chatUrlFor(resume.chatSessionId), { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(2000)
      if (page.url().includes(`/a/chat/s/${resume.chatSessionId}`)) {
        chatSessionId = resume.chatSessionId
        await page.evaluate(PROBE)
        console.log(`[web-bridge] resumed session ${resume.chatSessionId} (sentCount=${resume.sentCount})`)
        return
      }
      console.log(`[web-bridge] resume target redirected to ${page.url()}`)
    } catch (e) {
      console.log('[web-bridge] resume navigation failed:', e instanceof Error ? e.message : e)
    }
    await dumpDom('resume-failed')
    dropPersistedEntry(resume.key)
    chatSessionId = null
    await openHome()
  }

  async function openChatPage(): Promise<void> {
    if (!browser) throw new Error('browser not launched')
    const pages = await browser.pages()
    page = pages.find(p => p.url().includes('chat.deepseek.com')) ?? await browser.newPage()
    // 整页刷新后新 document 的 XHR 包装丢失，framenavigated 重注（PROBE 幂等不会双裹）（N4）
    const p = page
    p.on('framenavigated', frame => {
      if (frame === p.mainFrame()) void p.evaluate(PROBE).catch(() => {})
    })
    const snap = loadSessionSnapshot(sessionsFile)
    const resumableCount = Object.values(snap).filter(r => sanitizeChatSessionId(r?.chatSessionId)).length
    if (resumableCount > 1) console.log(`[web-bridge] ${resumableCount} resumable sessions; opening fresh chat to avoid context mixing`)
    const resume = pickResumeEntry(snap)
    if (resume) await openResumed(resume)
    else await openHome()
  }

  async function clickSend(sel: string): Promise<void> {
    if (!page) throw new Error('bridge not started')
    try {
      await page.click(sel)
    } catch {
      await dumpDom('selector-send')
      throw new Error('ui_changed: send selector not found')
    }
  }

  return {
    async start() {
      if (browser) return
      await launch()
      await openChatPage()
    },
    async stop() {
      try { await browser?.close() } catch { /* detached chrome 不随连接关闭而退出 */ }
      if (chromeProc?.pid) {
        // Windows 下子 Chrome 进程可能残留持有 profile 锁，taskkill /T /F 杀整树保证可重启（N5）
        try { spawn('taskkill', ['/pid', String(chromeProc.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* taskkill 缺失时退回 chromeProc.kill */ }
      }
      chromeProc?.kill()
      browser = null; page = null; chromeProc = null
    },
    async *generate(req): AsyncIterable<GenerateChunk> {
      if (!page) throw new Error('bridge not started')
      while (generating) await sleep(200) // 单飞锁：FIFO 等待
      generating = true
      try {
        const sel = readSelectors()
        await page.bringToFront()
        const ta = await page.waitForSelector('textarea', { timeout: 15000 })
        await ta!.click()
        const preLen = await page.evaluate(() => (window as unknown as { __comp: unknown[] }).__comp.length)
        const cdp = await page.createCDPSession()
        await cdp.send('Input.insertText', { text: req.prompt })
        await clickSend(sel.send)

        let t0 = Date.now()
        let entryIndex = -1
        let retried = false
        let emittedC = 0, emittedR = 0
        let lastProgress = Date.now()
        let lastLen = 0
        const deadline = Date.now() + (req.timeoutMs ?? config.timeoutMs)
        while (Date.now() < deadline) {
          if (entryIndex === -1) {
            const len = await page.evaluate(() => (window as unknown as { __comp: unknown[] }).__comp.length)
            const idx = resolveEntryIndex(len, preLen)
            if (idx < 0 && Date.now() - t0 > config.sendClickSettleMs) {
              if (!retried) {
                retried = true
                t0 = Date.now()
                await clickSend(sel.send)
                continue
              }
              await dumpDom('no-request')
              throw new Error('no_request_after_send: 点击后未捕获到请求，未重发')
            }
            if (idx >= 0) entryIndex = idx
          }
          if (entryIndex !== -1) {
            const st = await page.evaluate(i => {
              const e = (window as unknown as { __comp: Array<{ done: boolean; status: number | null; resp: string }> }).__comp[i]
              return e ? { done: e.done, status: e.status, resp: String(e.resp ?? '') } : null
            }, entryIndex)
            if (st) {
              const b = bucketSSE(st.resp)
              if (b.content.length > emittedC) { yield { content: b.content.slice(emittedC) }; emittedC = b.content.length }
              if (b.reasoning.length > emittedR) { yield { reasoning: b.reasoning.slice(emittedR) }; emittedR = b.reasoning.length }
              if (st.resp.length !== lastLen) { lastLen = st.resp.length; lastProgress = Date.now() }
              else if (Date.now() - lastProgress > PROGRESS_LOG_MS) {
                lastProgress = Date.now()
                console.log(`[web-bridge] generating... resp=${st.resp.length}B, waited ${Math.round((Date.now() - t0) / 1000)}s`)
              }
              if (st.done) {
                const err = completionError(st.status)
                if (err) throw new Error(err)
                const m = page.url().match(/\/a\/chat\/s\/([0-9a-f-]{36})/)
                if (m) chatSessionId = m[1]
                return
              }
            }
          }
          await sleep(400)
        }
        throw new Error('timeout: generation exceeded limit')
      } finally {
        generating = false
      }
    },
    async newChat() {
      if (!page) throw new Error('bridge not started')
      try { await page.locator(readSelectors().newChat).click() }
      catch {
        await dumpDom('selector-newchat')
        throw new Error('ui_changed: newChat selector not found')
      }
      await sleep(1000)
      chatSessionId = null
    },
    health(): Promise<HealthStatus> {
      return (async () => {
        if (!page) return 'error' as const
        try {
          const txt = await page.evaluate(() => document.body.innerText)
          if (txt.includes('Log in') || txt.includes('登录')) return 'login_required' as const
          const hasInput = await page.evaluate(() => !!document.querySelector('textarea'))
          return hasInput ? ('ok' as const) : ('ui_changed' as const)
        } catch { return 'error' as const }
      })()
    },
    lastChatSessionId() { return chatSessionId },
    resetSession() { chatSessionId = null },
  }
}
