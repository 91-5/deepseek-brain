import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import type { AppConfig } from '../config.js'
import type { GenerateChunk, Health, Transport, Capabilities } from '../core/types.js'
import { judgeLoginState, CHAT_INPUT_SELECTOR } from './login-state.js'
import { profileSeeded } from './lazy-start.js'
import {
  DEFAULT_SESSIONS_FILE,
  loadSessionSnapshot,
  saveSessionSnapshot,
  type SessionSnapshot,
} from '../core/session/store.js'
import { resolveChromeExecutable, chromeNotFoundMessage, chromeCandidates } from './chrome-detect.js'

const CHAT_URL = 'https://chat.deepseek.com/'
const SESSION_URL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROGRESS_LOG_MS = 30000

/** 页内探针：包裹 XHR，捕获 /chat/completion 的 body 与流式 responseText。
 *  幂等：重复注入（整页刷新后 framenavigated 重注）不会双重包裹
 *
 *  export 只是为了让测试能在沙箱里跑**这段真实脚本**；不影响页面侧语义。*/
export const PROBE = `(() => {
  if (window.__probeInstalled) return 'probe-ok'
  window.__probeInstalled = true;
  window.__comp = window.__comp || [];
  const oOpen = XMLHttpRequest.prototype.open;
  const oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u, ...r) { this.__u = u; return oOpen.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function(b, ...r) {
    try {
      if (/completion/.test(this.__u || '')) {
        const entry = { url: this.__u, body: b, t0: Date.now(), status: null, resp: '', done: false };
        window.__comp.push(entry);
        // 增量累积：progress 给的是 responseText 全量快照，逐次整份复制是 O(n^2)。
        // startsWith 守卫不可省：重定向/重试时 responseText 可能整体换掉，
        // 无守卫的 slice(prev.length) 会切出中段并追加进已累积正文（脏数据）。
        // 语义等价于 src/transports/tail.ts 的 appendTail。
        const merge = function(prev, next) {
          return (next.length > prev.length && next.startsWith(prev)) ? prev + next.slice(prev.length) : next;
        };
        this.addEventListener('progress', () => { entry.resp = merge(entry.resp, this.responseText); });
        this.addEventListener('loadend', () => { entry.status = this.status; entry.done = true; entry.resp = merge(entry.resp, this.responseText); });
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

/**
 * DeepSeek 网页 SSE 分流（协议实测修订，2026-09-30 首跑抓包）：
 * - JSON-Patch 增量流：带 p/o 的行是操作，**无 p/o 的行是上一个 content 路径的延续**（只有 v）
 * - `response/fragments` 的数组快照出现 type="RESPONSE" 的 fragment 是思考→答案的判别标志
 * - elapsed_secs（字符串!/status/usage BATCH 都是元数据，不进正文
 * - 答案 fragment 创建时的 content 快照是前缀，后续 -1/content 增量接续（去重防叠字）
 */
export function bucketSSE(sse: string): { reasoning: string; content: string } {
  let reasoning = '', content = ''
  let lastPath = ''
  let inAnswer = false
  let answerSeed = ''
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let obj: { p?: string; o?: string; v?: unknown }
    try { obj = JSON.parse(payload) } catch { continue }
    const hasOp = obj.p !== undefined || obj.o !== undefined
    if (hasOp) lastPath = String(obj.p ?? '')
    if (hasOp && lastPath === 'response/fragments') {
      // 数组快照：{"id":3,"type":"RESPONSE","content":"我是"} —— 答案 fragment 诞生（v 可能是原生数组或 JSON 字符串）
      let arr: unknown = obj.v
      if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { arr = null } }
      if (Array.isArray(arr)) {
        const resp = (arr as Array<{ type?: string; content?: string }>).filter(f => f?.type === 'RESPONSE').at(-1)
        if (resp) { inAnswer = true; answerSeed = resp.content ?? '' }
      }
      continue
    }
    if (!/\/content$/.test(lastPath)) continue // elapsed_secs/status/response(BATCH usage) 等元数据
    if (typeof obj.v !== 'string') continue
    if (inAnswer) content += obj.v
    else reasoning += obj.v
  }
  if (inAnswer && answerSeed && !content.startsWith(answerSeed)) content = answerSeed + content
  return { reasoning, content }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

/**
 * debug 级输出闸门：LOG_LEVEL=debug（CLI --verbose）才打。
 *
 * 刻意只有一个函数、只有一层判断——不给这个项目造日志框架。
 * 挂上来的都是「每次尝试都打一遍」的恢复诊断；状态变更的解释
 * （DOM 快照、丢弃过期会话条目等）仍留在 info，默认输出一行未减。
 */
export function debugLog(level: string, ...args: unknown[]): void {
  if (level === 'debug') console.log(...args)
}

/**
 * (b) 增量 SSE 消费。
 *
 * generate() 每 400ms 轮询一次。若每次都把全量 resp 重新喂给 bucketSSE，
 * 一条 N 字节的流会被反复重新解析（JSON.parse 每行每拍），总代价 O(N²)。
 * cursor 只解析**新增部分**，并保留跨 chunk 的解析状态。
 *
 * 等价性保证（tests/deepseek-bucket-sse.test.ts 里逐切点验证）：
 * - 只提交「已遇到 \n 的完整行」，推进 offset；末尾半行**暂解析但不提交**。
 *   整份解析 `sse.split('\n')` 的最后一段即使没有 \n 也会被处理，所以视图里
 *   必须带上它，否则中间步会比整份解析「慢半拍」——generate() 靠 emittedC
 *   切片产出增量，慢半拍就是流式行为变化（熔断线）。
 * - 视图复用 bucketSSE 末尾的 seed 修正，保持与原实现逐字符一致。
 * - 非前缀延伸（XHR 重定向/重试把 responseText 整体换掉）时丢弃状态重解析。
 *
 * 时序未变：generate() 的轮询间隔、emittedC/emittedR 切片、以及流末那次
 * 权威的整份 bucketSSE 全部保持原样，本函数只是替换了「每拍重解析」这一动作。
 */
export interface SseCursor {
  /** 已提交的完整行字节数（含其行尾 \n） */
  offset: number
  /** 上一条提交的整行，用于非前缀延伸检测（只比一行，O(行长) 而非 O(全长)） */
  lastLine: string
  committed: SseState
  /** 本拍的视图：含末尾半行的暂解析结果，等价于对当前前缀做整份解析 */
  reasoning: string
  content: string
}

interface SseState { reasoning: string; content: string; lastPath: string; inAnswer: boolean; answerSeed: string }

export function createSseCursor(): SseCursor {
  return {
    offset: 0,
    lastLine: '',
    committed: { reasoning: '', content: '', lastPath: '', inAnswer: false, answerSeed: '' },
    reasoning: '',
    content: '',
  }
}

/** 单行解析：把一条 SSE 行应用到 state 上（与 bucketSSE 内联逻辑逐字对应）。 */
function applyLine(line: string, s: SseState): void {
  if (!line.startsWith('data:')) return
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return
  let obj: { p?: string; o?: string; v?: unknown }
  try { obj = JSON.parse(payload) } catch { return }
  const hasOp = obj.p !== undefined || obj.o !== undefined
  if (hasOp) s.lastPath = String(obj.p ?? '')
  if (hasOp && s.lastPath === 'response/fragments') {
    let arr: unknown = obj.v
    if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { arr = null } }
    if (Array.isArray(arr)) {
      const resp = (arr as Array<{ type?: string; content?: string }>).filter(f => f?.type === 'RESPONSE').at(-1)
      if (resp) { s.inAnswer = true; s.answerSeed = resp.content ?? '' }
    }
    return
  }
  if (!/\/content$/.test(s.lastPath)) return
  if (typeof obj.v !== 'string') return
  if (s.inAnswer) s.content += obj.v
  else s.reasoning += obj.v
}

function seedFix(s: SseState): { reasoning: string; content: string } {
  const content = (s.inAnswer && s.answerSeed && !s.content.startsWith(s.answerSeed))
    ? s.answerSeed + s.content : s.content
  return { reasoning: s.reasoning, content }
}

export function feedSse(cursor: SseCursor, full: string): { reasoning: string; content: string } {
  // 非前缀延伸 → 整体重解析。比对「上一条提交的整行」而不是整份前缀：
  // O(行长) 而非 O(全长)，重定向/重试会同时改掉这条行，足以识别。
  if (cursor.offset > full.length
    || (cursor.offset > 0 && full.slice(cursor.offset - cursor.lastLine.length, cursor.offset) !== cursor.lastLine)) {
    cursor.offset = 0
    cursor.lastLine = ''
    cursor.committed = { reasoning: '', content: '', lastPath: '', inAnswer: false, answerSeed: '' }
  }

  const rest = full.slice(cursor.offset)
  const parts = rest.split('\n')
  const tail = parts.pop() ?? '' // 未见 \n 的半行

  for (const line of parts) {
    if (line === '') continue
    applyLine(line, cursor.committed)
    cursor.lastLine = line
    cursor.offset += line.length + 1
  }

  // 半行暂解析到副本上：结果进视图，但不写回 committed（下一拍它会更完整）。
  const viewState: SseState = { ...cursor.committed }
  if (tail !== '') applyLine(tail, viewState)
  const v = seedFix(viewState)
  cursor.reasoning = v.reasoning
  cursor.content = v.content
  return v
}

const SELECTORS_PATH = fileURLToPath(new URL('../../selectors.json', import.meta.url))

let selectorsCache: { send: string; newChat: string } | null = null
/** 界面语言兜底：selectors.json 的 newChat 不命中时依次尝试（2026-09-30 实测中文界面按钮文案为「开启新对话」） */
export const NEW_CHAT_FALLBACKS = ['::-p-text(开启新对话)', '::-p-text(New chat)']

/** 从 ::-p-text(X) 选择器提取裸文本；非 p-text 选择器返回 null */
export function textFromPTextSelector(sel: string): string | null {
  const m = sel.match(/^::-p-text\((.*)\)$/)
  return m ? m[1] : null
}
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
/** 正在进行的 start()；用于让 start 幂等且并发安全（懒启动下首请求与 CLI 可能同时触发） */
let starting: Promise<void> | null = null
  let chromeProc: ReturnType<typeof spawn> | null = null
  let generating = false
  let chatSessionId: string | null = null
  /** 进行中生成对应的 window.__comp 下标；-1 表示当前没有进行中的请求。
   *  提到闭包作用域是为了让 cancel() 能定位同一条 entry（与 generate 内取值完全一致）。 */
  let entryIndex = -1

  /** JS 派发点击：::-p-text 命中的是嵌套 div 文本节点，CDP hit-test 不可点，
   *  locator.click() 会卡在 actionability 等待直到超时（2026-09-30 实测）；
   *  冒泡 MouseEvent 直接派发，SPA 的 React 合成事件正常响应。 */
  async function jsClickByText(text: string): Promise<boolean> {
    if (!page) throw new Error('bridge not started')
    return page.evaluate(t => {
      const els = [...document.querySelectorAll('div,button,span')].filter(el => (el.textContent ?? '').trim() === t)
      if (!els.length) return false
      for (const el of els) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      return true
    }, text)
  }

  async function ensureProfileDir(): Promise<void> {
    const dest = path.resolve(config.browser.profileDir)
    fs.mkdirSync(dest, { recursive: true })
    if (!profileSeeded(dest)) {
      console.log('[web-bridge] fresh profile — first run needs manual login in the Chrome window')
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
    // 显式路径优先（--chrome-path / CHROME_PATH），否则自动探测。
    // 这里 spawn 的是解析出的可执行文件——puppeteer 侧只负责连 remote debugging 端口，
    // 不存在可传 executablePath 的 launch 调用，别照着文档去找那个参数。
    const chrome = resolveChromeExecutable(config.browser.executablePath)
    if (!chrome) throw new Error(chromeNotFoundMessage(chromeCandidates(process.env, process.platform)))
    chromeProc = spawn(chrome, [
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
        debugLog(config.log.level, `[web-bridge] resumed session ${resume.chatSessionId} (sentCount=${resume.sentCount})`)
        return
      }
      debugLog(config.log.level, `[web-bridge] resume target redirected to ${page.url()}`)
    } catch (e) {
      debugLog(config.log.level, '[web-bridge] resume navigation failed:', e instanceof Error ? e.message : e)
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

  /**
   * 存活探测：browser 对象非 null **不等于** Chrome 还活着。
   *
   * Chrome 崩溃、被用户关窗、或休眠后被系统回收时，puppeteer 的 Browser /
   * Page 对象都不会自动置 null——它们只是变成了指向已死进程的陈旧句柄。
   * 于是 `if (browser) return` 会一路早退、`if (!page)` 也判定为「已就绪」，
   * shim 就此永久砖化：每个请求都 502，Chrome 再也不会被重新拉起，
   * 只能手动重启进程。对「常驻后台服务」这个定位来说这是硬伤。
   *
   * `isConnected()` 是 puppeteer 提供的存活判据，连接断开时返回 false。
   * 探测本身要吞异常：句柄已死时任何调用都可能抛，而抛异常在这里必须等价于
   * 「死了」——不能让它冒泡去打断调用方的正常流程。
   */
  function isBridgeAlive(): boolean {
    if (!browser) return false
    try {
      return browser.isConnected()
    } catch {
      return false
    }
  }

  /** Chrome 已死时把闭包状态清干净，让 startBridge 能重新走一遍 launch。 */
  function resetStaleBridge(): void {
    browser = null
    page = null
    chromeProc = null
    chatSessionId = null
  }

  /**
   * 幂等启动：重复调用不重复拉 Chrome。懒启动下 CLI 与首个 generate 可能同时触发，
   * 故用 starting 复用同一个 promise 而不是各拉一个 Chrome。
   *
   * 早退条件是「存活」而不是「非 null」——见 isBridgeAlive 的注释：陈旧句柄
   * 曾让这里永久早退，是 shim 无法自愈的直接原因。
   */
  async function startBridge(): Promise<void> {
    if (starting) return starting
    if (isBridgeAlive()) return
    // 上一次留下的陈旧句柄必须先清掉，否则 launch() 里的 retryConnect 会去
    // 连一个已死的 browser，而且重新赋值前的旧引用会让并发调用误判为已启动。
    if (browser || page) resetStaleBridge()
    starting = (async () => {
      await launch()
      await openChatPage()
    })()
    try { await starting } finally { starting = null }
  }

  return {
    async start() { await startBridge() },
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
      // (c) 懒启动：首个请求才拉起 Chrome。start() 幂等，重复调用无副作用。
      // 判据是「bridge 活着吗」而非「page 存在吗」——Chrome 死后 page 是陈旧
      // 句柄，仍非 null，只判 null 会让这次请求直接掉进 502 而不尝试重连。
      if (!isBridgeAlive()) await startBridge()
      if (!page) throw new Error('bridge not started') // start 失败兜底；同时让 TS 保住 null 收窄
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
        entryIndex = -1
        let retried = false
        let emittedC = 0, emittedR = 0
        let lastProgress = Date.now()
        let lastLen = 0
        const sseCursor = createSseCursor()
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
              // (b) 增量解析：只喂新增尾部，状态跨拍保留。轮询间隔 / emittedC 切片 /
              // 流末那次权威整份解析都保持原样，时序与语义不变。
              const b = feedSse(sseCursor, st.resp)
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
                // 流结束兜底（只能在这里做：局部解析时 reasoning 还只是思考片段，
                // 提前挪 content 会把思考当正文吐出去并顶高 emittedC 吞掉真答案）
                const bf = bucketSSE(st.resp)
                let outR = bf.reasoning, outC = bf.content
                if (!outC && outR) { outC = outR; outR = '' }
                if (outR.length > emittedR) { yield { reasoning: outR.slice(emittedR) }; emittedR = outR.length }
                if (outC.length > emittedC) { yield { content: outC.slice(emittedC) }; emittedC = outC.length }
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
        entryIndex = -1
      }
    },
    /** harness 侧取消：把进行中那条 entry 标记为完成并清空 resp，
     *  generate 的轮询下一拍读到 done 即返回（不复用任何新的取值路径，只写 __comp[entryIndex]）。 */
    async cancel() {
      if (!page || entryIndex < 0) return
      const i = entryIndex
      await page.evaluate(idx => {
        const e = (window as unknown as { __comp: Array<{ done: boolean; resp: string }> }).__comp[idx]
        if (e) { e.done = true; e.resp = '' }
      }, i)
    },
    getCapabilities(): Capabilities {
      return {
        supportsThinking: true,
        supportsResume: true,
        // 网页端不暴露模型规格；64000 取 DeepSeek 公开的 chat 上下文上限（V3/R1 同为 64K），
        // 并非本地实测值。compaction 阈值仍以 config.compactTokenThreshold 为准，两者独立。
        maxContextTokens: 64000,
        tokenEstimator: (t: string) => Math.ceil(t.length / 2),
      }
    },
    async newChat() {
      if (!page) throw new Error('bridge not started')
      // 界面语言兜底：selectors.json 为主，NEW_CHAT_FALLBACKS 双语候补（去重保序）
      let clicked = false
      for (const sel of [...new Set([readSelectors().newChat, ...NEW_CHAT_FALLBACKS])]) {
        const text = textFromPTextSelector(sel)
        if (!text) continue
        try {
          if (await jsClickByText(text)) { clicked = true; break }
        } catch { /* 选择器无效/语言不匹配：试下一个 */ }
      }
      if (!clicked) {
        await dumpDom('selector-newchat')
        throw new Error('ui_changed: newChat selector not found')
      }
      await sleep(1000)
      chatSessionId = null
    },
    health(): Promise<Health> {
      return (async () => {
        /**
         * (c) 懒启动下 Chrome 可能根本没起来。
         *
         * 这里**不返回 error**：error 的语义是「页面在但读取失败」，调用方
         * （尤其 CLI 的阻塞登录循环）会把 error 当成需要重试或退出的坏状态。
         *
         * 也**不返回 login_required**：那是「页面在、确实没登录」的结论，
         * 而此刻连页面都没有，判据根本没跑过——把它报成未登录，等于拿一个
         * 未经检验的断言去覆盖「只是还没被叫醒」这个事实。此前就是这么写的，
         * 后果是冷启动阶段 /health 永远报 login_required，运维探针无法区分
         * 「服务没起」和「账号掉线」，只能一律去重新登录。
         *
         * 所以这里引入独立的 bridge_idle：它是**部署状态**而非账号状态，
         * loggedIn 保持 false——bridge 没起时确实无从得知登录态，false 是诚实的值，
         * 而非「已知未登录」的断言。
         */
        if (!isBridgeAlive()) return { status: 'bridge_idle', loggedIn: false }
        // isBridgeAlive() 看的是 browser，page 是另一路状态：launch() 中途失败时
        // browser 可能已连上而 page 仍为 null。显式收窄既让 TS 认得，也避免下面
        // 两次 evaluate 在 null 上抛成 error（那会把「还没准备好」误报成故障）。
        if (!page) return { status: 'bridge_idle', loggedIn: false }
        try {
          /**
           * loggedIn 的主判据是「聊天输入框是否渲染」，不是正文文本。
           *
           * 旧实现先 `document.body.innerText.includes('登录')` 就报 login_required，
           * 这是已记录的误报：页面加载早期正文里就可能出现「登录」二字（导航、
           * 页脚、弹窗文案、甚至别人的提问），于是鉴权尚未完成时就被判成未登录。
           * 反过来，输入框只在真正登录后的会话页才渲染——DeepSeek 未登录时
           * 直接跳登录页，压根没有 textarea。这一条既不会误报，判据也更贴近
           * 「能不能干活」：没有输入框就发不出任何请求。
           *
           * 不引入新选择器：复用 generate() 里既有的裸标签 'textarea'
           * （deepseek-web.ts:319），与 selectors.json 的 send/newChat 无关。
           */
          const hasInput = await page.evaluate(s => !!document.querySelector(s), CHAT_INPUT_SELECTOR)
          const txt = await page.evaluate(() => document.body.innerText || '')
          return judgeLoginState({ hasInput, bodyText: txt })
        } catch { return { status: 'error', loggedIn: false } }
      })()
    },
    lastChatSessionId() { return chatSessionId },
    resetSession() { chatSessionId = null },
  }
}
