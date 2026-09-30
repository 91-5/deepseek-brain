import http from 'node:http'
import type { OpenAIChatRequest, OpenAIChatResponse } from './openai-types.js'
import type { AppConfig } from '../config.js'
import { runAgentTurn } from '../pipeline.js'
import type { OpenAIMessage, ToolSpec } from '../types.js'
import type { Transport } from '../transport/types.js'

function toInternal(req: OpenAIChatRequest): { messages: OpenAIMessage[]; tools: ToolSpec[] } {
  const messages: OpenAIMessage[] = req.messages.map(m => ({
    role: m.role as OpenAIMessage['role'],
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    tool_call_id: m.tool_call_id,
    tool_calls: m.tool_calls as OpenAIMessage['tool_calls'],
  }))
  const tools: ToolSpec[] = (req.tools ?? []).map(t => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }))
  return { messages, tools }
}

// transport 由 index.ts 注入（避免循环依赖）
let transportGetter: () => Transport = () => { throw new Error('transport not initialized') }
export function setTransportGetter(fn: () => Transport): void { transportGetter = fn }

export function createHttpServer(config: AppConfig): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-web-brain', object: 'model', created: 0, owned_by: 'deepseek-brain' }] }))
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', async () => {
      let parsed: OpenAIChatRequest
      try { parsed = JSON.parse(body) as OpenAIChatRequest } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid json' } }))
        return
      }
      try {
        const { messages, tools } = toInternal(parsed)
        const result = await runAgentTurn({ messages, tools, transport: transportGetter(), config })
        const id = `chatcmpl-${Date.now().toString(36)}`
        const created = Math.floor(Date.now() / 1000)
        const toolCalls = result.toolCall
          ? [{ id: result.toolCall.id, type: 'function' as const, function: { name: result.toolCall.name, arguments: JSON.stringify(result.toolCall.arguments) } }]
          : undefined
        if (parsed.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          const send = (delta: Record<string, unknown>, finish: string | null) =>
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
          if (result.reasoning) send({ reasoning_content: result.reasoning }, null)
          send({ content: result.content }, null)
          if (toolCalls) {
            send({ tool_calls: [{ index: 0, ...toolCalls[0] }] }, null)
            send({}, 'tool_calls')
          } else {
            send({}, 'stop')
          }
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        const resp: OpenAIChatResponse = {
          id, object: 'chat.completion', created, model: parsed.model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: result.content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
            finish_reason: toolCalls ? 'tool_calls' : 'stop',
          }],
          usage: { total_tokens: result.usageTokens },
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(resp))
      } catch (e) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: e instanceof Error ? e.message : String(e) } }))
      }
    })
  })
}
