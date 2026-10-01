---
name: 功能建议
about: 为 deepseek-brain 提出新功能或改进
title: "[Feature] "
labels: enhancement
assignees: ''
---

## 1. 概述

<!-- 一句话说清你想要什么。 -->

## 2. 动机

<!--
这是最重要的一节。请说明你**现在**是怎么解决的、
为什么现有能力不够用。
「加个 XX 功能」本身不构成动机，「我因为没有 XX 每周要手动做 YYY」才是。
-->

## 3. 期望的用法

<!--
具体到调用形态。下面是示意，请按你的场景改写：

    // 期望的代码或命令形态
    const transport = createMyTransport(config)
    await runAgentTurn({ messages, tools, transport, config })
-->

```ts
// 或命令行形态
// deepseek-brain serve --xxx
```

## 4. 考虑过的替代方案

<!--
为什么现有办法不行？
用 `statelessStrategy` 自己包一层？换别的后端？自己 fork？
如果你已经试过替代方案，请贴出来。
-->

## 5. 影响面

| 维度 | 影响 |
| --- | --- |
| 是否改动 `core/`（协议内核） | <!-- 是 / 否 --> |
| 是否改动 `transports/` | <!-- 是 / 否 --> |
| 是否**破坏性**变更（已有用户会受影响） | <!-- 是 / 否 --> |
| 是否引入新依赖 | <!-- 是 / 否；是的话写明包名与用途 --> |

> 如果改动 `core/`：请确认没有引入对 `transports/`、`puppeteer-core`
> 或站点常量的依赖，否则 `tests/core-boundary.test.ts` 会让 CI 失败。
> 详见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 6. 补充信息

<!-- 相关 issue、PR、文档链接，或你对 API 设计的想法。 -->