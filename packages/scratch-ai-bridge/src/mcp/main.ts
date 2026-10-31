import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { BrowserBridgeRelay } from './companion.js'

const parseOptions = (): { readonly origins: string[]; readonly port: number } => {
  const origins = ['https://polik18.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']
  let port = 43128
  for (let index = 2; index < process.argv.length; index += 1) {
    const option = process.argv[index]
    const value = process.argv[index + 1]
    if (option === '--origin' && value) {
      const url = new URL(value)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
        throw new Error('--origin must be an http(s) page origin without credentials.')
      origins.push(url.origin)
      index += 1
    } else if (option === '--port' && value) {
      port = Number(value)
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
        throw new Error('--port must be an integer between 1024 and 65535.')
      index += 1
    } else {
      throw new Error('Usage: scratch-ai-bridge-mcp [--origin <Bridge-page-origin>] [--port <1024-65535>]')
    }
  }
  return { origins: [...new Set(origins)], port }
}

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const failure = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
})

const main = async (): Promise<void> => {
  const { origins, port } = parseOptions()
  const relay = new BrowserBridgeRelay(origins)
  await relay.listen(port)
  const server = new McpServer({ name: 'scratch-ai-bridge', version: '0.2.0' })
  const requestTimes: number[] = []
  const enforceToolLimit = (): void => {
    const now = Date.now()
    while (requestTimes.length > 0 && now - (requestTimes.at(0) ?? now) >= 60_000) requestTimes.shift()
    if (requestTimes.length >= 20) throw new Error('MCP 每分鐘工具呼叫上限為 20 次，請稍後再試。')
    requestTimes.push(now)
  }

  server.registerTool(
    'inspect_project',
    {
      description: '檢查目前已連線 Bridge 頁面中的遊戲，回傳可修改結構與 revision。只讀取，不修改作品。',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        enforceToolLimit()
        return result(await relay.call('inspect_project', {}))
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'propose_live_patch',
    {
      description:
        '將 live-patch JSON 傳給目前 Bridge 頁面驗證並顯示差異。只產生待審候選，必須由使用者在 Bridge 中確認套用。',
      inputSchema: z.object({
        patchJson: z
          .string()
          .min(2)
          .max(16 * 1024),
      }),
    },
    async ({ patchJson }) => {
      try {
        enforceToolLimit()
        return result(await relay.call('propose_live_patch', { patchJson }))
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    'get_patch_status',
    {
      description: '查看目前 Bridge 頁面的最近一個 MCP patch 候選及其 revision 狀態。',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        enforceToolLimit()
        return result(await relay.call('get_patch_status', {}))
      } catch (error) {
        return failure(error)
      }
    },
  )

  process.stdin.once('end', () => relay.close())
  process.once('SIGINT', () => relay.close())
  process.once('SIGTERM', () => relay.close())
  console.error(`Scratch AI Bridge MCP relay listening on 127.0.0.1:${port}.`)
  console.error(`Allowed Bridge page origins: ${origins.join(', ')}`)
  serveStdio(() => server)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
