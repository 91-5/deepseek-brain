import type { OpenAIMessage } from '../types.js'
import { estimateTokens } from './manager.js'

/** 超阈值时生成 compaction 指令（由 transport 发给 DeepSeek，纯文本，不涉及工具协议） */
export function buildCompactPrompt(messages: OpenAIMessage[]): string {
  const transcript = messages.map(m => `[${m.role}] ${m.content}`).join('\n')
  return `请将以下对话压缩为进展摘要，保留：任务目标、已完成事项、关键结论、待办。500字以内。\n\n${transcript}`
}

export function totalTokens(messages: OpenAIMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
}
