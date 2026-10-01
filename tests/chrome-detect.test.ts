import { describe, it, expect } from 'vitest'
import { detectWindowsChrome, chromeNotFoundMessage } from '../src/transports/chrome-detect.js'

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
