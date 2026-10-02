# deepseek-brain 跨平台支持 — 设计规格

**日期:** 2026-10-02
**目标版本:** v0.3.0
**状态:** DRAFT — 待独立评审
**上游调研:**
- 源码级调研（librarian）：四家成熟项目路径探测对比、各平台真实路径、Node 跨平台探测原语
- 架构可行性评估（hard-reasoning）：headless Linux 首登流程的物理限制、Tier 诚实分级、ROI 判断

---

## 1. 目标与非目标

### 1.1 目标

把项目从「Windows-only（硬性拒绝）」改为「**多平台可用，但按验证程度诚实分级**」。

核心改动哲学：**放开限制 + 扩充探测 + 诚实标注**，而非「宣称全平台支持」。

### 1.2 非目标（明确不做）

| 不做的事 | 理由 |
|---|---|
| 三平台真机验证 | 作者只有 Windows 机器；ROI 为负（项目未发 npm、受众小） |
| CI 三平台矩阵 | 同上。macOS CI runner 也测不出 Gatekeeper 用户摩擦 |
| snap / flatpak 探测 | 四家成熟项目（puppeteer / chrome-launcher / karma / playwright）**无一家**做；无先例、无法验证 |
| 无条件注入 `--no-sandbox` | puppeteer 官方原话 "strongly discouraged"；有安全含义 |
| headless server / Docker 支持 | **物理上不成立**，见 §2 |
| 自带 Chromium 下载 | 会立刻引入 Gatekeeper / 签名问题；当前「驱动用户已装 Chrome」的设计已规避此风险 |
| `import-profile` / `export-profile` 子命令 | 是独立特性，与本改造无关 |

---

## 2. 决定性约束：headless Linux 首登流程不成立

**这是本 spec 最重要的一条，决定了「全系统兼容」的正确表述方式。**

### 2.1 事实链

1. 项目**首次运行必须人工登录**：拉起有头（headful）Chrome，阻塞等待用户在 `chat.deepseek.com` 输密码、过 2FA，最长 30 分钟。
2. 无 X11/Wayland 的纯 headless 环境里，有头 Chrome 没有可绘制的 display，**直接启动失败或立即崩溃**。这是 Chrome 的 GUI 依赖，不是 puppeteer 的问题。
3. 上 `xvfb` 能起虚拟帧缓冲，但**虚拟显示的画面在没人看的内存里**——用户看不见窗口，就无法输入密码。

### 2.2 结论矩阵

| 环境 | 首登流程能否走通 | 定性 |
|---|---|---|
| Windows | ✅ | Tier 1（已实测） |
| 桌面 Linux（有真实 display） | ✅ | Tier 2（代码支持，未实测） |
| WSL2 + WSLg | ⚠️ 可能可以（WSLg 提供 display） | Tier 2，需单独验证 |
| 纯 headless 服务器 / VPS | ❌ **走不通** | 明确不支持 |
| Docker | ❌ 同上 + sandbox 问题叠加 | 明确不支持 |

### 2.3 为什么不做 profile 拷贝这条变通

理论上可行（登录态是文件系统状态），但风险集中在**不可验证**：

- Chrome 对 cookie 有加密，Linux 上密钥可能来自系统 keyring（libsecret）而非 profile 目录。换机器后 keyring 不同 → **静默的数据不兼容**，排查成本极高。
- 要求 Chrome 版本一致，否则 profile schema 可能不兼容。
- 用户需完成：桌面机装同版本 Chrome → 登录 → 停 Chrome → 定位 profile → 打包传输 → 服务器放到正确位置 → 确保 keyring 能解密。**每一步都可能失败。**

若将来真要做服务器场景，正确做法是**新增独立的 `import-profile` 特性**，把它当显式特性，而不是假装 headful 登录在服务器上能跑。

---

## 3. 诚实分级（对外表述规范）

README 必须按此三级表述，**不得含糊**：

| Tier | 平台 | README 表述 |
|---|---|---|
| **Tier 1 已实测** | Windows | 「已在 Windows 实机验证」 |
| **Tier 2 代码存在·未验证** | 桌面 Linux（有 display） | 「代码路径已存在，**未在真实 Linux 实机验证**；纯 headless 服务器不支持首登流程」 |
| **Tier 3 不承诺** | macOS、headless Linux、Docker | 「路径已加入但**完全未验证**，首登能否成功未知，预期需 P2 真机验证」 |

**修订说明（2026-10-02，吸收内部预审 B5(e)）：** Tier 2 初版标签写「代码支持·未验证」，其中**「支持」二字即是承诺**——用户会读成「能用」。已改为「代码存在·未验证」。Tier 3 增加「预期需 P2 真机验证」与 spawn 失败说明。

**Tier 标签的用词纪律：**
- 禁用「支持 / supported」描述任何未在真机跑通的平台。
- 可用「代码路径已存在 / code path present」「未验证 / unverified」。
- 必须与 `package.json` 的 `description` 一致（见 §5 B4 修复）。

**README 第一屏必须写明这条硬前提：首次人工登录需要真实图形显示。**

**附加说明（B5 引出的用户摩擦）：** 除 `chrome-not-found` 外，还需说明「找得到但起不来」这一类失败（缺库 / 无 display / sandbox 拒绝）——否则用户会在 `probe` 通过之后遭遇无从判断的挂起或崩溃。

---

## 4. 探测实现设计

### 4.1 探测原语：`accessSync(X_OK)` 三平台通用

**本次调研最有价值的一条。** Node 官方文档 `doc/api/fs.md` 明文：

> `X_OK` — ... **This has no effect on Windows (will behave like `fs.constants.F_OK`).**

```ts
import { accessSync, constants } from 'node:fs'

function probe(p: string): string | null {
  try {
    accessSync(p, constants.X_OK)
    return p
  } catch {
    return null
  }
}
```

一个写法三平台通用：Unix 查可执行位，Windows 自动退化为存在性检查。**替换现有的 `fs.existsSync`**（后者不查可执行性）。

### 4.2 候选路径表

#### Windows（现有 6 条 + 1 条补充）

保持现有结构（env 前缀 × 后缀），补充 `ProgramW6432`：
- 依据：karma `getChromeExe` prefixes 含 `process.env.ProgramW6432`；puppeteer `WINDOWS_ENV_PARAM_NAMES` 含 `ProgramW6432`
- 作用：32 位 Node 跑在 64 位 Windows 上时，`PROGRAMFILES` 指向 (x86)，此变量兜底

**不做**：Windows PATH 扫描（`PATHEXT` 展开成本高收益低；三家成熟项目全都放弃）。**不加** `D:\Program Files` 硬编码回退（价值存疑）。

#### macOS（新增）

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
/Applications/Chromium.app/Contents/MacOS/Chromium
~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

依据：puppeteer / playwright / karma / chrome-launcher 四家交叉一致；`~/Applications` 来自 chrome-launcher（权重 50，低于 `/Applications` 的 100）。

`.app` 内可执行文件在 `Contents/MacOS/` 这一结构由四家独立项目源码交叉佐证。

#### Linux（新增，仅主流）

```
/opt/google/chrome/chrome            # 官方 deb/rpm 真实二进制
/opt/microsoft/msedge/msedge         # Edge 官方 Linux 安装
# PATH 扫描兜底（候选顺序见下）
```

PATH 扫描候选顺序（**`chromium-browser` 必须在 `chromium` 之前**）：
```
google-chrome-stable → google-chrome → chromium-browser → chromium
```
依据：chrome-launcher `linux()` 的 which 列表；karma 源码注释明确 *"Try chromium-browser before chromium to avoid conflict with the legacy chromium-bsu package"*（Debian 上 `chromium` 这个名字曾被游戏包 chromium-bsu 占用）。

**PATH 扫描实现：纯 Node，不依赖 `which` 命令**（部分最小化镜像没有它）：
```ts
function probeOnPath(names: string[]): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const hit = probe(path.join(dir, name))
      if (hit) return hit
    }
  }
  return null
}
```

**不做**：snap（`/snap/bin/chromium`）、flatpak（`exports/bin/*`）。理由见 §1.2——四家主流项目无一家做，属无先例自研。

### 4.3 `channel: 'stable'` 不能替代自研探测

puppeteer-core 支持 `launch({ channel })` 让其自行定位，但 `computeSystemExecutablePath` **只覆盖 Chrome 四个 channel**：
- **不含** Edge
- **不含** Chromium
- **不含** snap/flatpak

源码依据：`browser-data/browser-data.ts` 对 `Browser.CHROMIUM` 直接 throw。

**因此 `chrome-detect.ts` 必须保留并扩表。**

### 4.4 函数签名改造（**不留旧名**）

**修订说明（2026-10-02，吸收内部预审 B2/B3）：** 本节的初版设计打算「保留 `windowsChromeCandidates` / `detectWindowsChrome` 作为薄封装以向后兼容」。**该设计是错的，已废弃。** 原因：

- `src/cli.ts` 与 `src/transports/deepseek-web.ts` **两个文件都 import 了旧名 `windowsChromeCandidates`**，并在各自的失败路径上调用它。**（行号已刻意去掉——`ea44ef8` 落地后行号整体漂移，Ximo O2 已就此开单；本节一律以符号/内容锚定，不用行号。）**
- 只要旧名还存在（即便只是薄封装），这两个调用点在 darwin/linux 上就会打印 `%LOCALAPPDATA%…chrome.exe` 的候选列表——**非 Windows 用户看到的错误信息指向错误平台**，诚实分级目标被一条错误信息直接破坏。
- 薄封装的本质是「允许调用点继续使用平台专属的过时名字」，这与本改造的目标方向相反。

**因此：旧名彻底删除，不复存在。** 全部调用点改调新名。

| 现有 | 改造后 | 调用点（按内容锚定） |
|---|---|---|
| `windowsChromeCandidates(env)` | **删除**（不再是 public 函数） | `cli.ts` 的 import 行与 `chromeNotFoundMessage` 调用处 → 改调 `chromeCandidates(env, platform)`；`deepseek-web.ts` 的 import 行与失败路径 → 同上 |
| `detectWindowsChrome(env)` | **删除** | `cli.ts` 的 import 行与早检查调用处 → 改调 `detectChrome(env, platform)`；`cli-args.ts` 的 `helpText()` 首行平台声明同步 |
| — | `chromeCandidates(env, platform = process.platform): string[]` | 新增，按平台分派候选表 |
| — | `detectChrome(env, platform = process.platform): string \| null` | 新增，用 `probe()` 逐个探测 |
| `resolveChromeExecutable(explicit, env)` | **签名不变**，内部改调 `detectChrome(env)` | `deepseek-web.ts` 的 import 行去掉旧名，保留此名 |

**Windows 候选表**仍然需要一个「只生成 Windows 候选」的内部函数（平台分派需要它），但它**降级为模块内部函数**（不 export），或保留 export 但**任何生产调用点都不得直接使用它**——避免再次出现「调用点绕过平台分派」的洞。

#### 必须维持的设计约束

显式值（`--chrome-path` / config）与自动探测**必须复用同一套校验判据**，否则会出现「CLI 早失败探测说存在、bridge 启动时说不存在」的**两套真相**。§4.1 的 `probe()` 是唯一判据来源。

**B2 修复要点：`cli.ts` 中 `opts.chromePath ?? detectWindowsChrome()` 的早检查分支必须一并改造**——显式值也要过 `detectChrome` 的校验，不能零校验直通（实施后该分支落在 `cli.ts` 早检查处，见卡片 Acceptance 的 `detectChrome` 命中判据）。改造后 `cli.ts` 的早检查与 `deepseek-web.ts` 的 bridge 启动必须调用**同一个函数**，从而端到端只有一条真相路径。

#### 仍未消除的第二真相（诚实声明，见 §6）

`probe()` / `accessSync` 只能验证「文件存在且可执行」。**它验证不了「能否真的 spawn」**——缺共享库、无 display、Linux sandbox 拒绝，都发生在 `accessSync` 之后。这一类启动期失败 `probe` 永远覆盖不了，必须在 §6 明说。

`platform` 参数默认为 `process.platform`，**可注入**——这样测试能在 Windows 上覆盖 macOS/Linux 分支的候选表生成逻辑（但**测不了实际启动**，测试边界见 §6）。

---

## 5. `package.json` 字段处理

**删除 `os: ["win32"]`**，不改为白名单。

理由（hard-reasoning 结论）：
- 删字段成本几乎为零；这是「从 1 平台变 N 平台」的低成本高杠杆改动。
- 若改 `["win32","linux"]`，就是**主动拒绝 macOS**。macOS 的代码路径成本极低（就是删字段），主动拒绝没有技术收益，只有「避免用户踩坑」的沟通收益。
- 用 README 的 Tier 表述诚实标注，比替用户做决定更灵活。

### 5.1 同时必须改 `description`（**内部预审 B4**）

`package.json:4` 的 `description` 当前以 **"Windows only。"** 结尾：

```
「…供 OpenCode 作为 subagent 大脑使用。Windows only。」
```

**这是初版 spec 的疏漏**——只列了删 `os`，没列改 `description`。后果：
- 删 `os` 后该字段继续宣称 Windows-only，与 Tier 诚实目标**直接矛盾**；
- `description` 是 npm 包页与 `npm view` 直接展示的字段，用户第一眼看到的就是它。

**改造要求：** `description` 中的 "Windows only。" 必须改为与 Tier 分级一致的表述（例如「Windows 已实测；Linux/macOS 代码路径存在但未验证」）。**`description` 与 README 的 Tier 表述必须一致**，二者矛盾即为文档缺陷。

改造清单（`package.json` 内）：
| 行 | 现状 | 改造后 |
|---|---|---|
| `:4` `description` | 以 "Windows only。" 结尾 | Tier 一致的表述 |
| `:9` `os` | `["win32"]` | 字段删除 |

---

## 6. 验证边界（诚实声明）

**修订说明（2026-10-02，吸收内部预审 B5）：** 本节初版遗漏四项不可验证项，并把 Windows 上的验证范围写得比实际更宽。已补齐并收紧措辞。

**本次改造在 Windows 机器上能验证的：**
- ✅ 原行为无回归（现有测试全绿）
- ✅ macOS/Linux **候选表生成逻辑**（通过注入 `platform` 参数）
- ✅ **`probe()` 在 Windows 上的退化分支**——即 `X_OK` 被当作 `F_OK` 处理。**已实测，非仅引文档**（依据 Node 24.18.0 / Windows 实测，2026-10-02，见下方复现命令）。**Unix 上的 X_OK 可执行位分支不可验证。**
- ✅ 构建、打包、`npx --help`
- ✅ 改造后**不再有调用点 import 平台专属旧名**（可由 `git grep` 断言，见卡片 Acceptance）

**本次改造无法验证的（必须白纸黑字承认）：**

| # | 不可验证项 | 说明 |
|---|---|---|
| 1 | Linux 上 Chrome 实际能否被拉起 | 无 Linux 机器 |
| 2 | macOS 上 Chrome 实际能否被拉起 | 无 Mac 机器 |
| 3 | macOS 上 Gatekeeper / 权限是否干扰 | 无 Mac 机器；见下方专项声明 |
| 4 | 任何平台的首登流程（除 Windows） | 需要真实桌面环境 |
| 5 | 无 display 环境下的失败模式是否「优雅报错」而非「静默挂起」 | 需真机 |
| 6 | **WSL2 + WSLg**（§2.2 列为「需单独验证」，本表必须收录） | 需真机 |
| 7 | **Unix 上 `X_OK` 可执行位分支**（Windows 只验了 F_OK 退化） | 需 Unix 机器 |
| 8 | **Windows 上的真实启动路径**——既有测试以 `process.execPath` 冒充浏览器，**从不真正 spawn**；live 测试默认跳过。因此「找得到但起不来」这一类问题**在 Windows 上同样未被新测试覆盖**，不是 macOS/Linux 专属缺口 | 需真实 Chrome 会话 |
| 9 | **`ProgramW6432` 的真实语义**——该变量只在「32 位 Node 跑在 64 位 Windows」时才有意义，靠 env 注入测不出真实行为 | 需 32 位 Node 环境 |

**第 9 项的处置**：`ProgramW6432` 仍值得加入候选表（karma / puppeteer 均含此变量），但**不宣称它被验证过**——它只是「与主流实现一致」的防御性补充。

**关于 Windows `X_OK` 退化的复现证据（2026-10-02 补测）**

第二轮评审（`XJ-20261002-002`，Observation O1）对「`X_OK` 在 Windows 退化为 `F_OK`」提出事实性存疑：评审者用 `process.execPath`（一个真实 `.exe`）实测 `accessSync(p, X_OK)` 与 `F_OK` 均返回成功，**无法区分二者**，因此建议实现轮复核。

评审的方法是对的——用可执行文件测这个命题**在原理上不可能证伪**。正确的探针必须是一个**存在但不可执行**的文件。补测如下：

```js
// 关键：探针文件是 .txt，绝不是可执行文件
const fs = require('fs'), os = require('os'), path = require('path')
const tmp = path.join(os.tmpdir(), 'xok-probe.txt')
fs.writeFileSync(tmp, 'x')
try {
  fs.accessSync(tmp, fs.constants.X_OK)
  console.log('存在但非可执行的 .txt + X_OK -> 通过（说明 Windows 忽略执行位）')
} catch (e) {
  console.log('存在但非可执行的 .txt + X_OK -> 抛错', e.code)
}
fs.unlinkSync(tmp)
```

实测结果（Node 24.18.0，Windows）：**`.txt` 文件通过 `X_OK` 检查** —— 证实 Windows 不实现执行位，`X_OK` 语义等同于 `F_OK`。本改造的判据因此正确；但**这只证明了 Windows 侧**，Unix 侧的「不可执行文件会被 `X_OK` 拒绝」仍未验证（见上表第 7 项）。

**方法学教训（值得保留）**：一个用可执行文件去测「可执行位是否被尊重」的探针，其结论必然是「被尊重」——无论平台实际如何。评审者识别出无法判定并标注存疑，而不是顺势判 PASS 或 FAIL，是正确处置。

**关于 macOS 权限的不确定性（不得编造）：**
- 不确定 puppeteer 走 CDP 路径是否需要 Accessibility / Automation / Screen Recording 权限。
- 方向性判断：CDP 是 Chrome 自己开放的调试端口，**可能不触发** Accessibility 权限（后者主要针对系统级 UI 模拟）。但**不确定**。
- chrome-launcher 在 macOS 上用 `lsregister` 而非直接 spawn，暗示「路径存在」与「能启动」在 macOS 上不完全等价——这提高了「仅加路径条目可能不够」的风险权重。
- 首次运行时用户**可能**遭遇系统授权弹窗，这是真实存在的用户摩擦；具体弹几个、弹什么，**不验证不知道**。

**`accessSync` 通过 ≠ 可启动（B2 引出的第二真相）：**
`probe()` 只验证「文件存在且可执行」。缺共享库、无 display、Linux sandbox 拒绝，都发生在 `accessSync` 之后、`spawn` 期间。这一类失败**永远不在 `probe` 的能力范围内**，因此：
- CLI 早检查通过**不代表** bridge 启动会成功；
- 本 spec **不声称**已消除全部「两套真相」——只消除了「显式值零校验直通」这一条（B2）。启动期真相只能在 P1/P2 真机阶段处理。

以上不确定项在 README 中按 Tier 3 表述处理，不给出任何承诺。

---

## 7. 验收标准（可执行）

> 按 Agent Covenant PROTOCOL.md §5，每条必须能被机器判真伪。

1. `npm run typecheck` 退出码 0
2. `npm run typecheck:test` 退出码 0
3. `npm test` 退出码 0，且 `183 passed | 1 skipped`（数量不得减少）
4. `git grep -n '"os": \[' package.json` 无命中（`os` 字段已删除）
5. `git grep -c 'accessSync' src/transports/chrome-detect.ts` ≥ 1（`existsSync` 判据已替换）
6. `git grep -n 'existsSync' src/transports/chrome-detect.ts` 无命中
7. 新增测试文件中存在覆盖 `darwin` 与 `linux` 分支的用例，且 `npm test` 中通过
8. `npm pack` 退出码 0，且 tarball 内包含 `dist/transports/chrome-detect.js`
9. 干净目录安装 tarball 后，`npx deepseek-brain --help` 退出码 0
10. README 中含字符串 `Tier` 与 `headless`（诚实分级已写入）
11. README 安装章节不再声明「Windows only」为硬性限制（`git grep -n 'Windows only' README.md` 的结果必须已改为分级表述或删除）

---

## 8. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| Linux 无 display 时静默挂起，而非优雅报错 | 中 | 需在 §6 P1 阶段实测；当前至少保证 `chrome-not-found` 早失败路径覆盖 |
| macOS 授权弹窗造成首登中断 | 高·未知 | Tier 3 表述，不承诺；等真实 Mac 用户反馈再投入 |
| `--profile` 相对路径（按 cwd 解析）在三平台的语义差异 | 低 | 保持现状（跟随 cwd），风险最小；文档说明 |
| 测试注入 `platform` 参数后，真实平台分派与测试分派不一致 | 中 | 生产代码 `platform` 默认 `process.platform`，测试仅覆盖候选表生成，不覆盖启动 |

---

## 9. 分阶段计划

| 阶段 | 内容 | 置信度 |
|---|---|---|
| **P0（本次）** | 删 `os`；扩 macOS/Linux 路径表；`accessSync(X_OK)`；纯 Node PATH 扫描；README Tier 分级；不碰 snap/flatpak；不注入 `--no-sandbox` | 高（80%） |
| **P1（触发式）** | 有真实桌面 Linux 需求时：实机跑首登 + 起服务 + 一次 API 调用；确认无 display 时的失败模式 | 中（需真机） |
| **P2（触发式）** | 有真实 Mac 用户时：验证 Gatekeeper/权限交互 | 低（无 Mac 无法预判） |
| **P3（明确不做）** | headless server / Docker → 需独立的 `import-profile` 特性 | — |

---

## 10. 参考来源

**源码级核实（librarian）：**
- puppeteer `packages/browsers/src/launch.ts`、`browser-data/chrome.ts`、`packages/puppeteer-core/src/node/ChromeLauncher.ts` — https://github.com/puppeteer/puppeteer
- chrome-launcher `src/chrome-finder.ts` — https://github.com/GoogleChrome/chrome-launcher
- karma-chrome-launcher `index.js` — https://github.com/karma-runner/karma-chrome-launcher
- playwright `packages/playwright-core/src/server/registry/index.ts` — https://github.com/microsoft/playwright
- Node.js `doc/api/fs.md`（`X_OK` 在 Windows 上退化）— https://nodejs.org/api/fs.html
- Node.js `doc/api/process.md`（`process.platform` 取值）
- puppeteer troubleshooting（Linux AppArmor / `--no-sandbox` / 缺库）— https://pptr.dev/troubleshooting

**架构判断（hard-reasoning）：** headless Linux 首登物理限制、Tier 分级、ROI 排序。

**未核实（禁止写进实现或文档作为事实）：**
- macOS 是否需要 Accessibility / Automation / Screen Recording 权限
- macOS Gatekeeper 是否干扰（puppeteer 官方 troubleshooting 通读未见提及）
- `microsoft-edge` 作为 Linux PATH 命令名（推断，未核实）
