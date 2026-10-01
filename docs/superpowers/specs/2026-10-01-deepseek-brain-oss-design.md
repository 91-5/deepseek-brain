# deepseek-brain 开源化设计（v0.2.0）

- 日期：2026-10-01
- 状态：待 sir 审阅
- 前置：v0.1.0 已在 `D:\15812\Documents\deepseek-brain` 跑通（71 测试通过，SSE 分流 / session 深链 / compaction / newChat 四条 live 路径全部实证）

---

## 1. 背景

v0.1.0 是一个个人工具：Node 24 + TypeScript 本地 shim，通过 CDP 驱动受控 Chrome 抓取 DeepSeek 网页版的流式回答，对外暴露 OpenAI 兼容的 `/v1/chat/completions`。它让没有原生 function calling 的纯对话模型充当 agent 的「规划器大脑」——工具调用靠文本协议实现（system prompt 注入工具定义 → 模型输出 ` ```tool_call ` 代码块 → 解析回标准 `tool_calls`）。

问题：代码里硬编码了作者个人路径（`C:\Users\15812\...` 的 Chrome 可执行文件与浏览器 profile 目录），`package.json` 标 `private: true`，README 只有 26 行且仅覆盖 OpenCode 接入。别人 clone 下来跑不起来。

目标：让它成为一个任何支持 OpenAI 兼容端点的 agent 都能接入的开源项目，并把「文本规划器」协议内核抽成可独立复用的模块。

## 2. 定位与范围

**做什么**

- DeepSeek 网页版作为**唯一** transport
- 三层解耦：`core/`（transport 无关、可复用）→ `transports/deepseek-web.ts`（唯一 DeepSeek 专属代码）→ `server/`（OpenAI 兼容 HTTP）
- `core` 以 npm subpath 导出，别人可以只拿协议内核接自己的哑模型后端
- 跨平台配置化（Linux / macOS / Windows）
- 主流 agent 的接入文档

**明确不做（YAGNI）**

- 多后端插件注册表 / adapter 发现机制
- Docker、Web UI
- DeepSeek 官方 API 回退路径
- 不修改 OpenCode / Claude Code 等 agent 本体，只给配置片段
- 不提供任何绕过风控的手段

## 3. 架构

```
┌─ core/                      transport 无关，可独立复用（npm subpath 导出）
│   planner.ts                buildTurn / parseReply / renderToolResult
│   session/                  前缀 key、.sessions.json 持久化
│   compaction/               转录摘要 + 会话重置
│   types.ts                  Transport 接口（纯类型，零运行时依赖）
│
├─ transports/deepseek-web.ts  唯一 DeepSeek 专属代码
│     实现 Transport { generate, newChat, health, lastChatSessionId, resetSession, cancel, getCapabilities }
│
└─ server/                     OpenAI 兼容 HTTP，harness 无关
```

### 3.1 依赖方向规则（硬约束）

- `core/` **绝不 import** `transports/` 的任何模块
- `core/` 只依赖 `Transport` **接口**（依赖倒置）。compaction 需要开新会话时，通过 `Transport.newChat()` 通知 transport，不自己去操作 DOM
- `core/` 的 `package.json` exports 段**不拖 `puppeteer-core`**，只有 `server/` 与 `transports/` 依赖它
- CI 有一条检查：若 `core/` 出现对 `transports/` 或 `puppeteer-core` 的 import，测试失败

> 说明：外部评审曾指出「core 依赖 transport 所以边界糊」。本设计明确采用依赖倒置——依赖接口不依赖实现——因此不把 `session/`、`compaction/` 移出 core，而是补强 import 方向的静态检查。

### 3.2 对外 core API

```ts
import { createPlanner } from 'deepseek-brain/core'

const planner = createPlanner()   // v0.2.0 仅实现 fence-json 一种协议
planner.buildTurn(messages, tools)   // → { sendDelta, sessionKey, sentCount }
planner.parseReply(rawText)           // → { toolCall?: ToolCall, content: string }
planner.renderToolResult(id, name, r) // → string
```

文档主张（README 原文）：*如果你有一个不会 tool calling 的模型，不管是网页 UI、TUI 还是 telnet，实现 4 个方法的 `Transport`，就能免费得到 OpenAI 兼容的 tool-loop 行为。*

`Transport` 接口（v0.2.0 补齐评审指出的缺口）：

```ts
interface Transport {
  generate(req: GenerateRequest): AsyncIterable<GenerateChunk>
  newChat(): Promise<void>
  health(): Promise<HealthStatus>
  lastChatSessionId(): string | null
  resetSession(): void
  cancel(): Promise<void>            // 新增：OpenCode 侧取消 / 超时需要
  getCapabilities(): Capabilities    // 新增：supportsThinking / supportsResume / maxContextTokens
}
```

## 4. 重构映射

| 现状 | 目标 |
|---|---|
| `src/protocol/{system-prompt,parser,tool-result}.ts` | `src/core/protocol/*` |
| `src/pipeline.ts` | `src/core/planner.ts` |
| `src/session/{manager,store,compact}.ts` | `src/core/{session/*,compaction/*}` |
| `src/transport/{types,web-bridge}.ts` | `src/core/types.ts`（接口）+ `src/transports/deepseek-web.ts` |
| `src/server/*` | `src/server/*`（仅换 import 路径：pipeline → core） |
| `src/index.ts` | 保持为编程式根导出（`exports["."]`）；**新增** `src/cli.ts` 作为 bin 入口 |

纯机械重构，行为不变。测试文件随源文件同步改名，`tests/` 数量不减。

## 5. 跨平台配置化（发布阻断级）

必须删除的硬编码（`web-bridge.ts:17-18`）：

```ts
const CHROME = process.env.CHROME_PATH ?? 'C:\\Users\\15812\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const NUPHUS_PROFILE = path.join(os.homedir(), 'AppData', 'Roaming', 'Nuphus', 'browser_profile_v2')
```

改为：

- `CHROME_PATH` 环境变量优先
- 否则按平台自动探测候选路径（Linux: `which google-chrome` / `chromium`；macOS: `/Applications/Google Chrome.app/...`；Windows: `%LOCALAPPDATA%` 与 `%PROGRAMFILES%`）
- 都找不到则启动时明确报错并打印各平台候选路径清单，**不做静默 fallback**
- profile 目录：CLI `--profile` 参数 > `BRAIN_PROFILE` env > `path.join(os.homedir(), '.deepseek-brain', 'profile')`
- **移除了对 Nuphus profile 的依赖**——那是作者机器的私有产物，别人没有

## 6. 默认值与实验开关

| 能力 | 默认 | 说明 |
|---|---|---|
| 并发数 | **1（严格串行）** | 单账号多上下文会导致网页侧会话互扰与 sentCount 串台（代码 bug，v0.1 已修过同类）。`--pool-size N` 显式开启 |
| headless | **关闭** | 很多站点检测 headless / `navigator.webdriver` 特征，会**当场拒绝服务**而非慢慢封号。默认开启等于让人第一次跑就失败。`--headless` 显式开启，启动时打印风险提示 |
| 登录 | 首次运行需在弹出的 Chrome 手动登录 | profile 持久化，后续重启自动恢复 |

这两个开关存在的理由是「默认开启会功能失败」，不是风险规避。

## 7. 打包与分发

```json
{
  "name": "deepseek-brain",
  "version": "0.2.0",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "bin": { "deepseek-brain": "dist/cli.js" },
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core/index.js"
  },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"]
}
```

去掉 `private: true`。依赖版本用 lockfile 固定（`npm ci` 供贡献者复现）。

`cli.js` 参数：`--port --profile --chrome-path --pool-size --headless --verbose`

## 8. 文档与社区文件

- `README.md`：定位 → **免责声明 + 非官方声明** → 安装（`npx deepseek-brain`）→ 各 agent 配置片段 → 架构图 → core API → 局限（选择器脆弱 / 不支持并发 / 上下文墙 / 中文 UI 依赖）
- `examples/`：`opencode.jsonc`、`claude_desktop_settings.json`、`cline`、`aider`
- `CONTRIBUTING.md`（含「如何新增一个 transport」的完整步骤）、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`CHANGELOG.md`、Issue/PR 模板
- `docs/e2e-checklist.md` 追加一条 Windows 陷阱：PowerShell 5.1 会按 GBK 解码 curl 的 UTF-8 输出导致字符不可逆丢失，验证脚本必须用 `curl -o` 直接写字节

### 免责声明的真实理由

保留免责与「非 DeepSeek 官方项目」声明，理由不是规避责任，而是**防止商标关联误解**——npm 包名叫 `deepseek-brain` 会被默认理解为官方项目。

## 9. 测试与 CI

- 保持现有 71 个测试（随重构改名不减量）
- 新增 core 独立单元测试（不依赖 transport / 不依赖浏览器）
- 新增一条静态检查：`core/` 不得 import `transports/` 或 `puppeteer-core`
- GitHub Actions：node 24 矩阵，`typecheck` + `test` + `build` 全绿才允许合并
- transport 的 live 测试保持 `describe.skip`，标注需要已登录的 Chrome 实例

## 10. 效率优化（P1，非发布阻断）

| 项 | 判断 | 说明 |
|---|---|---|
| 页内 progress 回调整份复制 `this.responseText` | **必做** | 长流是 O(n²)，改为记录上次长度、只追加新增尾部切片 |
| `bucketSSE` 每 chunk 重新累积整段转录 | **必做** | 改增量解析 |
| Chrome 懒启动 | 做 | 首次请求时才拉起 |
| compaction 预热（80% 阈值提前开会话） | 可选 | 阈值未必触发，默认关 |
| 浏览器并发池 | **移出 P1** | 降为 §6 的实验开关，默认串行 |

## 11. 分期

**P0（发布阻断）**：§4 机械重构 → §5 跨平台 → §6 默认值 → §7 打包 → §8 文档 → §9 CI

**P1（性能）**：§10 前两项 + 懒启动

**发布流程**：P0 完成后先在私有远端跑通，确认 Linux 至少能构建，再转 public。版本策略——网页端一改就崩，主版本号要敢跳。

## 12. 已识别的死因与最小预防

| 死因 | 预防 |
|---|---|
| DeepSeek 前端改版 / 反自动化升级，选择器全挂 | 选择器集中在 `selectors.json` 便于 PR；`/health` 端点；DOM 快照日志；README 声明随时可能失效 |
| 变成「只有作者能跑的脚本」 | core 干净可独立测试；CI 自动化；CONTRIBUTING 写清「如何加 transport」 |
| Windows-only（硬编码路径） | §5 跨平台配置化 |

## 13. 决策记录

- **2026-10-01 评审采纳**：`Transport` 补 `cancel` / `getCapabilities`；跨平台列为发布阻断级；社区文件全套；headless 与并发降为默认关的实验开关
- **2026-10-01 评审驳回**：「core 依赖 transport 故边界糊」——采用依赖倒置解释，不把 `session/`、`compaction/` 移出 core，改为加静态 import 检查
- **2026-10-01 sir 定调**：风险披露到 README 即可，不做过度保守设计；只保留「非官方声明」以防商标关联误解
- **现场发现**：DeepSeek 在无 `tools[]` 时主动拒绝编造工具名（"任何工具名都是我编造的"），是文本协议反幻觉约束有效的证据，值得写进 README
