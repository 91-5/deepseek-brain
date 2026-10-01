# `.tasks/` 与 `verdicts/`

这两个目录是 **v0.2.0 开发过程的评审记录**，**不是项目运行所需**。

`npm install` / `npm pack` 都不会包含它们（见 `package.json` 的 `files` 白名单），
删掉也不影响 deepseek-brain 的任何功能。它们留在这里是为了让 v0.2.0 的评审过程可追溯。

## 里面有什么

| 文件 | 内容 |
|---|---|
| `REVIEW-XJ-20261001-001.md` | 第 001 轮独立评审卡（人工阅读版） |
| `../verdicts/XJ-20261001-001.verdict.json` | 同一轮评审的机器可读结论 |

评审结论：**PASS · 0 blockers · 5 conditions**，评审日期 2026-10-01。

## 关于 `XJ-` 编号和目录名

`XJ-<日期>-<轮次>` 这套编号、以及 `.tasks/` + `verdicts/` 的目录布局，**沿用了
agent-covenant 协议的格式规范**（agent-covenant 是另一个独立项目，用来约定
"评审结论必须有机器可读载体"这件事）。

**但这两个文件的内容全部属于 deepseek-brain**，与 agent-covenant 没有任何关系——
评审对象是 deepseek-brain v0.2.0 的 16 个提交，五条 condition 全部是本仓库自身的问题
（bug 模板与已发布接口矛盾、CONTRIBUTING 陈旧计数、两个 diag 脚本 import 断链、
轮次坐标失真、评审会话无终端导致运行类门未实跑）。

评审卡末尾的 `Reviewer disclosure` 段落记录了评审过程中的一次误操作：
评审会话曾误将一份 agent-covenant 的旧 verdict 覆写至其原路径，核对后确认内容与既有
修正版逐字一致、无损坏。此事已在评审卡内备案。

## 5 条 condition 的现状

其中 3 条内容缺陷已在 commit `ea44ef8` 修复：

- `bug_report.md` 中关于 `/health` 的错误描述
- `CONTRIBUTING.md` 的陈旧测试计数
- `diag-check.mjs` / `diag-probe.mjs` 的断链 import

轮次坐标失真（condition 4）属于评审记录本身的坐标问题，无代码影响。
运行类门实跑（condition 5）由 CI 覆盖，`.github/workflows/ci.yml` 在 PR 到 main 时
全量执行 typecheck / test / build / pack / 安装冒烟。
