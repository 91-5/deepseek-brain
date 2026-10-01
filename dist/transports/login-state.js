/**
 * 登录态判据（供 CLI 阻塞等待复用）。
 *
 * 抽出成独立纯函数而不是把正则埋进 health() 里，是因为「判据本身正确」是
 * 首次运行体验的地基：判据误报会让 CLI 在已登录时也永远等下去。
 */
export const CHAT_INPUT_SELECTOR = 'textarea';
/** 深拷贝页面文本以便离线单测，不碰 puppeteer 类型。 */
export function judgeLoginState(input) {
    if (input.hasInput)
        return { status: 'ok', loggedIn: true };
    if (looksLoggedOut(input.bodyText))
        return { status: 'login_required', loggedIn: false };
    return { status: 'ui_changed', loggedIn: false };
}
/**
 * 无输入框时，正文里出现「独占一行」的登录入口才判未登录。
 *
 * 锚定行首行尾是关键：旧的 `includes('登录')` 会把导航栏、页脚、弹窗、
 * 甚至别人提问里的「登录」都算成未登录——项目台账里记过这个误报。
 * 要求它单独成行，把误报面压到实际的登录按钮/标题文案上。
 */
export function looksLoggedOut(bodyText) {
    return /(^|\n)\s*(Log in|登录|登录 DeepSeek|Sign in)\s*(\n|$)/.test(bodyText || '');
}
