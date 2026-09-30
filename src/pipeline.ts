import type { AppConfig } from './config.js'
import type { OpenAIMessage, ToolCall, ToolSpec } from './types.js'
import { buildSystemPrompt } from './protocol/system-prompt.js'
import { parseModelOutput } from './protocol/parser.js'
import { renderToolResult } from './protocol/tool-result.js'
import type { Transport } from './transport/types.js'
import { computeSessionKey, newMessagesSince } from './session/manager.js'
import { createSessionStore, DEFAULT_SESSIONS_FILE, type SessionRecord, type SessionStore } from './session/store.js'
import { buildCompactPrompt, totalTokens } from './session/compact.js'

const FENCE_OPEN = '```tool_call'

const FIX_HINT = '格式不正确。请严格按协议重新输出一个 ```tool_call 代码块，内含一个合法 JSON 对象：{"tool":"<工具名>","arguments":{...}}。'

export class FormatGiveUpError extends Error {
  constructor() { super('format_give_up: 模型连续输出无法解析的工具调用'); this.name = 'FormatGiveUpError' }
}

/**
 * 会话表入口：每次调用按 env 新建 store 并从 .sessions.json hydration——
 * 进程重启后「OpenCode 会话 key → DeepSeek 会话」的映射不丢（绑定要求，
 * 否则 delta 会跳过历史造成上下文断裂）。
 * NODE_ENV=test（vitest）下退化为纯内存，避免单测污染仓库根。
 */
function openSessionStore(): SessionStore {
  if (process.env.NODE_ENV === 'test') return createSessionStore(null)
  return createSessionStore(process.env.SESSIONS_FILE ?? DEFAULT_SESSIONS_FILE)
}

export interface TurnResult {
  content: string
  reasoning: string
  toolCall?: ToolCall
  usageTokens: number
}

/**
 * 新会话 key 首次出现（首轮或进程重启后的续轮）时，assistant 消息是模型自己的回复、
 * DeepSeek 网页会话里必然已存在，视作已发送；无 assistant 则从头发送。
 * 有 entry 时以 entry.sentCount 为准（正常单进程流）。
 */
function initialSentCount(messages: OpenAIMessage[]): number {
  return messages.map(m => m.role).lastIndexOf('assistant') + 1
}

/**
 * sentCount 钳制：OpenCode 历史回退/取消时持久化 sentCount 可能超过当前 messages 长度，
 * 裸 slice 会得空 delta（整轮只发 system prompt → 垃圾回答）。钳到最后一条 user 消息下标，
 * 保证 delta 至少包含触发本轮的那条 user 消息（N3）。
 */
export function clampSentCount(stored: number, messages: OpenAIMessage[]): number {
  const lastUser = messages.map(m => m.role).lastIndexOf('user')
  return Math.min(stored, lastUser < 0 ? messages.length : lastUser)
}

/** tool_call_id → 工具名：从历史 assistant.tool_calls 建表，渲染工具结果时报真名（T6①） */
function toolNameMap(messages: OpenAIMessage[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) if (tc.function?.name) names.set(tc.id, tc.function.name)
    }
  }
  return names
}

/** delta 只取 user/tool 消息：assistant 的历史动作网页会话里模型自己已见过 */
function buildPrompt(delta: OpenAIMessage[], tools: ToolSpec[], withFixHint: boolean, toolMaxChars: number, toolNames: Map<string, string>): string {
  const sys = buildSystemPrompt(tools)
  const parts = [sys]
  for (const m of delta) {
    if (m.role === 'tool') {
      const name = toolNames.get(m.tool_call_id ?? '') ?? m.tool_call_id ?? 'unknown'
      parts.push(renderToolResult(name, m.content, toolMaxChars))
    }
    else parts.push(`[${m.role}] ${m.content}`)
  }
  if (withFixHint) parts.push(FIX_HINT)
  return parts.join('\n\n')
}

export async function runAgentTurn(opts: {
  messages: OpenAIMessage[]
  tools: ToolSpec[]
  transport: Transport
  config: AppConfig
}): Promise<TurnResult> {
  const { messages, tools, transport, config } = opts
  const key = computeSessionKey(messages)
  const sessions = openSessionStore()
  const stored = sessions.get(key) ?? { chatSessionId: null, sentCount: initialSentCount(messages) }
  const entry: SessionRecord = { chatSessionId: stored.chatSessionId, sentCount: clampSentCount(stored.sentCount, messages) }
  const delta = newMessagesSince(messages, entry.sentCount)
    .filter(m => m.role === 'user' || m.role === 'tool')

  let sendDelta = delta
  if (delta.length > 0 && totalTokens(messages) > config.compactTokenThreshold) {
    await transport.newChat()
    let summary = ''
    for await (const c of transport.generate({
      prompt: buildCompactPrompt(messages),
      thinking: false,
      timeoutMs: config.timeoutMs,
    })) { if (c.content) summary += c.content }
    sendDelta = [{ role: 'user', content: `【进展摘要】${summary}\n请在此基础上继续完成原任务。` }]
    sessions.set(key, { chatSessionId: null, sentCount: clampSentCount(0, sendDelta) })
  }

  let content = '', reasoning = '', usageTokens = 0
  for (let attempt = 0; attempt <= config.maxFormatRetries; attempt++) {
    content = ''; reasoning = ''
    const iter = transport.generate({
      prompt: buildPrompt(sendDelta, tools, attempt > 0, config.toolResultMaxChars, toolNameMap(messages)),
      thinking: config.thinking,
      timeoutMs: config.thinking ? config.thinkingTimeoutMs : config.timeoutMs,
    })
    for await (const chunk of iter) {
      if (chunk.reasoning) reasoning += chunk.reasoning
      if (chunk.content) content += chunk.content
      usageTokens += Math.ceil(((chunk.reasoning ?? '') + (chunk.content ?? '')).length / 2)
    }
    const parsed = parseModelOutput(content, tools)
    if (parsed.kind === 'tool_call') {
      const tc: ToolCall = { id: `call_${Date.now().toString(36)}`, name: parsed.tool, arguments: parsed.arguments }
      sessions.set(key, { chatSessionId: transport.lastChatSessionId(), sentCount: messages.length })
      const visible = content.replace(parsed.raw, '').trim()
      return { content: visible || '（调用工具）', reasoning, toolCall: tc, usageTokens }
    }
    if (!content.includes(FENCE_OPEN)) {
      sessions.set(key, { chatSessionId: transport.lastChatSessionId(), sentCount: messages.length })
      return { content, reasoning, usageTokens }
    }
    if (attempt === config.maxFormatRetries) break
  }
  throw new FormatGiveUpError()
}
