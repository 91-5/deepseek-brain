import { describe, it, expect } from 'vitest'
import { runAgentTurn } from '../src/pipeline.js'
import type { Transport } from '../src/transport/types.js'
import { loadConfig } from '../src/config.js'
import type { OpenAIMessage, ToolSpec } from '../src/types.js'

const TOOLS: ToolSpec[] = [{ name: 'read_file', description: '读', parameters: {} }]
const cfg = loadConfig({ COMPACT_THRESHOLD: '20' }) // 强制触发 compaction

describe('compaction', () => {
  it('超阈值时摘要并重开会话', async () => {
    let newChats = 0
    const prompts: string[] = []
    const t: Transport = {
      async *generate(req) {
        prompts.push(req.prompt)
        if (req.prompt.includes('压缩为进展摘要')) { yield { content: '摘要：已完成ABC' }; return }
        yield { content: `收到:${req.prompt.slice(0, 30)}` }
      },
      async newChat() { newChats++ },
      async health() { return 'ok' as const },
      lastChatSessionId() { return 's2' },
      resetSession() {},
    }
    const messages: OpenAIMessage[] = [
      { role: 'user', content: '第一轮任务'.repeat(5) },
      { role: 'assistant', content: '进展'.repeat(5) },
      { role: 'tool', content: '结果'.repeat(5), tool_call_id: 'c1' },
      { role: 'user', content: '继续' },
    ]
    const r = await runAgentTurn({ messages, tools: TOOLS, transport: t, config: cfg })
    expect(newChats).toBe(1)
    expect(prompts.some(p => p.includes('压缩为进展摘要'))).toBe(true)
    expect(prompts.some(p => p.includes('【进展摘要】摘要：已完成ABC'))).toBe(true)
  })
  it('未超阈值不开新会话', async () => {
    let newChats = 0
    const t: Transport = {
      async *generate() { yield { content: '普通回答' } },
      async newChat() { newChats++ },
      async health() { return 'ok' as const },
      lastChatSessionId() { return null },
      resetSession() {},
    }
    const r = await runAgentTurn({ messages: [{ role: 'user', content: '短问' }], tools: TOOLS, transport: t, config: loadConfig({}) })
    expect(newChats).toBe(0)
    expect(r.content).toBe('普通回答')
  })
})
