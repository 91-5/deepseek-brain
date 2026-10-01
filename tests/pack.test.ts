import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pkg from '../package.json' with { type: 'json' }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const p = pkg as unknown as Record<string, any>

describe('打包元数据', () => {
  it('不是 private（否则 npm publish 被拒）', () => expect(p.private).toBeUndefined())
  it('版本是 0.2.0', () => expect(p.version).toBe('0.2.0'))
  it('声明 MIT 许可', () => expect(p.license).toBe('MIT'))
  it('声明 win32 平台限制', () => expect(p.os).toEqual(['win32']))
  it('声明 engines.node', () => expect(p.engines.node).toBe('>=20'))
  it('bin 指向 dist/cli.js', () => expect(p.bin['deepseek-brain']).toBe('dist/cli.js'))
  it('是 ESM-only', () => expect(p.type).toBe('module'))
  it('puppeteer-core 用精确版本（无 ^，避免消费者装到不同大版本）', () => {
    expect(p.dependencies['puppeteer-core']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('根导出用条件导出带 types', () => {
    expect(p.exports['.'].types).toBe('./dist/index.d.ts')
    expect(p.exports['.'].default).toBe('./dist/index.js')
  })
  it('core 导出用条件导出带 types', () => {
    expect(p.exports['./core'].types).toBe('./dist/core/index.d.ts')
    expect(p.exports['./core'].default).toBe('./dist/core/index.js')
  })
  it('显式导出 package.json（vite 等 bundler 需要）', () => {
    expect(p.exports['./package.json']).toBe('./package.json')
  })

  it('files 含 dist 与 selectors.json', () => {
    expect(p.files).toContain('dist')
    expect(p.files).toContain('selectors.json')
  })
  it('files 里列的每个路径都真实存在（否则 npm pack 静默漏装）', () => {
    const missing = p.files.filter((f: string) => !fs.existsSync(path.join(root, f)))
    expect(missing, `files 中列了不存在的路径: ${missing.join(', ')}`).toEqual([])
  })
  it('start 脚本指向 dist/cli.js', () => expect(p.scripts.start).toBe('node dist/cli.js'))
})

// exports["."].types 的承诺必须是真的：dist/index.d.ts 若只产出一句
// `export {}`，TS 消费方 import 任何名字都会报 TS2305，而 build 阶段完全看不出来。
// 顺带钉住「import 不许有副作用」——顶层就 main() 等于谁 import 谁被拉起 Chrome。
describe('包根入口是可用的库入口', () => {
  it('src/index.ts 顶层不调用 main()（import 无副作用）', () => {
    const src = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8')
    const topLevelCall = src.split('\n').filter(l => /^\s*(void\s+)?main\(\)/.test(l) && !/export async function/.test(l))
    expect(topLevelCall).toEqual([])
  })
  it('包根确实导出可用的公共面', () => {
    const src = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8')
    expect(src).toMatch(/export \{ loadConfig/)
    expect(src).toMatch(/export \{ createWebBridge/)
    expect(src).toMatch(/export async function startShim/)
  })
})

describe('cli 入口', () => {
  it('src/cli.ts 首行是 shebang（tsc 不会自动加）', () => {
    const first = fs.readFileSync(path.join(root, 'src/cli.ts'), 'utf8').split('\n')[0]
    expect(first).toBe('#!/usr/bin/env node')
  })
  it('cli.ts 只用 ESM import，不出现 require', () => {
    const src = fs.readFileSync(path.join(root, 'src/cli.ts'), 'utf8')
    expect(src).not.toMatch(/\brequire\s*\(/)
    expect(src).not.toMatch(/\bmodule\.exports\b/)
  })
  it('tsconfig 开了 declaration（否则 .d.ts 不产出）', () => {
    const ts = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'))
    expect(ts.compilerOptions.declaration).toBe(true)
  })
})

// transport 运行时读 selectors.json（DOM 选择器活锁时是唯一逃生口）。
// src/transports/ 与 dist/transports/ 深度相同，所以 '../../selectors.json'
// 在源码与产物里都指向包根——但这是巧合式的脆弱前提，必须有测试钉住：
// 一旦 dist 布局变了或 selectors.json 漏进 files，安装后的包会静默读不到文件。
describe('selectors.json 运行时解析', () => {
  it('源码里的相对路径能解析到真实文件', () => {
    const from = new URL('../../selectors.json', pathToFileURL(path.join(root, 'src/transports/deepseek-web.ts')))
    expect(fs.existsSync(fileURLToPath(from))).toBe(true)
  })
  it('dist 布局与 src 同深度，故产物里解析到包根的同一个文件', () => {
    const from = new URL('../../selectors.json', pathToFileURL(path.join(root, 'dist/transports/deepseek-web.js')))
    expect(fileURLToPath(from)).toBe(path.join(root, 'selectors.json'))
  })
  it('内容含 readSelectors 需要的 send / newChat 两个键', () => {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'selectors.json'), 'utf8'))
    expect(typeof parsed.send).toBe('string')
    expect(typeof parsed.newChat).toBe('string')
  })
})