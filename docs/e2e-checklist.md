# E2E 验证清单（人工）

前置：shim 已启动且 health=ok；Chrome 页面正常。

- [ ] 1. curl 非流式对话返回正常回答（Task 9 Step 2 已覆盖）
- [ ] 2. curl 流式（body 加 "stream":true）收到 SSE chunk 与 data: [DONE]
- [ ] 3. opencode.jsonc 增加 provider deepseek-brain + agent brain（README 片段）
- [ ] 4. opencode 新会话指定 model deepseek-brain/deepseek-web-brain（或 /agent brain）
- [ ] 5. 让 brain 执行两步任务（如"列出当前目录文件，然后读取其中一个"）：
      brain 输出 tool_call → OpenCode 真执行 → 结果回传 → brain 继续；全程不出现半截 JSON
- [ ] 6. 连续 5 轮以上对话，验证会话连续（brain 记得前文）
- [ ] 7. 长时间会话触发 compaction（阈值 40K）后行为仍正常
- [ ] 8. 勾选完毕后本清单随会话归档
