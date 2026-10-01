import { describe, it, expect } from 'vitest'
import { runAgentTurn, clampSentCount } from '../src/core/planner.js'
import type { Transport } from '../src/core/types.js'
import { loadConfig } from '../src/config.js'
import { createSessionStore } from '../src/core/session/store.js'
import { computeSessionKey } from '../src/core/session/manager.js'
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
    async health() { return { status: 'ok' as const, loggedIn: true } },
    lastChatSessionId() { return 'sess-1' },
    resetSession() {},
    async newChat() {},
    async cancel() {},
    getCapabilities() { return { supportsThinking: true, supportsResume: true, maxContextTokens: 64000 } },
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

describe('toolNameMap/clampSentCount 边界', () => {
  it('工具结果渲染用 assistant.tool_calls 里的真名', async () => {
    const msgs: OpenAIMessage[] = [
      { role: 'user', content: '跑一下搜索' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_7', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
      { role: 'tool', content: '结果A', tool_call_id: 'call_7' },
      { role: 'user', content: '继续' },
    ]
    const t = fakeTransport([[{ content: '收到' }]])
    await runAgentTurn({ messages: msgs, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts[0]).toContain('[工具 web_search 返回]')
    expect(t.prompts[0]).not.toContain('call_7')
  })
  it('assistant 之后的 user 轮：delta 只含触发轮的 user 消息', async () => {
    const msgs: OpenAIMessage[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '回退后的新问题' },
    ]
    const t = fakeTransport([[{ content: '答' }]])
    await runAgentTurn({ messages: msgs, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts[0]).toContain('回退后的新问题')
    expect(t.prompts[0]).not.toContain('第一问')
  })
it('clampSentCount：正常值不动、无 user 时取全长', () => {
    expect(clampSentCount(1, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }])).toBe(1)
    expect(clampSentCount(99, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }])).toBe(2)
    expect(clampSentCount(0, [{ role: 'user', content: 'a' }])).toBe(0)
    expect(clampSentCount(5, [{ role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b' }])).toBe(2)
  })
})

// 阈值链：deps.threshold > COMPACT_THRESHOLD env > config 默认 40000。
// env 那一腿由 loadConfig 读进 config.compactTokenThreshold，所以 planner 侧
// 只需 deps.threshold ?? config.compactTokenThreshold 一处表达式即可覆盖整条链。
describe('compaction 阈值优先级', () => {
  const small: OpenAIMessage[] = [{ role: 'user', content: 'x'.repeat(200) }] // ≈100 估算 token

  function compactsUnder(threshold: number | undefined, config: ReturnType<typeof loadConfig>): Promise<boolean> {
    const t = fakeTransport([[{ content: '摘要内容' }], [{ content: '好' }]])
    return runAgentTurn({ messages: small, tools: TOOLS, transport: t, config, deps: { threshold } })
      .then(() => t.prompts.length > 1)
  }

  it('deps.threshold 生效：调低阈值即触发 compaction', async () => {
    // cfg 默认 40000，不会触发；注入 10 后必须触发
    expect(await compactsUnder(10, cfg)).toBe(true)
  })

  it('deps.threshold 调高到极大值时不再 compaction（默认 40000 本就不触发）', async () => {
    expect(await compactsUnder(Number.MAX_SAFE_INTEGER, cfg)).toBe(false)
  })

  it('第 2 腿 COMPACT_THRESHOLD env 生效（经 loadConfig 注入）', async () => {
    const envCfg = loadConfig({ COMPACT_THRESHOLD: '10' })
    expect(envCfg.compactTokenThreshold).toBe(10)
    expect(await compactsUnder(undefined, envCfg)).toBe(true)
  })

  it('第 3 腿 config 默认值仍是 40000（不得改成 maxContextTokens=64000）', () => {
    expect(cfg.compactTokenThreshold).toBe(40000)
    expect(loadConfig({}).compactTokenThreshold).toBe(40000)
    expect(loadConfig({ COMPACT_THRESHOLD: '' }).compactTokenThreshold).toBe(40000)
  })

  it('deps.threshold 优先于 env：env=10 但 deps=99999 时不触发', async () => {
    const envCfg = loadConfig({ COMPACT_THRESHOLD: '10' })
    expect(await compactsUnder(Number.MAX_SAFE_INTEGER, envCfg)).toBe(false)
  })
})

// 注入点本身：store 与 keyStrategy 接管后，planner 不再读 env / 不再用内置哈希
describe('PlannerDeps 注入', () => {
  it('deps.store 接管会话表，keyStrategy 决定落库用的 key', async () => {
    const store = createSessionStore(null)
    const t = fakeTransport([[{ content: '答' }]])
    await runAgentTurn({
      messages: baseMsgs,
      tools: TOOLS,
      transport: t,
      config: cfg,
      deps: { store, keyStrategy: () => 'my-key' },
    })
    expect(store.get('my-key')).toMatchObject({ chatSessionId: 'sess-1' })
    expect(store.keys()).toEqual(['my-key'])
  })

  it('不传 deps 时默认策略与存量 key 语义一致（prefix 哈希）', async () => {
    const store = createSessionStore(null)
    const t = fakeTransport([[{ content: '答' }]])
    await runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg, deps: { store } })
    expect(store.get(computeSessionKey(baseMsgs))).toMatchObject({ chatSessionId: 'sess-1' })
  })
})
