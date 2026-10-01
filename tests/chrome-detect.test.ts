import { describe, it, expect } from 'vitest'
import { detectWindowsChrome, chromeNotFoundMessage, resolveChromeExecutable } from '../src/transports/chrome-detect.js'

describe('detectWindowsChrome', () => {
  it('优先使用 CHROME_PATH', () => {
    expect(detectWindowsChrome({ CHROME_PATH: process.execPath })).toBe(process.execPath)
  })
  it('CHROME_PATH 为空串时回退到探测', () => {
    expect(detectWindowsChrome({ CHROME_PATH: '' })).toBeNull()
  })
  it('全部候选缺失时返回 null', () => {
    expect(detectWindowsChrome({ LOCALAPPDATA: 'C:\\none', PROGRAMFILES: 'C:\\none', 'PROGRAMFILES(X86)': 'C:\\none' })).toBeNull()
  })
})

describe('chromeNotFoundMessage', () => {
  it('列出全部候选路径', () => {
    const msg = chromeNotFoundMessage(['C:\\a\\chrome.exe', 'C:\\b\\chrome.exe'])
    expect(msg).toContain('C:\\a\\chrome.exe')
    expect(msg).toContain('C:\\b\\chrome.exe')
    expect(msg).toContain('CHROME_PATH')
  })
})

describe('resolveChromeExecutable（--chrome-path 透传的落点）', () => {
  it('显式路径存在 → 直接返回，不看 env', () => {
    expect(resolveChromeExecutable(process.execPath, {})).toBe(process.execPath)
  })
  it('显式路径不存在 → null（复用探测的 existsSync 判据，不重复实现）', () => {
    expect(resolveChromeExecutable('D:\\no-such\\chrome.exe', {})).toBeNull()
  })
  it('显式路径优先于 env 探测', () => {
    const env = { CHROME_PATH: 'D:\\no-such\\chrome.exe' }
    expect(resolveChromeExecutable(process.execPath, env)).toBe(process.execPath)
  })
  it('无显式路径 → 回退到常规探测', () => {
    expect(resolveChromeExecutable(undefined, { CHROME_PATH: process.execPath })).toBe(process.execPath)
    expect(resolveChromeExecutable(undefined, { LOCALAPPDATA: 'C:\\none' })).toBeNull()
  })
})
