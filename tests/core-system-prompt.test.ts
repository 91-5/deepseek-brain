import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../src/core/protocol/system-prompt'
import type { ToolSpec } from '../src/types'

describe('buildSystemPrompt', () => {
  it('包含工具目录与调用协议', () => {
    const tools: ToolSpec[] = [
      { name: 'read_file', description: '读文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    ]
    const p = buildSystemPrompt(tools)
    expect(p).toContain('```tool_call')
    expect(p).toContain('"read_file"')
    expect(p).toContain('读文件')
    expect(p).toContain('每次只调一个工具')
  })
  it('空工具列表也给出协议', () => {
    const p = buildSystemPrompt([])
    expect(p).toContain('```tool_call')
    expect(p).toContain('可用工具：[]')
  })
})
