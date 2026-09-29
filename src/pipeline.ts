import type { AppConfig } from './config.js'
import type { OpenAIMessage, ToolCall, ToolSpec } from './types.js'
import { buildSystemPrompt } from './protocol/system-prompt.js'
import { parseModelOutput, findFenceStart, type ParseResult } from './protocol/parser.js'
import { renderToolResult } from './protocol/tool-result.js'
import type { Transport } from './transport/types.js'
import { computeSessionKey, newMessagesSince } from './session/manager.js'

const FENCE_OPEN = '```tool_call'

const FIX_HINT = '格式不正确。请严格按协议重新输出一个 ```tool_call 代码块，内含一个合法 JSON 对象：{"tool":"<工具名>","arguments":{...}}。'

export class FormatGiveUpError extends Error {
  constructor() { super('format_give_up: 模型连续输出无法解析的工具调用'); this.name = 'FormatGiveUpError' }
}

interface SessionEntry { chatSessionId: string | null; sentCount: number }

/** 会话表：OpenCode 会话 key → DeepSeek 会话状态。单进程内存态。 */
const sessions = new Map<string, SessionEntry>()

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

/** 首轮只校验首个完整 fence（协议口径「首个 ```tool_call 代码块」）：首个 fence 解析失败即判格式错误 */
function parseFirstFence(raw: string, tools: ToolSpec[]): ParseResult {
  const start = findFenceStart(raw)
  if (start === -1) return { kind: 'text', text: raw }
  const close = raw.indexOf('```', start + FENCE_OPEN.length)
  const end = close === -1 ? raw.length : close + 3
  return parseModelOutput(raw.slice(start, end), tools)
}

/** delta 只取 user/tool 消息：assistant 的历史动作网页会话里模型自己已见过 */
function buildPrompt(delta: OpenAIMessage[], tools: ToolSpec[], withFixHint: boolean, toolMaxChars: number): string {
  const sys = buildSystemPrompt(tools)
  const parts = [sys]
  for (const m of delta) {
    if (m.role === 'tool') parts.push(renderToolResult(m.tool_call_id ?? 'unknown', m.content, toolMaxChars))
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
  const entry = sessions.get(key) ?? { chatSessionId: null, sentCount: initialSentCount(messages) }
  const delta = newMessagesSince(messages, entry.sentCount)
    .filter(m => m.role === 'user' || m.role === 'tool')

  let content = '', reasoning = '', usageTokens = 0
  for (let attempt = 0; attempt <= config.maxFormatRetries; attempt++) {
    content = ''; reasoning = ''
    const iter = transport.generate({
      prompt: buildPrompt(delta, tools, attempt > 0, config.toolResultMaxChars),
      thinking: config.thinking,
      timeoutMs: config.thinking ? config.thinkingTimeoutMs : config.timeoutMs,
    })
    for await (const chunk of iter) {
      if (chunk.reasoning) reasoning += chunk.reasoning
      if (chunk.content) content += chunk.content
      usageTokens += Math.ceil(((chunk.reasoning ?? '') + (chunk.content ?? '')).length / 2)
    }
    const parsed = attempt === 0 ? parseFirstFence(content, tools) : parseModelOutput(content, tools)
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
  const finalParsed = parseModelOutput(content, tools)
  if (finalParsed.kind === 'text' && !content.includes(FENCE_OPEN)) {
    sessions.set(key, { chatSessionId: transport.lastChatSessionId(), sentCount: messages.length })
    return { content: finalParsed.text, reasoning, usageTokens }
  }
  throw new FormatGiveUpError()
}
