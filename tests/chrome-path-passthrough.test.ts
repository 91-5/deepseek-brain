import { describe, it, expect } from 'vitest'
import { parseArgs, cliOptionsToEnv } from '../src/cli-args.js'
import { loadConfig } from '../src/config.js'
import { resolveChromeExecutable } from '../src/transports/chrome-detect.js'

/**
 * --chrome-path 的全链路透传：argv → env → config → bridge 的可执行文件解析。
 * 之前 flag 只参与 CLI 的早失败探测，createWebBridge 完全看不到它，
 * 于是真启动时又走一遍自动探测——用户指定的浏览器被无声忽略。
 * 这里只断言「值能不能走到最后一站」，不真启动 Chrome。
 */

/** 用本机真实存在的可执行文件（process.execPath）当"用户指定的浏览器"：
 *  解析链上有 existsSync 判据，假路径会在最后一步变 null，测不出透传。 */
const EXE = process.execPath

describe('--chrome-path 透传', () => {
  it('argv → env：flag 写进 CHROME_PATH', () => {
    const o = parseArgs(['--chrome-path', EXE])
    expect(o.chromePath).toBe(EXE)
    expect(cliOptionsToEnv(o, {}).CHROME_PATH).toBe(EXE)
  })

  it('env → config：loadConfig 收进 browser.executablePath', () => {
    const c = loadConfig({ CHROME_PATH: EXE })
    expect(c.browser.executablePath).toBe(EXE)
  })

  it('config → bridge：launch 的可执行文件解析认这个值', () => {
    const c = loadConfig({ CHROME_PATH: EXE })
    expect(c.browser.executablePath).toBe(EXE)
    // 即使 env 里另有 CHROME_PATH，config 里的显式值也赢
    expect(resolveChromeExecutable(c.browser.executablePath, { CHROME_PATH: 'D:\\no-such\\chrome.exe' })).toBe(EXE)
  })

  it('全链路：--chrome-path 一路到 bridge 的解析函数', () => {
    const o = parseArgs(['--chrome-path', EXE])
    const c = loadConfig(cliOptionsToEnv(o, {}))
    expect(resolveChromeExecutable(c.browser.executablePath, {})).toBe(EXE)
  })

  it('未给 flag 时 executablePath 为 undefined → 回退自动探测，不改变既有行为', () => {
    const c = loadConfig(cliOptionsToEnv(parseArgs([]), {}))
    expect(c.browser.executablePath).toBeUndefined()
  })
})