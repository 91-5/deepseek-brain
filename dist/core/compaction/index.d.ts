import type { OpenAIMessage } from '../../types.js';
/** 超阈值时生成 compaction 指令（由 transport 发给 DeepSeek，纯文本，不涉及工具协议） */
export declare function buildCompactPrompt(messages: OpenAIMessage[]): string;
export declare function totalTokens(messages: OpenAIMessage[]): number;
