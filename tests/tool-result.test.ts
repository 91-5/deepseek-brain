import { describe, it, expect } from 'vitest'
import { renderToolResult } from '../src/protocol/tool-result.js'

describe('renderToolResult', () => {
  it('渲染带标记的结果', () => {
    expect(renderToolResult('read_file', '内容A', 4000))
      .toBe('[工具 read_file 返回]\n内容A\n[/返回]')
  })
  it('超长截断并标注', () => {
    const long = 'x'.repeat(50)
    const out = renderToolResult('bash', long, 10)
    expect(out).toBe('[工具 bash 返回]\nxxxxxxxxxx\n...（截断，原长 50 字符）\n[/返回]')
  })
})
