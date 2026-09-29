import { createHash } from 'node:crypto'
import type { OpenAIMessage } from '../types.js'

/**
 * 会话键：第一条 user 消息之前的前缀（system/preamble）哈希。
 * 后续轮追加 user/assistant/tool 不改变前缀 → key 稳定 → 复用同一 DeepSeek 会话；
 * compaction/系统提示改写前缀 → key 失效 → 开新会话。
 */
export function computeSessionKey(messages: OpenAIMessage[]): string {
  const cutoff = messages.findIndex(m => m.role === 'user')
  const prefix = cutoff === -1 ? messages : messages.slice(0, cutoff)
  return createHash('sha256').update(JSON.stringify(prefix)).digest('hex')
}

export function newMessagesSince(messages: OpenAIMessage[], sentCount: number): OpenAIMessage[] {
  return messages.slice(sentCount)
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2)
}
