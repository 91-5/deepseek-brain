import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseArgs, cliOptionsToEnv } from '../src/cli-args.js'
import { loadConfig } from '../src/config.js'
import { debugLog } from '../src/transports/deepseek-web.js'

/**
 * --verbose 的链路审计结论：LOG_LEVEL 全仓**零消费者**，
 * config.log.level 也没有任何读取点——flag 解析正确、日志一个字都不多打。
 *
 * 修法刻意保持最小：不给它造日志框架，只把「per-attempt 的恢复诊断」这类
 * 本来就不该常驻输出的行挂到 debug 闸门上，info 级信息一行不动。
 */

describe('--verbose → LOG_LEVEL 链路', () => {
  it('--verbose 落到 env.LOG_LEVEL=debug，并被 loadConfig 收进 log.level', () => {
    const o = parseArgs(['--verbose'])
    expect(o.verbose).toBe(true)
    expect(cliOptionsToEnv(o, {}).LOG_LEVEL).toBe('debug')
    expect(loadConfig(cliOptionsToEnv(o, {})).log.level).toBe('debug')
  })

  it('不给 --verbose → 保持 info（默认输出零变化）', () => {
    expect(cliOptionsToEnv(parseArgs([]), {}).LOG_LEVEL).toBeUndefined()
    expect(loadConfig({}).log.level).toBe('info')
  })

  it('直接给 LOG_LEVEL=debug env 也生效（不依赖 flag）', () => {
    expect(loadConfig({ LOG_LEVEL: 'debug' }).log.level).toBe('debug')
  })

  it('flag 覆盖 env：env 是 info 时 --verbose 仍然是 debug', () => {
    const o = parseArgs(['--verbose'])
    const env = cliOptionsToEnv(o, { LOG_LEVEL: 'info' })
    expect(loadConfig(env).log.level).toBe('debug')
  })
})

describe('debugLog 闸门', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('level=info 时不打（默认输出保持原样）', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugLog('info', '不该出现')
    expect(spy).not.toHaveBeenCalled()
  })

  it('level=debug 时打', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    debugLog('debug', '[web-bridge] resumed session abc')
    expect(spy).toHaveBeenCalledWith('[web-bridge] resumed session abc')
  })
})