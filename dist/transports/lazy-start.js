import fs from 'node:fs';
import path from 'node:path';
/**
 * (c) 懒启动的登录判据。
 *
 * 纯文件系统判断，**不拉起 Chrome**：CLI 启动时要在浏览器还没起来之前
 * 就回答「这个 profile 以前登录过吗」，否则懒启动就无从谈起。
 *
 * 判据与 deepseek-web.ts 的 ensureProfileDir 用同一对路径——
 * 两处若各写一份，迟早漂移成「CLI 认为已登录、bridge 认为没登录」的错位。
 */
export const COOKIE_PATHS = [
    ['Default', 'Network', 'Cookies'], // 新版 Chrome
    ['Default', 'Cookies'], // 旧版布局
];
export function profileSeeded(profileDir) {
    return COOKIE_PATHS.some(parts => fs.existsSync(path.resolve(profileDir, ...parts)));
}
