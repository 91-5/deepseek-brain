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
- Windows 支持与配置化（**仅 Windows**）
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

### 3.1.1 core 允许 / 禁止清单

依赖倒置只保证**依赖方向**，不保证**模块内聚**——core 里仍可能藏着 transport 假设。因此除 import 检查外，core 有如下硬约束：

**必须参数化（禁止魔法数）**

| 当前值 | 位置 | 改为 |
|---|---|---|
| `compactTokenThreshold: 40000` | `config.ts:26` | 默认值取自 `transport.getCapabilities().maxContextTokens`；config 降级为覆盖手段而非定义处 |
| chars/4 的 token 估算系数 | `session/manager.ts` `estimateTokens` | 由 `getCapabilities().tokenEstimator` 提供，默认实现可留 core |

**必须接口化（可替换策略）**

- `SessionKeyStrategy` — 现有「消息前缀 hash」策略隐含假设「transport 支持用前缀复用会话」。无状态后端（每次调用独立）根本没有 session 概念，必须能替换。默认实现放 core，但不是唯一路径
- `SessionStore` — 现有 `session/store.ts` 直接 `fs` 读写 `.sessions.json`，无接口。测试替身与用户自定义存储需要它

**禁止出现在 core**

DeepSeek URL、选择器字符串、任何站点特定常量、`puppeteer-core`、以及绕过 `SessionStore` / `LogSink` 的 Node fs 直呼。

> 落地方式：一条 lint 规则 + code review checklist。CI 的 import 检查只能抓显式 `import`，抓不到硬编码常量与假设耦合——这是第二轮评审明确指出的缺口。

> 说明：外部评审曾指出「core 依赖 transport 所以边界糊」。本设计明确采用依赖倒置——依赖接口不依赖实现——因此不把 `session/`、`compaction/` 移出 core，而是补强上述约束。

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

## 5. Windows 支持与配置化

> **范围决定（2026-10-01）**：仅支持 Windows，Linux / macOS 不做。代价是受众受限（GitHub 开发者基数以 macOS/Linux 为主）——这是受众决策而非风险决策。收益是跨平台探测、snap/Flatpak 路径、`~/Applications`、无显示器远程场景全部不需要实现。

### 5.1 必须删除的两处个人资产

**① 硬编码路径**（`web-bridge.ts:17-18`）

```ts
const CHROME = process.env.CHROME_PATH ?? 'C:\\Users\\15812\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
const NUPHUS_PROFILE = path.join(os.homedir(), 'AppData', 'Roaming', 'Nuphus', 'browser_profile_v2')
```

**② `ensureProfileDir()` 的登录态复制机制**（`web-bridge.ts:199-204`）

```ts
fs.cpSync(NUPHUS_PROFILE, dest, { recursive: true, errorOnExist: false })
console.log('[web-bridge] copied Nuphus profile (login reused)')
```

每次启动把作者个人的 Nuphus 浏览器 profile 整个复制进工作目录当登录态。这不是路径问题，是**把作者的个人浏览器数据当实现机制**——别人机器上不存在该目录，开源必须彻底删除，改为 §6 的文档化手动登录。

### 5.2 Chrome 探测（Windows only）

- `CHROME_PATH` env / `--chrome-path` 优先
- 否则按序探测：

| 优先级 | 路径 |
|---|---|
| 1 | `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`（per-user 安装为主） |
| 2 | `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe` |
| 3 | `%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe` |
| 4 | `%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe` |
| 5 | `%LOCALAPPDATA%\Chromium\Application\chrome.exe` |

- 全部未命中 → **server 启动时**明确报错并打印上表，不做静默 fallback
- 启动时打印探测到的浏览器版本与路径

### 5.3 版本兼容

- README 声明最低 Windows Chrome 版本（以 `puppeteer-core` 24.x 的 CDP 依赖为准，开工时实测确定）
- `package.json` 固定 `puppeteer-core` 版本，**不用 `^`**——CDP 方法缺失只在运行时炸，漂移不可接受
- `package.json` 声明 `"os": ["win32"]`：非 Windows 上 npm 安装时即给明确提示，而非装完运行时报看不懂的错

### 5.4 profile

- CLI `--profile` > `BRAIN_PROFILE` env > `path.join(os.homedir(), '.deepseek-brain', 'profile')`
- 明确文档化：**不要指向用户日常 Chrome 的 profile**——Chrome 单实例锁会导致连不上
- 启动时检测 profile 被占用并给出可操作提示

### 5.5 探测时机 vs 懒启动（消解评审指出的矛盾）

- **探测在 server 启动时**做——早失败，让配置错误立刻暴露
- **Chrome 进程在首次请求时**拉起——省常驻资源

两者不冲突：探测是 `fs.existsSync`，拉起是 `spawn`。

### 5.6 Windows 特有的坑（写进 README 与 e2e-checklist）

- **PowerShell 5.1 按 GBK 解码 UTF-8 输出**：`curl.exe` 的 UTF-8 响应经 PowerShell 字符串层会变成乱码，且不可逆丢失字符（实测一次评审回复丢了 26 个字符）。验证脚本必须用 `curl -o <file>` 让 curl 直接写字节，或全程用 node 处理
- 验证 JSON 必须用 `node -e` 而非 `Get-Content -Raw | ConvertFrom-Json`——后者对 UTF-8 中文文件会误报未终止字符串
- `Start-Process -RedirectStandardOutput` 在某些 harness 下报 `ChildProcess.kill` 假错，进程实际存活，需轮询日志确认

## 6. 默认值与实验开关

| 能力 | 默认 | 说明 |
|---|---|---|
| 并发数 | **1（严格串行）** | 单账号多上下文会导致网页侧会话互扰与 sentCount 串台（代码 bug，v0.1 已修过同类）。`--pool-size N` 显式开启 |
| headless | **关闭** | 很多站点检测 headless / `navigator.webdriver` 特征，会**当场拒绝服务**而非慢慢封号。默认开启等于让人第一次跑就失败。`--headless` 显式开启，启动时打印风险提示 |
| 登录 | 首次运行需在弹出的 Chrome 手动登录 | profile 持久化，后续重启自动恢复 |

这两个开关存在的理由是「默认开启会功能失败」，不是风险规避。

**诚实陈述（第二轮评审纠正）**：默认关并发与 headless 同时也降低了风控暴露面——单账号多并发是自动化最明显的特征之一。两条理由**独立成立，任一都足以支持默认关**：① 技术：headless 会被站点当场拒绝，并发导致会话互扰与 sentCount 串台；② 合规：并发是自动化最明显特征，默认关降低 ToS 风险。

### 6.1 首次登录 UX（已拍板：阻塞等登录）

评审指出懒启动与登录流程矛盾：Chrome 首次请求才拉起，此时用户手动登录，**请求早已超时**。解法：

- 有 profile 且检测到已登录 → 立即监听端口
- 无 profile / 未登录 → 启动 Chrome 并**阻塞等待登录完成**，检测到登录态后才开始监听，并打印「等待登录中…完成后自动继续」
- 登录态检测：`health()` 返回值增加 `loggedIn: boolean`，检测方式（DOM 元素 / cookie / URL 判据）实现时确定并写入 spec 附录
- 提供 `deepseek-brain login` 子命令，供已运行中的实例主动触发登录流程

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

**模块格式：ESM-only**（2026-10-01 拍板）。项目已是 `"type": "module"` + tsc 直出 + 无打包器，不引入 CJS 双出，因此无需打包器，`exports` 不写 `import`/`require` 双条件。

### 7.1 bin 入口的三个必做项

1. **`src/cli.ts` 首行必须是 `#!/usr/bin/env node`**——tsc 不会自动加 shebang 也不会 chmod。构建后需实测 `dist/cli.js` 首行保留
2. **cli.ts 只用 ESM import**，不得出现 `require`
3. **CI 必须实测打包链路**：`npm pack` → 安装 tarball 到临时目录 → `npx deepseek-brain --help`。只跑 `build` 不能证明 bin 可用——shebang 丢失时报 `Permission denied` 或 `SyntaxError: invalid character`

### 7.2 exports 用条件导出

字符串形式会让 TS 用户拿不到类型声明，IDE 报「找不到类型声明」：

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./core": { "types": "./dist/core/index.d.ts", "default": "./dist/core/index.js" },
  "./package.json": "./package.json"
}
```

- `"./package.json"` **必须显式导出**，否则 vite 等 bundler 与部分工具读不到（经典坑）
- `tsconfig` 开 `declaration: true`，并实测 `dist/core/index.d.ts` 真的产出（core 的 `types.ts` 只导出类型，须 re-export 到 `core/index.d.ts`）

`cli.js` 参数：`--port --profile --chrome-path --pool-size --headless --verbose`，另加 §6.1 的 `login` 子命令。

## 8. 文档与社区文件

- `README.md`：定位 → **免责声明 + 非官方声明** → 安装（`npx deepseek-brain`）→ 各 agent 配置片段 → 架构图 → core API → 局限（选择器脆弱 / 不支持并发 / 上下文墙 / 中文 UI 依赖）
- `examples/`：`opencode.jsonc`、`claude_desktop_settings.json`、`cline`、`aider`
- `CONTRIBUTING.md`（含「如何新增一个 transport」的完整步骤）、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`CHANGELOG.md`、Issue/PR 模板
- `docs/e2e-checklist.md` 追加一条 Windows 陷阱：PowerShell 5.1 会按 GBK 解码 curl 的 UTF-8 输出导致字符不可逆丢失，验证脚本必须用 `curl -o` 直接写字节

### 免责声明的真实理由

保留两件独立的事，第二轮评审指出合并成一句属于**误导性披露**：

1. **非官方声明**（防商标关联误解）——npm 包名叫 `deepseek-brain` 会被默认理解为官方项目
2. **ToS 风险段落**（防风险误解）——措辞直白：*本项目通过自动化驱动网页版，可能违反 DeepSeek 服务条款，可能导致账号被限制或封禁，风险自负*

第 2 条与「风险自负」的立场不冲突：用户要自己解决风险，前提是先知道风险是什么。只写「可能跑不通」而漏「可能账号没了」，用户会误判。

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

**P0（发布阻断）**：§4 机械重构 → §5 Windows 配置化（含删除 Nuphus 复制机制）→ §6 默认值与登录 UX → §7 打包 → §8 文档 → §9 CI

**P1（性能）**：§10 前两项 + 懒启动

**发布流程**（第二轮评审补强，原版缺了最关键一步）

「能构建」≠「能跑」。构建是 CI 层面，运行是 e2e。真正的发布 gate 是**陌生人验证**。

1. private repo → 内部 dogfood（作者自测全链路）
2. **陌生人 + 干净 Windows 机器 + 只读 README**：找一名未参与开发的人，在干净的 Windows 机器上从 `git clone` 到首次成功请求，**全程只按 README、不改代码**。这一步能在 30 分钟内暴露 80% 的「第一次跑不起来」问题
3. 按发现的问题修一轮
4. public repo（**先不发 npm**），让人用 `npm install github:you/deepseek-brain` 或 `npx github:...` 验证
5. 第二批陌生人从 GitHub 装，再修一轮
6. npm 发 `0.2.0-beta.1`（GitHub prerelease + tag），收集 issue 修一轮
7. npm 发 `0.2.0`

补充：npm 包名一旦发布难以收回（unpublish 有 72 小时限制与污染问题），故 npm 晚于 public repo。转 public 前准备好「已知问题」置顶 issue 与快速 patch 流程。

**版本策略**：网页端一改就崩，主版本号要敢跳。

## 12. 已识别的死因与最小预防

| 死因 | 预防 |
|---|---|
| DeepSeek 前端改版 / 反自动化升级，选择器全挂 | 选择器集中在 `selectors.json` 便于 PR；`/health` 端点；DOM 快照日志；README 声明随时可能失效 |
| 变成「只有作者能跑的脚本」 | core 干净可独立测试；CI 自动化；CONTRIBUTING 写清「如何加 transport」 |
| 硬编码个人路径，别人 clone 即崩 | §5 Windows 配置化 |

## 13. 决策记录

- **2026-10-01 评审采纳**：`Transport` 补 `cancel` / `getCapabilities`；跨平台列为发布阻断级；社区文件全套；headless 与并发降为默认关的实验开关
- **2026-10-01 评审驳回**：「core 依赖 transport 故边界糊」——采用依赖倒置解释，不把 `session/`、`compaction/` 移出 core，改为加静态 import 检查
- **2026-10-01 sir 定调**：风险披露到 README 即可，不做过度保守设计；只保留「非官方声明」以防商标关联误解
- **2026-10-01 现场发现**：DeepSeek 在无 `tools[]` 时主动拒绝编造工具名（"任何工具名都是我编造的"），是文本协议反幻觉约束有效的证据，值得写进 README

### 第二轮评审（对 spec 草案，DeepSeek，6403 tokens）

- **接受**不把 session/compaction 移出 core，但**驳回「CI import 检查就够了」**：DIP 只管依赖方向，不管模块内聚。补 `SessionKeyStrategy` / `SessionStore` 接口化 + core 禁 transport 特定常量
- **修正**：40K 阈值实际在 `config.ts:26` 且已支持 `COMPACT_THRESHOLD` env，非「硬编码在 core」；但默认值的深层问题成立——应来自 `getCapabilities().maxContextTokens`
- **采纳发布流程补强**：spec 缺「陌生人 + 干净机器 + 只读 README」这一步，这是比任何技术细节都更容易翻车的地方
- **超出评审的发现**：`web-bridge.ts:200` 每次启动把作者个人的 Nuphus 浏览器 profile 整个 `cpSync` 进工作目录当登录态（日志 `copied Nuphus profile (login reused)`）。这不是路径问题，是把作者个人数据当实现机制，开源必须彻底删除
- **接受其对我动机的质疑**：默认关并发/headless 不只是技术原因，也客观降低了风控暴露面。spec 已改为两条并列陈述，不再声称「非风险规避」

### 已拍板的三个前置决策（2026-10-01）

1. **模块格式：ESM-only**。项目已是 `"type": "module"` + tsc 直出 + 无打包器，不引入 CJS 双出。`exports` 用条件导出（`types` / `default`），并显式导出 `"./package.json"`
2. **首次登录 UX：首次运行阻塞等登录**。有 profile 则立即监听；无 profile 则弹 Chrome 阻塞等待，检测到登录完成再监听端口。与懒启动不冲突
3. **ToS 披露：照办**。README 顶部独立 ToS 风险段落，与「非官方声明」并列
4. **平台范围：仅 Windows**。Linux / macOS 不做。`package.json` 加 `"os": ["win32"]` 让错误在安装期暴露。诚实代价：受众受限，GitHub 开发者基数以 macOS/Linux 为主
