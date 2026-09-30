import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createSessionStore,
  loadSessionSnapshot,
  saveSessionSnapshot,
} from '../src/session/store.js'
import {
  chatUrlFor,
  pickResumeEntry,
  resolveStartUrl,
} from '../src/transport/web-bridge.js'
import { computeSessionKey } from '../src/session/manager.js'
import { runAgentTurn } from '../src/pipeline.js'
import { loadConfig } from '../src/config.js'
import type { OpenAIMessage, ToolSpec } from '../src/types.js'
import type { Transport } from '../src/transport/types.js'

let dir = ''
let file = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsb-sessions-'))
  file = path.join(dir, '.sessions.json')
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function fakeTransport(chunks: Array<{ reasoning?: string; content?: string }>): Transport & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    async *generate(req) { prompts.push(req.prompt); for (const c of chunks) yield c },
    async health() { return 'ok' as const },
    lastChatSessionId() { return 'sess-live' },
    resetSession() {},
    async newChat() {},
  }
}

const TOOLS: ToolSpec[] = [{ name: 'read_file', description: '读', parameters: {} }]
const cfg = loadConfig({})

describe('session store', () => {
  it('文件缺失/损坏时返回空快照', () => {
    expect(loadSessionSnapshot(file)).toEqual({})
    fs.writeFileSync(file, '{ 不是 json', 'utf-8')
    expect(loadSessionSnapshot(file)).toEqual({})
    fs.writeFileSync(file, '[]', 'utf-8')
    expect(loadSessionSnapshot(file)).toEqual({})
  })
  it('过滤非法记录（sentCount 非正整数 / chatSessionId 类型错）', () => {
    fs.writeFileSync(file, JSON.stringify({
      ok: { chatSessionId: null, sentCount: 2 },
      badCount: { chatSessionId: null, sentCount: -1 },
      badType: { chatSessionId: 5, sentCount: 1 },
      noCount: { chatSessionId: null },
    }), 'utf-8')
    expect(loadSessionSnapshot(file)).toEqual({ ok: { chatSessionId: null, sentCount: 2 } })
  })
  it('原子写：不留临时文件，重启后新 store 读回同一份状态', () => {
    const a = createSessionStore(file)
    a.set('k1', { chatSessionId: null, sentCount: 1 })
    a.set('k2', { chatSessionId: 'abc', sentCount: 4 })
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.readdirSync(dir)).toEqual(['.sessions.json'])

    const b = createSessionStore(file)
    expect(b.get('k1')).toEqual({ chatSessionId: null, sentCount: 1 })
    expect(b.get('k2')).toEqual({ chatSessionId: 'abc', sentCount: 4 })
    expect(b.keys().sort()).toEqual(['k1', 'k2'])

    b.delete('k1')
    expect(fs.readdirSync(dir)).toEqual(['.sessions.json'])
    expect(loadSessionSnapshot(file)).toEqual({ k2: { chatSessionId: 'abc', sentCount: 4 } })
  })
  it('覆盖同名旧文件（rename 原子替换）', () => {
    saveSessionSnapshot(file, { k: { chatSessionId: null, sentCount: 1 } })
    saveSessionSnapshot(file, { k: { chatSessionId: null, sentCount: 9 } })
    expect(loadSessionSnapshot(file)).toEqual({ k: { chatSessionId: null, sentCount: 9 } })
  })
  it('filePath 为 null 时纯内存，不落盘', () => {
    const m = createSessionStore(null)
    m.set('k', { chatSessionId: null, sentCount: 1 })
    expect(fs.existsSync(file)).toBe(false)
    expect(m.snapshot()).toEqual({ k: { chatSessionId: null, sentCount: 1 } })
  })
  it('嵌套目录自动创建', () => {
    const nested = path.join(dir, 'a', 'b', '.sessions.json')
    saveSessionSnapshot(nested, { k: { chatSessionId: null, sentCount: 0 } })
    expect(loadSessionSnapshot(nested)).toEqual({ k: { chatSessionId: null, sentCount: 0 } })
  })
})

describe('start URL 选择（纯函数）', () => {
  const UUID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  it('chatSessionId 为 null / 空串 → 首页', () => {
    expect(resolveStartUrl(null)).toBe('https://chat.deepseek.com/')
    expect(resolveStartUrl(pickResumeEntry({ k: { chatSessionId: '', sentCount: 1 } }))).toBe('https://chat.deepseek.com/')
    expect(resolveStartUrl(pickResumeEntry({ k: { chatSessionId: null, sentCount: 1 } }))).toBe('https://chat.deepseek.com/')
  })
  it('UUID → 对应 chat URL', () => {
    const entry = { key: 'k', chatSessionId: UUID, sentCount: 3 }
    expect(resolveStartUrl(entry)).toBe(`https://chat.deepseek.com/a/chat/s/${UUID}`)
    expect(chatUrlFor(UUID)).toBe(`https://chat.deepseek.com/a/chat/s/${UUID}`)
  })
  it('非 UUID 形态（含路径注入）被拒绝', () => {
    const snap = {
      a: { chatSessionId: '../evil', sentCount: 1 },
      b: { chatSessionId: 'deadbeef', sentCount: 1 },
      c: { chatSessionId: UUID.toUpperCase(), sentCount: 1 },
    }
    const picked = pickResumeEntry(snap)
    expect(picked).not.toBeNull()
    expect(picked!.chatSessionId).toBe(UUID.toUpperCase())
  })
  it('快照里无可用条目 → null', () => {
    expect(pickResumeEntry({})).toBeNull()
    expect(pickResumeEntry({ a: { chatSessionId: null, sentCount: 5 } })).toBeNull()
  })
  it('多个可用条目取 sentCount 最大者', () => {
    const snap = {
      a: { chatSessionId: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', sentCount: 2 },
      b: { chatSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', sentCount: 7 },
      c: { chatSessionId: null, sentCount: 99 },
    }
    expect(pickResumeEntry(snap)!.chatSessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })
})

describe('pipeline 会话持久化（绑定要求）', () => {
  const messages: OpenAIMessage[] = [
    { role: 'user', content: '第一问' },
    { role: 'assistant', content: '第一答' },
    { role: 'user', content: '第二问' },
  ]
  const key = computeSessionKey(messages)

  afterEach(() => {
    delete process.env.SESSIONS_FILE
    process.env.NODE_ENV = 'test'
  })

  it('成功轮写落盘：key → {chatSessionId, sentCount}', async () => {
    process.env.SESSIONS_FILE = file
    delete process.env.NODE_ENV
    const t = fakeTransport([{ content: '好的' }])
    await runAgentTurn({ messages, tools: TOOLS, transport: t, config: cfg })
    expect(loadSessionSnapshot(file)[key]).toEqual({ chatSessionId: 'sess-live', sentCount: messages.length })
  })

  it('重启后按持久化 sentCount 续发 delta（compaction 中断场景：sentCount=0 必须重发全文）', async () => {
    saveSessionSnapshot(file, { [key]: { chatSessionId: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', sentCount: 0 } })
    process.env.SESSIONS_FILE = file
    delete process.env.NODE_ENV
    const t = fakeTransport([{ content: '好的' }])
    await runAgentTurn({ messages, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts[0]).toContain('第一问')
    expect(t.prompts[0]).toContain('第二问')
    expect(t.prompts[0]).not.toContain('第一答')
    expect(loadSessionSnapshot(file)[key].sentCount).toBe(messages.length)
  })

  it('无持久化文件（全新进程）时仍按 last-assistant 启发式起跳，行为不回退', async () => {
    process.env.SESSIONS_FILE = path.join(dir, 'missing.json')
    delete process.env.NODE_ENV
    const t = fakeTransport([{ content: '好的' }])
    await runAgentTurn({ messages, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts[0]).toContain('第二问')
    expect(t.prompts[0]).not.toContain('第一问')
    expect(loadSessionSnapshot(path.join(dir, 'missing.json'))[key].sentCount).toBe(messages.length)
  })
})
