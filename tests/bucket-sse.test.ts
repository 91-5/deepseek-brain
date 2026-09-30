import { describe, it, expect } from 'vitest'
import { bucketSSE } from '../src/transport/web-bridge.js'

// fixture 来自 2026-09-29 spike 实测 SSE
const FIXTURE = [
  'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"针"}',
  'data: {"v":"正常"}',
  'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":94},{"p":"quasi_status","v":"FINISHED"}]}',
  'data: {"p":"response/status","o":"SET","v":"FINISHED"}',
  'event: close',
].join('\n')

describe('bucketSSE', () => {
  it('拼接 content 分桶且忽略非字符串 v', () => {
    expect(bucketSSE(FIXTURE).content).toBe('针正常')
  })
  it('thinking 路径归 reasoning', () => {
    const sse = 'data: {"p":"response/fragments/0/thinking","v":"想"}\ndata: {"p":"response/fragments/0/thinking","v":"了"}'
    expect(bucketSSE(sse).reasoning).toBe('想了')
  })
})
