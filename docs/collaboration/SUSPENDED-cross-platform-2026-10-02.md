# SUSPENDED: 跨平台改造任务挂起说明（2026-10-02）

> 给未来的自己/下一个会话。**先读这份，再碰任何东西。**

## 为什么挂起

sir 下令暂停跨平台任务，先处理 **Ximo 评审邮箱目录的文件名碰撞问题**：

- `D:\15812\mo brain\ximo\.tasks\` 被多个项目共用（deepseek-brain、软著申请等）
- 已发生实际事故：**别的项目用同名 `REVIEW-REQUEST-XJ-20261002-001.md` 覆盖了本项目的请求卡**（2026-10-02 13:31）
- 当前对策：本项目的信封一律加 `DSB-` 前缀（如 `DSB-REVIEW-REQUEST-XJ-20261002-002.md`）
- sir 说这个问题他会自己搞定，之后再回来做全系统兼容

## 任务当前坐标

- **仓库**：`D:\15812\Documents\deepseek-brain`
- **分支**：`main`
- **HEAD**：`bf3e2d8`（`fix(bridge): Chrome 异常退出后能自愈，不再永久 502`）← 注意这是 **shim 修复**，不是跨平台改造
- **代码改造进度**：**零**。`src/` 未做任何跨平台改动，工作树在本存档提交后应干净

## 评审门禁状态（关键：别重复劳动）

跨平台方案的评审**已经跑完两轮**，不要再从零开始：

| 轮次 | verdict id | 结果 | 文件 |
|---|---|---|---|
| 第一轮 | `XJ-20261002-001` | **FAIL / 4 blockers** | `verdicts/XJ-20261002-001.verdict.json` |
| 第二轮（复审） | `XJ-20261002-002` | **FAIL / 1 blocker**（4 → 1，说明修法被认可） | `verdicts/XJ-20261002-002.verdict.json` |

**注意**：`XJ-20261002-002.verdict.json` 的 `artifact` 字段写的是 `.tasks/DSB-20261002-001.md`，这是 Ximo 的填写笔误（它审的其实是复审请求卡 + 修订后的 001 卡）。id 是 002，别被 artifact 字段误导。

**sir 明确指示**：那 1 个 blocker 与 5 条 conditions **后期重新审查一遍**，本存档不做消化。

## 第一轮 4 个 blockers 的原始内容（已被第二轮认可为「修订到位」）

1. **B1** — 协议 A1 不可满足（实现未开始）→ **不修**，OPEN 卡的正确状态
2. **B2** — Constraints 自相矛盾：「旧名彻底删除」与「禁止改 183 测试」死锁（`tests/chrome-detect.test.ts:2` import `detectWindowsChrome`）
   - 修法：窄豁免，只许可改 import 行 + 函数名，白名单只此一个文件
3. **B3** — `deepseek-web.ts`「只动两处」是自制力约束，不可机检
   - 修法：三条 diff 判据（numstat ≤ 8 / hunk ≤ 2 / `+/-` 行内容白名单）
4. **B4** — description ↔ README 一致性无机检判据
   - 修法：定稿共享子串 `Windows 已实测；Linux/macOS 代码路径存在但未验证`
   - **sir 已拍板选这个措辞**（约束放能力前面）

## 作者自曝的一条坏判据（已修，勿回退）

按 Ximo O1 要求把 `os` 判据改成 `git grep -nF '"os"'` 后，本机实测**假阳性命中 `package.json:6` 的 `repository.url`（github.com）**：

- 后果：**undeletable failure** —— 即使 `os` 字段正确删除，该行仍命中 → 永久 FAIL
- 已换成 Node 精确判据：`node -e "process.exit(Object.prototype.hasOwnProperty.call(require('./package.json'),'os')?1:0)"`
- 双向验证过：改前 exit 1、模拟删除后 exit 0

**任何未来的 `os` 判据都不要用 grep 文本匹配。**

## 关键设计决策（已定，勿重新争论）

- **目标表述纪律**：headless Linux 上「首次人工登录」物理上不成立（有头 Chrome 无 display 崩、xvfb 画面用户看不见）
- **Tier 分级**：Tier 1 Windows 已实测 / Tier 2 桌面 Linux 代码存在·未验证 / Tier 3 macOS·headless·Docker 不承诺
- **Tier 标签禁用「支持/supported」**，用「代码路径已存在·未验证」
- **旧名彻底删除**，不留薄封装（保留即 B3 必然回归）
- **`accessSync(path, X_OK)`** 替换 `existsSync`（Windows 退化为 F_OK，Node 官方明文）
- **不做**：snap/flatpak 探测（四家成熟项目无先例）、无条件 `--no-sandbox`、自带 Chromium 下载

## 邮箱规则（重要）

- 本项目信封**必须**带 `DSB-` 前缀：`DSB-REVIEW-REQUEST-XJ-<日期>-<序号>.md`
- Ximo 的产出写回 `DSB-REVIEW-XJ-<日期>-<序号>.md` + `D:\15812\Documents\deepseek-brain\verdicts\XJ-<日期>-<序号>.verdict.json`
- **Ximo 无 API、无文件监听器**：必须有真人在它界面说「读 xxx.md」才会启动。这是设计，不是缺陷
- `ts` 规则：最新被审文件 mtime ≤ ts ≤ now，**不取整**

## 恢复步骤

1. 确认 sir 已解决邮箱碰撞问题
2. 读 `verdicts/XJ-20261002-002.verdict.json`，消化那 1 个 blocker + 5 conditions（sir 要求重新审查）
3. 按消化结果改卡片/spec → 重新提交 Ximo 复审（第三轮，id 顺延 `XJ-20261002-003`）
4. 门禁 PASS 后再动 `src/` 代码

## 相关文件

- `.tasks/DSB-20261002-001.md` — 跨平台任务卡（含 B2/B3/B4 修订）
- `.tasks/DSB-20261002-003.md` — **另一个任务**：shim 驻留加固（对应 `bf3e2d8`），与本任务无关。**编号说明**：该卡原为 `002`，因与本项目评审第二轮的 verdict id `XJ-20261002-002` 撞号（同一日期同一序号，两套编号语义不同），于 2026-10-02 改名为 `003`
- `docs/superpowers/specs/2026-10-02-deepseek-brain-cross-platform-design.md` — 跨平台设计规格
- `.tasks/archive/` — oracle 内部预审存档（id 冲突已解，非正式 verdict）
- `.tasks/REVIEW-XJ-20261001-001.md` — 第一轮（v0.2.0 OSS 化）评审卡，已补 Blockers/Conditions 段过 lint
