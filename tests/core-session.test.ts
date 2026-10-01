import { describe, it, expect } from 'vitest'
import { computeSessionKey, newMessagesSince, estimateTokens } from '../src/core/session/manager.js'
import { buildCompactPrompt, totalTokens } from '../src/core/compaction/index.js'
import type { OpenAIMessage } from '../src/types.js'

const msgs: OpenAIMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '问题一' },
]

describe('computeSessionKey', () => {
  it('追加消息后 key 不变（同会话）', () => {
    const k1 = computeSessionKey(msgs)
    const k2 = computeSessionKey([...msgs, { role: 'assistant', content: '答' }])
    expect(k1).toBe(k2)
  })
  it('历史内容变化 key 变化（compaction 场景）', () => {
    const k1 = computeSessionKey(msgs)
    const k2 = computeSessionKey([{ role: 'system', content: '摘要版' }, { role: 'user', content: '问题一' }])
    expect(k1).not.toBe(k2)
  })
  it('空输入也返回稳定 hash', () => {
    expect(computeSessionKey([])).toMatch(/^[a-f0-9]{64}$/)
  })
  it('不同会话（首条 user 不同）key 不同', () => {
    const k1 = computeSessionKey([{ role: 'system', content: 'sys' }, { role: 'user', content: '问题A' }])
    const k2 = computeSessionKey([{ role: 'system', content: 'sys' }, { role: 'user', content: '问题B' }])
    expect(k1).not.toBe(k2)
  })
})
describe('newMessagesSince', () => {
  it('返回 sentCount 之后的增量', () => {
    expect(newMessagesSince(msgs, 1)).toEqual([{ role: 'user', content: '问题一' }])
    expect(newMessagesSince(msgs, 2)).toEqual([])
  })
})
describe('estimateTokens', () => {
  it('粗略估算', () => {
    expect(estimateTokens('1234')).toBe(2)
    expect(estimateTokens('中文测试')).toBe(2)
  })
})
describe('compact helpers', () => {
  it('buildCompactPrompt 含三条记录', () => {
    const p = buildCompactPrompt(msgs)
    expect(p).toContain('[system] sys')
    expect(p).toContain('[user] 问题一')
    expect(p).toContain('压缩为进展摘要')
  })
  it('totalTokens 求和', () => {
    expect(totalTokens(msgs)).toBe(estimateTokens('sys') + estimateTokens('问题一'))
  })
})
