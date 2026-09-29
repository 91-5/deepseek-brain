import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  it('returns default config', () => {
    const c = loadConfig({})
    expect(c.port).toBe(8790)
    expect(c.thinking).toBe(true)
    expect(c.maxFormatRetries).toBe(2)
    expect(c.compactTokenThreshold).toBe(40000)
  })
  it('env overrides port and timeout', () => {
    const c = loadConfig({ PORT: '9001', TIMEOUT_MS: '1000' })
    expect(c.port).toBe(9001)
    expect(c.timeoutMs).toBe(1000)
  })
})
