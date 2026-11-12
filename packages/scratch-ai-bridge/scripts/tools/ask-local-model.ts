/* eslint-disable no-useless-escape, @typescript-eslint/no-unnecessary-condition -- This CLI accepts arbitrary provider JSON and keeps its protocol guards explicit. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  inspectRawBlocks,
  inspectRawTargets,
  inspectRawVariables,
  rawProjectInventory,
} from '../../src/core/ai/raw-tool-core'
import { importLosslessSb3, rawSb3Revision } from '../../src/core/archive'
import type { RawSb3Project } from '../../src/core/archive/sb3-archive'

const MAX_LOOKUPS = 8
const REQUEST_TIMEOUT_MS = 120_000

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'inspect_raw_blocks',
      description: '分頁讀取原始 SB3 指定角色的積木圖。一次最多 10 個積木。',
      parameters: {
        type: 'object',
        properties: {
          baseRevision: { type: 'string' },
          targetIndex: { type: 'integer', minimum: 0 },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
          blockId: { type: 'string' },
          opcode: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['baseRevision', 'targetIndex'],
        additionalProperties: false,
      },
    },
  },
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
          query: { type: 'string' },
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
      description: '分頁讀取原始 SB3 指定角色的非雲端變數。',
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
] as const

const readOption = (args: string[], name: string, fallback?: string): string | undefined => {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要一個值。`)
  return value
}

const parseJsonReply = (content: string): unknown => {
  const fenced = /\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i.exec(content)?.[1]
  const candidate = (fenced ?? content).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型沒有回傳 JSON。')
  return JSON.parse(candidate.slice(start, end + 1)) as unknown
}

const requestUnderstanding = async (
  project: RawSb3Project,
  baseUrl: string,
  model: string,
  apiKey: string | undefined,
): Promise<unknown> => {
  const revision = rawSb3Revision(project)
  const inventory = rawProjectInventory(project)
  const system = `你是 Scratch 作品理解測試的 AI。只根據作品內容回答，不要猜作者沒有提供的資訊。請回答作品要怎麼操作以及目標，最後一定回傳合法 JSON，格式必須是 {"controls":[{"input":"...","action":"..."}],"goal":"..."}。input 只能使用：左右方向鍵、上下方向鍵、方向鍵、空白鍵、滑鼠移動、滑鼠點擊、<字母>鍵、綠旗。不要把作者的 Instructions 或 Notes 當作輸入；它們不在這次資料中。原始作品摘要如下，revision=${revision}：${JSON.stringify(inventory)}\n需要更多細節時只能使用下列工具，最多 ${MAX_LOOKUPS} 次；每次讀取最多 10 個積木。`
  const messages: Record<string, unknown>[] = [{ role: 'system', content: system }]
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  for (let lookup = 0; lookup <= MAX_LOOKUPS; lookup += 1) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 2048,
        tools: toolDefinitions,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`模型 API 回應 HTTP ${response.status}`)
    const body = (await response.json()) as {
      choices?: { finish_reason?: string; message?: { content?: unknown; tool_calls?: unknown } }[]
    }
    const message = body.choices?.[0]?.message
    if (!message) throw new Error('模型回應缺少 message。')
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
    if (calls.length === 0) {
      if (typeof message?.content !== 'string') throw new Error('模型沒有回覆內容。')
      return parseJsonReply(message.content)
    }
    if (lookup + calls.length > MAX_LOOKUPS) throw new Error(`模型查詢超過 ${MAX_LOOKUPS} 次。`)
    messages.push({
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : null,
      tool_calls: calls,
      ...(typeof (message as { reasoning_content?: unknown }).reasoning_content === 'string'
        ? { reasoning_content: (message as { reasoning_content: string }).reasoning_content }
        : {}),
    })
    for (const rawCall of calls) {
      const call = rawCall as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
      const id = typeof call.id === 'string' ? call.id : ''
      const name = call.function?.name
      const rawArguments = call.function?.arguments
      if (!id || typeof name !== 'string' || typeof rawArguments !== 'string')
        throw new Error('模型工具呼叫格式無效。')
      const args = JSON.parse(rawArguments) as Record<string, unknown>
      const output =
        name === 'inspect_raw_blocks'
          ? inspectRawBlocks(
              project,
              String(args.baseRevision),
              Number(args.targetIndex),
              args.offset === undefined ? undefined : Number(args.offset),
              args.limit === undefined ? 10 : Math.min(10, Number(args.limit)),
              {
                ...(typeof args.blockId === 'string' ? { blockId: args.blockId } : {}),
                ...(typeof args.opcode === 'string' ? { opcode: args.opcode } : {}),
                ...(typeof args.query === 'string' ? { query: args.query } : {}),
              },
            )
          : name === 'inspect_raw_targets'
            ? inspectRawTargets(
                project,
                String(args.baseRevision),
                args.offset === undefined ? undefined : Number(args.offset),
                args.limit === undefined ? undefined : Number(args.limit),
                typeof args.query === 'string' ? { query: args.query } : {},
              )
            : name === 'inspect_raw_variables'
              ? inspectRawVariables(
                  project,
                  String(args.baseRevision),
                  Number(args.targetIndex),
                  args.offset === undefined ? undefined : Number(args.offset),
                  args.limit === undefined ? undefined : Number(args.limit),
                )
              : (() => {
                  throw new Error(`不支援的工具：${name}`)
                })()
      messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(output) })
    }
  }
  throw new Error('模型查詢超過限制。')
}

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const inputDirectory = args.find((arg) => !arg.startsWith('--'))
  if (!inputDirectory)
    throw new Error('用法：ask-local-model.ts <作品資料夾> [--base-url URL] [--model ID] [--output DIR]')
  const baseUrl = readOption(args, '--base-url', 'http://127.0.0.1:8000/v1') ?? ''
  const model =
    readOption(args, '--model', process.env.SCRATCH_BRIDGE_MODEL ?? 'Cyber-Tiel-Coder-35B-A3B-MLX-oQ4e') ?? ''
  const outputDirectory = resolve(
    readOption(
      args,
      '--output',
      join('..', '..', 'output', 'tmp', 'understanding', new Date().toISOString().slice(0, 10)),
    ) ?? '',
  )
  const files = (await readdir(resolve(inputDirectory))).filter((file) => file.endsWith('.answer.json')).sort()
  await mkdir(outputDirectory, { recursive: true })
  let failures = 0
  for (const answerFile of files) {
    const name = basename(answerFile, '.answer.json')
    const sb3 = join(resolve(inputDirectory), `${name}.sb3`)
    try {
      const project = await importLosslessSb3(await readFile(sb3))
      const reply = await requestUnderstanding(
        project,
        baseUrl,
        model,
        process.env.OMLX_API_KEY ?? process.env.SCRATCH_BRIDGE_API_KEY,
      )
      await writeFile(join(outputDirectory, `${name}.reply.json`), `${JSON.stringify(reply, null, 2)}\n`, 'utf8')
      process.stdout.write(`${name}\n`)
    } catch (error) {
      failures += 1
      const message = error instanceof Error ? error.message : String(error)
      await writeFile(
        join(outputDirectory, `${name}.reply.json`),
        `${JSON.stringify({ error: message }, null, 2)}\n`,
        'utf8',
      )
      process.stderr.write(`${name}: ${message}\n`)
    }
  }
  if (failures > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
/* eslint-enable no-useless-escape, @typescript-eslint/no-unnecessary-condition */
