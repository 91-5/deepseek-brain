import { describe, it, expect } from 'vitest'
import { runAgentTurn } from '../src/pipeline.js'
import type { Transport } from '../src/transport/types.js'
import { loadConfig } from '../src/config.js'
import type { OpenAIMessage, ToolSpec } from '../src/types.js'

const TOOLS: ToolSpec[] = [{ name: 'read_file', description: '读', parameters: {} }]
const cfg = loadConfig({})

/** 每次 generate 返回 attempts[i]（最后一次重复）：模拟多轮独立回复 */
function fakeTransport(attempts: Array<Array<{ reasoning?: string; content?: string }>>): Transport & { prompts: string[] } {
  const prompts: string[] = []
  let call = 0
  return {
    prompts,
    async *generate(req) {
      prompts.push(req.prompt)
      const chunks = attempts[Math.min(call, attempts.length - 1)]
      call++
      for (const c of chunks) yield c
    },
    async health() { return 'ok' as const },
    lastChatSessionId() { return 'sess-1' },
    resetSession() {},
    async newChat() {},
  }
}

const baseMsgs: OpenAIMessage[] = [{ role: 'user', content: '读一下 README' }]

describe('runAgentTurn', () => {
  it('解析出 tool_call', async () => {
    const t = fakeTransport([[{ content: '好的，调用工具。\n```tool_call\n{"tool":"read_file","arguments":{"path":"README.md"}}\n```' }]])
    const r = await runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg })
    expect(r.toolCall).toMatchObject({ name: 'read_file', arguments: { path: 'README.md' } })
    expect(r.content).toContain('好的，调用工具。')
    expect(r.content).not.toContain('```tool_call')
    expect(t.prompts[0]).toContain('```tool_call')
    expect(t.prompts[0]).toContain('读一下 README')
  })
  it('格式错误自动修正重试一次', async () => {
    const t = fakeTransport([
      [{ content: '```tool_call\n{"tool":"read_file",坏}\n```' }],
      [{ content: '```tool_call\n{"tool":"read_file","arguments":{}}\n```' }],
    ])
    const r = await runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts).toHaveLength(2)
    expect(t.prompts[1]).toContain('格式不正确')
    expect(r.toolCall).toMatchObject({ name: 'read_file' })
  })
  it('重试耗尽则抛 FormatGiveUpError', async () => {
    const t = fakeTransport([
      [{ content: '```tool_call\n{"tool":\n```' }],
      [{ content: '```tool_call\n{坏\n```' }],
      [{ content: '```tool_call\n仍然坏\n```' }],
    ])
    await expect(runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg }))
      .rejects.toThrow(/format_give_up/)
  })
  it('纯文本回答无 toolCall', async () => {
    const t = fakeTransport([[{ reasoning: '想一下' }, { content: '答案是 42' }]])
    const r = await runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg })
    expect(r.toolCall).toBeUndefined()
    expect(r.reasoning).toBe('想一下')
    expect(r.content).toBe('答案是 42')
  })
  it('后续轮只发增量（不重发历史）', async () => {
    const t = fakeTransport([[{ content: '第二轮回答' }]])
    const messages: OpenAIMessage[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'tool', content: '[工具结果] X', tool_call_id: 'c1' },
      { role: 'user', content: '第二问' },
    ]
    const r = await runAgentTurn({ messages, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts[0]).toContain('第二问')
    expect(t.prompts[0]).not.toContain('第一问')
  })
})
