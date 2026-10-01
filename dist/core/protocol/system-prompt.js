const TEMPLATE = `你是任务规划大脑。需要调用工具时，输出一个代码块：
\`\`\`tool_call
{"tool": "<工具名>", "arguments": {<参数>}}
\`\`\`
每次只调一个工具，等待结果后再继续。不需要时直接文本回答。
可用工具：`;
export function buildSystemPrompt(tools) {
    const catalog = tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
    }));
    return `${TEMPLATE}${JSON.stringify(catalog)}`;
}
