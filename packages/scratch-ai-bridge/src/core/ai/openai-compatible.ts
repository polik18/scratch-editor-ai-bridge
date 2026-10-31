export interface OpenAiCompatiblePatchRequest {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey?: string
  readonly instruction: string
  readonly request: string
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
  readonly enableRawBlockInspection?: boolean
  readonly onToolCall: (
    name: string,
    argumentsJson: string,
  ) =>
    | { readonly output: string; readonly patchJson?: string }
    | Promise<{ readonly output: string; readonly patchJson?: string }>
}

const endpointFor = (input: string): URL => {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('模型 API 網址必須是有效的 http 或 https URL。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('模型 API 只支援 http 或 https。')
  if (url.username || url.password || url.search || url.hash)
    throw new Error('模型 API 網址不可包含帳密、查詢參數或片段。')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!isLocalHost) throw new Error('為避免誤連付費雲端服務，目前只允許本機或區域網路上的模型 API。')
  const path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/chat/completions')) return url
  url.pathname = `${path}${path.endsWith('/v1') ? '' : '/v1'}/chat/completions`
  return url
}

const extractPatchText = (value: unknown): string | null => {
  if (typeof value !== 'object' || value === null) throw new Error('模型回應格式不正確。')
  const choices = (value as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('模型沒有回傳候選修改。')
  const first = choices[0] as { message?: { content?: unknown; tool_calls?: unknown } }
  const message = first.message
  if (!message) throw new Error('模型回應缺少 message。')
  if (typeof message.content === 'string' && message.content.trim()) return unwrapJsonFence(message.content.trim())
  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => (typeof part === 'object' && part !== null ? (part as { text?: unknown }).text : null))
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
    if (text.trim()) return unwrapJsonFence(text.trim())
  }
  return null
}

const unwrapJsonFence = (source: string): string => {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source)
  return match ? match[1].trim() : source
}

const readResponseText = async (response: Response, maxBytes: number): Promise<string> => {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('模型 API 回應超過 1 MiB 上限。')
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('模型 API 回應超過 1 MiB 上限。')
    return text
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('模型 API 回應超過 1 MiB 上限。')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export const requestOpenAiCompatiblePatch = async ({
  baseUrl,
  model,
  apiKey,
  instruction,
  request,
  signal,
  onToolCall,
  enableRawBlockInspection = false,
  fetchImpl = fetch,
}: OpenAiCompatiblePatchRequest): Promise<string> => {
  if (!model.trim()) throw new Error('請輸入模型 ID。')
  if (new TextEncoder().encode(instruction).byteLength + new TextEncoder().encode(request).byteLength > 32_000)
    throw new Error('送給模型的文字超過 32 KB 限制。')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: instruction },
    { role: 'user', content: request.trim() },
  ]
  let toolCallCount = 0
  for (let round = 0; round < 4; round += 1) {
    const endpoint = endpointFor(baseUrl)
    const payload = {
      model: model.trim(),
      messages,
      temperature: 0.2,
      max_tokens: 4096,
    }
    const responseOptions = {
      method: 'POST',
      headers,
      signal,
    } as const
    let response = await fetchImpl(endpoint, {
      ...responseOptions,
      body: JSON.stringify({
        ...payload,
        tools: [
          {
            type: 'function',
            function: {
              name: 'inspect_project',
              description: '重新讀取目前專案的精簡結構、可修改欄位與 revision。',
              parameters: { type: 'object', properties: {}, additionalProperties: false },
            },
          },
          ...(enableRawBlockInspection
            ? [
                {
                  type: 'function',
                  function: {
                    name: 'inspect_raw_targets',
                    description: '分頁列出原始 SB3 的角色。',
                    parameters: {
                      type: 'object',
                      properties: {
                        baseRevision: { type: 'string' },
                        offset: { type: 'integer', minimum: 0 },
                        limit: { type: 'integer', minimum: 1, maximum: 30 },
                      },
                      required: ['baseRevision'],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: 'function',
                  function: {
                    name: 'inspect_raw_variables',
                    description: '分頁讀取原始 SB3 某個角色的非雲端變數。',
                    parameters: {
                      type: 'object',
                      properties: {
                        baseRevision: { type: 'string' },
                        targetIndex: { type: 'integer', minimum: 0 },
                        offset: { type: 'integer', minimum: 0 },
                        limit: { type: 'integer', minimum: 1, maximum: 30 },
                      },
                      required: ['baseRevision', 'targetIndex'],
                      additionalProperties: false,
                    },
                  },
                },
                {
                  type: 'function',
                  function: {
                    name: 'inspect_raw_blocks',
                    description: '分頁讀取原始 SB3 某個角色的積木圖。',
                    parameters: {
                      type: 'object',
                      properties: {
                        baseRevision: { type: 'string' },
                        targetIndex: { type: 'integer', minimum: 0 },
                        offset: { type: 'integer', minimum: 0 },
                        limit: { type: 'integer', minimum: 1, maximum: 20 },
                      },
                      required: ['baseRevision', 'targetIndex'],
                      additionalProperties: false,
                    },
                  },
                },
              ]
            : []),
          {
            type: 'function',
            function: {
              name: 'propose_live_patch',
              description: '提交候選 patch 供 Bridge 驗證。此工具不會套用修改。',
              parameters: {
                type: 'object',
                properties: { patchJson: { type: 'string', description: '完整 live-patch v1 JSON 字串' } },
                required: ['patchJson'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: 'auto',
      }),
    })
    if (!response.ok) {
      const detail = await readResponseText(response, 1024 * 1024)
      const unsupportedTools =
        round === 0 &&
        toolCallCount === 0 &&
        response.status === 400 &&
        /tool|function|unsupported|unknown field/i.test(detail)
      if (unsupportedTools) {
        response = await fetchImpl(endpoint, {
          ...responseOptions,
          body: JSON.stringify(payload),
        })
      } else {
        const summary = detail.slice(0, 500)
        throw new Error(`模型 API 回應 HTTP ${response.status}${summary ? `：${summary}` : ''}`)
      }
    }
    if (!response.ok) {
      const detail = (await readResponseText(response, 1024 * 1024)).slice(0, 500)
      throw new Error(`模型 API 回應 HTTP ${response.status}${detail ? `：${detail}` : ''}`)
    }
    let body: unknown
    try {
      body = JSON.parse(await readResponseText(response, 1024 * 1024)) as unknown
    } catch {
      throw new Error('模型 API 回傳的內容不是有效 JSON。')
    }
    const text = extractPatchText(body)
    const choice = (body as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] }).choices?.[0]
    const message = choice?.message
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      if (text) return text
      throw new Error('模型回應中找不到 patch JSON 或可用工具呼叫。')
    }
    if (toolCallCount + calls.length > 8) throw new Error('模型工具呼叫超過 8 次上限。')
    toolCallCount += calls.length
    messages.push({
      role: 'assistant',
      content: typeof message?.content === 'string' ? message.content : null,
      tool_calls: calls,
    })
    for (const rawCall of calls) {
      const call = rawCall as {
        id?: unknown
        function?: { name?: unknown; arguments?: unknown }
      }
      const callId = typeof call.id === 'string' ? call.id : ''
      const name = call.function?.name
      const args = call.function?.arguments
      if (!callId || typeof name !== 'string' || typeof args !== 'string')
        throw new Error('模型傳回格式錯誤的工具呼叫。')
      const output = await onToolCall(name, args)
      if (output.patchJson) return output.patchJson
      messages.push({ role: 'tool', tool_call_id: callId, content: output.output.slice(0, 12_000) })
    }
  }
  throw new Error('模型超過 4 輪工具呼叫仍未提出可用 patch。')
}
