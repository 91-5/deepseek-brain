# 贡献指南

感谢你考虑给 deepseek-brain 贡献代码。

本项目目前只在 Windows 上工作，且核心能力（驱动网页版）高度依赖特定站点结构，
因此**新增一个 transport 是最有价值的贡献方式**——它把「协议内核」与「具体后端」
解耦，让别人不必 fork 就能接上自己的后端。

## 开发环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | **仅 Windows**（`package.json` 的 `os` 字段已声明 `win32`，其他平台安装即被拒） |
| Node.js | **>= 20**（ESM + `node:` 内置模块前缀，见 `engines`） |
| 浏览器 | Chrome 或 Edge。默认自动探测；装在非标准位置时用 `CHROME_PATH` 环境变量或 `--chrome-path` 指定 |
| 包管理 | npm（仓库带 `package-lock.json`） |

```bash
npm install
```

> 只有要跑真实网页（`transports/`）相关代码时才需要浏览器。
> `core/` 是纯逻辑层，不依赖 `puppeteer-core`，可以完全离线测试。

## 三条必跑命令

```bash
npm run typecheck        # tsc -p tsconfig.json --noEmit
npm run typecheck:test   # tsc -p tsconfig.test.json
npm test                 # vitest run
```

三条都要通过。`typecheck:test` 不是可选项——测试文件同样进类型检查，
漏掉它会让测试里的类型错误拖到运行时才炸。

## 新增一个 transport

这是本项目最主要的扩展点。完整步骤如下。

### 1. 实现 `Transport` 接口

接口定义在 `src/core/types.ts`，共 **7 个方法**：

| 方法 | 签名 | 语义 |
| --- | --- | --- |
| `generate` | `generate(req: GenerateRequest): AsyncIterable<GenerateChunk>` | 跑一轮生成。**必须流式** yield，`content` / `reasoning` 分开给 |
| `newChat` | `newChat(): Promise<void>` | 开一条全新后端会话 |
| `health` | `health(): Promise<Health>` | 返回 `{ status, loggedIn }` |
| `lastChatSessionId` | `lastChatSessionId(): string \| null` | 当前后端会话 id，供上层做深链恢复 |
| `resetSession` | `resetSession(): void` | 丢弃进程内状态（换账号、页面崩了等） |
| `cancel` | `cancel(): Promise<void>` | 中止进行中的生成；**没有进行中生成时必须是空操作**，不能抛错 |
| `getCapabilities` | `getCapabilities(): Capabilities` | 见下 |

建议放在 `src/transports/` 下你自己的文件里，并在 `src/core/index.ts` 之外单独导出。

### 2. `getCapabilities()` 必须如实回报

```ts
getCapabilities(): Capabilities {
  return {
    supportsThinking: true,   // 模型是否产出 reasoning_content 分流
    supportsResume: true,     // 是否支持用 chatSessionId 深链恢复会话
    maxContextTokens: 64000,  // 上下文墙
    tokenEstimator: text => Math.ceil(text.length / 2),  // 可选
  }
}
```

三条都必须是**实测或后端文档明确说明**的值，不要照抄本项目的数字：

- `supportsThinking` 填 `true` 但后端其实不分流，会让上层把正文误当思考内容处理。
- `supportsResume` 填 `true` 但不支持会话恢复，会话表会持续累积且永远命中不了。
- `maxContextTokens` 是**对外暴露的能力信息**，不要用它当 compaction 阈值
  （见 `src/core/planner.ts` 里关于为什么不接 `maxContextTokens` 的注释：
  那是「宣称上限」而非「安全余量」，按它 compaction 会来不及触发）。

### 3. 选择会话 key 策略

- 你的后端**没有会话概念**（每次调用独立）→ 用 `statelessStrategy`：

  ```ts
  import { statelessStrategy } from 'deepseek-brain/core'
  await runAgentTurn({ messages, tools, transport, config, deps: { keyStrategy: statelessStrategy } })
  ```

  ⚠️ `statelessStrategy` 恒返回 `'stateless'`。若配在**支持 resume** 的后端上，
  所有 OpenCode 会话会挤进同一条记录互相覆盖。要支持恢复就用默认的
  `prefixHashStrategy`，或自己实现 `SessionKeyStrategy`。

- 你的后端**有会话**→ 用 `keyStrategy`（默认 `prefixHashStrategy`），
  或传入自实现的 `(messages: OpenAIMessage[]) => string`。

### 4. 用 `runAgentTurn()` 装配

```ts
import { runAgentTurn, type PlannerDeps } from 'deepseek-brain/core'

const result = await runAgentTurn({
  messages,
  tools,
  transport: myTransport,
  config,
  deps: { /* store / keyStrategy / threshold 均可选 */ },
})
```

返回 `{ content, reasoning, toolCall?, usageTokens }`。

`deps` 三项（`store` / `keyStrategy` / `threshold`）**全部可选**，
不传时行为与 v0.1 完全一致。

> 注：早期设计稿里这个装配函数叫 `createPlanner()`，实现时改名为
> `runAgentTurn()`（`src/core/planner.ts`）——以代码为准。

### 5. 不要 import `transports/` 下的任何东西

**这条是硬性边界。** `core/` 是纯逻辑层，不得依赖具体后端。
`tests/core-boundary.test.ts` 会在 `npm test` 时扫描 `src/core/**/*.ts`，
命中以下任一模式就失败：

- `from '...transports...'`
- `from 'puppeteer-core'`
- `chat.deepseek.com`
- `开启新对话`

也就是说，**core 依赖具体 transport 会被测试直接拒绝**。
如果你发现自己想在 core 里引用站点细节，说明它该待在 `transports/`。

### 6. 跑测试

```bash
npm test
```

除了新增 transport 自己的用例外，务必确认：

- `tests/core-boundary.test.ts` 仍通过（你没有从 core 引 transports）。
- 若你改动了 `core/` 的公开接口，`tests/core-*.test.ts` 需要相应更新。

测试**不得**真的启动 Chrome。仓库里的 live 测试（`*.live.test.ts`）默认跳过，
需要显式环境变量才会跑——不要为了「验证一下」在 PR 里把它们打开。

## 提交 PR 前自检清单

- [ ] `npm run typecheck` 通过
- [ ] `npm run typecheck:test` 通过
- [ ] `npm test` 通过（`162 passed / 1 skipped` 是当前基线；live 测试保持跳过）
- [ ] 没有改动 `tests/fixtures/` 下的真实 SSE 抓包文件（它们是回归基准，不是普通测试数据）
- [ ] 新增/修改的代码有对应用例，且**至少做过一次反向验证**：
      手动把实现改坏，确认对应测试真的会红，再改回来
- [ ] 若改了 `core/`：确认没有引入对 `transports/`、`puppeteer-core`、站点常量的依赖
- [ ] 若改了 CHANGELOG：破坏性变更标注在「移除」小节下
- [ ] 提交信息用祈使句、一行说明「做了什么」；破坏性变更在正文里说明原因

## 代码风格

沿用仓库现状，无需额外配置：

- TypeScript strict，ESM（`import ... from './x.js'`，注意带扩展名）
- 2 空格缩进，无分号
- 注释解释**为什么**，不复述代码在做什么
- 中文注释、中文文档

## 许可

提交即表示你同意你的贡献以 MIT 许可发布。