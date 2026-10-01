import { describe, it, expect } from 'vitest'
import { appendTail } from '../src/transports/tail.js'
import { PROBE } from '../src/transports/deepseek-web.js'

describe('appendTail', () => {
  it('只取新增部分', () => {
    expect(appendTail('abc', 'abcdef')).toBe('def')
  })
  it('无新增时返回空串', () => {
    expect(appendTail('abc', 'abc')).toBe('')
  })
  it('空 prev 时返回全部', () => {
    expect(appendTail('', 'abc')).toBe('abc')
  })

  // 计划里的内联写法 `next.slice(prev.length)` 没有 startsWith 守卫：
  // prev='abc', next='xyz…' 时它会切出中段脏数据。XHR 在重定向/重试时
  // responseText 确实可能整体换掉，所以这不是假想场景。
  //
  // 注意用例必须让 **next 比 prev 长**：等长时朴素 slice 返回 '' 或恰好相同，
  // 守卫缺失也照样通过，测不出东西。反向验证就是靠这里的「更长」二字。
  it('非前缀延伸时整体替换，而不是切中段', () => {
    expect(appendTail('abc', 'xyzxyz')).toBe('xyzxyz')
    expect(appendTail('data: {"a":1}\ndata: {"b', 'data: {"c":2}\ndata: {"d":3}\n')).toBe('data: {"c":2}\ndata: {"d":3}\n')
    // 与「朴素 slice」的结果对比，说明守卫拦下了什么
    const prev = 'abc', next = 'xyzxyz'
    expect(appendTail(prev, next)).not.toBe(next.slice(prev.length))
    expect(next.slice(prev.length)).toBe('xyz') // 脏数据长这样
  })
  it('同长度但内容不同 → 替换（不误判为无新增）', () => {
    expect(appendTail('aaa', 'bbb')).toBe('bbb')
  })
  it('prev 是 next 的前缀（内容变短）→ 替换而非空串', () => {
    expect(appendTail('abcdef', 'abc')).toBe('abc')
  })
})

/**
 * 直接在沙箱里跑**线上真正注入的那段 PROBE 字符串**，而不是抄一份等价实现。
 * 抄写版的测试只能证明抄写版对，证明不了注入页面的代码对——而后者才是回归现场。
 */
interface FakeEntry { resp: string; done: boolean; status: number | null }

const listeners = new Map<string, Array<(this: FakeXHR) => void>>()

class FakeXHR {
  __u = ''
  responseText = ''
  status = 0
  addEventListener(ev: string, fn: (this: FakeXHR) => void): void {
    if (!listeners.has(ev)) listeners.set(ev, [])
    listeners.get(ev)!.push(fn)
  }
  open(_m: string, u: string): void { this.__u = u }
  send(_b: unknown): undefined { return undefined }
  emit(ev: string): void { for (const fn of listeners.get(ev) ?? []) fn.call(this) }
}

function runProbe(url = 'https://chat.deepseek.com/api/v0/chat/completion'): { xhr: FakeXHR; comp: () => FakeEntry[] } {
  listeners.clear()
  const win: { __comp: FakeEntry[] } = { __comp: [] }
  new Function('window', 'XMLHttpRequest', 'Date', PROBE)(win, FakeXHR, Date)
  const xhr = new FakeXHR()
  xhr.open('POST', url)
  xhr.send('{}')
  return { xhr, comp: () => win.__comp }
}

describe('PROBE 内联增量（跑真实注入脚本）', () => {
  it('progress 累积出完整响应，且与一次性赋值等价', () => {
    const { xhr, comp } = runProbe()
    xhr.responseText = 'data: {"v":"a"'
    xhr.emit('progress')
    xhr.responseText = 'data: {"v":"a"}\ndata: {"v":"b"'
    xhr.emit('progress')
    xhr.responseText = 'data: {"v":"a"}\ndata: {"v":"b"}\n'
    xhr.emit('loadend')
    expect(comp()).toHaveLength(1)
    expect(comp()[0].resp).toBe('data: {"v":"a"}\ndata: {"v":"b"}\n')
    expect(comp()[0].done).toBe(true)
    expect(comp()[0].status).toBe(0)
  })

  it('responseText 整体换掉时（重定向/重试）不拼出脏数据', () => {
    const { xhr, comp } = runProbe()
    xhr.responseText = 'data: {"v":"第一份响应"}\n'
    xhr.emit('progress')
    // 第二份必须比第一份长：等长/更短时朴素 slice 恰好无害，测不出守卫
    const second = 'data: {"v":"完全不同的第二份，且更长"}\n'
    xhr.responseText = second
    xhr.emit('progress')
    // 朴素 slice 会从 prev.length 处切，得到第二份的中段垃圾
    expect(comp()[0].resp).toBe(second)
    expect(comp()[0].resp).not.toContain('第一份响应')
  })

  it('loadend 前未再发 progress 时，末帧内容不丢', () => {
    const { xhr, comp } = runProbe()
    xhr.responseText = 'data: {"v":"x"'
    xhr.emit('progress')
    xhr.responseText = 'data: {"v":"x"}\ndata: {"v":"y"}\n'
    xhr.emit('loadend')
    expect(comp()[0].resp).toBe('data: {"v":"x"}\ndata: {"v":"y"}\n')
  })

  it('非 completion 请求不入库', () => {
    const { xhr, comp } = runProbe('https://chat.deepseek.com/api/v0/user/settings')
    xhr.responseText = 'x'
    xhr.emit('progress')
    expect(comp()).toHaveLength(0)
  })
})