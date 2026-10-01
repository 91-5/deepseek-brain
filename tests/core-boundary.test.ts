import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const CORE = path.resolve('src/core')
const FORBIDDEN = [/from\s+['"].*transports/, /from\s+['"]puppeteer-core/, /chat\.deepseek\.com/, /开启新对话/]

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

describe('core 边界', () => {
  it('core 不得 import transports / puppeteer-core / 站点常量', () => {
    const violations: string[] = []
    for (const f of walk(CORE)) {
      const src = fs.readFileSync(f, 'utf8')
      for (const re of FORBIDDEN) {
        if (re.test(src)) violations.push(`${path.relative(CORE, f)} :: ${re}`)
      }
    }
    expect(violations).toEqual([])
  })
})
