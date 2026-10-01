import type { OpenAIMessage } from '../../types.js'
import { computeSessionKey } from './manager.js'

/** 会话 key 策略：把 OpenCode 会话映射到后端会话的规则。
 *  可替换——无状态后端（每次调用独立）没有 session 概念，用 statelessStrategy。 */
export type SessionKeyStrategy = (messages: OpenAIMessage[]) => string

/**
 * 默认策略：截至并包含**第一条** user 消息的前缀哈希。
 *
 * 直接委托给 computeSessionKey 而非重写一遍：算法一旦分叉（first vs last user、
 * 无 user 时取全部还是取首条），在用的 .sessions.json 里已持久化的 key 会全部失配，
 * 历史会话不再命中、静默退化成每次开新会话。委托让两者不可能漂移。
 * tests/core-strategy.test.ts 的逐输入一致性断言是这个决定的守卫。
 */
export const prefixHashStrategy: SessionKeyStrategy = messages => computeSessionKey(messages)

/**
 * 无状态后端策略：忽略历史，恒定 key。
 * 仅适用于本身没有会话概念、每次调用都独立的后端；若与支持 resume 的后端搭配，
 * 所有会话会挤进同一条记录互相覆盖。supportsResume 为 true 时用 prefixHashStrategy。
 */
export const statelessStrategy: SessionKeyStrategy = () => 'stateless'
