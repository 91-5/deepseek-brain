import type { Browser } from 'puppeteer-core';
import type { AppConfig } from '../config.js';
import type { Transport } from '../core/types.js';
import { type SessionSnapshot } from '../core/session/store.js';
/** 页内探针：包裹 XHR，捕获 /chat/completion 的 body 与流式 responseText。
 *  幂等：重复注入（整页刷新后 framenavigated 重注）不会双重包裹
 *
 *  export 只是为了让测试能在沙箱里跑**这段真实脚本**；不影响页面侧语义。*/
export declare const PROBE = "(() => {\n  if (window.__probeInstalled) return 'probe-ok'\n  window.__probeInstalled = true;\n  window.__comp = window.__comp || [];\n  const oOpen = XMLHttpRequest.prototype.open;\n  const oSend = XMLHttpRequest.prototype.send;\n  XMLHttpRequest.prototype.open = function(m, u, ...r) { this.__u = u; return oOpen.call(this, m, u, ...r); };\n  XMLHttpRequest.prototype.send = function(b, ...r) {\n    try {\n      if (/completion/.test(this.__u || '')) {\n        const entry = { url: this.__u, body: b, t0: Date.now(), status: null, resp: '', done: false };\n        window.__comp.push(entry);\n        // \u589E\u91CF\u7D2F\u79EF\uFF1Aprogress \u7ED9\u7684\u662F responseText \u5168\u91CF\u5FEB\u7167\uFF0C\u9010\u6B21\u6574\u4EFD\u590D\u5236\u662F O(n^2)\u3002\n        // startsWith \u5B88\u536B\u4E0D\u53EF\u7701\uFF1A\u91CD\u5B9A\u5411/\u91CD\u8BD5\u65F6 responseText \u53EF\u80FD\u6574\u4F53\u6362\u6389\uFF0C\n        // \u65E0\u5B88\u536B\u7684 slice(prev.length) \u4F1A\u5207\u51FA\u4E2D\u6BB5\u5E76\u8FFD\u52A0\u8FDB\u5DF2\u7D2F\u79EF\u6B63\u6587\uFF08\u810F\u6570\u636E\uFF09\u3002\n        // \u8BED\u4E49\u7B49\u4EF7\u4E8E src/transports/tail.ts \u7684 appendTail\u3002\n        const merge = function(prev, next) {\n          return (next.length > prev.length && next.startsWith(prev)) ? prev + next.slice(prev.length) : next;\n        };\n        this.addEventListener('progress', () => { entry.resp = merge(entry.resp, this.responseText); });\n        this.addEventListener('loadend', () => { entry.status = this.status; entry.done = true; entry.resp = merge(entry.resp, this.responseText); });\n      }\n    } catch (e) {}\n    return oSend.call(this, b, ...r);\n  };\n  return 'probe-ok';\n})()";
export interface WebBridge extends Transport {
    start(): Promise<void>;
    stop(): Promise<void>;
}
export interface WebBridgeOptions {
    /** 会话持久化文件路径；默认读 env.SESSIONS_FILE，再退化到仓库根 .sessions.json */
    sessionsFile?: string;
    /**
     * **仅测试用**：整段替换「解析 Chrome 可执行文件 + spawn 真进程 + 连 CDP 端口」。
     *
     * 为什么不提供更细的缝（如只注 `connect` 或只注导航动作）：生产启动链是
     * `spawn → retryConnect(15 次 ×1s) → openChatPage`，只注其中一环仍会在 CI 里
     * 真起进程或白等 15 秒。把整段替换掉，生产时序则**原样**保留——
     * `openChatPage` / `startBridge` / `teardownBridge` / `health` 一行不改，
     * 测试跑的是真实组合，而不是「某个阶段被单独调用」。
     *
     * **不是包的公开 API**：`package.json` 的 exports 只有 `.` 与 `./core`，
     * 本文件不在其中，所以这是**仓内** API 面的变宽。生产调用方（index.ts /
     * cli.ts）不传它时**运行时行为等价**——注意是「行为等价」而非「源码逐字不变」：
     * 源码里确实多了一个分支。（措辞由评审方纠正：原文写「逐字不变」，对行为成立、
     * 对源码不成立。）
     * 残余隐患值得知道：`browserFactory` 当前只来自 `opts`，风险为零；但若将来它
     * 改为可来自全局配置且被意外置真，生产会**静默跳过真实浏览器启动**。
     *
     * 这个缝能证明什么、不能证明什么写在 `tests/bridge-badpage.test.ts` 顶部
     * （假通过清单）。最要紧的一条：factory 路径下 `chromeProc` 恒为 null，
     * 故 `taskkill` 杀进程树与 `close()` 的 3s 超时**都测不到**——
     * 「每次重试泄漏一个 Chrome」这个最贵的风险本测试证明不了，标注为 live-only。
     *
     * 维护税：测试里的 fake 靠 `as unknown as Browser/Page` 转型，
     * puppeteer 大版本升级时这里最先碎。升级后请连带检查该测试。
     */
    browserFactory?: () => Promise<Browser>;
}
export interface ResumeEntry {
    key: string;
    chatSessionId: string;
    sentCount: number;
}
/**
 * 从持久化快照里挑可续接的 DeepSeek 会话：仅当**恰好一个**可用条目时才深链恢复。
 * 多会话并存时返回 null——v0.1 单 brain 假设，宁可开新会话（delta 自带上下文）
 * 也不把 A 会话的轮次打进 B 会话的网页聊天造成串台。
 */
export declare function pickResumeEntry(snapshot: SessionSnapshot): ResumeEntry | null;
/** 纯函数：__comp 长度超过发送前基线 → 新请求下标（= preLen）；否则 -1（尚未捕获到请求）。
 *  防止点击未触发请求时误读上一轮已完成 entry（会静默返回旧答案并屏蔽 no_request 检测） */
export declare function resolveEntryIndex(currentLen: number, preLen: number): number;
/** done 后的状态判定：HTTP≥400 或 status===0（网络中止时 loadend 也置 done）→ 传输错误 */
export declare function completionError(status: number | null): string | null;
/** connect 重试：Chrome 冷启动可能超过固定 sleep，最多 attempts 次、间隔 delayMs（T8①） */
export declare function retryConnect<T>(fn: () => Promise<T>, attempts?: number, delayMs?: number): Promise<T>;
export declare function chatUrlFor(chatSessionId: string): string;
/** 只有形如 UUID 的 chatSessionId 才允许拼进 URL（防路径/查询注入） */
export declare function sanitizeChatSessionId(v: unknown): string | null;
/** 纯函数：有可续接会话 → 深链；否则首页。无浏览器即可单测 */
export declare function resolveStartUrl(entry: ResumeEntry | null): string;
/**
 * DeepSeek 网页 SSE 分流（协议实测修订，2026-09-30 首跑抓包）：
 * - JSON-Patch 增量流：带 p/o 的行是操作，**无 p/o 的行是上一个 content 路径的延续**（只有 v）
 * - `response/fragments` 的数组快照出现 type="RESPONSE" 的 fragment 是思考→答案的判别标志
 * - elapsed_secs（字符串!/status/usage BATCH 都是元数据，不进正文
 * - 答案 fragment 创建时的 content 快照是前缀，后续 -1/content 增量接续（去重防叠字）
 */
export declare function bucketSSE(sse: string): {
    reasoning: string;
    content: string;
};
/**
 * debug 级输出闸门：LOG_LEVEL=debug（CLI --verbose）才打。
 *
 * 刻意只有一个函数、只有一层判断——不给这个项目造日志框架。
 * 挂上来的都是「每次尝试都打一遍」的恢复诊断；状态变更的解释
 * （DOM 快照、丢弃过期会话条目等）仍留在 info，默认输出一行未减。
 */
export declare function debugLog(level: string, ...args: unknown[]): void;
/**
 * (b) 增量 SSE 消费。
 *
 * generate() 每 400ms 轮询一次。若每次都把全量 resp 重新喂给 bucketSSE，
 * 一条 N 字节的流会被反复重新解析（JSON.parse 每行每拍），总代价 O(N²)。
 * cursor 只解析**新增部分**，并保留跨 chunk 的解析状态。
 *
 * 等价性保证（tests/deepseek-bucket-sse.test.ts 里逐切点验证）：
 * - 只提交「已遇到 \n 的完整行」，推进 offset；末尾半行**暂解析但不提交**。
 *   整份解析 `sse.split('\n')` 的最后一段即使没有 \n 也会被处理，所以视图里
 *   必须带上它，否则中间步会比整份解析「慢半拍」——generate() 靠 emittedC
 *   切片产出增量，慢半拍就是流式行为变化（熔断线）。
 * - 视图复用 bucketSSE 末尾的 seed 修正，保持与原实现逐字符一致。
 * - 非前缀延伸（XHR 重定向/重试把 responseText 整体换掉）时丢弃状态重解析。
 *
 * 时序未变：generate() 的轮询间隔、emittedC/emittedR 切片、以及流末那次
 * 权威的整份 bucketSSE 全部保持原样，本函数只是替换了「每拍重解析」这一动作。
 */
export interface SseCursor {
    /** 已提交的完整行字节数（含其行尾 \n） */
    offset: number;
    /** 上一条提交的整行，用于非前缀延伸检测（只比一行，O(行长) 而非 O(全长)） */
    lastLine: string;
    committed: SseState;
    /** 本拍的视图：含末尾半行的暂解析结果，等价于对当前前缀做整份解析 */
    reasoning: string;
    content: string;
}
interface SseState {
    reasoning: string;
    content: string;
    lastPath: string;
    inAnswer: boolean;
    answerSeed: string;
}
export declare function createSseCursor(): SseCursor;
export declare function feedSse(cursor: SseCursor, full: string): {
    reasoning: string;
    content: string;
};
/** 界面语言兜底：selectors.json 的 newChat 不命中时依次尝试（2026-09-30 实测中文界面按钮文案为「开启新对话」） */
export declare const NEW_CHAT_FALLBACKS: string[];
/** 从 ::-p-text(X) 选择器提取裸文本；非 p-text 选择器返回 null */
export declare function textFromPTextSelector(sel: string): string | null;
export declare function createWebBridge(config: AppConfig, opts?: WebBridgeOptions): WebBridge;
export {};
