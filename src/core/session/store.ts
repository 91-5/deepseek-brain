import fs from 'node:fs'
import path from 'node:path'

/** 单个 OpenCode 会话 key 对应的 DeepSeek 网页会话状态 */
export interface SessionRecord { chatSessionId: string | null; sentCount: number }

/** 落盘格式：OpenCode 会话 key → SessionRecord */
export type SessionSnapshot = Record<string, SessionRecord>

/** 默认落盘路径（相对 cwd，已 gitignore） */
export const DEFAULT_SESSIONS_FILE = '.sessions.json'

function isValidRecord(v: unknown): v is { chatSessionId: string | null; sentCount: number } {
  if (!v || typeof v !== 'object') return false
  const r = v as { chatSessionId?: unknown; sentCount?: unknown }
  if (typeof r.sentCount !== 'number' || !Number.isInteger(r.sentCount) || r.sentCount < 0) return false
  return r.chatSessionId === null || typeof r.chatSessionId === 'string'
}

/** 读快照：文件缺失/损坏一律降级为空快照（进程不因此挂掉） */
export function loadSessionSnapshot(filePath: string): SessionSnapshot {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: SessionSnapshot = {}
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (isValidRecord(val)) out[key] = { chatSessionId: val.chatSessionId, sentCount: val.sentCount }
  }
  return out
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** rename 换原子性：Windows 下目标文件可能被 AV/索引器瞬时占用（EPERM），重试后兜底直写 */
function renameOrCopy(tmp: string, target: string): void {
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, target)
      return
    } catch (e) {
      if (i === 4) {
        try {
          fs.writeFileSync(target, fs.readFileSync(tmp))
          fs.rmSync(tmp, { force: true })
          return
        } catch {
          throw e
        }
      }
      sleepSync(60)
    }
  }
}

/** 原子写：先写同目录临时文件再 rename，避免崩溃时留下半个 JSON */
export function saveSessionSnapshot(filePath: string, snapshot: SessionSnapshot): void {
  const target = path.resolve(filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8')
  renameOrCopy(tmp, target)
}

export interface SessionStore {
  get(key: string): SessionRecord | undefined
  set(key: string, record: SessionRecord): void
  delete(key: string): void
  keys(): string[]
  snapshot(): SessionSnapshot
}

/**
 * 会话表读写入口。filePath 为 null 时纯内存（单测用，零落盘副作用）。
 * 每次 set/delete 立即写穿落盘——轮次级写入、数据量极小，无需后台 flush。
 */
export function createSessionStore(filePath: string | null): SessionStore {
  const map = new Map<string, SessionRecord>(
    filePath ? Object.entries(loadSessionSnapshot(filePath)) : [],
  )
  function persist(): void {
    if (!filePath) return
    saveSessionSnapshot(filePath, Object.fromEntries(map))
  }
  return {
    get(key) { return map.get(key) },
    set(key, record) {
      map.set(key, { chatSessionId: record.chatSessionId, sentCount: record.sentCount })
      persist()
    },
    delete(key) { map.delete(key); persist() },
    keys() { return [...map.keys()] },
    snapshot() { return Object.fromEntries(map) },
  }
}
