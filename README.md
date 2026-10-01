# deepseek-brain

> **本项目非 DeepSeek 官方项目**，与 DeepSeek 无任何关联。DeepSeek 不为本项目背书，也不对本工具的任何行为负责。

> **ToS 风险**：本工具通过自动化驱动 DeepSeek 网页版，**可能违反 DeepSeek 服务条款，可能导致你的账号被限流或封禁**。风险自负，请勿使用重要账号。

把 DeepSeek 网页版包装成一个本地 OpenAI 兼容 HTTP API，让任意 agent（OpenCode、Cline、aider……）把它当成一个 subagent 大脑来用。

**Windows only。** `package.json` 声明了 `os: ["win32"]`，非 Windows 平台安装时即被拒绝。

---

## 特性

- **网页版没有函数调用，代码里有。** tool_call 走 ```` ```tool_call ```` 代码块协议（fence-json），协议不成立就带格式提示重试，最多重试 2 次。
- **可复用的三层结构**：`core/`（纯逻辑，不依赖任何具体后端）→ `transports/`（唯一含 DeepSeek 专属代码的地方）→ `server/`（OpenAI 兼容 HTTP）。`core` 以 `deepseek-brain/core` 子路径单独导出，**不拖 `puppeteer-core`**。
- **三个替换点公开**：`SessionStore`（会话表存储）、`SessionKeyStrategy`（会话 key 派生）、`PlannerDeps.threshold`（compaction 阈值）——第三方可以接管，不必改 core 内部。
- **`Transport.cancel()`**：中止进行中的生成；没有进行中生成时是空操作（不抛错）。
- **`Transport.getCapabilities()`**：如实回报 `supportsThinking` / `supportsResume` / `maxContextTokens` / `tokenEstimator`。
- **首次运行阻塞登录**：没有登录态时启动阶段会拉起 Chrome 并**阻塞等待你登录完成**，登录态持久化到 profile，之后重启不再等待。也可以单独跑 `deepseek-brain login`。
- **Chrome 路径自动探测**：装在标准位置就零配置；探测不到在启动早期直接失败并列出候选路径，而不是等首个请求超时。
- **Chrome 懒启动**：profile 已播种时端口先开，首个 `/v1/chat/completions` 请求才拉起 Chrome。
- **只读 `GET /health`**：报告 `{ status, loggedIn }` 且**绝不触发懒启动**——探活不该把浏览器从被子里拽出来。
- **增量 SSE / 增量 PROBE tail**：长回答不再每 400ms 重解析整份流（原为 O(N²)）。
- **上下文墙缓解**：超过阈值（默认 40000 估算 token）自动摘要 + 重开会话续写。

---

## 安装

要求：**Windows** + **Node.js >= 20** + **Chrome 或 Edge**（Chromium 亦可）。

```bash
npm install -g deepseek-brain     # 全局安装，得到 deepseek-brain 命令
# 或者不装直接跑：
npx deepseek-brain
```

---

## 快速开始

### 1. 启动

```bash
deepseek-brain
```

首次运行会发生这些事：

1. 探测 Chrome 路径，找不到就打印候选列表并退出（**早失败**，不让你干等）。
2. 检查 profile 里有没有登录态。
3. **没有** → 拉起 Chrome 窗口，阻塞等待你在 `chat.deepseek.com` 完成登录（最长等 30 分钟），期间打印「等待登录中…」。
4. **有** → 跳过等待，端口先开，Chrome 等首个请求再启动。
5. 监听 `http://127.0.0.1:8790/v1`。

想只登录不启服务：

```bash
deepseek-brain login
```

### 2. 验证

```bash
curl.exe -s -o resp.json http://127.0.0.1:8790/v1/models
node -e "console.log(JSON.parse(require('fs').readFileSync('resp.json','utf8')).data.map(m=>m.id))"
# [ 'deepseek-web-brain' ]

curl.exe -s -o resp.json http://127.0.0.1:8790/health
node -e "console.log(require('fs').readFileSync('resp.json','utf8'))"
# {"status":"ok","loggedIn":true}

curl.exe -s -o resp.json http://127.0.0.1:8790/v1/chat/completions ^
  -H "content-type: application/json" ^
  -d "{\"model\":\"deepseek-web-brain\",\"messages\":[{\"role\":\"user\",\"content\":\"用一句话介绍你自己\"}]}"
node -e "const r=JSON.parse(require('fs').readFileSync('resp.json','utf8'));console.log(r.choices[0].message.content)"
```

> **为什么是 `curl.exe -o` + `node -e`，不是 `curl | ConvertFrom-Json`**：PowerShell 5.1 会按 GBK 解码 curl 的 UTF-8 输出，字符**不可逆丢失**（实测一次评审回复丢了 26 个字符）。校验中文响应必须让 curl 直接写字节、再用 node 读文件。完整说明见 [`docs/e2e-checklist.md`](docs/e2e-checklist.md)。

---

## 接入各 Agent

shim 是标准的 OpenAI 兼容端点，所有参数都是：`base_url = http://127.0.0.1:8790/v1`、`api_key` 随便填（shim **不做鉴权**，只绑 127.0.0.1）、模型名 `deepseek-web-brain`。

| Agent | 状态 | 示例 |
| --- | --- | --- |
| OpenCode | ✅ 已核实并实跑 | [`examples/opencode.jsonc`](examples/opencode.jsonc) |
| Cline | ✅ 已核对官方文档 | [`examples/cline.md`](examples/cline.md) |
| aider | ✅ 已核对官方文档 | [`examples/aider.md`](examples/aider.md) |
| Claude Code | ❌ **不能直连**（已核实官方文档，附原因） | [`examples/claude-code.md`](examples/claude-code.md) |

各示例的核实状态与不确定点写在 [`examples/README.md`](examples/README.md)。

---

## HTTP 接口

只有三个端点。**其他任何路径一律 404** `{"error":{"message":"not found"}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | `{ status: 'ok' \| 'login_required' \| 'ui_changed', loggedIn: boolean }`。只读，**不触发 Chrome 懒启动**；transport 未就绪时降级返回 `login_required` 而不是 500。 |
| `GET` | `/v1/models` | 固定返回一个模型：`deepseek-web-brain`。 |
| `POST` | `/v1/chat/completions` | 标准 OpenAI 形状。`"stream": true` 返回 SSE（含 `reasoning_content` → `content` → `tool_calls` → `[DONE]`）。JSON 解析失败 400，上层异常 502。 |

监听地址固定 `127.0.0.1`，**没有鉴权**——它假设自己只对本机可见。别自己绑到 `0.0.0.0`。

---

## 配置

### 环境变量

以 `src/config.ts` 的 `loadConfig()` 为准，逐个核实：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8790` | 监听端口。 |
| `CHROME_PATH` | 自动探测 | Chrome 可执行文件全路径。**空串等同于没给**（会被 `existsSync` 否掉，于是你看到的是「探测失败」而不是「候选列表」）。 |
| `LOG_LEVEL` | `info` | `--verbose` 会把它设成 `debug`。 |
| `THINKING` | `true` | 只有字符串 `true` 会开启，`false` 关闭。⚠️ 写 `1` 会被当成 `false`——判断是 `=== 'true'`，不是「非空即真」。 |
| `TIMEOUT_MS` | `240000` | 单轮生成超时。 |
| `THINKING_TIMEOUT_MS` | `300000` | 开思考模式时的超时。 |
| `SEND_SETTLE_MS` | `8000` | 点发送后等页面稳定的时间。 |
| `MAX_FORMAT_RETRIES` | `2` | 工具调用格式不合法时的重试次数。 |
| `COMPACT_THRESHOLD` | `40000` | compaction 触发阈值（**估算** token 数）。优先级：`deps.threshold` > 本变量 > 默认值。 |
| `TOOL_RESULT_MAX_CHARS` | `4000` | 渲染单个工具结果时的截断长度。 |

数值型变量的判定是 `Number.isFinite(n) && n > 0`，所以 `0` 和非数字都会静默回落到默认值。

Chrome 探测顺序（`CHROME_PATH` / `--chrome-path` 优先于这张表）：

1. `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`
2. `%LOCALAPPDATA%\Chromium\Application\chrome.exe`
3. `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe`
4. `%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe`
5. `%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe`
6. `%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe`

### CLI 参数

以 `src/cli-args.ts` 的 `parseArgs()` 为准，逐个核实：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `serve` | 默认子命令 | 启动并监听端口。 |
| `login` | — | 只走登录流程，成功后退出，**不监听端口**。 |
| `--port <n>` | `8790` | 必须是 1–65535 的整数，否则报错退出。 |
| `--profile <dir>` | `.chrome-profile` | Chrome profile 目录。**相对路径按进程 cwd 解析**，换个目录启动就是另一个 profile。 |
| `--chrome-path <exe>` | 自动探测 | 显式指定浏览器，跳过探测。 |
| `--headless` | 关 | 给 Chrome 加 `--headless=new`。默认关闭是因为很多站点检测 headless 特征会**当场拒绝服务**，不是风险规避。 |
| `--verbose` | 关 | 等价于 `LOG_LEVEL=debug`，打开**三处会话恢复诊断**（恢复的 sessionId / 恢复目标被重定向 / 恢复导航失败）。 |
| `--help`, `-h` | — | 打印用法后退出。 |

坏值一律报错而不是静默降级（静默的 `NaN` 会一路传到 `server.listen()`，用户看到的是网络层报错，排查方向完全跑偏）。未知 flag 忽略（向前兼容），**未知子命令报错**——否则 `deepseek-brain logout` 会被当成 `serve` 默默起一个服务。

---

## 作为库复用

`deepseek-brain/core` 是纯逻辑层，不依赖 `transports/` 也不依赖 `puppeteer-core`。

```ts
import { runAgentTurn, type PlannerDeps } from 'deepseek-brain/core'

const result = await runAgentTurn({
  messages,        // OpenAIMessage[]
  tools,           // ToolSpec[]，没有工具就传 []
  transport: myTransport,   // 你自己实现的 Transport
  config,                  // loadConfig() 的返回值（从 'deepseek-brain' 导入）
  deps: { /* store / keyStrategy / threshold 全部可选 */ } satisfies PlannerDeps,
})

result.content     // 去掉 tool_call 代码块后的可见正文
result.reasoning   // 思考内容（thinking 模式）
result.toolCall    // { id, name, arguments } | undefined
result.usageTokens // 估算值
```

`deps` 三项不传时行为与 0.1.0 完全一致：

- `store` —— 接管会话表存储（默认按环境变量现开 `.sessions.json`）
- `keyStrategy` —— 接管「OpenCode 会话 → 后端会话」的映射（默认 `prefixHashStrategy`；后端无会话概念时用 `statelessStrategy`）
- `threshold` —— compaction 阈值，最高优先级

`core` 导出的完整清单见 `src/core/index.ts`：`runAgentTurn`、`computeSessionKey`、`newMessagesSince`、`estimateTokens`、`createSessionStore`、`openDefaultSessionStore`、`DEFAULT_SESSIONS_FILE`、`prefixHashStrategy`、`statelessStrategy`、`buildCompactPrompt`、`totalTokens`、`buildSystemPrompt`、`parseModelOutput`、`renderToolResult`，以及 `Transport` / `Capabilities` / `GenerateRequest` / `GenerateChunk` / `HealthStatus` / `PlannerDeps` / `SessionStore` 等类型。

包根导出（`deepseek-brain`）：`loadConfig` 及配置类型、`createHttpServer`、`setTransportGetter`、`createWebBridge`、消息与工具类型。**import 根入口没有副作用**，不会帮你拉起 server 或 Chrome。

---

## 添加自定义 transport

这是本项目最主要的扩展点。**如果你有一个不会 tool calling 的模型**——网页 UI、TUI、telnet、别的第三方 API——实现 `Transport` 的 7 个方法，就能白拿 OpenAI 兼容的 tool-loop 行为。

完整步骤（接口签名、`getCapabilities()` 的填写纪律、`SessionKeyStrategy` 选型、装配写法、边界测试怎么跑）见 **[`CONTRIBUTING.md`](CONTRIBUTING.md#新增一个-transport)**。

---

## 已知限制

请如实读完再用。**Windows only** 是范围决定，不是待办——跨平台探测、snap/Flatpak 路径、无显示器远程场景全部不实现。

- **Windows only。** 非 Windows 平台 `npm install` 即被拒绝。
- **选择器脆弱。** 依赖 `selectors.json` 里的 DOM 选择器，DeepSeek 改版即失效。`/health` 报 `ui_changed` 就是这个信号：既没有输入框也没有登录入口，多半是选择器过期了。
- **单会话、单账号、并发 = 1。** 本版本不提供并发开关。同一账号开多个上下文会导致网页侧会话互扰与 `sentCount` 串台。
- **token 估算是 `Math.ceil(text.length / 2)`。** 这是字符数除以 2，不是真 tokenizer——中文/英文混排时偏差很大。compaction 因此可能**偏晚触发**。改阈值用 `COMPACT_THRESHOLD` 或 `deps.threshold`，别指望那个数字准。
- **上下文墙仍然存在。** compaction 只是缓解：摘要质量取决于网页版模型本身，撞上真·上下文墙时可能整轮失败。
- **只实现 `POST /v1/chat/completions`。** 没有 `/v1/messages`、没有 embeddings、没有图片输入、没有批量接口。**因此 Claude Code 不能直连**（见 `examples/claude-code.md`）。
- **没有鉴权。** 只绑 127.0.0.1 是唯一防线。别改绑到 `0.0.0.0`。
- **`maxContextTokens: 64000` 是引用值不是实测值。** 取自 DeepSeek 公开的 chat 上下文上限；网页端不暴露模型规格。compaction 阈值**不以它为准**（见 `src/core/planner.ts` 里的理由）。
- **profile 默认是相对路径 `.chrome-profile`**，按进程 cwd 解析。**不要指向你日常 Chrome 的 profile**——Chrome 单实例锁会让你连不上。
- **headless 默认关，且开了未必能用。** 很多站点检测 headless / `navigator.webdriver` 会当场拒绝服务。
- **需要真实浏览器会话。** 首登要输密码、过 2FA，30 分钟超时。
- **中文 UI 依赖。** 新建会话按钮有中英双语候补，但站点改文案仍可能失配。

---

## 故障排查

| 现象 | 原因 / 处置 |
| --- | --- |
| `[brain] chrome not found` | 装 Chrome/Edge，或设 `CHROME_PATH` / `--chrome-path`。错误信息里列了探测过的候选路径。 |
| `/health` → `{"status":"login_required","loggedIn":false}` | 没登录。在 shim 启动的 Chrome 窗口里登录 `chat.deepseek.com`，或先跑 `deepseek-brain login`。 |
| `/health` → `{"status":"ui_changed"}` | 页面在，但既没有输入框也没有登录入口 → 选择器过期，更新 `selectors.json`。 |
| `/health` → `login_required` 但你确实登录了 | profile 目录不对（相对路径按 cwd 解析），或 Chrome 单实例锁挡住了。检查 `--profile`。 |
| 首个请求超时很久才回 | Chrome 懒启动：首个请求要现拉浏览器。要提前拉起就先用 `deepseek-brain login`，或直接调一次 `/v1/chat/completions`。 |
| `format_give_up` | 模型连续输出无法解析的工具调用。`--verbose` 看恢复诊断；也可能是 fence-json 协议描述不清。 |
| 之前能跑，现在 `sentCount` 错乱 | `.sessions.json` 与实际对话脱节。删掉 `.sessions.json` 会话记录重新建。 |
| curl 回来的中文是乱码 | **不是 bug，是 PowerShell 5.1 的 GBK 解码。** 用 `curl.exe -o` 落盘再 `node -e` 读。 |
| `Cannot GET /v1/messages` | 预期行为。本项目只实现三个端点，见上文接口表。 |

---

## License

[MIT](LICENSE)
