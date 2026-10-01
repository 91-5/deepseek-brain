# Changelog

本文件记录 deepseek-brain 的用户可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0]

首个公开发布版本。相比 0.1.0 的核心变化是把项目从「私有 shim」改造成**可复用、可安装的库**。

### 新增

- `deepseek-brain/core` 子路径导出：`SessionStore`、`SessionKeyStrategy`、
  `PlannerDeps` 三个替换边界公开，第三方可接管会话存储、会话 key 派生与
  compaction 阈值，无需改动 core 内部。
- `Transport.cancel()`：中止进行中的生成；无进行中生成时为空操作。
- `Transport.getCapabilities()`：回报 `supportsThinking` / `supportsResume` /
  `maxContextTokens`，让第三方 transport 能如实描述自己的能力。
- `deepseek-brain login` 子命令：只走登录流程，成功后退出、不监听端口。
- 首次运行阻塞登录：未检测到登录态时启动阶段阻塞等待，登录完成后才开始
  监听端口，避免客户端拿到一个必然失败的端口。
- 完整 CLI 参数面：`--port` / `--profile` / `--chrome-path` / `--headless` /
  `--verbose` 与 `serve` / `login` 子命令，坏值一律报错而非静默降级。
  - `--verbose` 有实际作用：等价 `LOG_LEVEL=debug`，打开三处会话恢复诊断
    （恢复的 chatSessionId / 恢复目标被重定向 / 恢复导航失败）。此前 `LOG_LEVEL`
    只有一个写入方、零个读取方，该 flag 形同虚设。
- `LOG_LEVEL` 环境变量现在真的被读取（此前无人读，`log.level` 恒为 `info`）。
- Chrome 路径自动探测：装在标准位置时无需任何配置；探测不到会在启动早期
  直接失败并列出候选路径，而不是等首个请求超时。
- compaction 阈值注入：`deps.threshold` > `COMPACT_THRESHOLD` 环境变量 > 默认
  40000（估算 token 数）。详见 `src/core/planner.ts`。
- 条件导出（`types` + `default`）与显式 `"./package.json"`，TypeScript 消费方
  与 vite 等 bundler 均可正确解析。
- 可安装的 `bin`：`npx deepseek-brain` 可直接运行。

### 变更

- 内部重构为三层（`core` / `transports` / `server`）。`core` 为纯逻辑层，
  不依赖 `transports` 与 `puppeteer-core`。
- **Windows only**：`package.json` 声明 `os: ["win32"]`，其他平台安装即被拒绝，
  不再「装得上但跑不了」。
- 会话存储接口化，同时**保持 `.sessions.json` 落盘格式不变**。
- `health()` 从裸字符串改为 `{ status, loggedIn }` 对象：只有 status 分不清
  「没登录」与「页面还没加载出来」，而这两者的正确处置完全不同。
- 登录态判据从「页面是否渲染」改为「profile 里有没有 Cookies 文件」，
  因此 Chrome **懒启动**：profile 已播种时端口先开、首个 `/v1/chat/completions`
  请求才拉起 Chrome（可复现原行为：删掉 profile 或先跑 `deepseek-brain login`）。
- PROBE 响应改为带 `startsWith` 守卫的增量合并，长回答不再每 400ms 重解析整份
  SSE 流（原为 O(N²)）；SSE 消费同样改为增量，分片与整份解析逐步等价。
- `puppeteer-core` 依赖改为精确版本固定。

### 移除

- **破坏性**：删除把作者个人 Nuphus 浏览器 profile 复制为登录态的机制。
  旧版本靠「复制一份现成的浏览器 profile」免登录，新版本一律要求用户在自己
  的 Chrome 里亲手登录。升级后请先跑 `deepseek-brain login`。
- **破坏性**：删除硬编码的个人 Chrome 路径，改为标准位置自动探测 +
  `CHROME_PATH` / `--chrome-path` 覆盖。
- `--pool-size` 在发布前移除（从未实现，避免帮助文本虚假承诺）。该版本从未
  发布过，升级者不存在依赖；现在传入它会被当作未知 flag 忽略。

### 兼容性

- **`.sessions.json` 格式未变**，0.1.0 产生的会话文件可直接沿用。
- 会话 key 算法未变（`prefixHashStrategy` 委托既有 `computeSessionKey`），
  升级后历史会话不会失配。
- compaction 触发阈值未变（仍为 40000）。
- 监听地址与路由未变（`127.0.0.1` + `/v1/models`、`/v1/chat/completions`）。

## [0.1.0]

初始内部版本。

- DeepSeek 网页版 → OpenAI 兼容 HTTP 接口的 shim。
- WebBridge 封装 puppeteer-core 会话恢复、选择器点击与 DOM 文本抓取。
- 工具调用协议解析与格式重试。

[0.2.0]: https://github.com/91-5/deepseek-brain/releases/tag/v0.2.0
[0.1.0]: https://github.com/91-5/deepseek-brain/releases/tag/v0.1.0