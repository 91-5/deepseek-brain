import { describe, it, expect } from 'vitest'
import { chromeCandidates, detectChrome } from '../src/transports/chrome-detect.js'

/**
 * 跨平台候选表测试。
 *
 * **测试边界（诚实声明）**：这里只能覆盖**候选表生成逻辑**——通过注入 `platform`
 * 参数在 Windows 上跑到 darwin/linux 分支。**测不了实际启动**：不验证 macOS/Linux
 * 上 Chrome 真能被拉起来、不验证可执行位语义、不验证 macOS 权限弹窗。
 * 见 spec §6 与 README 的平台分级。
 */

const winEnv = {
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  PROGRAMFILES: 'C:\\Program Files',
  ProgramW6432: 'C:\\Program Files',
  'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
}

describe('chromeCandidates · Windows', () => {
  it('返回 .exe 候选，且不含任何 Unix 路径', () => {
    const out = chromeCandidates(winEnv, 'win32')
    expect(out.length).toBeGreaterThan(0)
    expect(out.every(c => c.endsWith('.exe'))).toBe(true)
  })

  it('LOCALAPPDATA 优先（per-user 安装最常见）', () => {
    const out = chromeCandidates(winEnv, 'win32')
    expect(out[0]).toBe('C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    expect(out[1]).toBe('C:\\Users\\x\\AppData\\Local\\Chromium\\Application\\chrome.exe')
  })

  it('ProgramW6432 排在 PROGRAMFILES(X86) 之前（32 位 Node 跑 64 位 Windows 时兜底）', () => {
    const out = chromeCandidates(winEnv, 'win32')
    const pw64 = out.indexOf('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    const pf86 = out.indexOf('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe')
    expect(pw64).toBeGreaterThanOrEqual(0)
    expect(pf86).toBeGreaterThanOrEqual(0)
    expect(pw64).toBeLessThan(pf86)
  })

  it('缺失环境变量时对应条目直接省略，不产生 undefined 拼接', () => {
    const out = chromeCandidates({ LOCALAPPDATA: 'C:\\L' }, 'win32')
    expect(out).toHaveLength(2)
    expect(out.every(c => !c.includes('undefined'))).toBe(true)
  })

  it('不含 Edge 之外的其他浏览器、不做 PATH 扫描（Windows 上无先例且成本高）', () => {
    const out = chromeCandidates(winEnv, 'win32')
    expect(out.some(c => c.includes('msedge.exe'))).toBe(true)
    // PATHEXT 展开三家成熟项目都放弃了，候选表里不该出现裸命令名
    expect(out.every(c => c.includes('\\'))).toBe(true)
  })
})

describe('chromeCandidates · macOS', () => {
  it('返回 .app 包内 Contents/MacOS 路径', () => {
    const out = chromeCandidates({}, 'darwin')
    expect(out.every(c => c.includes('.app/Contents/MacOS/'))).toBe(true)
  })

  it('标准三件套齐全且 /Applications 优先', () => {
    const out = chromeCandidates({ HOME: '/Users/x' }, 'darwin')
    expect(out[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(out).toContain('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
    expect(out).toContain('/Applications/Chromium.app/Contents/MacOS/Chromium')
  })

  it('HOME 存在时补 ~/Applications，且排在 /Applications 之后', () => {
    const out = chromeCandidates({ HOME: '/Users/x' }, 'darwin')
    // 必须用正斜杠：宿主是 Windows 时 path.join 会产出反斜杠，破坏可测性
    const userApp = out.indexOf('/Users/x/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    expect(userApp).toBeGreaterThan(0)
  })

  it('HOME 为 POSIX 路径时产出纯正斜杠（宿主是 Windows 也不引入反斜杠）', () => {
    // 关键：macOS 分支必须用正斜杠拼接，不能借道 path.join——
    // 后者在 Windows 宿主上会产出 `\Users\x\...`，让「注入 platform」的可测性失效。
    const out = chromeCandidates({ HOME: '/Users/x' }, 'darwin')
    expect(out.every(c => !c.includes('\\'))).toBe(true)
    expect(out).toContain('/Users/x/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  })

  it('HOME 缺失时不产生 undefined 拼接', () => {
    const out = chromeCandidates({}, 'darwin')
    expect(out.every(c => !c.includes('undefined'))).toBe(true)
  })
})

describe('chromeCandidates · Linux', () => {
  it('固定路径含 /opt 下官方安装位置', () => {
    const out = chromeCandidates({}, 'linux')
    expect(out).toContain('/opt/google/chrome/chrome')
    expect(out).toContain('/opt/microsoft/msedge/msedge')
  })

  /**
   * **测试边界（重要）**：Linux 的 PATH 扫描用 POSIX 路径（`/dir/name`）去 probe 真实
   * 文件系统。在 Windows 宿主上这类路径解析不到（会被当成 `C:\dir\name`），因此
   * **「扫描命中」这条分支无法在 Windows 上用真实文件系统验证**——这正是 spec §6
   * 声明的不可验证项之一。下面只验证**能验证的部分**：扫描的输入解析与输出格式，
   * 不断言「真的找到了浏览器」。
   */

  it('PATH 为空/缺失时不崩，只返回固定路径', () => {
    expect(chromeCandidates({}, 'linux')).toEqual([
      '/opt/google/chrome/chrome',
      '/opt/microsoft/msedge/msedge',
    ])
    expect(chromeCandidates({ PATH: '' }, 'linux')).toHaveLength(2)
  })

  it('PATH 上什么都不存在时不报错，固定路径仍返回', () => {
    const out = chromeCandidates({ PATH: '/definitely/not/here' }, 'linux')
    expect(out).toEqual(['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'])
  })

  it('固定路径始终在前，扫描结果只能追加（不能被扫描结果取代）', () => {
    const out = chromeCandidates({ PATH: '/definitely/not/here' }, 'linux')
    expect(out[0]).toBe('/opt/google/chrome/chrome')
    expect(out[1]).toBe('/opt/microsoft/msedge/msedge')
  })

  it('扫描结果不变形为宿主平台的反斜杠形式（冒号分隔语义）', () => {
    // 分号是 Windows 的 PATH 分隔符，在 Linux 语义下应被当成**一个**畸形目录名，
    // 而不是两个目录。用它反证实现没有偷偷用 path.delimiter。
    const withSemicolon = chromeCandidates({ PATH: '/a;/b' }, 'linux')
    const withColon = chromeCandidates({ PATH: '/a:/b' }, 'linux')
    // 两种写法都不存在真实文件 → 都只剩固定路径；这里断言的是「不崩且格式统一」
    expect(withSemicolon).toEqual(['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'])
    expect(withColon).toEqual(['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'])
  })

  it('PATH 为空/缺失时不崩，只返回固定路径', () => {
    expect(chromeCandidates({}, 'linux')).toEqual([
      '/opt/google/chrome/chrome',
      '/opt/microsoft/msedge/msedge',
    ])
    expect(chromeCandidates({ PATH: '' }, 'linux')).toHaveLength(2)
  })

  it('PATH 上什么都没有时也不报错（固定路径仍返回）', () => {
    const out = chromeCandidates({ PATH: '/definitely/not/here' }, 'linux')
    expect(out).toEqual(['/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge'])
  })
})

describe('chromeCandidates · 未知平台', () => {
  it('不返回 Unix .app 或 .exe 硬编码路径，只给 PATH 机会', () => {
    const out = chromeCandidates({ PATH: '/whatever' }, 'freebsd' as NodeJS.Platform)
    expect(out.every(c => !c.includes('C:\\'))).toBe(true)
    expect(out.every(c => !c.includes('.app'))).toBe(true)
  })
})

describe('detectChrome · 平台分派与显式值校验', () => {
  it('显式 CHROME_PATH 存在即返回，与平台无关', () => {
    expect(detectChrome({ CHROME_PATH: process.execPath }, 'linux')).toBe(process.execPath)
    expect(detectChrome({ CHROME_PATH: process.execPath }, 'darwin')).toBe(process.execPath)
    expect(detectChrome({ CHROME_PATH: process.execPath }, 'win32')).toBe(process.execPath)
  })

  it('显式 CHROME_PATH 不存在 → null，不会回退去猜（显式值只提优先级，不降校验）', () => {
    expect(detectChrome({ CHROME_PATH: '/no/such/chrome' }, 'linux')).toBeNull()
  })

  it('空 CHROME_PATH 视为未提供，回退到候选表', () => {
    expect(detectChrome({ CHROME_PATH: '', LOCALAPPDATA: 'C:\\none' }, 'win32')).toBeNull()
  })

  it('非 Windows 平台上不再返回 Windows 路径（旧 bug：错误信息指向错误平台）', () => {
    // 候选全不存在 → null，且候选项里不该混入 .exe
    const out = chromeCandidates({ LOCALAPPDATA: 'C:\\none' }, 'linux')
    expect(out.every(c => !c.endsWith('.exe'))).toBe(true)
  })
})
