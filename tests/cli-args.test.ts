import { describe, it, expect } from 'vitest'
import { parseArgs, helpText, DEFAULT_PORT } from '../src/cli-args.js'

describe('parseArgs', () => {
  it('默认 headless 关', () => {
    const o = parseArgs([])
    expect(o.headless).toBe(false)
    expect(o.command).toBe('serve')
    expect(o.port).toBe(8790)
    expect(o.verbose).toBe(false)
    expect(o.profile).toBeUndefined()
    expect(o.chromePath).toBeUndefined()
  })

  it('解析 --port', () => {
    expect(parseArgs(['--port', '9000']).port).toBe(9000)
  })
  it('解析 login 子命令', () => {
    expect(parseArgs(['login']).command).toBe('login')
  })
  it('解析 --headless 与 --verbose', () => {
    const o = parseArgs(['--headless', '--verbose'])
    expect(o.headless).toBe(true); expect(o.verbose).toBe(true)
  })
  it('解析 --profile 与 --chrome-path', () => {
    const o = parseArgs(['--profile', 'D:/p', '--chrome-path', 'C:/chrome.exe'])
    expect(o.profile).toBe('D:/p'); expect(o.chromePath).toBe('C:/chrome.exe')
  })
  // --pool-size 从未实现，发布前整条链路移除。它现在只是一个未知 flag：
  // 自身被静默忽略，但它带的值会掉到子命令判定上并报错（`4` 不是 serve/login）。
  it('已移除的 --pool-size 退化为未知 flag：自身忽略，带值则报未知子命令', () => {
    expect(parseArgs(['--pool-size']).port).toBe(DEFAULT_PORT)
    expect(() => parseArgs(['--pool-size', '4'])).toThrow(/unknown command/i)
  })

  it('login 子命令后仍可带 flag', () => {
    const o = parseArgs(['login', '--profile', 'D:/p', '--verbose'])
    expect(o.command).toBe('login')
    expect(o.profile).toBe('D:/p')
    expect(o.verbose).toBe(true)
  })
  it('未知 flag 被忽略而非崩溃', () => {
    expect(parseArgs(['--nope', '--port', '1234']).port).toBe(1234)
  })

  // 坏值必须显式失败。静默把 --port abc 变成 NaN 会一路传到
  // server.listen()，错误信息指向网络层而不是用户的拼写错误。
  it('--port 非法值抛错而不是产生 NaN', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/port/i)
    expect(() => parseArgs(['--port'])).toThrow(/port/i)
    expect(() => parseArgs(['--port', '0x10'])).toThrow(/port/i)
    expect(() => parseArgs(['--port', '8080.5'])).toThrow(/port/i)
  })
  it('--profile / --chrome-path 缺值抛错', () => {
    expect(() => parseArgs(['--profile'])).toThrow(/profile/i)
    expect(() => parseArgs(['--chrome-path'])).toThrow(/chrome-path/i)
  })
  it('--help 被识别', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
  })
  it('未知子命令抛错（避免被静默当成 serve 而起服务）', () => {
    expect(() => parseArgs(['logout'])).toThrow(/unknown command/i)
  })

  it('helpText 覆盖全部 flag 与子命令', () => {
    const h = helpText()
    for (const f of ['--port', '--profile', '--chrome-path', '--headless', '--verbose', 'login']) {
      expect(h).toContain(f)
    }
  })

  // 帮助文本是唯一面向用户的 flag 清单：它宣传什么，用户就以为支持什么。
  // 没实现的 flag 不能出现在这里。
  it('helpText 不宣传任何未实现的 flag', () => {
    expect(helpText()).not.toMatch(/pool-size/)
  })
})