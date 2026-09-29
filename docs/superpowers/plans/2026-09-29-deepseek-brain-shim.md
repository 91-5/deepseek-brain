# DeepSeek Brain Shim — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建本地 OpenAI 兼容 Shim，让只能对话的 DeepSeek 网页版通过"文本协议工具调用"成为 OpenCode 的 subagent 大脑。

**Architecture:** 单体 Node 24 + TypeScript 进程：OpenAI 兼容 HTTP 层接收 OpenCode 请求，协议层把 tools[] 注入 system prompt 并解析模型文本为 tool_calls，transport 层（web-bridge）用 puppeteer-core 驱动 headful Chrome 访问 chat.deepseek.com 并以页内探针读取 SSE 流。多轮复用 DeepSeek 服务端会话（前缀哈希 delta 发送）。

**Tech Stack:** Node 24、TypeScript 5.x、puppeteer-core（复用系统 Chrome）、vitest、node:http。

**Spec:** `docs/superpowers/specs/2026-09-29-deepseek-brain-shim-design.md`

## Global Constraints

- Node >= 24（测试用 vitest；不下载浏览器：puppeteer-core + 系统 Chrome `C:\Users\15812\AppData\Local\Google\Chrome\Application\chrome.exe`）
- 不接官方 API（sir 明确决定），transport 仅 web-bridge
- 所有配置经 `src/config.ts` 的 `loadConfig()`
- 浏览器 profile 复制前置条件：操作时 Nuphus 受控 Chrome 需已关闭（profile 文件锁）
- 提交信息用 conventional commits（feat/fix/chore/test/docs）
- 每个任务完成时 `npm test` 与 `npm run typecheck` 必须全绿

---

### Task 1: 项目脚手架 + 配置模块

**Files:**
- Create: `package.json`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `AppConfig`（type）、`loadConfig(env?: Record<string,string|undefined>): AppConfig`；默认值：`port=8790, thinking=true, timeoutMs=240000, thinkingTimeoutMs=300000, sendClickSettleMs=8000, maxFormatRetries=2, compactTokenThreshold=40000, toolResultMaxChars=4000, browser={debugPort:9222, profileDir:".chrome-profile", headless:false}, log={level:"info", dir:"logs"}`

- [ ] **Step 1: 写失败测试**

```ts
// tests/config.test.ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  it('返回默认配置', () => {
    const c = loadConfig({})
    expect(c.port).toBe(8790)
    expect(c.thinking).toBe(true)
    expect(c.maxFormatRetries).toBe(2)
    expect(c.compactTokenThreshold).toBe(40000)
  })
  it('env 覆盖端口与超时', () => {
    const c = loadConfig({ PORT: '9001', TIMEOUT_MS: '1000' })
    expect(c.port).toBe(9001)
    expect(c.timeoutMs).toBe(1000)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL（`src/config` 不存在）

- [ ] **Step 3: 脚手架 + 最小实现**

`package.json`：
```json
{
  "name": "deepseek-brain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/index.js",
    "smoke": "node scripts/smoke.mjs"
  },
  "dependencies": { "puppeteer-core": "^24.0.0" },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^24.0.0"
  }
}
```

`tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

（注：只编译 `src`，产物路径 `dist/index.js`、`dist/transport/web-bridge.js`，与 `start` 脚本和 smoke 导入一致；`tests/` 由 vitest 直接跑 TS 源码，不进 tsc 编译范围。）

`vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } })
```

`.gitignore`：
```
node_modules/
dist/
logs/
.chrome-profile/
```

`src/config.ts`：
```ts
export interface BrowserConfig {
  debugPort: number
  profileDir: string
  headless: boolean
}
export interface LogConfig { level: string; dir: string }
export interface AppConfig {
  port: number
  thinking: boolean
  timeoutMs: number
  thinkingTimeoutMs: number
  sendClickSettleMs: number
  maxFormatRetries: number
  compactTokenThreshold: number
  toolResultMaxChars: number
  browser: BrowserConfig
  log: LogConfig
}
const DEFAULTS: AppConfig = {
  port: 8790,
  thinking: true,
  timeoutMs: 240000,
  thinkingTimeoutMs: 300000,
  sendClickSettleMs: 8000,
  maxFormatRetries: 2,
  compactTokenThreshold: 40000,
  toolResultMaxChars: 4000,
  browser: { debugPort: 9222, profileDir: '.chrome-profile', headless: false },
  log: { level: 'info', dir: 'logs' },
}
function num(v: string | undefined, d: number): number {
  const n = Number(v); return v !== undefined && Number.isFinite(n) && n > 0 ? n : d
}
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    ...DEFAULTS,
    browser: { ...DEFAULTS.browser },
    log: { ...DEFAULTS.log },
    port: num(env.PORT, DEFAULTS.port),
    thinking: env.THINKING ? env.THINKING === 'true' : DEFAULTS.thinking,
    timeoutMs: num(env.TIMEOUT_MS, DEFAULTS.timeoutMs),
    thinkingTimeoutMs: num(env.THINKING_TIMEOUT_MS, DEFAULTS.thinkingTimeoutMs),
    sendClickSettleMs: num(env.SEND_SETTLE_MS, DEFAULTS.sendClickSettleMs),
    maxFormatRetries: num(env.MAX_FORMAT_RETRIES, DEFAULTS.maxFormatRetries),
    compactTokenThreshold: num(env.COMPACT_THRESHOLD, DEFAULTS.compactTokenThreshold),
    toolResultMaxChars: num(env.TOOL_RESULT_MAX_CHARS, DEFAULTS.toolResultMaxChars),
  }
}
```

- [ ] **Step 4: 安装依赖并跑测试**

Run: `npm install && npx vitest run tests/config.test.ts && npm run typecheck`
Expected: PASS 2 tests；typecheck 无输出（成功）

- [ ] **Step 5: 提交**

```bash
git init && git add -A && git commit -m "chore: scaffold project with config module"
```

---

### Task 2: 共享类型 + 协议 system prompt 生成

**Files:**
- Create: `src/types.ts`、`src/protocol/system-prompt.ts`
- Test: `tests/system-prompt.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ToolSpec {name, description, parameters}`, `OpenAIMessage {role, content, tool_call_id?, tool_calls?}`, `ToolCall {id, name, arguments}`, `buildSystemPrompt(tools: ToolSpec[]): string`

- [ ] **Step 1: 写失败测试**

```ts
// tests/system-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../src/protocol/system-prompt'
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/system-prompt.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/types.ts`：
```ts
export interface ToolSpec {
  name: string
  description: string
  parameters: unknown
}
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}
```

`src/protocol/system-prompt.ts`：
```ts
import type { ToolSpec } from '../types'

const TEMPLATE = `你是任务规划大脑。需要调用工具时，输出一个代码块：
\`\`\`tool_call
{"tool": "<工具名>", "arguments": {<参数>}}
\`\`\`
每次只调一个工具，等待结果后再继续。不需要时直接文本回答。
可用工具：`

export function buildSystemPrompt(tools: ToolSpec[]): string {
  const catalog = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
  return `${TEMPLATE}${JSON.stringify(catalog)}`
}
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npx vitest run tests/system-prompt.test.ts && npm run typecheck`
Expected: PASS 2 tests；typecheck 通过

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(protocol): shared types and tool-protocol system prompt builder"
```

---

### Task 3: 协议解析器（文本 → tool_call | 正文）

**Files:**
- Create: `src/protocol/parser.ts`
- Test: `tests/parser.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` 的 `ToolSpec`（Task 2）
- Produces:
  - `ParseResult = {kind:'text', text:string} | {kind:'tool_call', tool:string, arguments:Record<string,unknown>, raw:string}`
  - `parseModelOutput(raw: string, tools: ToolSpec[]): ParseResult`
  - `findFenceStart(text: string): number`（返回 fence 起始下标，无则 -1）

- [ ] **Step 1: 写失败测试**

```ts
// tests/parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseModelOutput, findFenceStart } from '../src/protocol/parser'
import type { ToolSpec } from '../src/types'

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/protocol/parser.ts`：
```ts
import type { ToolSpec } from '../types'

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
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npx vitest run tests/parser.test.ts && npm run typecheck`
Expected: PASS 7 tests；typecheck 通过

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(protocol): tolerant tool_call parser with fence detection"
```

---

### Task 4: 会话键 + 增量计算 + token 估算

**Files:**
- Create: `src/session/manager.ts`, `src/session/compact.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: `OpenAIMessage`（Task 2）
- Produces:
  - `computeSessionKey(messages: OpenAIMessage[]): string`（对**除最后一条外**的前缀做 sha256）
  - `newMessagesSince(messages: OpenAIMessage[], sentCount: number): OpenAIMessage[]`
  - `estimateTokens(text: string): number`（`Math.ceil(text.length / 2)` 粗估）
  - `buildCompactPrompt(messages: OpenAIMessage[]): string`、`totalTokens(messages: OpenAIMessage[]): number`

- [ ] **Step 1: 写失败测试**

```ts
// tests/session.test.ts
import { describe, it, expect } from 'vitest'
import { computeSessionKey, newMessagesSince, estimateTokens } from '../src/session/manager'
import { buildCompactPrompt, totalTokens } from '../src/session/compact'
import type { OpenAIMessage } from '../src/types'

const msgs: OpenAIMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '问题一' },
]

describe('computeSessionKey', () => {
  it('追加消息后 key 不变（同会话）', () => {
    const k1 = computeSessionKey(msgs)
    const k2 = computeSessionKey([...msgs, { role: 'assistant', content: '答' }])
    expect(k1).toBe(k2)
  })
  it('历史内容变化 key 变化（compaction 场景）', () => {
    const k1 = computeSessionKey(msgs)
    const k2 = computeSessionKey([{ role: 'system', content: '摘要版' }, { role: 'user', content: '问题一' }])
    expect(k1).not.toBe(k2)
  })
  it('空输入也返回稳定 hash', () => {
    expect(computeSessionKey([])).toMatch(/^[a-f0-9]{64}$/)
  })
})
describe('newMessagesSince', () => {
  it('返回 sentCount 之后的增量', () => {
    expect(newMessagesSince(msgs, 1)).toEqual([{ role: 'user', content: '问题一' }])
    expect(newMessagesSince(msgs, 2)).toEqual([])
  })
})
describe('estimateTokens', () => {
  it('粗略估算', () => {
    expect(estimateTokens('1234')).toBe(2)
    expect(estimateTokens('中文测试')).toBe(2)
  })
})
describe('compact helpers', () => {
  it('buildCompactPrompt 含三条记录', () => {
    const p = buildCompactPrompt(msgs)
    expect(p).toContain('[system] sys')
    expect(p).toContain('[user] 问题一')
    expect(p).toContain('压缩为进展摘要')
  })
  it('totalTokens 求和', () => {
    expect(totalTokens(msgs)).toBe(estimateTokens('sys') + estimateTokens('问题一'))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/session/manager.ts`：
```ts
import { createHash } from 'node:crypto'
import type { OpenAIMessage } from '../types'

export function computeSessionKey(messages: OpenAIMessage[]): string {
  const prefix = messages.slice(0, Math.max(0, messages.length - 1))
  return createHash('sha256').update(JSON.stringify(prefix)).digest('hex')
}

export function newMessagesSince(messages: OpenAIMessage[], sentCount: number): OpenAIMessage[] {
  return messages.slice(sentCount)
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2)
}
```

`src/session/compact.ts`：
```ts
import type { OpenAIMessage } from '../types'
import { estimateTokens } from './manager'

/** 超阈值时生成 compaction 指令（由 transport 发给 DeepSeek，纯文本，不涉及工具协议） */
export function buildCompactPrompt(messages: OpenAIMessage[]): string {
  const transcript = messages.map(m => `[${m.role}] ${m.content}`).join('\n')
  return `请将以下对话压缩为进展摘要，保留：任务目标、已完成事项、关键结论、待办。500字以内。\n\n${transcript}`
}

export function totalTokens(messages: OpenAIMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
}
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npx vitest run tests/session.test.ts && npm run typecheck`
Expected: PASS 8 tests；typecheck 通过

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(session): prefix-hash session key, delta slicing, compaction helpers"
```

---

### Task 5: tool 结果渲染

**Files:**
- Create: `src/protocol/tool-result.ts`
- Test: `tests/tool-result.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `renderToolResult(toolName: string, content: string, maxChars: number): string`

- [ ] **Step 1: 写失败测试**

```ts
// tests/tool-result.test.ts
import { describe, it, expect } from 'vitest'
import { renderToolResult } from '../src/protocol/tool-result'

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/tool-result.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/protocol/tool-result.ts`：
```ts
export function renderToolResult(toolName: string, content: string, maxChars: number): string {
  const body = content.length > maxChars
    ? `${content.slice(0, maxChars)}\n...（截断，原长 ${content.length} 字符）`
    : content
  return `[工具 ${toolName} 返回]\n${body}\n[/返回]`
}
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npx vitest run tests/tool-result.test.ts && npm run typecheck`
Expected: PASS 2 tests；typecheck 通过

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(protocol): tool result renderer with truncation"
```

---

### Task 6: agent-turn 管道（协议编排 + 格式重试，不含 HTTP）

**Files:**
- Create: `src/transport/types.ts`、`src/pipeline.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 1-5 全部
- Produces:
  - `Transport`（`src/transport/types.ts`）：`generate(req: {prompt:string; thinking:boolean; timeoutMs?:number}): AsyncIterable<{reasoning?:string; content?:string}>`、`health(): Promise<'ok'|'login_required'|'ui_changed'|'error'>`、`lastChatSessionId(): string|null`、`resetSession(): void`
  - `runAgentTurn(opts: {messages: OpenAIMessage[]; tools: ToolSpec[]; transport: Transport; config: AppConfig}): Promise<{content:string; reasoning:string; toolCall?:ToolCall; usageTokens:number}>`
  - `FormatGiveUpError`

- [ ] **Step 1: 写失败测试**

```ts
// tests/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import { runAgentTurn } from '../src/pipeline'
import type { Transport } from '../src/transport/types'
import { loadConfig } from '../src/config'
import type { OpenAIMessage, ToolSpec } from '../src/types'

const TOOLS: ToolSpec[] = [{ name: 'read_file', description: '读', parameters: {} }]
const cfg = loadConfig({})

function fakeTransport(chunks: Array<{ reasoning?: string; content?: string }>): Transport & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    async *generate(req) { prompts.push(req.prompt); for (const c of chunks) yield c },
    async health() { return 'ok' as const },
    lastChatSessionId() { return 'sess-1' },
    resetSession() {},
  }
}

const baseMsgs: OpenAIMessage[] = [{ role: 'user', content: '读一下 README' }]

describe('runAgentTurn', () => {
  it('解析出 tool_call', async () => {
    const t = fakeTransport([{ content: '好的，调用工具。\n```tool_call\n{"tool":"read_file","arguments":{"path":"README.md"}}\n```' }])
    const r = await runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg })
    expect(r.toolCall).toMatchObject({ name: 'read_file', arguments: { path: 'README.md' } })
    expect(r.content).toContain('好的，调用工具。')
    expect(r.content).not.toContain('```tool_call')
    expect(t.prompts[0]).toContain('```tool_call')
    expect(t.prompts[0]).toContain('读一下 README')
  })
  it('格式错误自动修正重试一次', async () => {
    const t = fakeTransport([
      { content: '```tool_call\n{"tool":"read_file",坏}\n```' },
      { content: '```tool_call\n{"tool":"read_file","arguments":{}}\n```' },
    ])
    const r = await runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts).toHaveLength(2)
    expect(t.prompts[1]).toContain('格式不正确')
    expect(r.toolCall).toMatchObject({ name: 'read_file' })
  })
  it('重试耗尽则抛 FormatGiveUpError', async () => {
    const t = fakeTransport([
      { content: '```tool_call\n{"tool":\n```' },
      { content: '```tool_call\n{坏\n```' },
      { content: '还是坏' },
    ])
    await expect(runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg }))
      .rejects.toThrow(/format_give_up/)
  })
  it('纯文本回答无 toolCall', async () => {
    const t = fakeTransport([{ reasoning: '想一下' }, { content: '答案是 42' }])
    const r = await runAgentTurn({ messages: baseMsgs, tools: TOOLS, transport: t, config: cfg })
    expect(r.toolCall).toBeUndefined()
    expect(r.reasoning).toBe('想一下')
    expect(r.content).toBe('答案是 42')
  })
  it('后续轮只发增量（不重发历史）', async () => {
    const t = fakeTransport([{ content: '第二轮回答' }])
    const messages: OpenAIMessage[] = [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'tool', content: '[工具结果] X', tool_call_id: 'c1' },
      { role: 'user', content: '第二问' },
    ]
    const r = await runAgentTurn({ messages, tools: TOOLS, transport: t, config: cfg })
    expect(t.prompts[0]).toContain('第二问')
    expect(t.prompts[0]).not.toContain('第一问')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/transport/types.ts`：
```ts
export type HealthStatus = 'ok' | 'login_required' | 'ui_changed' | 'error'
export interface GenerateRequest { prompt: string; thinking: boolean; timeoutMs?: number }
export interface GenerateChunk { reasoning?: string; content?: string }
export interface Transport {
  generate(req: GenerateRequest): AsyncIterable<GenerateChunk>
  health(): Promise<HealthStatus>
  lastChatSessionId(): string | null
  resetSession(): void
}
```

`src/pipeline.ts`：
```ts
import type { AppConfig } from './config'
import type { OpenAIMessage, ToolCall, ToolSpec } from './types'
import { buildSystemPrompt } from './protocol/system-prompt'
import { parseModelOutput } from './protocol/parser'
import { renderToolResult } from './protocol/tool-result'
import type { Transport } from './transport/types'
import { computeSessionKey, newMessagesSince } from './session/manager'

const FIX_HINT = '格式不正确。请严格按协议重新输出一个 ```tool_call 代码块，内含一个合法 JSON 对象：{"tool":"<工具名>","arguments":{...}}。'

export class FormatGiveUpError extends Error {
  constructor() { super('format_give_up: 模型连续输出无法解析的工具调用'); this.name = 'FormatGiveUpError' }
}

interface SessionEntry { chatSessionId: string | null; sentCount: number }

/** 会话表：OpenCode 会话 key → DeepSeek 会话状态。单进程内存态。 */
const sessions = new Map<string, SessionEntry>()

export interface TurnResult {
  content: string
  reasoning: string
  toolCall?: ToolCall
  usageTokens: number
}

/** delta 只取 user/tool 消息：assistant 的历史动作网页会话里模型自己已见过 */
function buildPrompt(delta: OpenAIMessage[], tools: ToolSpec[], withFixHint: boolean, toolMaxChars: number): string {
  const sys = buildSystemPrompt(tools)
  const parts = [sys]
  for (const m of delta) {
    if (m.role === 'tool') parts.push(renderToolResult(m.tool_call_id ?? 'unknown', m.content, toolMaxChars))
    else parts.push(`[${m.role}] ${m.content}`)
  }
  if (withFixHint) parts.push(FIX_HINT)
  return parts.join('\n\n')
}

export async function runAgentTurn(opts: {
  messages: OpenAIMessage[]
  tools: ToolSpec[]
  transport: Transport
  config: AppConfig
}): Promise<TurnResult> {
  const { messages, tools, transport, config } = opts
  const key = computeSessionKey(messages)
  const entry = sessions.get(key) ?? { chatSessionId: null, sentCount: 0 }
  const delta = newMessagesSince(messages, entry.sentCount)
    .filter(m => m.role === 'user' || m.role === 'tool')

  let content = '', reasoning = '', usageTokens = 0
  for (let attempt = 0; attempt <= config.maxFormatRetries; attempt++) {
    content = ''; reasoning = ''
    const iter = transport.generate({
      prompt: buildPrompt(sendDelta, tools, attempt > 0, config.toolResultMaxChars),
      thinking: config.thinking,
      timeoutMs: config.thinking ? config.thinkingTimeoutMs : config.timeoutMs,
    })
    for await (const chunk of iter) {
      if (chunk.reasoning) reasoning += chunk.reasoning
      if (chunk.content) content += chunk.content
      usageTokens += Math.ceil(((chunk.reasoning ?? '') + (chunk.content ?? '')).length / 2)
    }
    const parsed = parseModelOutput(content, tools)
    if (parsed.kind === 'tool_call') {
      const tc: ToolCall = { id: `call_${Date.now().toString(36)}`, name: parsed.tool, arguments: parsed.arguments }
      sessions.set(key, { chatSessionId: transport.lastChatSessionId(), sentCount: messages.length })
      const visible = content.replace(parsed.raw, '').trim()
      return { content: visible || '（调用工具）', reasoning, toolCall: tc, usageTokens }
    }
    if (attempt === config.maxFormatRetries) break
  }
  const finalParsed = parseModelOutput(content, tools)
  if (finalParsed.kind === 'text' && !content.includes('```tool_call')) {
    sessions.set(key, { chatSessionId: transport.lastChatSessionId(), sentCount: messages.length })
    return { content: finalParsed.text, reasoning, usageTokens }
  }
  throw new FormatGiveUpError()
}
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npx vitest run tests/pipeline.test.ts && npm run typecheck`
Expected: PASS 5 tests；typecheck 通过

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(pipeline): agent-turn orchestration with delta send and format retry"
```

---

### Task 7: compaction 编排（超阈值摘要 + 新会话）

**Files:**
- Modify: `src/transport/types.ts`（Transport 增加 `newChat()`）、`src/pipeline.ts`（接入 compaction）
- Test: `tests/compact.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `buildCompactPrompt/totalTokens`、Task 6 的 `runAgentTurn`
- Produces: `Transport.newChat(): Promise<void>`（网页端开会话）；`runAgentTurn` 在 `totalTokens(messages) > config.compactTokenThreshold` 且有增量时：先 `newChat()` → 生成摘要 → delta 替换为 `[{role:'user', content:'【进展摘要】…请在此基础上继续完成原任务。'}]`

- [ ] **Step 1: 写失败测试**

```ts
// tests/compact.test.ts
import { describe, it, expect } from 'vitest'
import { runAgentTurn } from '../src/pipeline'
import type { Transport } from '../src/transport/types'
import { loadConfig } from '../src/config'
import type { OpenAIMessage, ToolSpec } from '../src/types'

const TOOLS: ToolSpec[] = [{ name: 'read_file', description: '读', parameters: {} }]
const cfg = loadConfig({ COMPACT_THRESHOLD: '20' }) // 强制触发 compaction

describe('compaction', () => {
  it('超阈值时摘要并重开会话', async () => {
    let newChats = 0
    const prompts: string[] = []
    const t: Transport = {
      async *generate(req) {
        prompts.push(req.prompt)
        if (req.prompt.includes('压缩为进展摘要')) { yield { content: '摘要：已完成ABC' }; return }
        yield { content: `收到:${req.prompt.slice(0, 30)}` }
      },
      async newChat() { newChats++ },
      async health() { return 'ok' as const },
      lastChatSessionId() { return 's2' },
      resetSession() {},
    }
    const messages: OpenAIMessage[] = [
      { role: 'user', content: '第一轮任务'.repeat(5) },
      { role: 'assistant', content: '进展'.repeat(5) },
      { role: 'tool', content: '结果'.repeat(5), tool_call_id: 'c1' },
      { role: 'user', content: '继续' },
    ]
    const r = await runAgentTurn({ messages, tools: TOOLS, transport: t, config: cfg })
    expect(newChats).toBe(1)
    expect(prompts.some(p => p.includes('压缩为进展摘要'))).toBe(true)
    expect(r.content).toContain('摘要：已完成ABC')
  })
  it('未超阈值不开新会话', async () => {
    let newChats = 0
    const t: Transport = {
      async *generate() { yield { content: '普通回答' } },
      async newChat() { newChats++ },
      async health() { return 'ok' as const },
      lastChatSessionId() { return null },
      resetSession() {},
    }
    const r = await runAgentTurn({ messages: [{ role: 'user', content: '短问' }], tools: TOOLS, transport: t, config: loadConfig({}) })
    expect(newChats).toBe(0)
    expect(r.content).toBe('普通回答')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/compact.test.ts`
Expected: FAIL（`Transport` 无 `newChat`，Task 6 测试也会因类型变化失败）

- [ ] **Step 3: 实现**

修改 `src/transport/types.ts`，接口增加：
```ts
  newChat(): Promise<void>
```

修改 `src/pipeline.ts`——文件顶部 import 区加入：
```ts
import { buildCompactPrompt, totalTokens } from './session/compact'
```

在 `runAgentTurn` 的 `const delta = ...` 之后、主循环之前插入：
```ts
  let sendDelta = delta
  if (delta.length > 0 && totalTokens(messages) > config.compactTokenThreshold) {
    await transport.newChat()
    let summary = ''
    for await (const c of transport.generate({
      prompt: buildCompactPrompt(messages),
      thinking: false,
      timeoutMs: config.timeoutMs,
    })) { if (c.content) summary += c.content }
    sendDelta = [{ role: 'user', content: `【进展摘要】${summary}\n请在此基础上继续完成原任务。` }]
    sessions.set(key, { chatSessionId: null, sentCount: 0 })
  }
```

并把主循环里的 `buildPrompt(delta, tools, attempt > 0)` 改为 `buildPrompt(sendDelta, tools, attempt > 0)`。

注意：compaction 后 `sessions.set(key, {sentCount: 0})` 意味着下一轮又视作首轮发全量——正确，因为 DeepSeek 侧已是新会话。

- [ ] **Step 4: 跑测试 + typecheck（含回归 Task 6 的 fake 需补 newChat）**

先把 Task 6 测试里的 `fakeTransport` 补上 `async newChat() {}` 方法以满足新接口，然后：
Run: `npx vitest run && npm run typecheck`
Expected: 全部测试 PASS（含 Task 6 的 5 个）；typecheck 通过

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(session): compaction orchestration with transcript summary and session reset"
```

---

### Task 8: web-bridge transport（CDP 驱动 + 页内探针）

**Files:**
- Create: `src/transport/web-bridge.ts`、`selectors.json`、`scripts/smoke.mjs`
- Test: `tests/bucket-sse.test.ts`（纯函数）+ `tests/web-bridge.live.test.ts`（`LIVE_TEST=1` 门控）

**Interfaces:**
- Consumes: `src/transport/types.ts`（Task 6/7 的 Transport 含 newChat）、`src/config.ts`
- Produces: `WebBridge`（extends Transport）：`createWebBridge(config: AppConfig): WebBridge`、`start()/stop()`、`bucketSSE(sse: string): {reasoning: string, content: string}`（导出供测试）
- selectors.json 初始内容：`{"send":"div.ds-button--primary.ds-button--filled.ds-button--circle[role=\"button\"]","newChat":"::-p-text(New chat)"}`

- [ ] **Step 1: 写 bucketSSE 失败测试（纯函数先行）**

```ts
// tests/bucket-sse.test.ts
import { describe, it, expect } from 'vitest'
import { bucketSSE } from '../src/transport/web-bridge'

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
```

- [ ] **Step 2: 写 live 测试（门控）**

```ts
// tests/web-bridge.live.test.ts
import { describe, it } from 'vitest'
import { createWebBridge } from '../src/transport/web-bridge'
import { loadConfig } from '../src/config'

describe.runIf(process.env.LIVE_TEST === '1')('web-bridge live', () => {
  it('驱动网页版完成一次生成', async () => {
    const config = loadConfig()
    const bridge = createWebBridge(config)
    await bridge.start()
    try {
      expect(await bridge.health()).toBe('ok')
      let out = ''
      for await (const c of bridge.generate({ prompt: '只回复两个字：正常', thinking: false, timeoutMs: 120000 })) {
        if (c.content) out += c.content
      }
      expect(out.trim().length).toBeGreaterThan(0)
      expect(bridge.lastChatSessionId()).toMatch(/[0-9a-f-]{36}/)
    } finally {
      await bridge.stop()
    }
  }, 180000)
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/bucket-sse.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 web-bridge**

`selectors.json`：
```json
{
  "send": "div.ds-button--primary.ds-button--filled.ds-button--circle[role=\"button\"]",
  "newChat": "::-p-text(New chat)"
}
```

`src/transport/web-bridge.ts`：
```ts
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import puppeteer from 'puppeteer-core'
import type { AppConfig } from '../config'
import type { GenerateChunk, HealthStatus, Transport } from './types'

const CHROME = 'C:\\Users\\15812\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const NUPHUS_PROFILE = path.join(os.homedir(), 'AppData', 'Roaming', 'Nuphus', 'browser_profile_v2')
const CHAT_URL = 'https://chat.deepseek.com/'

/** 页内探针：包裹 XHR，捕获 /chat/completion 的 body 与流式 responseText */
const PROBE = `(() => {
  window.__comp = window.__comp || [];
  const oOpen = XMLHttpRequest.prototype.open;
  const oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u, ...r) { this.__u = u; return oOpen.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function(b, ...r) {
    try {
      if (/completion/.test(this.__u || '')) {
        const entry = { url: this.__u, body: b, t0: Date.now(), status: null, resp: '', done: false };
        window.__comp.push(entry);
        this.addEventListener('progress', () => { entry.resp = this.responseText; });
        this.addEventListener('loadend', () => { entry.status = this.status; entry.done = true; entry.resp = this.responseText; });
      }
    } catch (e) {}
    return oSend.call(this, b, ...r);
  };
  return 'probe-ok';
})()`

export interface WebBridge extends Transport {
  start(): Promise<void>
  stop(): Promise<void>
}

export function bucketSSE(sse: string): { reasoning: string; content: string } {
  let reasoning = '', content = ''
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let obj: { p?: string; v?: unknown }
    try { obj = JSON.parse(payload) } catch { continue }
    const v = obj.v
    if (typeof v !== 'string') continue
    const p = String(obj.p ?? '')
    if (/thinking|reason/i.test(p)) reasoning += v
    else content += v
  }
  return { reasoning, content }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

let selectorsCache: { send: string; newChat: string } | null = null
function readSelectors(): { send: string; newChat: string } {
  if (!selectorsCache) {
    selectorsCache = JSON.parse(fs.readFileSync(path.resolve('selectors.json'), 'utf-8')) as { send: string; newChat: string }
  }
  return selectorsCache
}

export function createWebBridge(config: AppConfig): WebBridge {
  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | null = null
  let page: Awaited<ReturnType<NonNullable<typeof browser>['newPage']>> | null = null
  let chromeProc: ReturnType<typeof spawn> | null = null
  let generating = false
  let chatSessionId: string | null = null

  async function ensureProfileDir(): Promise<void> {
    const dest = path.resolve(config.browser.profileDir)
    if (fs.existsSync(path.join(dest, 'Default', 'Cookies'))) return
    fs.mkdirSync(dest, { recursive: true })
    try {
      fs.cpSync(NUPHUS_PROFILE, dest, { recursive: true, errorOnExist: false })
      console.log('[web-bridge] copied Nuphus profile (login reused)')
    } catch (e) {
      console.log('[web-bridge] fresh profile; manual login required on first run:', e instanceof Error ? e.message : e)
    }
  }

  async function launch(): Promise<void> {
    await ensureProfileDir()
    if (!fs.existsSync(CHROME)) throw new Error(`chrome not found: ${CHROME}`)
    chromeProc = spawn(CHROME, [
      `--remote-debugging-port=${config.browser.debugPort}`,
      `--user-data-dir=${path.resolve(config.browser.profileDir)}`,
      '--no-first-run', '--no-default-browser-check',
      ...(config.browser.headless ? ['--headless=new'] : []),
    ], { detached: true, stdio: 'ignore' })
    await sleep(1500)
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${config.browser.debugPort}`, defaultViewport: null })
  }

  async function openChatPage(): Promise<void> {
    if (!browser) throw new Error('browser not launched')
    const pages = await browser.pages()
    page = pages.find(p => p.url().includes('chat.deepseek.com')) ?? await browser.newPage()
    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' })
    await sleep(2000)
    await page.evaluate(PROBE)
    const m = page.url().match(/\/a\/chat\/s\/([0-9a-f-]{36})/)
    if (m) chatSessionId = m[1]
  }

  async function clickSend(sel: string): Promise<void> {
    if (!page) throw new Error('bridge not started')
    try {
      await page.click(sel)
    } catch {
      throw new Error('ui_changed: send selector not found')
    }
  }

  return {
    async start() {
      if (browser) return
      await launch()
      await openChatPage()
    },
    async stop() {
      try { await browser?.close() } catch { /* detached chrome 不随连接关闭而退出 */ }
      chromeProc?.kill()
      browser = null; page = null
    },
    async *generate(req): AsyncIterable<GenerateChunk> {
      if (!page) throw new Error('bridge not started')
      while (generating) await sleep(200) // 单飞锁：FIFO 等待
      generating = true
      try {
        const sel = readSelectors()
        await page.bringToFront()
        const ta = await page.waitForSelector('textarea', { timeout: 15000 })
        await ta!.click()
        const cdp = await page.createCDPSession()
        await cdp.send('Input.insertText', { text: req.prompt })
        await clickSend(sel.send)

        let t0 = Date.now()
        let entryIndex = -1
        let retried = false
        let emittedC = 0, emittedR = 0
        const deadline = Date.now() + (req.timeoutMs ?? config.timeoutMs)
        while (Date.now() < deadline) {
          if (entryIndex === -1) {
            const idx = await page.evaluate(() => (window as unknown as { __comp: unknown[] }).__comp.length - 1)
            if (idx < 0 && Date.now() - t0 > config.sendClickSettleMs) {
              if (!retried) {
                retried = true
                t0 = Date.now()
                await clickSend(sel.send)
                continue
              }
              throw new Error('no_request_after_send: 点击后未捕获到请求，未重发')
            }
            if (idx >= 0) entryIndex = idx
          }
          if (entryIndex !== -1) {
            const st = await page.evaluate(i => {
              const e = (window as unknown as { __comp: Array<{ done: boolean; status: number | null; resp: string }> }).__comp[i]
              return e ? { done: e.done, status: e.status, resp: String(e.resp ?? '') } : null
            }, entryIndex)
            if (st) {
              const b = bucketSSE(st.resp)
              if (b.content.length > emittedC) { yield { content: b.content.slice(emittedC) }; emittedC = b.content.length }
              if (b.reasoning.length > emittedR) { yield { reasoning: b.reasoning.slice(emittedR) }; emittedR = b.reasoning.length }
              if (st.done) {
                const m = page.url().match(/\/a\/chat\/s\/([0-9a-f-]{36})/)
                if (m) chatSessionId = m[1]
                return
              }
            }
          }
          await sleep(400)
        }
        throw new Error('timeout: generation exceeded limit')
      } finally {
        generating = false
      }
    },
    async newChat() {
      if (!page) throw new Error('bridge not started')
      try { await page.locator(readSelectors().newChat).first().click() }
      catch { throw new Error('ui_changed: newChat selector not found') }
      await sleep(1000)
      chatSessionId = null
    },
    health(): Promise<HealthStatus> {
      return (async () => {
        if (!page) return 'error' as const
        try {
          const txt = await page.evaluate(() => document.body.innerText)
          if (txt.includes('Log in') || txt.includes('登录')) return 'login_required' as const
          const hasInput = await page.evaluate(() => !!document.querySelector('textarea'))
          return hasInput ? ('ok' as const) : ('ui_changed' as const)
        } catch { return 'error' as const }
      })()
    },
    lastChatSessionId() { return chatSessionId },
    resetSession() { chatSessionId = null },
  }
}
```

`scripts/smoke.mjs`：
```js
// 手动 smoke：npm run build && node scripts/smoke.mjs
import { createWebBridge } from '../dist/transport/web-bridge.js'
import { loadConfig } from '../dist/config.js'

const bridge = createWebBridge(loadConfig())
await bridge.start()
console.log('health:', await bridge.health())
try {
  for await (const c of bridge.generate({ prompt: '只回复四个字：桥接正常', thinking: false, timeoutMs: 120000 })) {
    if (c.reasoning) process.stdout.write('[R] ' + c.reasoning + '\n')
    if (c.content) process.stdout.write('[C] ' + c.content + '\n')
  }
  console.log('session:', bridge.lastChatSessionId())
} catch (e) {
  console.error('SMOKE FAIL:', e.message)
  process.exitCode = 1
} finally {
  await bridge.stop()
}
```

- [ ] **Step 5: 单测 + live 验证**

Run: `npx vitest run tests/bucket-sse.test.ts && npm run typecheck`
Expected: PASS 2 tests；typecheck 通过

Live 前置条件：关闭 Nuphus 受控 Chrome。
Run: `$env:LIVE_TEST="1"; npx vitest run tests/web-bridge.live.test.ts`
Expected: PASS——网页版回复含"正常"，lastChatSessionId 为 UUID。若首次为全新 profile，按控制台提示手动登录后重跑。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat(transport): CDP web-bridge with in-page SSE probe and safe retry"
```

---

### Task 9: 入口组装 + HTTP 服务 + README

**Files:**
- Create: `src/server/http.ts`、`src/server/openai-types.ts`、`src/index.ts`、`README.md`

**Interfaces:**
- Consumes: Task 6 的 `runAgentTurn`、Task 8 的 `createWebBridge`、Task 1 的 `loadConfig`
- Produces: `npm run build && npm start` 后 `http://127.0.0.1:8790/v1/chat/completions` 可用（stream + 非 stream、`GET /v1/models`）

- [ ] **Step 1: 实现 HTTP 服务**

`src/server/openai-types.ts`：
```ts
export interface OpenAIChatRequest {
  model: string
  messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }>
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  stream?: boolean
}
export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: 'assistant'; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
    finish_reason: string | null
  }>
  usage?: { total_tokens: number }
}
```

`src/server/http.ts`：
```ts
import http from 'node:http'
import type { OpenAIChatRequest, OpenAIChatResponse } from './openai-types'
import type { AppConfig } from '../config'
import { runAgentTurn } from '../pipeline'
import type { OpenAIMessage, ToolSpec } from '../types'
import type { Transport } from '../transport/types'

function toInternal(req: OpenAIChatRequest): { messages: OpenAIMessage[]; tools: ToolSpec[] } {
  const messages: OpenAIMessage[] = req.messages.map(m => ({
    role: m.role as OpenAIMessage['role'],
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    tool_call_id: m.tool_call_id,
    tool_calls: m.tool_calls as OpenAIMessage['tool_calls'],
  }))
  const tools: ToolSpec[] = (req.tools ?? []).map(t => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }))
  return { messages, tools }
}

// transport 由 index.ts 注入（避免循环依赖）
let transportGetter: () => Transport = () => { throw new Error('transport not initialized') }
export function setTransportGetter(fn: () => Transport): void { transportGetter = fn }

export function createHttpServer(config: AppConfig): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-web-brain', object: 'model', created: 0, owned_by: 'deepseek-brain' }] }))
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', async () => {
      let parsed: OpenAIChatRequest
      try { parsed = JSON.parse(body) as OpenAIChatRequest } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid json' } }))
        return
      }
      try {
        const { messages, tools } = toInternal(parsed)
        const result = await runAgentTurn({ messages, tools, transport: transportGetter(), config })
        const id = `chatcmpl-${Date.now().toString(36)}`
        const created = Math.floor(Date.now() / 1000)
        const toolCalls = result.toolCall
          ? [{ id: result.toolCall.id, type: 'function' as const, function: { name: result.toolCall.name, arguments: JSON.stringify(result.toolCall.arguments) } }]
          : undefined
        if (parsed.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          const send = (delta: Record<string, unknown>, finish: string | null) =>
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
          if (result.reasoning) send({ reasoning_content: result.reasoning }, null)
          send({ content: result.content }, null)
          if (toolCalls) {
            send({ tool_calls: [{ index: 0, ...toolCalls[0] }] }, null)
            send({}, 'tool_calls')
          } else {
            send({}, 'stop')
          }
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        const resp: OpenAIChatResponse = {
          id, object: 'chat.completion', created, model: parsed.model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: result.content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
            finish_reason: toolCalls ? 'tool_calls' : 'stop',
          }],
          usage: { total_tokens: result.usageTokens },
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(resp))
      } catch (e) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: e instanceof Error ? e.message : String(e) } }))
      }
    })
  })
}
```

`src/index.ts`：
```ts
import { loadConfig } from './config'
import { createHttpServer, setTransportGetter } from './server/http'
import { createWebBridge } from './transport/web-bridge'

async function main() {
  const config = loadConfig()
  const bridge = createWebBridge(config)
  setTransportGetter(() => bridge)
  await bridge.start()
  console.log(`[brain] transport health: ${await bridge.health()}`)
  const server = createHttpServer(config)
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`[brain] shim listening on http://127.0.0.1:${config.port}/v1`)
  })
  const shutdown = async () => { server.close(); await bridge.stop(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
main().catch(e => { console.error('[brain] fatal:', e); process.exit(1) })
```

`README.md`：
```markdown
# DeepSeek Brain Shim

让 DeepSeek 网页版（无函数调用）作为 OpenCode 的 subagent 大脑。

## 启动

npm install
npm run build
npm start   # 首次运行若为全新 profile，需在弹出的 Chrome 里手动登录 chat.deepseek.com（登录态持久化）

## OpenCode 接入（opencode.jsonc）

"provider": { "deepseek-brain": { "npm": "@ai-sdk/openai-compatible",
  "options": { "baseURL": "http://127.0.0.1:8790/v1", "apiKey": "local" },
  "models": { "deepseek-web-brain": { "name": "DeepSeek Web Brain" } } } },
"agent": { "brain": { "mode": "subagent", "model": "deepseek-brain/deepseek-web-brain" } }

## 验证

curl -s http://127.0.0.1:8790/v1/chat/completions -H "content-type: application/json" -d "{\"model\":\"deepseek-web-brain\",\"messages\":[{\"role\":\"user\",\"content\":\"用一句话介绍你自己\"}]}"

## 故障排查

- health=login_required → 在 shim 启动的 Chrome 窗口重新登录 chat.deepseek.com
- health=ui_changed → 更新 selectors.json 的 send/newChat 选择器
- ToS 风险：自动化网页版可能违反 DeepSeek 服务条款，账号风险自担
```

- [ ] **Step 2: 冒烟（非流式）**

```powershell
npm run build
$p = Start-Process node -ArgumentList "dist/index.js" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 10
curl.exe -s http://127.0.0.1:8790/v1/chat/completions -H "content-type: application/json" -d "{\"model\":\"deepseek-web-brain\",\"messages\":[{\"role\":\"user\",\"content\":\"用一句话介绍你自己\"}]}"
Stop-Process -Id $p.Id
```
Expected: 返回 `chat.completion` JSON，`choices[0].message.content` 为 DeepSeek 的回答

- [ ] **Step 3: 全量测试 + 提交**

Run: `npm test && npm run typecheck`
```bash
git add -A && git commit -m "feat: OpenAI-compatible server, entrypoint, and docs"
```

---

### Task 10: E2E——OpenCode subagent 闭环

**Files:**
- Create: `docs/e2e-checklist.md`

**Interfaces:**
- Consumes: Task 9 全部
- Produces: 人工验证清单（E2E 需真实 OpenCode 会话，无法全自动）

- [ ] **Step 1: 写 E2E 清单**

`docs/e2e-checklist.md`：
```markdown
# E2E 验证清单（人工）

前置：shim 已启动且 health=ok；Chrome 页面正常。

- [ ] 1. curl 非流式对话返回正常回答（Task 9 Step 2 已覆盖）
- [ ] 2. curl 流式（body 加 "stream":true）收到 SSE chunk 与 data: [DONE]
- [ ] 3. opencode.jsonc 增加 provider deepseek-brain + agent brain（README 片段）
- [ ] 4. opencode 新会话指定 model deepseek-brain/deepseek-web-brain（或 /agent brain）
- [ ] 5. 让 brain 执行两步任务（如"列出当前目录文件，然后读取其中一个"）：
      brain 输出 tool_call → OpenCode 真执行 → 结果回传 → brain 继续；全程不出现半截 JSON
- [ ] 6. 连续 5 轮以上对话，验证会话连续（brain 记得前文）
- [ ] 7. 长时间会话触发 compaction（阈值 40K）后行为仍正常
- [ ] 8. 勾选完毕后本清单随会话归档
```

- [ ] **Step 2: 交付确认**

Run: `npm test && npm run typecheck`
Expected: 全绿（live 测试在未设 LIVE_TEST 时 skip）

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "docs: E2E verification checklist for OpenCode integration"
```
