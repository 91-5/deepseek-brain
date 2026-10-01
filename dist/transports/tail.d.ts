/**
 * 尾部增量语义。PROBE 注入页面的内联逻辑与本函数**必须等价**——
 * tests/probe-increment.test.ts 直接在沙箱里跑真实 PROBE 字符串来钉住这条，
 * 不要只测这里的纯函数版：抄写版的测试证明不了注入页面的代码。
 *
 * 场景来自 XHR 语义：progress 每次给的是 responseText 全量快照。
 */
/**
 * 返回「本次要追加的增量」：
 * - next 恰好等于 prev → 空串（无新增）
 * - next 是 prev 的前缀延伸 → 增量部分
 * - 其余（非前缀延伸：重定向/重试把内容整体换掉）→ 返回 next 本身，
 *   语义是「**整体替换**」而非追加。
 *
 * 注：计划原稿的实现漏了「next === prev → 空串」这一支，
 * 会让无新增时返回整份 next，与其自带用例冲突。
 */
export declare function appendTail(prev: string, next: string): string;
/**
 * 把 PROBE 的内联逻辑收敛成这一行，语义 = appendTail：
 * 前缀延伸时只取新增尾部；不是前缀延伸（重定向/重试导致整体换掉）时整体替换。
 *
 * 注意计划原稿写的 `entry.resp += responseText.slice(entry.resp.length)`
 * 少了 startsWith 守卫——prev='abc'、next='xyz' 时会切出 'z' 这种中段垃圾
 * 并被追加进已累积的正文，产出脏数据。
 */
export declare function mergeTail(prev: string, next: string): string;
