# deepseek-brain 开源化 v0.2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把个人工具改造成可发布的开源项目——删掉作者个人浏览器数据机制、抽出可复用 core、Windows-only 配置化、npm 可 `npx` 安装。

**Architecture:** 三层解耦 `core/`（transport 无关，可 npm subpath 复用）→ `transports/deepseek-web.ts`（唯一 DeepSeek 专属代码）→ `server/`（OpenAI 兼容 HTTP）。core 依赖 transport 的**接口**不依赖实现（依赖倒置）。

**Tech Stack:** Node 24 / TypeScript 5.6 / tsc 直出（无打包器）/ ESM-only / vitest 2.1 / puppeteer-core 24（固定版本）

**Spec:** `docs/superpowers/specs/2026-10-01-deepseek-brain-oss-design.md` —— 实施者须同时读 spec 与本计划，spec 随计划同行。

## Global Constraints

- **平台：仅 Windows**。不做 Linux / macOS 探测。`package.json` 声明 `"os": ["win32"]`
- **模块格式：ESM-only**。已是 `"type": "module"`；不引入 CJS 双出、不引入打包器；`cli.ts` 只用 ESM import，禁止 `require`
- **默认值：并发池 = 1（严格串行）、headless = off**。两者仅作显式实验开关
- **`puppeteer-core` 版本固定**，不用 `^`（CDP 方法缺失只在运行时炸）
- **`core/` 不得 import `transports/` 或 `puppeteer-core`**；core 内禁止站点常量与绕过 `SessionStore`/`LogSink` 的 fs 直呼
- **删除** `ensureProfileDir()` 的 Nuphus profile `cpSync` 机制与 `C:\Users\15812\...` 硬编码路径
- **README 顶部两件独立声明**：非官方声明（防商标关联误解）+ ToS 风险声明（自动化可能违反条款、可能封号）
- **PowerShell 5.1 验证规范**：JSON 校验用 `node -e`；HTTP 响应落盘用 `curl -o` 让 curl 直接写字节（PS 字符串层会按 GBK 解码 UTF-8 并不可逆丢字符）
- git 提交一律 `-c user.name="Jarvis" -c user.email="jarvis@local"`
- 每个任务结束时 `npm run typecheck && npm test` 必须全绿

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 保持现状：OpenAI wire 类型（`OpenAIMessage` / `ToolSpec` / `ToolCall`） |
| `src/core/types.ts` | **新** —— `Transport` 接口 + `Capabilities` + `GenerateRequest`/`GenerateChunk`/`HealthStatus` |
| `src/core/planner.ts` | **新**（由 `src/pipeline.ts` 迁移）—— `buildTurn` / `parseReply` / `renderToolResult` 编排 |
| `src/core/protocol/system-prompt.ts` | 由 `src/protocol/system-prompt.ts` 迁移，无逻辑改动 |
| `src/core/protocol/parser.ts` | 由 `src/protocol/parser.ts` 迁移 |
| `src/core/protocol/tool-result.ts` | 由 `src/protocol/tool-result.ts` 迁移 |
| `src/core/session/store.ts` | 由 `src/session/store.ts` 迁移；改为实现 `SessionStore` 接口 |
| `src/core/session/manager.ts` | 由 `src/session/manager.ts` 迁移 |
| `src/core/compaction/index.ts` | 由 `src/session/compact.ts` 迁移；阈值改为可注入 |
| `src/core/index.ts` | **新** —— core 的公开导出面（`createPlanner` 等） |
| `src/transports/deepseek-web.ts` | 由 `src/transport/web-bridge.ts` 迁移 + 删 Nuphus + Windows 探测 + `cancel`/`getCapabilities` |
| `src/transports/chrome-detect.ts` | **新** —— Windows Chrome/Edge 路径探测纯函数 |
| `src/server/http.ts` | 仅改 import 路径（pipeline → core） |
| `src/cli.ts` | **新** —— bin 入口，shebang 首行 |
| `src/index.ts` | 编程式根导出（`exports["."]`） |

---

### Task 1: 删除个人资产机制 + Windows Chrome 探测

**Files:**
- Create: `src/transports/chrome-detect.ts`
- Create: `tests/chrome-detect.test.ts`
- Modify: `src/transport/web-bridge.ts:17-18`（删硬编码常量）、`:191-205`（删 `ensureProfileDir` 复制逻辑）、`:229-237`（`launch()` 用探测结果）

**Interfaces:**
- Consumes: 现有 `AppConfig`（`config.browser.profileDir` / `.headless`）
- Produces:
  ```ts
  // src/transports/chrome-detect.ts
  export function detectWindowsChrome(env: Record<string, string | undefined>): string | null
  export function chromeNotFoundMessage(candidates: string[]): string
  ```
  后续 Task 5 的 `cli.ts` 用 `detectWindowsChrome` 做早失败探测

- [ ] **Step 1: 写失败测试**

`tests/chrome-detect.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { detectWindowsChrome, chromeNotFoundMessage } from '../src/transports/chrome-detect.js'

describe('detectWindowsChrome', () => {
  it('优先使用 CHROME_PATH', () => {
    expect(detectWindowsChrome({ CHROME_PATH: 'D:\\custom\\chrome.exe' })).toBe('D:\\custom\\chrome.exe')
  })
  it('CHROME_PATH 为空串时回退到探测', () => {
    expect(detectWindowsChrome({ CHROME_PATH: '' })).toBeNull()
  })
  it('全部候选缺失时返回 null', () => {
    expect(detectWindowsChrome({ LOCALAPPDATA: 'C:\\none', PROGRAMFILES: 'C:\\none', 'PROGRAMFILES(X86)': 'C:\\none' })).toBeNull()
  })
})

describe('chromeNotFoundMessage', () => {
  it('列出全部候选路径', () => {
    const msg = chromeNotFoundMessage(['C:\\a\\chrome.exe', 'C:\\b\\chrome.exe'])
    expect(msg).toContain('C:\\a\\chrome.exe')
    expect(msg).toContain('C:\\b\\chrome.exe')
    expect(msg).toContain('CHROME_PATH')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/chrome-detect.test.ts`
Expected: FAIL — `Cannot find module '../src/transports/chrome-detect.js'`

- [ ] **Step 3: 实现 chrome-detect.ts**

```ts
import fs from 'node:fs'
import path from 'node:path'

/** Windows Chrome/Chromium/Edge 候选路径，按优先级排列。
 *  LOCALAPPDATA 优先——Windows 上 Chrome 绝大多数是 per-user 安装。 */
export function windowsChromeCandidates(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  const local = env.LOCALAPPDATA
  const pf = env.PROGRAMFILES
  const pf86 = env['PROGRAMFILES(X86)']
  if (local) {
    out.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(local, 'Chromium', 'Application', 'chrome.exe'))
  }
  if (pf) {
    out.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  if (pf86) {
    out.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  return out
}

export function detectWindowsChrome(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.CHROME_PATH
  if (explicit) return fs.existsSync(explicit) ? explicit : null
  for (const c of windowsChromeCandidates(env)) {
    if (fs.existsSync(c)) return c
  }
  return null
}

export function chromeNotFoundMessage(candidates: string[]): string {
  return [
    '[brain] chrome not found. Set CHROME_PATH or --chrome-path, or install Chrome/Edge.',
    'Checked candidates:',
    ...candidates.map(c => `  - ${c}`),
  ].join('\n')
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/chrome-detect.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 改 web-bridge.ts 删除硬编码与 Nuphus 复制**

删掉文件顶部这两行（`:17-18`）：

```ts
const CHROME = process.env.CHROME_PATH ?? 'C:\\Users\\15812\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const NUPHUS_PROFILE = path.join(os.homedir(), 'AppData', 'Roaming', 'Nuphus', 'browser_profile_v2')
```

把 `ensureProfileDir()` 整个函数替换为（**只建目录，不复制任何个人数据**）：

```ts
  async function ensureProfileDir(): Promise<void> {
    const dest = path.resolve(config.browser.profileDir)
    fs.mkdirSync(dest, { recursive: true })
    const seeded = fs.existsSync(path.join(dest, 'Default', 'Network', 'Cookies'))
      || fs.existsSync(path.join(dest, 'Default', 'Cookies'))
    if (!seeded) {
      console.log('[web-bridge] fresh profile — first run needs manual login in the Chrome window')
    }
  }
```

改 `launch()` 的开头两行（`:231`）：

```ts
    const chrome = detectWindowsChrome()
    if (!chrome) throw new Error(chromeNotFoundMessage(windowsChromeCandidates(process.env)))
```

并把函数体内其余 `CHROME` 引用改为 `chrome`。在文件顶部加 import：

```ts
import { detectWindowsChrome, chromeNotFoundMessage, windowsChromeCandidates } from './chrome-detect.js'
```

- [ ] **Step 6: 确认无残留引用**

Run: `node -e "const s=require('fs').readFileSync('src/transport/web-bridge.ts','utf8');const bad=['C:\\\\Users\\\\15812','NUPHUS_PROFILE','cpSync'];const hit=bad.filter(b=>s.includes(b));console.log(hit.length?'LEFTOVER: '+hit.join(','):'CLEAN')"`
Expected: `CLEAN`

- [ ] **Step 7: 全量验证**

Run: `npm run typecheck; if ($?) { npm test }`
Expected: typecheck 无错，全部测试 PASS（原 71 个不减）

- [ ] **Step 8: 提交**

```bash
git add src/transports/chrome-detect.ts tests/chrome-detect.test.ts src/transport/web-bridge.ts
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "fix: drop personal Chrome path and Nuphus profile seeding

ensureProfileDir copied the author's personal Nuphus browser profile into
the working directory on every launch to reuse its login state. That is
personal data as an implementation mechanism, not a path problem, and it
means the shim cannot run on anyone else's machine.

Replaces it with plain mkdir plus a first-run manual-login notice, and
resolves the browser through CHROME_PATH or a Windows candidate table."
```

---

### Task 2: 三层重构 + Transport 接口扩展

**Files:**
- Create: `src/core/types.ts`、`src/core/index.ts`
- Move: `src/protocol/*` → `src/core/protocol/*`；`src/pipeline.ts` → `src/core/planner.ts`；`src/session/{manager,store}.ts` → `src/core/session/*`；`src/session/compact.ts` → `src/core/compaction/index.ts`；`src/transport/web-bridge.ts` → `src/transports/deepseek-web.ts`；`src/transport/types.ts` → `src/core/types.ts`
- Move tests: `tests/protocol-*.test.ts` → 对应 `tests/core/` 位置
- Modify: `src/server/http.ts`（import 路径）、`src/index.ts`、`tests/*.test.ts` 的 import 路径

**Interfaces:**
- Consumes: Task 1 的 `src/transports/chrome-detect.ts`
- Produces:
  ```ts
  // src/core/types.ts
  export interface Capabilities {
    supportsThinking: boolean
    supportsResume: boolean
    maxContextTokens: number
    tokenEstimator?: (text: string) => number
  }
  export interface Transport {
    generate(req: GenerateRequest): AsyncIterable<GenerateChunk>
    newChat(): Promise<void>
    health(): Promise<HealthStatus>
    lastChatSessionId(): string | null
    resetSession(): void
    cancel(): Promise<void>
    getCapabilities(): Capabilities
  }
  // src/core/index.ts
  export function createPlanner(deps?: PlannerDeps): Planner
  export type { Transport, Capabilities, GenerateRequest, GenerateChunk, HealthStatus }
  ```

- [ ] **Step 1: 用 git mv 做文件迁移（保留历史）**

```bash
mkdir -p src/core/protocol src/core/session src/core/compaction src/transports
git mv src/protocol/system-prompt.ts src/core/protocol/system-prompt.ts
git mv src/protocol/parser.ts        src/core/protocol/parser.ts
git mv src/protocol/tool-result.ts   src/core/protocol/tool-result.ts
git mv src/session/manager.ts        src/core/session/manager.ts
git mv src/session/store.ts          src/core/session/store.ts
git mv src/session/compact.ts        src/core/compaction/index.ts
git mv src/transport/types.ts        src/core/types.ts
git mv src/transport/web-bridge.ts   src/transports/deepseek-web.ts
git mv tests/system-prompt.test.ts   tests/core-system-prompt.test.ts
git mv tests/parser.test.ts          tests/core-parser.test.ts
git mv tests/tool-result.test.ts     tests/core-tool-result.test.ts
git mv tests/session.test.ts         tests/core-session.test.ts
git mv tests/session-persistence.test.ts tests/core-session-persistence.test.ts
git mv tests/compact.test.ts         tests/core-compact.test.ts
git mv tests/pipeline.test.ts        tests/core-planner.test.ts
git mv tests/bucket-sse.test.ts      tests/deepseek-bucket-sse.test.ts
git mv tests/web-bridge.live.test.ts tests/deepseek-web-bridge.live.test.ts
git mv tests/http.test.ts            tests/server-http.test.ts
git mv tests/config.test.ts          tests/config.test.ts
rmdir src/protocol src/session src/transport 2>$null
```

- [ ] **Step 2: 修正所有 import 路径**

统一规则（注意 `../` 深度从 2 变 3）：

| 原 | 新 |
|---|---|
| `src/pipeline.ts` 里 `'./protocol/system-prompt.js'` | `'./protocol/system-prompt.js'`（同层，不变） |
| `src/pipeline.ts` 里 `'./session/manager.js'` | `'./session/manager.js'`（同层，不变） |
| `src/pipeline.ts` 里 `'./transport/types.js'` | `'./types.js'` |
| `src/core/session/store.ts` 里 `'./manager.js'` | 不变 |
| `src/core/compaction/index.ts` 里 `'../types.js'` | `'../types.js'`（指向 `src/core/types.ts`，若原指向 `src/types.ts` 则改为 OpenAI wire 类型） |
| `src/transports/deepseek-web.ts` 里 `'../config.js'` | `'../config.js'`（深度 1→1，不变） |
| `src/transports/deepseek-web.ts` 里 `'./types.js'` | `'../core/types.js'` |
| `src/transports/deepseek-web.ts` 里 `'../session/store.js'` | `'../core/session/store.js'` |
| `src/transports/deepseek-web.ts` 里 `'./chrome-detect.js'` | 不变 |
| `src/server/http.ts` 里 `'../pipeline.js'` | `'../core/planner.js'` |

`src/core/compaction/index.ts` 原本 import `'../types.js'` 指向 `src/types.ts` 的 `OpenAIMessage`。迁移后它在 `src/core/compaction/`，`'../types.js'` 会解析到 `src/core/types.ts`（无 `OpenAIMessage`）。**必须显式改为** `'../../types.js'`。

Run 确认无悬空引用：
```bash
npm run typecheck
```
Expected: 若干 TS2307 module-not-found —— 逐条按上表修正后重跑至无错。

- [ ] **Step 3: 扩展 Transport 接口**

在 `src/core/types.ts` 追加：

```ts
export interface Capabilities {
  /** 模型是否产出 reasoning_content 分流 */
  supportsThinking: boolean
  /** 是否支持用 chatSessionId 深链恢复会话 */
  supportsResume: boolean
  /** 上下文墙；compaction 阈值默认取此值 */
  maxContextTokens: number
  /** token 估算器；默认 chars/4 */
  tokenEstimator?: (text: string) => number
}
```

并在 `Transport` 接口追加两个方法：

```ts
  cancel(): Promise<void>
  getCapabilities(): Capabilities
```

- [ ] **Step 4: 给 deepseek-web.ts 实现两个新方法**

在返回 `WebBridge` 的对象字面量里追加：

```ts
  async cancel(): Promise<void> {
    const entry = currentEntry()
    if (entry) { entry.done = true; entry.resp = '' }
  },
  getCapabilities(): Capabilities {
    return {
      supportsThinking: true,
      supportsResume: true,
      maxContextTokens: 64000,
      tokenEstimator: (t: string) => Math.ceil(t.length / 4),
    }
  },
```

若 `currentEntry()` 不是现有函数名，用文件里实际取当前 entry 的表达式替换——**该文件已有读取当前进行中 entry 的逻辑，Task 2 只需复用，不要新写**。

- [ ] **Step 5: 建 core/index.ts**

```ts
export { runAgentTurn } from './planner.js'
export { computeSessionKey, newMessagesSince, estimateTokens } from './session/manager.js'
export { createSessionStore, DEFAULT_SESSIONS_FILE } from './session/store.js'
export { buildCompactPrompt, totalTokens } from './compaction/index.js'
export { buildSystemPrompt } from './protocol/system-prompt.js'
export { parseModelOutput } from './protocol/parser.js'
export { renderToolResult } from './protocol/tool-result.js'
export type { Transport, Capabilities, GenerateRequest, GenerateChunk, HealthStatus } from './types.js'
```

> `createPlanner` 的完整实现属 Task 5（需注入 `SessionStore` 与 `SessionKeyStrategy`）。本任务只导出既有函数，Task 5 再补 `createPlanner`。

- [ ] **Step 6: 加 core 边界静态检查（测试形式）**

Create `tests/core-boundary.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const CORE = path.resolve('src/core')
const FORBIDDEN = [/from\s+['"].*transports/, /from\s+['"]puppeteer-core/, /chat\.deepseek\.com/, /开启新对话/]

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

describe('core 边界', () => {
  it('core 不得 import transports / puppeteer-core / 站点常量', () => {
    const violations: string[] = []
    for (const f of walk(CORE)) {
      const src = fs.readFileSync(f, 'utf8')
      for (const re of FORBIDDEN) {
        if (re.test(src)) violations.push(`${path.relative(CORE, f)} :: ${re}`)
      }
    }
    expect(violations).toEqual([])
  })
})
```

- [ ] **Step 7: 全量验证**

Run: `npm run typecheck; if ($?) { npm test }`
Expected: 测试数与迁移前一致（71 passed / 1 skipped），无 FAIL

- [ ] **Step 8: 提交**

```bash
git add -A src tests
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "refactor: three-layer split with core as a reusable unit

core/ holds the transport-agnostic planner, session and compaction logic;
transports/deepseek-web.ts keeps every DeepSeek-specific concern; server/
stays harness-agnostic. core depends on the Transport interface only.

Transport gains cancel() for harness-side aborts and getCapabilities() so
compaction thresholds and token estimation can come from the backend rather
than a magic number. Adds a boundary test that fails if core imports
transports, puppeteer-core, or site constants."
```

---

### Task 3: core 接口化（SessionStore / SessionKeyStrategy / 阈值注入）

**Files:**
- Modify: `src/core/session/store.ts`（实现 `SessionStore` 接口）
- Create: `src/core/session/strategy.ts`（`SessionKeyStrategy`）
- Modify: `src/core/compaction/index.ts`（阈值参数化）
- Create: `tests/core-strategy.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Capabilities`、`core/session/manager.ts` 的 `computeSessionKey`/`estimateTokens`
- Produces:
  ```ts
  // src/core/session/strategy.ts
  export type SessionKeyStrategy = (messages: OpenAIMessage[]) => string
  export const prefixHashStrategy: SessionKeyStrategy   // 现有行为
  export const statelessStrategy: SessionKeyStrategy     // 每次恒返回同一 key（无状态后端）

  // src/core/session/store.ts
  export interface SessionStore { load(): SessionSnapshot; save(s: SessionSnapshot): void }
  export function createSessionStore(file: string | null): SessionStore   // 签名不变，内部实现接口

  // src/core/compaction/index.ts
  export function shouldCompact(messages: OpenAIMessage[], threshold: number): boolean
  ```

- [ ] **Step 1: 写失败测试**

`tests/core-strategy.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { prefixHashStrategy, statelessStrategy } from '../src/core/session/strategy.js'
import type { OpenAIMessage } from '../src/types.js'

const msgs: OpenAIMessage[] = [
  { role: 'user', content: '第一句' },
  { role: 'assistant', content: '回复' },
  { role: 'user', content: '第二句' },
]

describe('SessionKeyStrategy', () => {
  it('prefixHash 对相同前缀产生相同 key', () => {
    expect(prefixHashStrategy(msgs.slice(0, 2))).toBe(prefixHashStrategy(msgs))
  })
  it('stateless 对任何输入恒返回同一 key', () => {
    expect(statelessStrategy(msgs)).toBe(statelessStrategy([]))
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/core-strategy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 strategy.ts**

```ts
import type { OpenAIMessage } from '../../types.js'

/** 会话 key 策略：把 OpenCode 会话映射到后端会话的规则。
 *  可替换——无状态后端（每次调用独立）没有 session 概念，用 statelessStrategy。 */
export type SessionKeyStrategy = (messages: OpenAIMessage[]) => string

/** 默认策略：取到首条 user 消息为止的前缀做 hash。前缀相同即视为同一会话。 */
export const prefixHashStrategy: SessionKeyStrategy = (messages) => {
  const end = messages.map(m => m.role).lastIndexOf('user') + 1
  return computePrefixHash(messages.slice(0, Math.max(end, 1)))
}

/** 无状态后端策略：忽略历史，恒定 key，配合每次 newChat 的 transport。 */
export const statelessStrategy: SessionKeyStrategy = () => 'stateless'
```

`computePrefixHash` 从 `manager.ts` 导出（若它当前是私有名 `computeSessionKey` 的一部分，把其内部 hash 逻辑提取为导出的 `computePrefixHash`）。

- [ ] **Step 4: runAgentTurn 支持注入**

在 `src/core/planner.ts` 的导出签名上增加可选 deps（保持向后兼容，既有测试不需改）：

```ts
export interface PlannerDeps {
  store?: SessionStore
  keyStrategy?: SessionKeyStrategy
  threshold?: number
}
```

函数体内：`openSessionStore()` 改为 `deps.store ?? openSessionStore()`；`computeSessionKey(messages)` 改为 `(deps.keyStrategy ?? prefixHashStrategy)(messages)`；compaction 阈值改为 `deps.threshold ?? config.compactTokenThreshold`，并由 `transport.getCapabilities().maxContextTokens` 作为缺省来源。

- [ ] **Step 5: 阈值默认值改走 capabilities**

在 `planner.ts` 计算阈值处：

```ts
  const threshold = deps.threshold
    ?? transport.getCapabilities().maxContextTokens
```

`config.compactTokenThreshold` 降级为显式覆盖：仅当 `COMPACT_THRESHOLD` env 存在时优先。

- [ ] **Step 6: 验证 core 不再硬编码阈值**

Run: `node -e "const s=require('fs').readFileSync('src/core/compaction/index.ts','utf8');console.log(s.includes('40000')?'HARDCODED':'CLEAN')"`
Expected: `CLEAN`

- [ ] **Step 7: 全量验证 + 提交**

Run: `npm run typecheck; if ($?) { npm test }`
Expected: 全绿

```bash
git add -A src tests
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "feat(core): make session keying and storage replaceable

The prefix-hash key assumed the backend can resume a session by prefix,
which is false for stateless backends, and the store hardcoded fs access to
.sessions.json. Both become injectable, and the compaction threshold now
comes from getCapabilities().maxContextTokens instead of a magic 40000, so
core carries no DeepSeek-specific assumption."
```

---

### Task 4: 打包基线（package.json / shebang / 条件 exports / npm pack 实测）

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`（开 `declaration`）
- Create: `src/cli.ts`
- Create: `tests/pack.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `src/core/index.ts`、`src/core/types.ts`
- Produces: `exports["."]` → `dist/index.js`；`exports["./core"]` → `dist/core/index.js`（带 types）；`bin.deepseek-brain` → `dist/cli.js`

- [ ] **Step 1: 写失败测试**

`tests/pack.test.ts`（只测可静态验证的部分，打包链路在 Step 6 手工/脚本验证）：

```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import pkg from '../package.json' with { type: 'json' }

describe('打包元数据', () => {
  it('不是 private', () => expect((pkg as any).private).toBeUndefined())
  it('声明 win32 平台限制', () => expect((pkg as any).os).toEqual(['win32']))
  it('bin 指向 dist/cli.js', () => expect((pkg as any).bin['deepseek-brain']).toBe('dist/cli.js'))
  it('core 导出带 types 条件', () => {
    expect((pkg as any).exports['./core'].types).toBe('./dist/core/index.d.ts')
  })
  it('显式导出 package.json', () => {
    expect((pkg as any).exports['./package.json']).toBe('./package.json')
  })
  it('cli.ts 首行是 shebang', () => {
    const first = fs.readFileSync('src/cli.ts', 'utf8').split('\n')[0]
    expect(first).toBe('#!/usr/bin/env node')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/pack.test.ts`
Expected: FAIL — `private` is `true`

- [ ] **Step 3: 改 package.json**

```json
{
  "name": "deepseek-brain",
  "version": "0.2.0",
  "type": "module",
  "license": "MIT",
  "os": ["win32"],
  "engines": { "node": ">=20" },
  "bin": { "deepseek-brain": "dist/cli.js" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./core": { "types": "./dist/core/index.d.ts", "default": "./dist/core/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md", "selectors.json"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/cli.js",
    "smoke": "node scripts/smoke.mjs"
  },
  "dependencies": { "puppeteer-core": "24.10.2" },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^24.0.0"
  }
}
```

`puppeteer-core` 版本须用 `npm ls puppeteer-core` 查出的**当前实际安装版本**替换 `24.10.2`，保持不变即可（去掉 `^`）。

- [ ] **Step 4: tsconfig 开 declaration**

在 `compilerOptions` 加 `"declaration": true`。

- [ ] **Step 5: 创建 src/cli.ts（最小可跑，后续任务再扩参数）**

```ts
#!/usr/bin/env node
import { loadConfig } from './config.js'

const config = loadConfig()
console.log(`deepseek-brain v0.2.0 — port ${config.port}`)
console.log('full CLI (flags, login subcommand) lands in Task 5')
process.exit(0)
```

- [ ] **Step 6: 实测打包链路（这一步是 DeepSeek 指定的阻断 gate）**

```bash
npm run build
node -e "const s=require('fs').readFileSync('dist/cli.js','utf8');console.log(s.startsWith('#!/usr/bin/env node')?'SHEBANG OK':'SHEBANG LOST')"
npm pack
```

Expected: `SHEBANG OK`，并生成 `deepseek-brain-0.2.0.tgz`

再实测安装 + npx（PowerShell）：

```powershell
$td = "$env:TEMP\brain-pack-test"; Remove-Item -Recurse -Force $td -ErrorAction SilentlyContinue; New-Item -ItemType Directory $td | Out-Null; cd $td; npm init -y | Out-Null; npm install "D:\15812\Documents\deepseek-brain\deepseek-brain-0.2.0.tgz" --no-audit --no-fund; npx deepseek-brain
```
Expected: 打印 `deepseek-brain v0.2.0 — port 8790`，无 `Permission denied` / `SyntaxError`

- [ ] **Step 7: 验证 dist 产物齐全**

```bash
node -e "const fs=require('fs');for(const f of ['dist/index.js','dist/index.d.ts','dist/core/index.js','dist/core/index.d.ts','dist/cli.js'])console.log(f, fs.existsSync(f)?'OK':'MISSING')"
```
Expected: 五行全 `OK`

- [ ] **Step 8: 测试 + 提交**

Run: `npm run typecheck; if ($?) { npm test }`

```bash
git add package.json tsconfig.json src/cli.ts tests/pack.test.ts
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "build: publishable package metadata with a verified bin

ESM-only with conditional exports so TypeScript consumers resolve types
for both the root and ./core subpath, plus an explicit ./package.json
export that bundlers need. os is limited to win32 so installation fails
with a clear message elsewhere instead of a cryptic runtime error.

The bin is verified end to end (npm pack, install the tarball, run npx)
because a lost shebang or a missing +x only shows up at install time, not
at build time."
```

---

### Task 5: 完整 CLI + 首次运行阻塞登录 + health.loggedIn

**Files:**
- Rewrite: `src/cli.ts`
- Create: `src/cli-args.ts`、`tests/cli-args.test.ts`
- Modify: `src/transports/deepseek-web.ts`（`health()` 增加 `loggedIn`）

**Interfaces:**
- Consumes: Task 1 的 `detectWindowsChrome` / `chromeNotFoundMessage`、Task 2 的 `Transport`、`src/config.ts` 的 `loadConfig`
- Produces:
  ```ts
  // src/cli-args.ts
  export interface CliOptions {
    port: number; profile?: string; chromePath?: string
    poolSize: number; headless: boolean; verbose: boolean
    command: 'serve' | 'login'
  }
  export function parseArgs(argv: string[]): CliOptions
  ```

- [ ] **Step 1: 写失败测试**

`tests/cli-args.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseArgs } from '../src/cli-args.js'

describe('parseArgs', () => {
  it('默认串行且 headless 关', () => {
    const o = parseArgs([])
    expect(o.poolSize).toBe(1)
    expect(o.headless).toBe(false)
    expect(o.command).toBe('serve')
  })
  it('解析 --port', () => {
    expect(parseArgs(['--port', '9000']).port).toBe(9000)
  })
  it('解析 login 子命令', () => {
    expect(parseArgs(['login']).command).toBe('login')
  })
  it('解析 --headless 与 --verbose', () => {
    const o = parseArgs(['--headless', '--verbose'])
    expect(o.headless).toBe(true); expect(o.verbose).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/cli-args.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 cli-args.ts**

```ts
export interface CliOptions {
  port: number
  profile?: string
  chromePath?: string
  poolSize: number
  headless: boolean
  verbose: boolean
  command: 'serve' | 'login'
}

export function parseArgs(argv: string[]): CliOptions {
  const o: CliOptions = { port: 8790, poolSize: 1, headless: false, verbose: false, command: 'serve' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === 'login') { o.command = 'login'; continue }
    if (a === '--headless') { o.headless = true; continue }
    if (a === '--verbose') { o.verbose = true; continue }
    if (a === '--port') { o.port = Number(argv[++i]); continue }
    if (a === '--profile') { o.profile = argv[++i]; continue }
    if (a === '--chrome-path') { o.chromePath = argv[++i]; continue }
    if (a === '--pool-size') { o.poolSize = Math.max(1, Number(argv[++i])); continue }
  }
  return o
}
```

- [ ] **Step 4: health() 增加 loggedIn**

`deepseek-web.ts` 的 `HealthStatus` 返回改为携带 `loggedIn`：

```ts
export type HealthStatus = 'ok' | 'login_required' | 'ui_changed' | 'error'
```

在 `health()` 内，已知页面加载完成的判据处返回：

```ts
{ status: loggedIn ? 'ok' : 'login_required', loggedIn }
```

`loggedIn` 判据：DeepSeek 已登录时聊天输入框可见。**实现时以当前 `health()` 已有的页面就绪判据为基础**，在其之后追加输入框可见性检查；若已有判据无法区分，改用「输入框元素存在且可见」。不得引入新选择器——复用 `selectors.json` 里已存在的输入框选择器。

- [ ] **Step 5: 首次运行阻塞等登录**

`src/cli.ts` 的 `main()`：

```ts
#!/usr/bin/env node
import { loadConfig } from './config.js'
import { parseArgs } from './cli-args.js'
import { createHttpServer, setTransportGetter } from './server/http.js'
import { createWebBridge } from './transports/deepseek-web.js'
import { detectWindowsChrome, chromeNotFoundMessage, windowsChromeCandidates } from './transports/chrome-detect.js'

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const config = loadConfig({ ...process.env, ...(opts.port ? { PORT: String(opts.port) } : {}) })
  if (opts.profile) config.browser.profileDir = opts.profile
  if (opts.headless) config.browser.headless = true

  // 早失败：server 启动时探测浏览器，不等首次请求
  const chrome = opts.chromePath ?? detectWindowsChrome()
  if (!chrome) { console.error(chromeNotFoundMessage(windowsChromeCandidates(process.env))); process.exit(1) }
  console.log(`[brain] browser: ${chrome}`)

  const bridge = createWebBridge(config)
  setTransportGetter(() => bridge)

  // 首次运行阻塞等登录：请求不能比用户手动登录更早超时
  let h = await bridge.health()
  while (!h.loggedIn) {
    console.log('[brain] waiting for login in the Chrome window...')
    await bridge.start()
    await waitFor(async () => (await bridge.health()).loggedIn, 5 * 60_000)
    h = await bridge.health()
  }

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

`login` 子命令只做登录不做监听：解析后若 `command === 'login'`，启动 bridge、等待登录完成、打印成功信息后 `process.exit(0)`。

- [ ] **Step 6: 验证**

Run: `npm run typecheck; if ($?) { npm test }; if ($?) { node dist/cli.js --help }`
Expected: 全绿，CLI 打印版本与用法

- [ ] **Step 7: 提交**

```bash
git add src/cli.ts src/cli-args.ts tests/cli-args.test.ts src/transports/deepseek-web.ts
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "feat(cli): blocking first-run login and full flag surface

Lazy Chrome launch meant the first request timed out while the user was
still logging in, so startup now blocks until the login state is detected.
Browser detection runs at server start to fail fast on a bad config, while
the process launch stays lazy on first request.

Defaults stay conservative: pool size 1 and headless off, both opt-in."
```

---

### Task 6: 效率优化（progress 尾增量 / SSE 增量 / 懒启动）

**Files:**
- Modify: `src/transports/deepseek-web.ts`（PROBE 字符串、bucketSSE）
- Modify: `tests/deepseek-bucket-sse.test.ts`
- Create: `tests/probe-increment.test.ts`

**Interfaces:**
- Consumes: Task 2 迁移后的 transport 文件
- Produces: 纯函数 `appendTail(prev: string, next: string): string`，供 PROBE 内联逻辑与测试共用

- [ ] **Step 1: 写失败测试**

`tests/probe-increment.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { appendTail } from '../src/transports/tail.js'

describe('appendTail', () => {
  it('只取新增部分', () => {
    expect(appendTail('abc', 'abcdef')).toBe('def')
  })
  it('无新增时返回空串', () => {
    expect(appendTail('abc', 'abc')).toBe('')
  })
  it('空 prev 时返回全部', () => {
    expect(appendTail('', 'abc')).toBe('abc')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/probe-increment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 tail.ts**

```ts
/** SSE 累积：responseText 每次 progress 都是整份，只取新增尾部，
 *  避免长流 O(n²) 的整缓冲复制。 */
export function appendTail(prev: string, next: string): string {
  return next.length > prev.length && next.startsWith(prev) ? next.slice(prev.length) : next
}
```

- [ ] **Step 4: PROBE 改为增量累积**

在 PROBE 字符串里，把两处 `entry.resp = this.responseText` 替换为增量累积（保持 IIFE 内联，逻辑等价于 `appendTail`）：

```js
entry.resp += this.responseText.slice(entry.resp.length);
```

`progress` 与 `loadend` 两处都改。`done` 时改为记录长度判据：

```js
this.addEventListener('loadend', function(){ entry.status = this.status; entry.done = true; entry.respLen = this.responseText.length; entry.resp += this.responseText.slice(entry.resp.length); });
```

- [ ] **Step 5: bucketSSE 增量校验**

对 `tests/deepseek-bucket-sse.test.ts` 增加一条用例：同一份 SSE 分两次喂入（前半、后半），结果与一次喂入整份**必须相同**。

- [ ] **Step 6: 验证 + 提交**

Run: `npm run typecheck; if ($?) { npm test }`

```bash
git add src/transports/deepseek-web.ts src/transports/tail.ts tests/
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "perf: incremental stream accumulation

The page probe assigned the entire responseText on every progress event,
which is O(n^2) in buffer copies on long streams. Appending only the new
tail keeps it linear. Adds a regression test asserting that feeding SSE in
two halves yields the same result as feeding it whole."
```

---

### Task 7: 社区文件

**Files:**
- Create: `CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`CHANGELOG.md`、`.github/ISSUE_TEMPLATE/bug_report.md`、`.github/ISSUE_TEMPLATE/feature_request.md`、`.github/PULL_REQUEST_TEMPLATE.md`
- Create: `LICENSE`（MIT，版权行 `Copyright (c) 2026 15812`）

**Interfaces:**
- Consumes: 无（纯文档）
- Produces: 无代码接口

- [ ] **Step 1: 写 LICENSE**

MIT 全文，版权行 `Copyright (c) 2026 15812`。

- [ ] **Step 2: 写 CONTRIBUTING.md（核心是「如何加一个 transport」）**

必须包含这一节的完整步骤：

```markdown
## 新增一个 transport

1. 实现 `src/core/types.ts` 的 `Transport` 接口（6 个方法）
2. `getCapabilities()` 如实回报：是否支持 thinking、是否支持 resume、上下文墙大小
3. 若你的后端无会话概念，用 `statelessStrategy` 作 `keyStrategy`
4. 用 `createPlanner()` 装配；不要 import `transports/` 下的任何东西
5. 跑 `npm test`——core 的边界测试会拒绝 core 依赖具体 transport
```

- [ ] **Step 3: 写 SECURITY.md**

报告渠道用 GitHub Security Advisory；明确「本项目不收集任何遥测、不上传数据」。

- [ ] **Step 4: 写 CODE_OF_CONDUCT.md**

采用 Contributor Covenant v2.1，联系方式留 issue。

- [ ] **Step 5: 写 CHANGELOG.md**

```markdown
# Changelog

## [0.2.0] - 2026-10-01
### Added
- `deepseek-brain/core` subpath export：文本规划器协议内核可独立复用
- `Transport.cancel()` / `getCapabilities()`
- `deepseek-brain login` 子命令与首次运行阻塞登录
### Changed
- 三层解耦：core / transports / server
- Windows-only，Chrome 路径自动探测
### Removed
- **破坏性**：删除把作者个人 Nuphus 浏览器 profile 复制为登录态的机制
- 硬编码的个人 Chrome 路径
```

- [ ] **Step 6: 写 Issue 与 PR 模板**

bug_report.md 必须要求填写：Node 版本、Windows 版本、Chrome 版本、`/health` 输出、以及 `CHROME_PATH` 是否显式设置。

- [ ] **Step 7: 提交**

```bash
git add LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md CHANGELOG.md .github/
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "docs: community health files for public release

CONTRIBUTING documents how to add a transport, which is the main reason a
third party would use this project. CHANGELOG flags the removal of the
profile-seeding mechanism as breaking so existing users are not surprised."
```

---

### Task 8: README + examples + e2e 清单

**Files:**
- Rewrite: `README.md`
- Create: `examples/opencode.jsonc`、`examples/claude_desktop_settings.json`、`examples/cline.md`、`examples/aider.md`
- Modify: `docs/e2e-checklist.md`

**Interfaces:**
- Consumes: Task 4 的 `exports`、Task 5 的 CLI 参数
- Produces: 无代码接口

- [ ] **Step 1: 写 README 顶部两段声明（顺序不可调换）**

第一段（非官方声明）：

```markdown
> **本项目非 DeepSeek 官方项目**，与 DeepSeek 无任何关联。
```

第二段（ToS 风险）：

```markdown
> **ToS 风险**：本项目通过自动化驱动 DeepSeek 网页版，**可能违反 DeepSeek 服务条款，可能导致你的账号被限制或封禁**。风险自负。请勿使用重要账号。
```

- [ ] **Step 2: 写安装与验证**

```markdown
## 安装
npx deepseek-brain            # 首次运行会弹出 Chrome，手动登录一次
npx deepseek-brain login      # 单独触发登录
```

指向 `http://127.0.0.1:8790/v1`，验证命令用 `curl.exe -o` 形式（避免 PS 5.1 编码陷阱）。

- [ ] **Step 3: 写四个 agent 的配置片段**

OpenCode 用 `@ai-sdk/openai-compatible` + baseURL `http://127.0.0.1:8790/v1`；Claude Code / Cline / aider 各自写实际字段，**实现时以各自官方文档为准，不确定则标注「待验证」而不是编造**。

- [ ] **Step 4: 写架构图、core API、局限**

局限必须含：选择器脆弱、仅 Windows、并发=1、上下文墙（compaction 缓解）、中文 UI 依赖。

- [ ] **Step 5: 追加 Windows 三坑到 e2e-checklist**

PowerShell 5.1 按 GBK 解码 curl 输出（实测丢 26 字符，必须 `curl -o`）；JSON 校验用 `node -e` 不用 `Get-Content -Raw | ConvertFrom-Json`；`Start-Process -RedirectStandardOutput` 的假 `ChildProcess.kill`。

- [ ] **Step 6: 验证 README 命令真实可用**

按 README 逐条实跑一遍 `npx` 启动与 curl 验证，输出写进 e2e-checklist 作为证据。

- [ ] **Step 7: 提交**

```bash
git add README.md examples/ docs/e2e-checklist.md
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "docs: README rewrite with dual notices and per-agent setup

The non-official notice and the ToS risk notice are separate blocks on
purpose: merging them left users believing the only risk was a broken
setup, when the real risk is account loss. Every command in the README was
executed before committing, and the three PowerShell 5.1 traps found
during live review are now in the e2e checklist."
```

---

### Task 9: CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 4 的 `npm pack` 链路验证要求
- Produces: 无代码接口

- [ ] **Step 1: 写 ci.yml**

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  verify:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - name: verify bin shebang survived compilation
        run: node -e "const s=require('fs').readFileSync('dist/cli.js','utf8');if(!s.startsWith('#!/usr/bin/env node')){console.error('SHEBANG LOST');process.exit(1)}console.log('SHEBANG OK')"
      - name: verify declaration output
        run: node -e "const fs=require('fs');for(const f of ['dist/index.d.ts','dist/core/index.d.ts'])if(!fs.existsSync(f)){console.error('MISSING',f);process.exit(1)}console.log('DECLARATIONS OK')"
      - name: verify tarball installs and bin runs
        run: |
          npm pack
          cd $env:RUNNER_TEMP
          npm init -y
          npm install ${{ github.workspace }}\deepseek-brain-*.tgz --no-audit --no-fund
          npx deepseek-brain
```

- [ ] **Step 2: 验证配置语法**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8');console.log(s.includes('runs-on: windows-latest')?'OK':'MISSING')"`
Expected: `OK`

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git -c user.name="Jarvis" -c user.email="jarvis@local" commit -m "ci: Windows matrix verifying build, declarations and bin tarball

Building is not enough to prove npx works: the shebang and the declaration
output only matter after packing, installing the tarball and running the
bin, so CI does all three."
```

---

## Self-Review

**Spec 覆盖核对**

| Spec 节 | 任务 |
|---|---|
| §3.1 core 依赖方向 | Task 2（边界测试） |
| §3.1.1 core 允许/禁止清单 | Task 2（静态检查）+ Task 3（阈值/策略接口化） |
| §3.2 Transport `cancel`/`getCapabilities` | Task 2 Step 3-4 |
| §4 三层重构映射 | Task 2 |
| §5.1 删硬编码 + 删 Nuphus 机制 | Task 1 |
| §5.2 Windows Chrome 探测 | Task 1 |
| §5.3 版本固定 + `os: win32` | Task 4 |
| §5.4 profile 配置化 | Task 1 + Task 5 |
| §5.5 探测早失败 / 拉起懒启动 | Task 5 |
| §5.6 Windows 三坑 | Task 8 |
| §6 默认串行 + headless 关 | Task 5（`poolSize=1` 默认） |
| §6.1 阻塞登录 + `login` 子命令 + `loggedIn` | Task 5 |
| §7 ESM-only + 条件 exports + shebang + npm pack | Task 4 |
| §8 两段声明 + 社区文件 | Task 7 + Task 8 |
| §9 CI + core 独立测试 | Task 9 |
| §10 效率三项 | Task 6 |
| §11 发布流程 | 非代码任务，sir 手动执行 |

无遗漏任务。

**类型一致性核对**：`Capabilities` 定义于 Task 2，Task 3/5 消费；`SessionStore`/`SessionKeyStrategy` 定义于 Task 3，Task 5 的 `PlannerDeps` 消费；`parseArgs` 定义于 Task 5，`cli.ts` 同任务消费；`detectWindowsChrome` 定义于 Task 1，Task 5 消费。命名一致。

**已知未做**：P1 的 compaction 预热（80% 提前开会话）——spec §10 已标为「可选」，YAGNI 不做。
