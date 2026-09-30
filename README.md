# DeepSeek Brain Shim

让 DeepSeek 网页版（无函数调用）作为 OpenCode 的 subagent 大脑。

## 启动

npm install
npm run build
npm start   # 首次运行若为全新 profile，需在弹出的 Chrome 里手动登录 chat.deepseek.com（登录态持久化）

## OpenCode 接入（opencode.jsonc）

"provider": { "deepseek-brain": { "npm": "@ai-sdk/openai-compatible",
  "options": { "baseURL": "http://127.0.0.1:8790/v1", "apiKey": "local" },
  "models": { "deepseek-web-brain": { "name": "DeepSeek Web Brain" } } } },
"agent": { "brain": { "mode": "subagent", "model": "deepseek-brain/deepseek-web-brain" } }

## 验证

curl -s http://127.0.0.1:8790/v1/chat/completions -H "content-type: application/json" -d "{\"model\":\"deepseek-web-brain\",\"messages\":[{\"role\":\"user\",\"content\":\"用一句话介绍你自己\"}]}"

## 故障排查

- health=login_required → 在 shim 启动的 Chrome 窗口重新登录 chat.deepseek.com
- health=ui_changed → 更新 selectors.json 的 send/newChat 选择器
- ToS 风险：自动化网页版可能违反 DeepSeek 服务条款，账号风险自担
