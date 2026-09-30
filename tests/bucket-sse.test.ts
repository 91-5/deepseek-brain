import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bucketSSE } from '../src/transport/web-bridge.js'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** 真实抓包 fixture：2026-09-30 首跑，DeepSeek 深度思考模式下 /chat/completion 的 SSE 全文 */
const ENTRY0 = fs.readFileSync(path.join(fixturesDir, 'deepseek-sse-entry0.txt'), 'utf-8')

/** 构造最小合法流：思考 delta ×N → RESPONSE 数组快照 → 答案 delta ×N → FINISHED。
 *  continuation=true 时首行带 p/o、后续行只有 v（JSON-Patch 增量流实测形态） */
function stream(think: string[], answer: string[], opts: { seed?: string; continuation?: boolean } = {}): string {
  const lines: string[] = []
  think.forEach((t, i) => {
    const withOp = !opts.continuation || i === 0
    lines.push(withOp
      ? `data: ${JSON.stringify({ p: 'response/fragments/-1/content', o: 'APPEND', v: t })}`
      : `data: ${JSON.stringify({ v: t })}`)
  })
  lines.push(`data: ${JSON.stringify({ p: 'response/fragments/-1/elapsed_secs', o: 'SET', v: '1.65' })}`)
  lines.push(`data: ${JSON.stringify({ p: 'response/fragments', o: 'APPEND', v: [{ id: 3, type: 'RESPONSE', content: opts.seed ?? '' }] })}`)
  answer.forEach((a, i) => {
    const withOp = !opts.continuation || i === 0
    lines.push(withOp
      ? `data: ${JSON.stringify({ p: 'response/fragments/-1/content', o: 'APPEND', v: a })}`
      : `data: ${JSON.stringify({ v: a })}`)
  })
  lines.push('data: {"p":"response","o":"BATCH","v":"[{\\"p\\":\\"accumulated_token_usage\\",\\"v\\":164}]"}')
  lines.push('data: {"p":"response/status","o":"SET","v":"FINISHED"}')
  lines.push('event: close')
  return lines.join('\n')
}

describe('bucketSSE（真实 fixture：entry0 首跑抓包）', () => {
  it('思考进 reasoning，答案进 content', () => {
    const b = bucketSSE(ENTRY0)
    expect(b.reasoning).toContain('回答用户。用户要求')
    expect(b.reasoning.length).toBeGreaterThan(300)
    expect(b.content).toContain('负责任务规划与工具调用编排的大脑')
    expect(b.content.startsWith('我是')).toBe(true) // 数组快照 seed 前缀
  })
  it('元数据（elapsed_secs/usage/status）不污染正文', () => {
    const b = bucketSSE(ENTRY0)
    expect(b.content).not.toContain('1.65')
    expect(b.content).not.toContain('accumulated_token_usage')
    expect(b.content).not.toContain('FINISHED')
    expect(b.reasoning).not.toContain('1.65')
  })
  it('思考与答案分流有效（CoT 会草拟答案，跨包含不成立，验证起点与相异）', () => {
    const b = bucketSSE(ENTRY0)
    expect(b.reasoning.startsWith('回答用户。用户要求')).toBe(true)
    expect(b.content).not.toBe(b.reasoning)
    expect(b.content.length).toBeLessThan(b.reasoning.length * 2)
    expect(b.content).toContain('通过用户指令') // 最终答案收尾
  })
})

describe('bucketSSE（协议单元）', () => {
  it('RESPONSE 快照后分流：思考 reasoning / 答案 content', () => {
    const b = bucketSSE(stream(['思考A', '思考B'], ['答案1', '答案2']))
    expect(b.reasoning).toBe('思考A思考B')
    expect(b.content).toBe('答案1答案2')
  })
  it('无 p/o 的延续行归属上一个 content 路径（JSON-Patch 增量流）', () => {
    const b = bucketSSE(stream(['思考A'], ['答案1'], { continuation: true }))
    expect(b.reasoning).toBe('思考A')
    expect(b.content).toBe('答案1')
  })
  it('数组快照 seed 与增量不叠字', () => {
    const b = bucketSSE(stream(['想'], ['负责任务'], { seed: '我是' }))
    expect(b.content).toBe('我是负责任务')
    const b2 = bucketSSE(stream(['想'], ['我是负责任务'], { seed: '我是' }))
    expect(b2.content).toBe('我是负责任务') // 增量已含 seed 前缀时不重复
  })
  it('无 RESPONSE 快照：bucketSSE 全部进 reasoning（兜底在 generate() 流末做，局部不挪）', () => {
    const sse = 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"直接答案"}\ndata: {"p":"response/status","o":"SET","v":"FINISHED"}'
    const b = bucketSSE(sse)
    expect(b.reasoning).toBe('直接答案')
    expect(b.content).toBe('')
  })
})
