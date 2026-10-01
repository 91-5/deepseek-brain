# 各 Agent 接入示例

shim 是标准 OpenAI 兼容端点，参数对所有 agent 都一样：

| 参数 | 值 |
| --- | --- |
| base URL | `http://127.0.0.1:8790/v1` |
| api key | 任意非空字符串（本 shim **不做鉴权**，只绑 `127.0.0.1`） |
| 模型名 | `deepseek-web-brain` |

模型名不是猜的：`src/server/http.ts` 的 `GET /v1/models` 固定只返回这一个 id，`/v1/chat/completions` 也只是把它原样回显到响应里，**不做模型名校验**——填错名字会照常请求，只是上游完全不知道你换了模型。

## 核实状态一览

| Agent | 文件 | 状态 | 依据 / 不确定点 |
| --- | --- | --- | --- |
| **OpenCode** | [`opencode.jsonc`](opencode.jsonc) | ✅ 已核实并在本机实跑 | 取自本机真实可用配置：`@ai-sdk/openai-compatible` + `options.baseURL` + `options.apiKey` + `models.<id>` 结构，以及 `agent.<name>.model` 的 `provider/model` 引用格式。 |
| **Cline** | [`cline.md`](cline.md) | ✅ 已核对官方文档 | 依据 [Cline · OpenAI Compatible](https://docs.cline.bot/provider-config/openai-compatible)：provider 选项 `OpenAI Compatible`，字段 `Base URL` / `API Key` / `Model ID`。**未实跑**——需要起 VS Code，本次未做端到端验证。 |
| **aider** | [`aider.md`](aider.md) | ✅ 已核对官方文档 | 依据 [OpenAI compatible APIs](https://aider.chat/docs/llms/openai-compat.html) 与 [Options reference](https://aider.chat/docs/config/options.html)：`setx OPENAI_API_BASE` / `setx OPENAI_API_KEY`、`aider --model openai/<model-name>`、`--openai-api-base` / `--openai-api-key`、`--no-show-model-warnings`。**未实跑**——aider 未安装，且实跑会真实驱动 Chrome 与 DeepSeek 账号。 |
| **Claude Code** | [`claude-code.md`](claude-code.md) | ❌ 已核实：不能直连 | 依据 [Claude Code · Gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol#api-formats) 与 [Connect to a gateway](https://code.claude.com/docs/en/llm-gateway-connect)：Claude Code 只讲 Anthropic Messages（`/v1/messages`）/ Bedrock InvokeModel / Vertex rawPredict 三种格式，均不经 `/v1/chat/completions`。这不是「没试」，是协议层没有交集。 |

## 为什么没有 `claude_desktop_settings.json`

实施计划里列了这个文件名。**没有创建**，因为 Claude Code 走不通（见上），产出一份指向 404 的配置文件属于编造可用路径。

同时计划里的 `cline.md` / `aider.md` 保留了原名，OpenCode 的配置文件沿用 `.jsonc` 后缀以便写注释。若你希望文件名与计划完全一致，请告诉我，我改。

## 一个共同的坑

四个 agent 里凡是要验证中文响应的，**别在 PowerShell 里直接管道解析**：

```powershell
# ❌ 会把 UTF-8 按 GBK 解码，字符不可逆丢失
curl.exe -s http://127.0.0.1:8790/v1/chat/completions ... | ConvertFrom-Json

# ✅ 让 curl 写字节，再用 node 读
curl.exe -s -o resp.json http://127.0.0.1:8790/v1/chat/completions ...
node -e "console.log(JSON.parse(require('fs').readFileSync('resp.json','utf8')).choices[0].message.content)"
```

完整解释见 [`../docs/e2e-checklist.md`](../docs/e2e-checklist.md)。
