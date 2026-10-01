import { createHash } from 'node:crypto';
/**
 * 会话键：截至并包含第一条 user 消息的前缀哈希（无 user 则取全部）。
 * 后续轮追加 assistant/tool/user 不改前缀 → key 稳定 → 复用同一 DeepSeek 会话；
 * 不同对话首条 user 不同 → key 不同，互不串扰；
 * compaction/系统提示改写前缀 → key 失效 → 开新会话。
 */
export function computeSessionKey(messages) {
    const firstUser = messages.findIndex(m => m.role === 'user');
    const prefix = firstUser === -1 ? messages : messages.slice(0, firstUser + 1);
    return createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
}
export function newMessagesSince(messages, sentCount) {
    return messages.slice(sentCount);
}
export function estimateTokens(text) {
    return Math.ceil(text.length / 2);
}
