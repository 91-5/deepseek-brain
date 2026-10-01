import type { ToolSpec } from '../../types.js';
export type ParseResult = {
    kind: 'text';
    text: string;
} | {
    kind: 'tool_call';
    tool: string;
    arguments: Record<string, unknown>;
    raw: string;
};
export declare function parseModelOutput(raw: string, tools: ToolSpec[]): ParseResult;
export declare function findFenceStart(text: string): number;
