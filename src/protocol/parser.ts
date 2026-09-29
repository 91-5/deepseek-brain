import type { ToolSpec } from '../types.js'

export type ParseResult =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; tool: string; arguments: Record<string, unknown>; raw: string }

const FENCE_RE = /```tool_call\s*\n([\s\S]*?)```/g

/** 提取首个平衡花括号 JSON 对象并解析；失败返回 null */
function tryParseLoose(s: string): Record<string, unknown> | null {
  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

export function parseModelOutput(raw: string, tools: ToolSpec[]): ParseResult {
  const names = new Set(tools.map(t => t.name))
  FENCE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FENCE_RE.exec(raw)) !== null) {
    const obj = tryParseLoose(m[1])
    if (!obj) continue
    const tool = String(obj.tool ?? '')
    if (!names.has(tool)) continue
    const args = (obj.arguments && typeof obj.arguments === 'object' && !Array.isArray(obj.arguments))
      ? (obj.arguments as Record<string, unknown>) : {}
    return { kind: 'tool_call', tool, arguments: args, raw: m[0] }
  }
  return { kind: 'text', text: raw }
}

export function findFenceStart(text: string): number {
  return text.indexOf('```tool_call')
}
