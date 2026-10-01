import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { profileSeeded } from '../src/transports/lazy-start.js'

/**
 * 判据必须是纯文件系统的——它要在**不拉起 Chrome**的前提下回答
 * 「这个 profile 以前登录过吗」。因此绝不能有任何 puppeteer / fs 副作用之外的依赖。
 */
describe('profileSeeded（懒启动的登录判据）', () => {
  let dir = ''
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsb-seed-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('目录不存在 → 未播种', () => {
    expect(profileSeeded(path.join(dir, 'nope'))).toBe(false)
  })
  it('空目录 → 未播种', () => {
    expect(profileSeeded(dir)).toBe(false)
  })
  it('新版布局 Default/Network/Cooks 存在 → 已播种', () => {
    fs.mkdirSync(path.join(dir, 'Default', 'Network'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Default', 'Network', 'Cookies'), '')
    expect(profileSeeded(dir)).toBe(true)
  })
  it('旧版布局 Default/Cookies 存在 → 已播种', () => {
    fs.mkdirSync(path.join(dir, 'Default'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Default', 'Cookies'), '')
    expect(profileSeeded(dir)).toBe(true)
  })
  it('与 ensureProfileDir 用的是同一对路径（防止两处判据漂移）', () => {
    fs.mkdirSync(path.join(dir, 'Default'), { recursive: true })
    // 只有 Default 目录、没有 Cookies → 必须判未播种，不能因为目录存在就算登录过
    expect(profileSeeded(dir)).toBe(false)
  })
  it('大小写不敏感的 Windows 布局不影响判定', () => {
    fs.mkdirSync(path.join(dir, 'Default', 'Network'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Default', 'Network', 'Cookies'), 'x')
    expect(profileSeeded(dir)).toBe(true)
  })
})