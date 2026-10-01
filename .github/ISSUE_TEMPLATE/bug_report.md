---
name: Bug 报告
about: 报告 deepseek-brain 的问题
title: "[Bug] "
labels: bug
assignees: ''
---

<!--
请先确认这不是「已知限制」：
- 站点改版导致 ui_changed → 见 README 的排障一节
- 非 Windows 平台 → 本项目仅支持 Windows（os: win32）
- 账号被限流/封禁 → 自动化驱动可能违反服务条款，属预期风险，不接受漏洞报告

下面第 2、4、5 项是排查的关键信息，缺了它们通常只能来回问三轮才能定位。
-->

## 1. 概述

<!-- 一句话说清：什么情况下、期望什么、实际得到什么。 -->

## 2. 环境（必填）

| 项 | 值 |
| --- | --- |
| deepseek-brain 版本 | <!-- 如 v0.2.0；`deepseek-brain --help` 首行可见 --> |
| Node.js 版本 | <!-- `node -v` --> |
| Windows 版本 | <!-- `winver`，写到 10 位版本号即可，如 Windows 11 23H2 / Windows 10 22H2 --> |
| Chrome 版本 | <!-- `chrome://version` 里的版本号；若实际用的是 Edge 请注明 --> |
| 安装方式 | <!-- npm 全局安装 / npx / 源码 npm install && npm run build --> |

## 3. 复现步骤

<!--
1.
2.
3.
越具体越好：用什么命令启动、带哪些 flag、发了什么请求。
-->

## 4. 实际输出 / 报错

<!--
终端原始输出，**不要**只写「报错了」。
完整的 stack trace、DeepSeek 返回的原始文本都贴上来。
-->


## 5. health 输出（必填）

<!--
服务暴露只读 GET /health（不触发 Chrome 启动），直接贴响应 JSON：

    curl.exe -s http://127.0.0.1:8790/health
    # → { "status": "ok", "loggedIn": true }

若服务没起来、拿不到该端点，就贴启动日志里这几行：
    [brain] browser: <chrome 路径>
    [brain] profile 已播种，跳过登录等待；Chrome 将在首个请求时启动
    [brain] shim listening on http://127.0.0.1:8790/v1
-->

    health: <粘贴>

## 6. CHROME_PATH 是否显式设置（必填）

| 项 | 值 |
| --- | --- |
| 是否设置了 `CHROME_PATH` 环境变量 | <!-- 是 / 否 --> |
| 是否使用了 `--chrome-path` | <!-- 是 / 否 --> |
| 若有，实际指向的路径 | <!-- 如 C:\Program Files\Google\Chrome\Application\chrome.exe --> |

<!--
这一项决定了 Chrome 是自动探测还是显式指定。
「自动探测失败」和「路径指错」是两类完全不同的问题。
-->

## 7. 登录态

| 项 | 值 |
| --- | --- |
| profile 目录 | <!-- 如 .chrome-profile --> |
| 是否跑过 `deepseek-brain login` 并成功 | <!-- 是 / 否 / 没试过 --> |
| `.chrome-profile/Default/Network/Cookies` 是否存在 | <!-- 是 / 否（Windows 上可用 `dir` 确认） --> |

## 8. 补充信息

<!--
最近是否改过什么？是否只有这台机器复现？是否跑过 `npm run smoke`？
如果怀疑是站点改版，附上页面截图会大幅加快定位。
-->