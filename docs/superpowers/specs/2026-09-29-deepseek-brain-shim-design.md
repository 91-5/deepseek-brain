# DeepSeek Brain Shim — 设计文档

- **日期**：2026-09-29
- **状态**：已通过分节评审（架构/transport/协议/HTTP 会话四节经 sir 确认）
- **项目位置**：`D:\15812\Documents\deepseek-brain`
- **作者**：Jarvis（sir 审核）

---

## 1. 背景与目标

sir 的 DeepSeek 网页版（chat.deepseek.com）只能对话，无函数调用能力，但推理强且免费。本项目的目标是让它作为 OpenCode 的"思考大脑"（独立 subagent）：

1. 本地 Shim 提供 OpenAI 兼容 HTTP 服务，OpenCode 零侵入接入（新增 provider + brain subagent，现有流程完全不动）
2. Shim 向模型注入文本协议工具调用（system prompt + ```tool_call fence），解析模型输出转标准 `tool_calls`
3. transport = CDP 驱动受控 Chrome 访问网页版（sir 明确决定：**不接官方 API**，无付费兜底）
4. 多轮 agent loop 复用 DeepSeek 服务端会话，只发增量消息

**非目标（YAGNI）**：多浏览器并行、账号池、GUI、API 兜底、通用反爬框架。

## 2. Spike 关键证据（2026-09-29 实测）

> 探针：页内 patch XHR（`open/setRequestHeader/send` 包裹），捕获请求体/头 + 流式累积响应。

### 2.1 请求形态

- `POST /api/v0/chat/completion`，Content-Type: application/json
- 关键请求头（**无头直连必死的原因**）：
  - `authorization: Bearer <会话令牌>`（无头复刻报 40002 Missing Token）
  - `x-ds-pow-response`：base64 JSON — `{algorithm:"DeepSeekHashV1", challenge, salt, answer, signature, target_path}`（PoW 工作量证明，需现场计算）
  - `x-hif-leim`：反爬 token（轮换）
  - `x-device-id` + `x-client-bundle-id: com.deepseek.chat`、`x-client-platform/version/locale/timezone-offset`
- 请求体：`{chat_session_id, parent_message_id, model_type:null, prompt, ref_file_ids:[], thinking_enabled:bool, search_enabled:true, action:null, preempt:false}`（首次创建时 `model_type:"default"`，后续请求为 `null`——实现时以实测为准）
- 会话创建：`POST /api/v0/chat_session/create`
- 裸 Node 请求被 WAF 拦截（429 Request Blocked）→ **决策：UI 驱动，让页面自己发请求**

### 2.2 响应形态（SSE + JSON-patch）

```
data: {"p":"response/fragments/-1/content","o":"APPEND","v":"针"}
data: {"v":"正常"}                                    # 裸 fragment 追加
data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":94},{"p":"quasi_status","v":"FINISHED"}]}
data: {"p":"response/status","o":"SET","v":"FINISHED"}
event: update_session
event: close                                          # ← 可靠完成信号
```

- 解析策略：按 `p` 路径分桶，reasoning fragments 与 content fragments 分流（具体 fragment 类型字段以实测为准）
- 延迟基准：TTFB ~185ms；短回答全程 2-5s；DeepThink 10-15s

### 2.3 会话续接

同一 `chat_session_id` + `parent_message_id` 链式追加，服务端维护历史 → **Shim 每轮只发增量，不重发全量历史**。

### 2.4 登录态

sir 已在受控 Chrome（profile `C:\Users\15812\AppData\Roaming\Nuphus\browser_profile_v2`）手动登录，cookie（`ds_session_id` 等）已持久化。传输层启动时优先复制该 profile。

## 3. 架构

单体 Node 24 + TypeScript 进程（sir 确认方案 1）：

```
src/
├── index.ts           入口：配置加载 → transport 启动/健康检查 → HTTP 服务
├── config.ts          env + config.json 解析
├── server/
│   ├── http.ts        POST /v1/chat/completions（stream+非stream）、GET /v1/models
│   └── openai-types.ts
├── protocol/
│   ├── system-prompt.ts   tools[] → 协议 system prompt
│   ├── parser.ts          模型文本 → {content?, toolCalls?}，容错 + 重试
│   └── tool-result.ts     tool 结果 → 下一轮 user 消息（截断）
├── transport/
│   ├── types.ts           Transport 接口（保留给未来接其他免费网页大脑）
│   └── web-bridge.ts      CDP UI 驱动 + 页内探针（唯一实现）
├── session/
│   ├── manager.ts         前缀哈希 → DeepSeek 会话映射、parent 链维护
│   └── compact.ts         超长自动压缩开新会话
└── selectors.json      DOM 选择器（网页改版只改这里）
logs/                   结构化运行日志
.chrome-profile/        shim 专属 Chrome profile（复制/登录产物，gitignore）
```

统一接口：

```ts
interface Transport {
  generate(req: { prompt: string; thinking: boolean; timeoutMs?: number }):
    AsyncIterable<{ reasoning?: string; content?: string }>;
  health(): Promise<'ok' | 'login_required' | 'ui_changed' | 'error'>;
}
```

## 4. Transport 层（web-bridge）

### 4.1 启动

1. profile：优先复制 Nuphus profile 到 `.chrome-profile/`（同用户同机 DPAPI 解密一般可行）；复制失败或登录校验失败 → 全新 profile，控制台提示 sir 一次性手动登录（窗口保持打开）
2. 启动 headful Chrome：`--remote-debugging-port=9222 --user-data-dir=.chrome-profile`；puppeteer-core 连接（复用系统 Chrome，不下载浏览器）
3. 导航 chat.deepseek.com，登录校验（检测到对话输入框 = 已登录），注入页内探针（**每次导航/刷新后自动重注**）

### 4.2 每轮生成

1. trusted click 聚焦输入框 → CDP `Input.insertText`（中文可靠）
2. 点击发送键（selector 来自 selectors.json）
3. 页内探针轮询：捕获 completion 请求 → SSE `event: close`（或 status FINISHED）为完成；默认超时 240s，DeepThink 300s；30s 无进展打进度日志
4. 流式按 `p` 路径分桶返回 reasoning/content

### 4.3 健壮性铁律

- **单飞锁**：同一时刻一个生成，其余 FIFO 排队
- **重试边界**：探针捕获到 completion 请求后**绝不重发**（重复消息污染上下文）；「点击后 8s 完全无请求」才安全重试一次；流已开始但中断 → 报错不重试
- **选择器失效** → health=`ui_changed`，报错附 DOM 快照路径（logs/ 落盘）
- **登录过期**（401/跳登录页）→ health=`login_required`，通知 sir 重登，冷却 5 分钟内不重复打扰

## 5. 协议层（文本工具调用）

### 5.1 system prompt（首轮注入，~200 token）

```
你是任务规划大脑。需要调用工具时，输出一个代码块：
```tool_call
{"tool": "<工具名>", "arguments": {<参数>}}
```
每次只调一个工具，等待结果后再继续。不需要时直接文本回答。
可用工具：<name + description + 参数 schema 摘要的紧凑 JSON>
```

### 5.2 解析链

fence 提取（首个 ```tool_call 代码块）→ 宽松 JSON（截取首个平衡花括号）→ 工具名校验（不在列表 → 当正文文本）→ 解析失败：shim 自动追加一条修正指令重试（最多 2 次），仍失败则以错误 tool_call 元信息返回上层。

### 5.3 流式关键规则

完整 fence 出现前 content 照常流；检测到 fence 起始后缓冲暂存；解析成功 → 转 OpenAI `tool_calls` delta 结束本轮。**半截 JSON 永不作为正文流出。**
v0.1 实现口径：内部按轮完整生成后一次性 emit（fence 前正文照发、fence 剥离、tool_calls 以标准 delta 结束），不变量已满足；逐 token 真流式为 v0.2 增强。

### 5.4 tool 结果渲染

```
[工具 read_file 返回]
<内容，超 toolResultMaxChars(默认4000) 截断并标注>
[/返回]
```

## 6. HTTP 与会话层

### 6.1 端点

- `POST /v1/chat/completions`：标准 OpenAI 校验；`tools[]` → 协议层；支持 `stream: true/false`
- `GET /v1/models`：返回 `deepseek-web-brain`

### 6.2 会话键（delta 发送）

- key = 消息数组（除最后一条）前缀哈希 → DeepSeek 会话映射
- 首轮：协议 system prompt + 首条 user 消息
- 后续轮：仅增量（新 user 消息或 tool 结果）
- compaction 改写历史 → 前缀失效 → 开新会话 + 压缩摘要重建

### 6.3 parent 链

UI 驱动模式下 `parent_message_id` 由网页端自动维护（spike 实测：第二次请求的 parent 由页面自己计算并发送），Shim 无需干预。

### 6.3b 会话 ID 获取

首次发送由页面自动创建会话（`chat_session/create` 随发送流程触发）。Shim 通过两条途径获得 `chat_session_id`：**发送后页面 URL 变为 `/a/chat/s/<id>`（首选，探针轮询捕获）**；备选为解析 SSE 事件中的 session 字段（实现时验证哪条可靠）。拿到 id 后写入会话映射。

### 6.4 compaction

估算会话超 `compactTokenThreshold`（默认 40K）→ 指令 DeepSeek 生成进展摘要（任务目标/已完成/关键结论/待办）→ 新会话 = 摘要 + 重注工具协议。

## 7. 配置

```json
{
  "port": 8790,
  "thinking": true,
  "timeoutMs": 240000,
  "thinkingTimeoutMs": 300000,
  "sendClickSettleMs": 8000,
  "maxFormatRetries": 2,
  "compactTokenThreshold": 40000,
  "toolResultMaxChars": 4000,
  "browser": { "debugPort": 9222, "profileDir": ".chrome-profile", "headless": false },
  "log": { "level": "info", "dir": "logs" }
}
```

## 8. OpenCode 接入（零侵入）

```jsonc
"provider": { "deepseek-brain": {
  "npm": "@ai-sdk/openai-compatible",
  "options": { "baseURL": "http://127.0.0.1:8790/v1", "apiKey": "local" },
  "models": { "deepseek-web-brain": { "name": "DeepSeek Web Brain" } }
}},
"agent": { "brain": { "mode": "subagent", "model": "deepseek-brain/deepseek-web-brain" } }
```

## 9. 错误处理矩阵

| 场景 | 行为 | 上层可见性 |
|---|---|---|
| 选择器失效 | health=ui_changed + DOM 快照落盘 | 502 + 明确错误信息 |
| 登录过期 | health=login_required，通知 sir 重登（v0.1 无健康端点，该状态仅启动日志与 live 测试可见；请求路径直接报错） | 502 + 重登指引 |
| 生成超时 | 取消等待，报 timeout | 504 |
| SSE 流中断 | 报 stream_broken，不重发 | 502 |
| 点击后 8s 无请求 | 安全重试一次 | 透明 |
| 格式解析失败×2 | 作为 assistant 元信息返回 | 200 + 内容含错误说明 |
| compaction 触发 | 摘要 + 新会话，透明 | 日志可见 |
| 并发第二请求 | FIFO 排队 | 透明 |

## 10. 测试策略

- **单元**（主要投入）：
  - system-prompt 生成（tools→协议提示）
  - parser：fixtures 覆盖 合法 fence / 残缺 JSON / 多个 fence / 工具名不存在 / fence 前后混合正文
  - 前缀哈希 delta 计算（含 compaction 改写场景）
  - tool-result 渲染 + 截断
- **集成**（live，环境变量门控 `LIVE_TEST=1`）：
  - transport smoke：启动浏览器 → 登录校验 → 一次 generate → 断言 content + close
  - 重试边界：模拟点击后无请求
- **E2E**：shim 启动 + 临时 OpenCode provider 指向它 → 跑通一次带工具调用的 agent loop
- **fixtures**：spike 实测的原始 SSE 与请求体存为 golden 文件，parser/transport 测试复用

## 11. 风险（sir 已知情）

1. **ToS/封号**：自动化操作违反 DeepSeek 服务条款，账号风险自担
2. **UI 改版**：selectors.json 集中管理，失效即ui_changed
3. **上下文墙**：长 loop 靠 compaction 缓解，极端场景仍可能顶限
4. **串行吞吐**：单飞锁 + 网页版串行，多任务排队时延叠加
5. **单点**：按 sir 决定无 API 兜底，网页版挂了大脑即停摆
6. **浏览器占用**：headful Chrome 常驻一个标签页，期间不可他用

## 12. 实现排序建议

1. transport（web-bridge）+ 集成 smoke —— 地基，先证明能稳定驱动
2. 协议层 + parser 单测 —— 纯函数，可并行
3. HTTP + 会话管理 + delta —— 贯通
4. compaction + E2E —— 打磨
5. 部署接入 opencode.jsonc + 使用文档
