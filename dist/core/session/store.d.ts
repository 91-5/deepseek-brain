/** 单个 OpenCode 会话 key 对应的 DeepSeek 网页会话状态 */
export interface SessionRecord {
    chatSessionId: string | null;
    sentCount: number;
}
/** 落盘格式：OpenCode 会话 key → SessionRecord */
export type SessionSnapshot = Record<string, SessionRecord>;
/** 默认落盘路径（相对 cwd，已 gitignore） */
export declare const DEFAULT_SESSIONS_FILE = ".sessions.json";
/** 读快照：文件缺失/损坏一律降级为空快照（进程不因此挂掉） */
export declare function loadSessionSnapshot(filePath: string): SessionSnapshot;
/** 原子写：先写同目录临时文件再 rename，避免崩溃时留下半个 JSON */
export declare function saveSessionSnapshot(filePath: string, snapshot: SessionSnapshot): void;
/** 会话表的可替换边界。第三方实现只需满足这 5 个方法即可接管存储
 *  （内存、Redis、SQLite……），planner 不再关心背后是 fs 还是别的。
 *  注意：本接口刻意保持细粒度的 get/set/delete 而非整快照 load/save——
 *  轮次级写入下逐 key 落盘更省，且已持久化的 .sessions.json 格式与语义完全不变。 */
export interface SessionStore {
    get(key: string): SessionRecord | undefined;
    set(key: string, record: SessionRecord): void;
    delete(key: string): void;
    keys(): string[];
    snapshot(): SessionSnapshot;
}
/**
 * 默认 store 工厂：把「读环境」这件事从 planner 里挪出来的唯一出口。
 *
 * 每次调用按 env 新建 store 并从 .sessions.json hydration——进程重启后
 * 「OpenCode 会话 key → DeepSeek 网页会话」的映射不丢（绑定要求，否则 delta
 * 会跳过历史造成上下文断裂）。NODE_ENV=test（vitest）下退化为纯内存，
 * 避免单测污染仓库根。
 *
 * 抽成独立函数是为了让 planner 不再直接摸 process.env：core 复用方可以完全
 * 绕开它（传 deps.store），而默认路径的行为一字未改。
 */
export declare function openDefaultSessionStore(env?: NodeJS.ProcessEnv): SessionStore;
/**
 * 会话表读写入口。filePath 为 null 时纯内存（单测用，零落盘副作用）。
 * 每次 set/delete 立即写穿落盘——轮次级写入、数据量极小，无需后台 flush。
 */
export declare function createSessionStore(filePath: string | null): SessionStore;
