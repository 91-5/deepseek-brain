#!/usr/bin/env node
/**
 * CLI 入口。
 *
 * 首行 shebang 是硬要求：tsc 不会自动补 shebang，也不会设执行位。
 * 丢了它，装好的包用 npx 跑会报 SyntaxError: invalid character '#'。
 * 仅用 ESM import——项目是 "type": "module"，CJS 的导入语法会直接崩。
 */
import { loadConfig } from './config.js'

const config = loadConfig()
console.log(`deepseek-brain v0.2.0 — port ${config.port}`)
console.log('full CLI (flags, login subcommand) lands in Task 5')
process.exit(0)