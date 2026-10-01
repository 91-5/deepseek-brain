# E2E 验证清单（人工）

前置：shim 已启动且 health=ok；Chrome 页面正常。

## 功能验证

- [ ] 1. curl 非流式对话返回正常回答（Task 9 Step 2 已覆盖）
- [ ] 2. curl 流式（body 加 "stream":true）收到 SSE chunk 与 data: [DONE]
- [ ] 3. opencode.jsonc 增加 provider deepseek-brain + agent brain（README 片段）
- [ ] 4. opencode 新会话指定 model deepseek-brain/deepseek-web-brain（或 /agent brain）
- [ ] 5. 让 brain 执行两步任务（如"列出当前目录文件，然后读取其中一个"）：
      brain 输出 tool_call → OpenCode 真执行 → 结果回传 → brain 继续；全程不出现半截 JSON
- [ ] 6. 连续 5 轮以上对话，验证会话连续（brain 记得前文）
- [ ] 7. 长时间会话触发 compaction（阈值 40K）后行为仍正常
- [ ] 8. `GET /health` **不触发 Chrome 懒启动**（用已播种的正常 profile 即可）：
      `deepseek-brain` 启动（看到「profile 已播种，跳过登录等待」）→
      确认进程列表里**没有** chrome.exe → 调一次 `/health` → 再确认**仍然没有** chrome.exe →
      首次调 `/v1/chat/completions` → 这次 chrome.exe 才出现
- [ ] 9. `deepseek-brain login` 子命令：只登录、不监听端口，登录成功后退出且端口未占用
- [ ] 10. `--verbose` 时多出三处会话恢复诊断（resumed session / redirect / navigation failure），
       不加该 flag 时这三行不出现
- [ ] 11. 勾选完毕后本清单随会话归档

## Windows / PowerShell 5.1 陷阱（spec §5.6）

这三条不是风格偏好，每一条都造成过**静默的错误结论**。

### 陷阱 ① PowerShell 会把 UTF-8 当 GBK 解码，字符丢失不可逆

`curl.exe` 写出的响应是 UTF-8 字节流，但只要经过 PowerShell 的**字符串层**（管道、变量赋值、
`Get-Content -Raw`），就会被按系统 ANSI 代码页（简体中文 Windows 上是 GBK/936）解码。
解码失败的位置变成替换字符，**原始字节已被丢弃，无法恢复**。

实测记录：一次评审回复经此路径后**丢了 26 个字符**，且当时看输出「像是模型答错了」。

**验证中文响应的唯一可靠做法**——让 curl 直接写字节，node 按 UTF-8 读：

```powershell
curl.exe -s -o resp.json http://127.0.0.1:8790/v1/chat/completions `
  -H "content-type: application/json" `
  -d "{\"model\":\"deepseek-web-brain\",\"messages\":[{\"role\":\"user\",\"content\":\"用中文写一段自我介绍\"}]}"

node -e "const r=JSON.parse(require('fs').readFileSync('resp.json','utf8'));console.log(r.choices[0].message.content)"
```

JSON 校验同理：**不要**用 `Get-Content -Raw | ConvertFrom-Json`，UTF-8 中文文件会误报
「字符串未终止」。用 `node -e` 读。

### 陷阱 ② curl 的输出一律 `-o` 落盘，禁止直接管道解析

管道本身就是「让 curl 的字节流穿过 PowerShell 字符串层」——正是陷阱 ① 的成因。
`-o` 让 curl 自己写文件，字节不经 PowerShell。

```powershell
# ❌ 触发陷阱 ①
$json = curl.exe -s http://127.0.0.1:8790/v1/chat/completions ...
$obj = $json | ConvertFrom-Json

# ✅ curl 写字节，node 读字节
curl.exe -s -o resp.json http://127.0.0.1:8790/v1/chat/completions ...
node -e "console.log(require('fs').readFileSync('resp.json','utf8'))"
```

同一条规则适用于所有 `curl.exe` 调用，**包括看起来「只有 ASCII」的**：`/v1/models`、
`/health` 的响应里也可能出现中文（会话 id、错误信息）。

### 陷阱 ③ .NET 方法的相对路径按**进程 cwd** 解析，不用 PS 当前位置

在 PowerShell 里 `cd` 改的是 PowerShell 自己的当前位置（`Get-Location`）。
但 .NET / Node 侧的相对路径是拿**进程 cwd**去解析的，两者可以不一致——
典型触发方式：用 `Start-Process`、`Invoke-Expression`、编辑器任务、CI runner，
子进程的 cwd 可能是系统目录或仓库根，而不是你以为的地方。

对本项目的具体后果：`--profile` 默认值 `.chrome-profile` 是相对路径
（`src/config.ts` 的 `DEFAULTS.browser.profileDir`），经 `path.resolve()` 按进程 cwd 解析。
换个目录启动 `deepseek-brain`，用的就是**另一个 profile**，于是「明明登录过了却报
`login_required`」。

**一律用绝对路径**：

```powershell
# ❌ 相对路径，cwd 一变就换 profile
deepseek-brain --profile .chrome-profile

# ✅ 绝对路径，与 cwd 无关
deepseek-brain --profile "$env:USERPROFILE\.deepseek-brain\profile"
deepseek-brain --chrome-path "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
```

验证脚本里读文件（`Get-Content`、`Test-Path`、以及交给 `node -e` 的路径）同理：
先 `(Resolve-Path .).Path` 拿到绝对路径再往下传，别依赖「我刚 cd 过」。
