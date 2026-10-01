# Cline 接入 deepseek-brain

**状态：✅ 已核对官方文档**（[Cline · OpenAI Compatible](https://docs.cline.bot/provider-config/openai-compatible)）
**核实项**：provider 选项名 `OpenAI Compatible`、三个必填字段 `Base URL` / `API Key` / `Model ID`。
**未核实项**：deepseek-brain 端点未在本机与 Cline 一起实跑过——Cline 是 VS Code 扩展，本次没有拉起 VS Code 做端到端验证。

Cline 在设置面板里就有现成的 **OpenAI Compatible** provider，不用改任何配置文件。

## 设置面板（⚙️）里填三项

| 字段 | 值 |
| --- | --- |
| API Provider | `OpenAI Compatible` |
| Base URL | `http://127.0.0.1:8790/v1` |
| API Key | `local`（shim 不做鉴权，任意非空字符串即可） |
| Model ID | `deepseek-web-brain` |

填完点 **Verify**。官方文档说返回 JSON 就说明通了。

## 几个要注意的点

- **Model Configuration 建议填 Context Window。** 官方文档列了这一节（Max Output Tokens / Context Window size / Image Support / Computer Use / 价格）。deepseek-brain 的 `getCapabilities()` 回报 `maxContextTokens: 64000`，但那是**引用 DeepSeek 公开上限的声明值，不是本地实测**，填的时候心里有数。
- **不要开 Image Support。** 本项目只实现 `/v1/chat/completions` 的纯文本 + 工具调用，没有图片输入路径。
- **Base URL 不要带 `/v1/chat/completions`。** Cline 自己会拼路径；填到 `/v1` 为止。
- **本项目不支持 Anthropic Messages 格式**（没有 `/v1/messages`）。如果 Cline 因为某项功能去探测 `/v1/messages`，会拿到 404 —— 那是预期的，不是配置错了。

## 排错

| 现象 | 处置 |
| --- | --- |
| Verify 报 Invalid API Key | 本 shim 不校验 key，检查 `Base URL` 是否写错（少写 `/v1` 或多写了尾路径）。 |
| Model Not Found | `Model ID` 必须是 `deepseek-web-brain`，大小写与连字符完全一致。 |
| Verify 通过但回答为空 / 半截 JSON | 大概率是 tool_call 协议没走通。`deepseek-brain --verbose` 看会话恢复诊断，同时确认请求真的带了 `tools[]`——本项目靠模型输出代码块表达工具调用，没传工具时模型会直接拒绝编造工具名（这是协议设计意图，不是 bug）。 |
