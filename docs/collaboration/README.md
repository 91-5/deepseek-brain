# `.tasks/` 与 `verdicts/`

这两个目录是 **v0.2.0 开发过程的评审记录**，**不是项目运行所需**。

`npm install` / `npm pack` 都不会包含它们（见 `package.json` 的 `files` 白名单），
删掉也不影响 deepseek-brain 的任何功能。它们留在这里是为了让 v0.2.0 的评审过程可追溯。

## 里面有什么

| 文件 | 内容 |
|---|---|
| `REVIEW-XJ-20261001-001.md` | 第 001 轮独立评审卡（人工阅读版） |
| `../verdicts/XJ-20261001-001.verdict.json` | 同一轮评审的机器可读结论 |
| `../verdicts/XJ-20261002-002.verdict.json` | 第 002 轮（跨平台）结论：FAIL · 1 blocker（+5 项 evidence 待办） |
| `../verdicts/XJ-20261002-003.verdict.json` | 第 003 轮（跨平台终态）结论：PASS · 0 blockers · 0 conditions |

第 001 轮评审结论：**PASS · 0 blockers · 5 conditions**，评审日期 2026-10-01。

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

## 第 002 轮独立评审（2026-10-02）

跨平台改造（`docs/superpowers/specs/2026-10-02-deepseek-brain-cross-platform-design.md`）
的独立评审。**结论：FAIL · 1 blocker · 0 conditions**——5 个待办项写在 verdict 的
`evidence` 段落（第 19 条），而非 `conditions` 字段，这是本仓库读 verdict 时踩过的坑：
**不能只看 `blockers`/`conditions` 计数，`evidence` 里可能夹带评审员要求的动作。**

机器可读结论：`../verdicts/XJ-20261002-002.verdict.json`。

### 第 002 轮 5 项 evidence 的处置

| # | 评审要求 | 处置 |
|---|---|---|
| 1 | B2 `describe` 字符串保留旧名即可，不改 import 与函数名（numstat ≤ 4 自然 PASS） | **已消化**：窄豁免以「内容判据」落地（每行 `+`/`-` 须匹配 `detectChrome\|detectWindowsChrome\|import`），测例数 8 不变 |
| 2 | B3 三判据存在 K1 别名注入 / K2 白名单子串夹带两条绕过，接受为「诚实实现者下足够强」 | **已缓解**：Acceptance #9 强制调用形态 `chromeCandidates(\|detectChrome(`；评审确认这是有效缓解 |
| 3 | B4 共享子串注释绕过仍可，建议加 `grep -v '<!--'` 或 `grep -F '\| darwin'` ≥ 1 强制 Tier 表 | **已实测不成立**：`package.json` 命中 1 处（有效 `description` 字段）、README 命中 3 处，**全部在正文，无一被 HTML 注释包住**。担忧为理论性；未加 `\| darwin` 判据（该行并不含 darwin 字面量，实测 `git grep -cF '\| darwin'` 为 0，采用会导致误判） |
| 4 | O1 升级版 Node 判据接受（grep 偏离必要代价） | **已消化**：判据已采用 `hasOwnProperty` 而非 `git grep -F '"os"'` |
| 5 | B4 增强建议视实现轮诚实度可选加 | **已消化**：见 #3，实测证伪理论担忧 |

### O1（`X_OK` Windows 退化存疑）的关闭

评审员对「`X_OK` 在 Windows 退化为 `F_OK`」提出事实性存疑，用 `process.execPath`
（真实 `.exe`）实测 `accessSync(p, X_OK)` 与 `F_OK` 均成功，**无法判定**。

结论：评审的方法学是对的——**用可执行文件去测「可执行位是否被尊重」，结论必然是
「被尊重」，无论平台实际如何**，此探针在原理上不可证伪。

作者用正确探针（存在但**不可执行**的 `.txt`）复测，Node 24.18.0 / Windows：
`accessSync(p, X_OK)` **通过**，证实 Windows 不实现执行位。已把复现命令写入 spec §6。

### 流程教训（写入请求卡模板）

> **请求卡必须显式要求 reviewer 逐条核对 `Deliverables` 清单，而不仅核对 `Acceptance` 判据。**

起因：第 001 轮，`DSB-20261002-001.md` 列了 5 项 deliverable，第三轮 PASS 的
verdict **不覆盖其中第 5 项**——该 deliverable 对应的 5 个实现提交从未触碰它，
评审证据清单也未提及。PASS 是真实的（评审只对证据清单内的条目负责），
**但「PASS」不等于「全部 deliverable 已完成」**。请求卡若不显式要求逐条核对
deliverable，评审员按惯例只核对 acceptance，漏项就会以 PASS 的形态通过。

同理，**读 verdict 不能只看计数**：第 002 轮的 5 个待办全部藏在 `evidence` 第 19 条，
`blockers`/`conditions` 计数为 1/0，会让人误以为只剩一个 blocker 待处理。

## 第 003 轮独立评审（2026-10-02，终态）

跨平台改造的终态独立评审。**结论：PASS · 0 blockers · 0 conditions · independent=true**
（`../verdicts/XJ-20261002-003.verdict.json`，ts `2026-10-02T08:20:21.052Z`）。

评审员独立复跑全量回归并逐条确认第 002 轮 B2/B3/B4 消解；
窄豁免的「内容判据」被判「更精准、无绕过」；
`src/cli.ts` 注释改写被判不构成粉饰。

### 三点如实说明

1. **`README.zh-CN.md` 存在 ~308 个私用区字符**（属既有损坏，`HEAD~1` 已 309 个，非本次引入）；
   本次仅修正了其中导致 `STALE_TEST_COUNT` 静默跳过的测试计数行。
2. **Tier 标签不使用「支持 / supported」字样**：Windows 用「已实测」，
   Linux/macOS 用「代码路径已存在·未验证」，headless Linux 用「不承诺」。
   理由：headless Linux 首次人工登录需要真实图形显示，物理上不成立，不能写「支持」。
3. **`gate.py` 的 `independent` 字段是自证字段**（`gate.py:142` 仅检查 `is True`），
   零机制能证明签字人真是独立评审人。本轮的独立性来自流程纪律（Ximo 是独立 Electron agent、
   无 API、靠人工信箱投递），**但不是密码学或机制保证**。
