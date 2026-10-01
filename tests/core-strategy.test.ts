import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prefixHashStrategy, statelessStrategy } from '../src/core/session/strategy.js'
import { computeSessionKey } from '../src/core/session/manager.js'
import { createSessionStore, loadSessionSnapshot, saveSessionSnapshot } from '../src/core/session/store.js'
import type { OpenAIMessage } from '../src/types.js'

const msgs: OpenAIMessage[] = [
  { role: 'user', content: '第一句' },
  { role: 'assistant', content: '回复' },
  { role: 'user', content: '第二句' },
]

describe('SessionKeyStrategy', () => {
  it('prefixHash 对相同前缀产生相同 key', () => {
    expect(prefixHashStrategy(msgs.slice(0, 2))).toBe(prefixHashStrategy(msgs))
  })
  it('stateless 对任何输入恒返回同一 key', () => {
    expect(statelessStrategy(msgs)).toBe(statelessStrategy([]))
  })

  // 迁移必须零语义漂移：前缀策略一旦换算法（first user vs last user），
  // 在用的 .sessions.json 里已持久化的 key 会全部失配，历史会话不再命中、
  // 静默退化成每次开新会话。此断言是迁移的安全网。
  it('prefixHashStrategy 与 computeSessionKey 逐输入一致', () => {
    const cases: OpenAIMessage[][] = [
      [],
      msgs,
      msgs.slice(0, 2),
      msgs.slice(0, 1),
      [{ role: 'user', content: '只有 user' }],
      [{ role: 'assistant', content: '无 user 前缀' }],           // 无 user：现有语义取全部
      [{ role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b' }],
      [{ role: 'system', content: 'sys' }, { role: 'user', content: 'u' }, { role: 'tool', content: 't', tool_call_id: 'c1' }],
    ]
    for (const c of cases) {
      expect(prefixHashStrategy(c), JSON.stringify(c)).toBe(computeSessionKey(c))
    }
  })
})

describe('SessionStore 落盘格式兼容', () => {
  let dir = ''
  let file = ''
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsb-store-'))
    file = path.join(dir, '.sessions.json')
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  // Task 3 把 store 接口化，但 .sessions.json 已有真实会话在用。
  // 断言「两个方向的读写都还认旧格式」——格式一变就是静默丢状态。
  it('新代码写入 → 旧读取函数认得，且字节结构不变', () => {
    const s = createSessionStore(file)
    s.set('k1', { chatSessionId: 'abc', sentCount: 3 })

    const raw = fs.readFileSync(file, 'utf-8')
    expect(JSON.parse(raw)).toEqual({ k1: { chatSessionId: 'abc', sentCount: 3 } })
    // 与 v0.1 的落盘形状逐字节对齐：2 空格缩进 + 结尾换行
    expect(raw).toBe(JSON.stringify({ k1: { chatSessionId: 'abc', sentCount: 3 } }, null, 2) + '\n')

    expect(loadSessionSnapshot(file)).toEqual({ k1: { chatSessionId: 'abc', sentCount: 3 } })
  })

  it('旧格式文件 → 新 store 原样读回（不丢字段、不改 key）', () => {
    const legacy = { oldKey: { chatSessionId: '91ab47ac-cb34-48ce-9145-15592b6879fe', sentCount: 1 } }
    fs.writeFileSync(file, JSON.stringify(legacy, null, 2) + '\n', 'utf-8')

    const s = createSessionStore(file)
    expect(s.get('oldKey')).toEqual(legacy.oldKey)
    expect(s.keys()).toEqual(['oldKey'])
    expect(s.snapshot()).toEqual(legacy)
  })

  it('存量 key 与 prefixHashStrategy 产出的 key 完全对得上', () => {
    const key = prefixHashStrategy(msgs)
    saveSessionSnapshot(file, { [key]: { chatSessionId: 'sess-1', sentCount: 2 } })

    const s = createSessionStore(file)
    expect(s.get(key)).toEqual({ chatSessionId: 'sess-1', sentCount: 2 })
    // 换用 computeSessionKey 查同一份存量文件也必须命中（两者算法等价）
    expect(s.get(computeSessionKey(msgs))).toEqual({ chatSessionId: 'sess-1', sentCount: 2 })
  })
})
