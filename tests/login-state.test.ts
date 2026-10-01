import { describe, it, expect } from 'vitest'
import { judgeLoginState, looksLoggedOut } from '../src/transports/login-state.js'

/**
 * 这些用例锁的是「login_required 不再误报」这个结论。
 * 旧的实现是 `bodyText.includes('登录')` 就报未登录，下面 §误报 里的
 * 每一条在旧实现下都会被判成 login_required。
 */
describe('judgeLoginState', () => {
  it('有输入框 → ok / loggedIn=true', () => {
    expect(judgeLoginState({ hasInput: true, bodyText: '随便什么文本' }))
      .toEqual({ status: 'ok', loggedIn: true })
  })

  it('无输入框 + 正文有独占一行的登录入口 → login_required', () => {
    expect(judgeLoginState({ hasInput: false, bodyText: 'DeepSeek\nLog in\n' }))
      .toEqual({ status: 'login_required', loggedIn: false })
    expect(judgeLoginState({ hasInput: false, bodyText: '欢迎\n登录\n注册' }))
      .toEqual({ status: 'login_required', loggedIn: false })
  })

  it('无输入框 + 正文无登录入口 → ui_changed（保留旧语义）', () => {
    expect(judgeLoginState({ hasInput: false, bodyText: '加载中' }))
      .toEqual({ status: 'ui_changed', loggedIn: false })
    expect(judgeLoginState({ hasInput: false, bodyText: '' }))
      .toEqual({ status: 'ui_changed', loggedIn: false })
  })

  // 主判据必须是 textarea。若把正文匹配提到最前面，下面这条会翻车：
  // 登录页上「登录」和输入框**可以同时存在**（比如带邮箱输入框的登录表单），
  // 此时判成 login_required 会让 CLI 在用户已登录后仍然永远等下去。
  it('正文含登录入口但输入框存在 → 仍是 ok（登录页的输入框不能被当成聊天框）', () => {
    expect(judgeLoginState({ hasInput: true, bodyText: '登录\n邮箱\n密码' }).status).toBe('ok')
  })

  describe('误报回归（旧 includes 实现会误判的样本）', () => {
    const falsePositives: Array<[string, string]> = [
      ['导航栏含登录入口', '首页  登录  注册'],
      ['页脚含登录', '© 2026 DeepSeek\n登录即代表同意条款'],
      ['弹窗文案', '登录可获得完整功能'],
      ['别人提问里提到登录', '如何实现免登录调用？'],
      ['句子中间出现登录', '这个功能需要登录才能用'],
      ['已登录但正文提到登录', '我登录之后就没问题了'],
    ]
    for (const [name, text] of falsePositives) {
      it(`${name} 不再被判为 login_required`, () => {
        expect(looksLoggedOut(text), text).toBe(false)
        expect(judgeLoginState({ hasInput: false, bodyText: text }).status).toBe('ui_changed')
      })
    }
  })

  it('输入框存在时，正文含「登录」也仍是 ok（主判据优先）', () => {
    expect(judgeLoginState({ hasInput: true, bodyText: '如何实现免登录调用？' }).status).toBe('ok')
  })

  it('行首行尾容许空白与 CRLF', () => {
    expect(looksLoggedOut('欢迎\r\n   Log in   \r\n')).toBe(true)
    expect(looksLoggedOut('登录')).toBe(true)
  })
})