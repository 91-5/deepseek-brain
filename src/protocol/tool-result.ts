export function renderToolResult(toolName: string, content: string, maxChars: number): string {
  const body = content.length > maxChars
    ? `${content.slice(0, maxChars)}\n...（截断，原长 ${content.length} 字符）`
    : content
  return `[工具 ${toolName} 返回]\n${body}\n[/返回]`
}
