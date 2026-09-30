export interface OpenAIChatRequest {
  model: string
  messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }>
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  stream?: boolean
}
export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: 'assistant'; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
    finish_reason: string | null
  }>
  usage?: { total_tokens: number }
}
