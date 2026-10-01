import { describe, it, expect } from 'vitest'
import { parseModelOutput, findFenceStart } from '../src/core/protocol/parser.js'
import type { ToolSpec } from '../src/types.js'

const TOOLS: ToolSpec[] = [{ name: 'read_file', description: '读', parameters: {} }]

describe('parseModelOutput', () => {
  it('纯文本返回 text', () => {
    const r = parseModelOutput('你好，直接回答', TOOLS)
    expect(r).toEqual({ kind: 'text', text: '你好，直接回答' })
  })
  it('合法 tool_call fence 返回结构化调用', () => {
    const raw = '好的。\n```tool_call\n{"tool":"read_file","arguments":{"path":"a.md"}}\n```\n'
    const r = parseModelOutput(raw, TOOLS)
    expect(r).toEqual({ kind: 'tool_call', tool: 'read_file', arguments: { path: 'a.md' }, raw: '```tool_call\n{"tool":"read_file","arguments":{"path":"a.md"}}\n```' })
  })
  it('参数缺省时给空对象', () => {
    const raw = '```tool_call\n{"tool":"read_file"}\n```'
    const r = parseModelOutput(raw, TOOLS)
    expect(r).toEqual({ kind: 'tool_call', tool: 'read_file', arguments: {}, raw: '```tool_call\n{"tool":"read_file"}\n```' })
  })
  it('残缺 JSON 当作正文', () => {
    const raw = '```tool_call\n{"tool":"read_file", "path"\n```'
    const r = parseModelOutput(raw, TOOLS)
    expect(r.kind).toBe('text')
  })
  it('工具不在目录中当作正文', () => {
    const raw = '```tool_call\n{"tool":"hack","arguments":{}}\n```'
    const r = parseModelOutput(raw, TOOLS)
    expect(r.kind).toBe('text')
  })
  it('多个 fence 时取第一个合法的', () => {
    const raw = '```tool_call\n{"tool":"bad"}\n```\n```tool_call\n{"tool":"read_file"}\n```'
    const r = parseModelOutput(raw, TOOLS)
    expect(r).toMatchObject({ kind: 'tool_call', tool: 'read_file' })
  })
})
describe('findFenceStart', () => {
  it('找到起始下标', () => {
    expect(findFenceStart('abc```tool_call\n{}')).toBe(3)
  })
  it('没有返回 -1', () => {
    expect(findFenceStart('普通文本')).toBe(-1)
  })
})
