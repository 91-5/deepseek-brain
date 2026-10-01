# Changelog

本文件记录 deepseek-brain 的用户可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0]

首个公开发布版本。相比 0.1.0 的核心变化是把项目从「私有 shim」改造成**可复用、可安装的库**。

### 新增

- `deepseek-brain/core` 子路径导出：`SessionStore`、`SessionKeyStrategy`、
  `PlannerDeps` 三个替换边界公开，第三方可接管会话存储、会话 key 派生与
  compaction 阈值，无需改动 core 内部。
- compaction 阈值注入：`deps.threshold` > `COMPACT_THRESHOLD` 环境变量 > 默认
  40000（估算 token 数）。详见 `src/core/planner.ts`。
- 条件导出（`types` + `default`）与显式 `"./package.json"`，TypeScript 消费方
  与 vite 等 bundler 均可正确解析。
- 可安装的 `bin`：`npx deepseek-brain` 可直接运行。

### 变更

- 内部重构为三层（`core` / `transports` / `server`）。`core` 为纯逻辑层，
  不依赖 `transports` 与 `puppeteer-core`。
- 会话存储接口化，同时**保持 `.sessions.json` 落盘格式不变**。
- `puppeteer-core` 依赖改为精确版本固定。

### 兼容性

- **`.sessions.json` 格式未变**，0.1.0 产生的会话文件可直接沿用。
- 会话 key 算法未变（`prefixHashStrategy` 委托既有 `computeSessionKey`），
  升级后历史会话不会失配。
- compaction 触发阈值未变（仍为 40000）。

## [0.1.0]

初始内部版本。

- DeepSeek 网页版 → OpenAI 兼容 HTTP 接口的 shim。
- WebBridge 封装 puppeteer-core 会话恢复、选择器点击与 DOM 文本抓取。
- 工具调用协议解析与格式重试。

[0.2.0]: https://github.com/15812/deepseek-brain/releases/tag/v0.2.0
[0.1.0]: https://github.com/15812/deepseek-brain/releases/tag/v0.1.0