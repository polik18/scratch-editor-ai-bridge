export interface OpenAiCompatiblePatchRequest {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey?: string
  readonly instruction: string
  readonly request: string
  readonly imageDataUrl?: string
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

/**
 * Lists the models a local service offers, which also checks the address and API key before the first request.
 * @param options - Connection.
 * @param options.baseUrl - Service address, for example http://127.0.0.1:8000/v1.
 * @param options.apiKey - Sent as a bearer token when not empty.
 * @param options.signal - Cancels the request.
 * @param options.fetchImpl - Replaces fetch (tests, the LAN gateway).
 * @returns Model IDs in the order the service lists them.
 */
export const listOpenAiCompatibleModels = async ({
  baseUrl,
  apiKey,
  signal,
  fetchImpl = fetch,
}: {
  readonly baseUrl: string
  readonly apiKey?: string
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}): Promise<string[]> => {
  const url = endpointFor(baseUrl)
  url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models')
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error(`連不上 ${url.origin}。請確認 AI 服務已經開啟，而且網址和埠號正確。`)
  }
  if (!response.ok) throw httpError(response.status, (await readResponseText(response, 1024 * 1024)).slice(0, 300))
  let body: unknown
  try {
    body = JSON.parse(await readResponseText(response, 1024 * 1024))
  } catch {
    throw new Error('這個網址回傳的不是 AI 服務的資料；請確認網址結尾是 /v1。')
  }
  const data = (body as { data?: unknown }).data
  return Array.isArray(data)
    ? data
        .map((item) => (typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
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

const MAX_LOOKUPS = 8

// The page can only change what the project already has, and a small model otherwise keeps searching for a way to
// add a picture until it runs out of lookups.
const LOOP_RULES = `只能修改作品裡已經有的東西：數值、變數、角色屬性、積木，以及切換到作品裡已有的造型。不能新增圖片、造型、音效或角色。
要求做不到時，不要再查詢，直接用一兩句中文說明做不到的原因，以及可以改成什麼。
最多查詢 ${MAX_LOOKUPS} 次；查到足夠的資訊就提交修改。`

const lookupLimitMessage = `AI 查了 ${MAX_LOOKUPS} 次作品，還是沒有提出修改，已停止。這個要求可能做不到（例如要換成作品裡沒有的圖片），或請說得更具體，例如指出要改哪個角色的什麼。`

const httpError = (status: number, detail: string): Error =>
  new Error(
    `${status === 401 || status === 403 ? 'API key 不正確或沒有填。' : ''}模型 API 回應 HTTP ${status}${detail ? `：${detail}` : ''}`,
  )

/**
 * One question, one plain-text answer (no tools), for explanations shown to the student.
 * @param options - Connection and the question.
 * @param options.baseUrl - Service address.
 * @param options.model - Model ID.
 * @param options.apiKey - Sent as a bearer token when not empty.
 * @param options.prompt - The question.
 * @param options.signal - Cancels the request.
 * @param options.fetchImpl - Replaces fetch (tests, the LAN gateway).
 * @returns The answer text.
 */
export const requestOpenAiCompatibleText = async ({
  baseUrl,
  model,
  apiKey,
  prompt,
  signal,
  fetchImpl = fetch,
}: {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey?: string
  readonly prompt: string
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}): Promise<string> => {
  if (!model.trim()) throw new Error('還沒選模型：打開上面的 AI 連線設定，按「測試連線」後選一個模型。')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  const response = await fetchImpl(endpointFor(baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model.trim(),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
    }),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw httpError(response.status, (await readResponseText(response, 1024 * 1024)).slice(0, 300))
  const body = JSON.parse(await readResponseText(response, 1024 * 1024)) as {
    choices?: { finish_reason?: unknown; message?: { content?: unknown } }[]
  }
  const choice = body.choices?.[0]
  const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : ''
  if (text) return text
  throw new Error(
    choice?.finish_reason === 'length' ? 'AI 想太久，還沒寫出說明就被截斷了；請再按一次。' : 'AI 沒有回覆說明。',
  )
}

export const requestOpenAiCompatiblePatch = async ({
  baseUrl,
  model,
  apiKey,
  instruction,
  request,
  imageDataUrl,
  signal,
  onToolCall,
  enableRawBlockInspection = false,
  fetchImpl = fetch,
}: OpenAiCompatiblePatchRequest): Promise<string> => {
  if (!model.trim()) throw new Error('還沒選模型：打開上面的 AI 連線設定，按「測試連線」後選一個模型。')
  if (new TextEncoder().encode(instruction).byteLength + new TextEncoder().encode(request).byteLength > 32_000)
    throw new Error('送給模型的文字超過 32 KB 限制。')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  const userContent = imageDataUrl
    ? [
        { type: 'text', text: request.trim() },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ]
    : request.trim()
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: `${instruction}\n\n${LOOP_RULES}` },
    { role: 'user', content: userContent },
  ]
  let toolCallCount = 0
  // Every round uses at least one lookup, so the lookup limit also bounds the rounds.
  for (let round = 0; round <= MAX_LOOKUPS; round += 1) {
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
                        query: { type: 'string', minLength: 1, maxLength: 256 },
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
                        blockId: { type: 'string', minLength: 1, maxLength: 256 },
                        opcode: { type: 'string', minLength: 1, maxLength: 256 },
                        query: { type: 'string', minLength: 1, maxLength: 256 },
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
        throw httpError(response.status, summary)
      }
    }
    if (!response.ok) {
      const detail = (await readResponseText(response, 1024 * 1024)).slice(0, 500)
      throw httpError(response.status, detail)
    }
    let body: unknown
    try {
      body = JSON.parse(await readResponseText(response, 1024 * 1024)) as unknown
    } catch {
      throw new Error('模型 API 回傳的內容不是有效 JSON。')
    }
    const text = extractPatchText(body)
    const choice = (
      body as { choices?: { finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown } }[] }
    ).choices?.[0]
    const message = choice?.message
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      if (text && !text.includes('{')) throw new Error(`AI 沒有提出修改：${text.slice(0, 400)}`)
      if (text) return text
      if (choice?.finish_reason === 'length')
        throw new Error(
          '模型還沒寫出修改，回答就被截斷了（想太久，超過長度上限）。請把要求拆小，一次只改一件事，再試一次。',
        )
      throw new Error('模型回應中找不到 patch JSON 或可用工具呼叫。')
    }
    if (toolCallCount + calls.length > MAX_LOOKUPS) throw new Error(lookupLimitMessage)
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
    const left = MAX_LOOKUPS - toolCallCount
    if (left <= 2)
      messages.push({
        role: 'user',
        content: `只剩 ${left} 次查詢。現在就呼叫 propose_live_patch 提交修改；如果做不到，直接用一兩句話說明原因。`,
      })
  }
  throw new Error(lookupLimitMessage)
}
