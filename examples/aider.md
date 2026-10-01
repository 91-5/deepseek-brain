# aider 接入 deepseek-brain

**状态：✅ 已核对官方文档**（[aider · OpenAI compatible APIs](https://aider.chat/docs/llms/openai-compat.html)、[aider · Options reference](https://aider.chat/docs/config/options.html)）
**核实项**：Windows 下的 `setx OPENAI_API_BASE` / `setx OPENAI_API_KEY` 写法、`aider --model openai/<model-name>` 前缀语法、`--no-show-model-warnings`、`--model-metadata-file` / `--model-settings-file`。
**未核实项**：未在本机实跑（aider 未安装，且跑起来会真实驱动 Chrome 与 DeepSeek 账号）。

## 一行命令版

```bash
aider --model openai/deepseek-web-brain ^
      --openai-api-base http://127.0.0.1:8790/v1 ^
      --openai-api-key local ^
      --no-show-model-warnings
```

`--openai-api-base` / `--openai-api-key` 在 Windows cmd 里也能写成 `--set-env` 形式，或直接用环境变量。

## 环境变量版（官方文档给的写法）

```bat
setx OPENAI_API_BASE http://127.0.0.1:8790/v1
setx OPENAI_API_KEY local
REM setx 只对「新起的」进程生效 —— 官方文档明确要求 setx 之后重启 shell
```

也可以用 aider 自己的环境变量名（等价，避免污染全局）：

```bat
setx AIDER_MODEL openai/deepseek-web-brain
setx AIDER_OPENAI_API_BASE http://127.0.0.1:8790/v1
setx AIDER_OPENAI_API_KEY local
```

## 为什么加了 `--no-show-model-warnings`

官方文档说明：对 aider 不认识的模型会打印警告。`deepseek-web-brain` 显然不在它的模型表里。要消掉警告有两条路：

- `--no-show-model-warnings`（图省事，推荐先这样）
- 写 `.aider.model.metadata.yml` / `--model-metadata-file` 补上下文窗口与价格。注意本项目 `usage.total_tokens` 是**字符数除以 2 的估算值**，报出来的数字本来就是估的。

## 注意

- **`openai/` 前缀不能省。** 官方文档原话是「Prefix the model name with `openai/`」——这是告诉 aider 走 OpenAI 兼容通道，别写成裸的 `--model deepseek-web-brain`。
- **不要开 `--cache-prompts`。** 本项目每次生成都把增量提示词重新送进网页会话，不透传任何 prompt cache 字段；开着只会得到「计费按未缓存算」的观感，没有任何收益。
- **`--weak-model` 默认会跟着主模型走。** 提交信息与历史摘要会各多打一次网页请求，慢。如果不需要，让它指向主模型即可（默认行为），别指望它便宜。
- **本项目不支持 Anthropic Messages 格式。** aider 走 `openai/` 前缀时用的就是 `/v1/chat/completions`，正好对上。
