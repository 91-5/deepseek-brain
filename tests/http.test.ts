import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHttpServer, setTransportGetter } from '../src/server/http.js'
import { loadConfig } from '../src/config.js'
import type { Transport } from '../src/transport/types.js'
import type { OpenAIMessage, ToolSpec } from '../src/types.js'

const cfg = loadConfig({})
const TOOLS: ToolSpec[] = [{ name: 'read_file', description: '读', parameters: {} }]

/** fake transport：content = 本轮回复；记录 prompts 便于断言 */
function fakeTransport(content: string): Transport & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    async *generate(req) {
      prompts.push(req.prompt)
      if (req.thinking) yield { reasoning: '想一下' }
      yield { content }
    },
    async health() { return 'ok' as const },
    lastChatSessionId() { return 'sess-1' },
    resetSession() {},
    async newChat() {},
  }
}

async function chat(body: unknown, port: number): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

describe('http server', () => {
  let server: http.Server
  let port: number

  beforeAll(async () => {
    setTransportGetter(() => fakeTransport('placeholder'))
    server = createHttpServer(cfg)
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()))
  })

  it('GET /v1/models 返回模型列表', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`)
    expect(res.status).toBe(200)
    const body = await res.json() as { data: Array<{ id: string }> }
    expect(body.data[0].id).toBe('deepseek-web-brain')
  })

  it('未知路径 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/nope`)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toBe('not found')
  })

  it('非法 JSON → 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toBe('invalid json')
  })

  it('transport 抛错 → 502', async () => {
    setTransportGetter(() => {
      throw new Error('boom')
    })
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-web-brain', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(502)
  })

  it('非流式：返回 content 与 finish_reason', async () => {
    setTransportGetter(() => fakeTransport('你好，我是大脑'))
    const res = await chat({
      model: 'deepseek-web-brain',
      messages: [{ role: 'user', content: 'nonstream-1' }],
      tools: [{ type: 'function', function: { name: 'read_file', description: '读', parameters: {} } }],
    }, port)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.text)
    expect(body.object).toBe('chat.completion')
    expect(body.model).toBe('deepseek-web-brain')
    expect(body.choices[0].message.content).toBe('你好，我是大脑')
    expect(body.choices[0].finish_reason).toBe('stop')
    expect(body.usage.total_tokens).toBeGreaterThan(0)
  })

  it('tool 消息与 assistant 历史能被转换（无 500）', async () => {
    setTransportGetter(() => fakeTransport('知道了'))
    const res = await chat({
      model: 'deepseek-web-brain',
      messages: [
        { role: 'user', content: 'hist-1' },
        { role: 'assistant', content: 'prev', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '[ok]' },
      ],
    }, port)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.text).choices[0].message.content).toBe('知道了')
  })

  it('流式：SSE 分帧 + [DONE] + finish_reason', async () => {
    setTransportGetter(() => fakeTransport('流式回答'))
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-web-brain', messages: [{ role: 'user', content: 'stream-1' }], stream: true }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    const frames = text.split('\n\n').filter(f => f.startsWith('data: '))
    expect(frames.some(f => f.includes('chat.completion.chunk'))).toBe(true)
    expect(text).toContain('data: [DONE]')
    const deltas = frames
      .filter(f => f !== 'data: [DONE]')
      .map(f => JSON.parse(f.slice(6)))
    expect(deltas.some(d => d.choices[0].delta.content === '流式回答')).toBe(true)
    expect(deltas.some(d => d.choices[0].delta.reasoning_content === '想一下')).toBe(true)
    expect(deltas.at(-1)!.choices[0].finish_reason).toBe('stop')
  })

  it('tool_call 路径：finish_reason=tool_calls，arguments 为 JSON 字符串', async () => {
    setTransportGetter(() => fakeTransport('```tool_call\n{"tool":"read_file","arguments":{"path":"README.md"}}\n```'))
    const res = await chat({
      model: 'deepseek-web-brain',
      messages: [{ role: 'user', content: 'tool-1' }],
      tools: [{ type: 'function', function: { name: 'read_file', description: '读', parameters: {} } }],
    }, port)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.text)
    expect(body.choices[0].finish_reason).toBe('tool_calls')
    const tc = body.choices[0].message.tool_calls[0]
    expect(tc.type).toBe('function')
    expect(tc.function.name).toBe('read_file')
    expect(JSON.parse(tc.function.arguments)).toEqual({ path: 'README.md' })
  })

  it('流式 tool_call：finish_reason=tool_calls', async () => {
    setTransportGetter(() => fakeTransport('```tool_call\n{"tool":"read_file","arguments":{"path":"a.txt"}}\n```'))
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web-brain',
        messages: [{ role: 'user', content: 'tool-stream-1' }],
        tools: [{ type: 'function', function: { name: 'read_file', description: '读', parameters: {} } }],
        stream: true,
      }),
    })
    const text = await res.text()
    const frames = text.split('\n\n').filter(f => f.startsWith('data: ') && f !== 'data: [DONE]')
      .map(f => JSON.parse(f.slice(6)))
    expect(frames.some(d => d.choices[0].finish_reason === 'tool_calls')).toBe(true)
    expect(frames.some(d => d.choices[0].delta.tool_calls?.[0]?.function?.name === 'read_file')).toBe(true)
    expect(text).toContain('data: [DONE]')
  })
})
