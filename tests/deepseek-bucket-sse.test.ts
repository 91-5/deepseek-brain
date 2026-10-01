import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bucketSSE, createSseCursor, feedSse } from '../src/transports/deepseek-web.js'

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

/**
 * (b) 增量消费。
 *
 * generate() 每 400ms 轮询一次，若每次都把全量 resp 重新喂给 bucketSSE，
 * 一条 N 字节的流会被反复重新解析，总代价 O(N²)。cursor 只解析新增部分。
 *
 * **验收标准是等价性**：分多次喂入与一次喂入整份，在**每一次**中间步都必须
 * 完全相同——不只是最终结果相同。因为 generate() 靠 emittedC/emittedR
 * 切片产出增量，中间步若偏早/偏晚就会改变流式行为（熔断线所在）。
 */
describe('增量 SSE 消费（等价性）', () => {
  /** 用真实 fixture 做等价性检验 */
  it('真实 fixture：分片喂入与整份喂入，每一步结果都相同', () => {
    const whole = bucketSSE(ENTRY0)
    const cuts = [1, 500, 5000, 20000, ENTRY0.length - 1, ENTRY0.length]
    let cursor = createSseCursor()
    let prev = ''
    for (const cut of cuts) {
      const chunk = ENTRY0.slice(prev.length, cut)
      prev = ENTRY0.slice(0, cut)
      const inc = feedSse(cursor, prev)
      // 每一中间步都必须等于「对当前前缀做整份解析」的结果
      expect(inc.reasoning, `cut=${cut}`).toBe(bucketSSE(prev).reasoning)
      expect(inc.content, `cut=${cut}`).toBe(bucketSSE(prev).content)
    }
    expect(cursor.reasoning).toBe(whole.reasoning)
    expect(cursor.content).toBe(whole.content)
  })

  it('构造流：任意切点逐一切分，结果恒等于整份解析', () => {
    const sse = stream(['思考A', '思考B', '思考C'], ['答案1', '答案2', '答案3'], { seed: '我是' })
    for (let cut = 0; cut <= sse.length; cut++) {
      const cursor = createSseCursor()
      feedSse(cursor, sse.slice(0, cut))
      expect(cursor.reasoning, `cut=${cut}`).toBe(bucketSSE(sse.slice(0, cut)).reasoning)
      expect(cursor.content, `cut=${cut}`).toBe(bucketSSE(sse.slice(0, cut)).content)
    }
  })

  it('continuation 形态（无 p/o 的延续行）切分也等价', () => {
    const sse = stream(['想1', '想2'], ['答1', '答2'], { continuation: true, seed: '我' })
    for (let cut = 0; cut <= sse.length; cut++) {
      const cursor = createSseCursor()
      feedSse(cursor, sse.slice(0, cut))
      expect(cursor.content, `cut=${cut}`).toBe(bucketSSE(sse.slice(0, cut)).content)
    }
  })

  // 半行缓冲是核心：XHR 在任意字节处截断，最后一行必然常常是半行。
  // 若把半行当成完整行提交，下一片会把它当新行再解析一次 → 重复内容。
  it('半行不会被重复计入', () => {
    const sse = 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"AAAABBBBCCCC"}\n'
    const half = sse.length - 8
    const cursor = createSseCursor()
    feedSse(cursor, sse.slice(0, half))          // 第一片停在半行
    const mid = feedSse(cursor, sse)
    expect(mid.reasoning).toBe('AAAABBBBCCCC') // 没有 AAABBBB+AAABBBB
    expect(mid.reasoning).not.toContain('AAAAAAAA')
  })

  it('responseText 非前缀延伸（重定向/重试）时整体重解析，不拼脏数据', () => {
    const cursor = createSseCursor()
    const first = 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"第一份"}\n'
    feedSse(cursor, first)
    expect(cursor.reasoning).toBe('第一份')
    const second = 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"完全不同的"}\n'
    const r = feedSse(cursor, second)
    expect(r.reasoning).toBe('完全不同的')
    expect(r.reasoning).not.toContain('第一份')
  })

  it('无新增时重复喂入同一份 → 结果稳定不膨胀', () => {
    const cursor = createSseCursor()
    const sse = stream(['想'], ['答'], { seed: 'x' })
    feedSse(cursor, sse)
    const a = cursor.content
    feedSse(cursor, sse)
    feedSse(cursor, sse)
    expect(cursor.content).toBe(a)
    expect(cursor.content).not.toContain('xx')
  })

  it('cursor 始终不早于整份解析（generate() 靠它切片产出增量）', () => {
    const sse = stream(['思考', '继续'], ['答', '案'], { seed: 'S' })
    for (let cut = 1; cut <= sse.length; cut++) {
      const cursor = createSseCursor()
      feedSse(cursor, sse.slice(0, cut))
      const whole = bucketSSE(sse.slice(0, cut))
      expect(cursor.content.length).toBeLessThanOrEqual(whole.content.length)
      expect(cursor.reasoning.length).toBeLessThanOrEqual(whole.reasoning.length)
    }
  })

  /**
   * 最贴近真实的一例：generate() 每 400ms 轮询一次，落点**大概率落在行中间**，
   * 于是同一个 cursor 会连续收到多份「停在半行」的前缀。
   *
   * 单切点用例抓不到半行缓冲的 bug——一次喂半行、再喂整份时，
   * 越界的 offset 会被非前缀守卫发现并触发整体重解析，输出照样正确（只是慢）。
   * 必须连续多刀切在同一行内部，才会暴露「半行被当整行提交 → 下一刀从行中间
   * 开始解析 → 整行丢失」。
   */
  it('连续多刀切在同一行内部，结果仍等于整份解析', () => {
    const sse = stream(['第一段思考', '第二段思考', '第三段思考'], ['第一段答案', '第二段答案', '第三段答案'], { seed: 'Q' })
    const whole = bucketSSE(sse)
    const cuts: number[] = []
    for (let i = 1; i < sse.length; i += 7) cuts.push(i) // 步长刻意与行长不同步，保证落在行内
    cuts.push(sse.length)
    const cursor = createSseCursor()
    let prevLen = 0
    for (const cut of cuts) {
      feedSse(cursor, sse.slice(0, cut))
      prevLen = cut
    }
    expect(prevLen).toBe(sse.length)
    expect(cursor.reasoning).toBe(whole.reasoning)
    expect(cursor.content).toBe(whole.content)
  })

  it('逐刀校验：连续半行轮询下每一步都不丢内容（无重复、无丢失）', () => {
    const sse = stream(['甲乙丙丁戊己庚辛'], ['一二三四五六七八九十'], { continuation: true })
    const cursor = createSseCursor()
    const seen: string[] = []
    for (let cut = 1; cut <= sse.length; cut++) {
      const r = feedSse(cursor, sse.slice(0, cut))
      seen.push(r.content)
      // 视图必须始终等于整份解析：既不丢（>= 整份对同前缀的值），也不重复膨胀
      expect(r.content, `cut=${cut}`).toBe(bucketSSE(sse.slice(0, cut)).content)
    }
    // 逐拍产出的增量拼起来 == 最终全文
    let acc = ''
    for (const s of seen) if (s.length > acc.length) acc = s
    expect(acc).toBe(bucketSSE(sse).content)
  })
})
