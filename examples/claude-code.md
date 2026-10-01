# Claude Code 接入 deepseek-brain —— 不能直连

**状态：✅ 已核对官方文档（结论：不适用，不是「待验证」）**

这不是「还没试」，是**试不通**：Claude Code 只讲 Anthropic Messages 协议，本项目只讲 OpenAI Chat Completions，两者没有交集。

## 为什么

Claude Code 官方文档 [Gateway compatibility guide · API formats](https://code.claude.com/docs/en/llm-gateway-protocol#api-formats) 列明，客户端能对接的 API 格式只有三种：

| 格式 | 用哪个变量选 | 端点 |
| --- | --- | --- |
| Anthropic Messages | `ANTHROPIC_BASE_URL` | `/v1/messages`、`/v1/messages/count_tokens`（可选） |
| Amazon Bedrock InvokeModel | `ANTHROPIC_BEDROCK_BASE_URL` + `CLAUDE_CODE_USE_BEDROCK=1` | `/model/{model}/invoke` 等 |
| Google Cloud Agent Platform rawPredict | `ANTHROPIC_VERTEX_BASE_URL` + `CLAUDE_CODE_USE_VERTEX=1` | `:rawPredict` 等 |

三条路**都不经过 `/v1/chat/completions`**。而 deepseek-brain 的全部路由是：

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`

其余一律 404。所以 Claude Code 的推理请求会打在 `/v1/messages` 上拿到 `{"error":{"message":"not found"}}`。

## 配置格式本身（供未来参考，已核实）

如果哪天本项目加了 `/v1/messages`，配置长这样。**变量名与文件位置均来自官方文档，现在照抄只会 404。**

环境变量方式（官方文档的 PowerShell 例子）：

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8790"
$env:ANTHROPIC_AUTH_TOKEN = "local"
```

> base URL **不带** `/v1`——官方文档的验证请求是 `POST "$ANTHROPIC_BASE_URL/v1/messages"`，路径由 Claude Code 自己拼。

settings 文件方式（推荐，因为后台 agent 也能读到）：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8790",
    "ANTHROPIC_AUTH_TOKEN": "local"
  }
}
```

- 全局：`%USERPROFILE%\.claude\settings.json`（Windows）
- 单项目：`<project>/.claude/settings.local.json`（**别把凭据写进会被提交的项目级 `.claude/settings.json`**）
- 凭据变量二选一：`ANTHROPIC_AUTH_TOKEN` 走 `Authorization: Bearer`，`ANTHROPIC_API_KEY` 走 `x-api-key`

## 就算加了 `/v1/messages`，还有两道坎

1. **模型名会被模型发现过滤掉。** 官方文档：Claude Code 的 gateway 模型发现只保留 `id` 里含 `claude` 或 `anthropic`（大小写不敏感）的条目。`deepseek-web-brain` 两个都不含，会被丢掉。用 `ANTHROPIC_MODEL` 直接指定模型可以绕过发现。
2. **Claude Code 对非 Claude 模型有硬限制。** 官方文档原文：「Anthropic doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude Code to non-Claude models through any gateway.」这是 Anthropic 的立场声明，不是技术障碍，但意味着出问题没有官方支持可指望。

## 那用什么

本项目的 HTTP 层是 harness 无关的 OpenAI 兼容端点。**能直接接的 agent 见 [`README.md`](README.md#接入各-agent)**：OpenCode（已实跑）、Cline、aider。

如果你确实需要让 Claude Code 用上网页版大脑，需要在中间加一层 **Anthropic Messages → OpenAI Chat Completions 的协议转换网关**（社区有若干方案）。本项目不提供该转换，也没验证过任何一款——**不建议照着未经验证的中转配置改生产环境**。
