import fs from 'node:fs'
import path from 'node:path'

/** Windows Chrome/Chromium/Edge 候选路径，按优先级排列。
 *  LOCALAPPDATA 优先——Windows 上 Chrome 绝大多数是 per-user 安装。 */
export function windowsChromeCandidates(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  const local = env.LOCALAPPDATA
  const pf = env.PROGRAMFILES
  const pf86 = env['PROGRAMFILES(X86)']
  if (local) {
    out.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(local, 'Chromium', 'Application', 'chrome.exe'))
  }
  if (pf) {
    out.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  if (pf86) {
    out.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    out.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  }
  return out
}

export function detectWindowsChrome(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.CHROME_PATH
  if (explicit) return fs.existsSync(explicit) ? explicit : null
  for (const c of windowsChromeCandidates(env)) {
    if (fs.existsSync(c)) return c
  }
  return null
}

export function chromeNotFoundMessage(candidates: string[]): string {
  return [
    '[brain] chrome not found. Set CHROME_PATH or --chrome-path, or install Chrome/Edge.',
    'Checked candidates:',
    ...candidates.map(c => `  - ${c}`),
  ].join('\n')
}
