import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { BrowserBridgeRelay } from './companion.js'

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const failure = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
})

export const createBridgeMcpFactory = (relay: BrowserBridgeRelay): (() => McpServer) => {
  const requestTimes: number[] = []
  return () => {
    const server = new McpServer({ name: 'scratch-ai-bridge', version: '0.2.0' })
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
      'inspect_raw_targets',
      {
        description: '分頁列出原始 SB3 的角色，需提供目前 revision。',
        inputSchema: z.object({
          baseRevision: z.string().min(1).max(100),
          offset: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(30).optional(),
        }),
      },
      async (args) => {
        try {
          enforceToolLimit()
          return result(await relay.call('inspect_raw_targets', args))
        } catch (error) {
          return failure(error)
        }
      },
    )

    server.registerTool(
      'inspect_raw_variables',
      {
        description: '分頁讀取原始 SB3 指定角色的非雲端變數，需提供目前 revision。',
        inputSchema: z.object({
          baseRevision: z.string().min(1).max(100),
          targetIndex: z.number().int().min(0),
          offset: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(30).optional(),
        }),
      },
      async (args) => {
        try {
          enforceToolLimit()
          return result(await relay.call('inspect_raw_variables', args))
        } catch (error) {
          return failure(error)
        }
      },
    )

    server.registerTool(
      'inspect_raw_blocks',
      {
        description: '分頁讀取原始 SB3 指定角色的積木圖；需先用 inspect_project 取得 revision。',
        inputSchema: z.object({
          baseRevision: z.string().min(1).max(100),
          targetIndex: z.number().int().min(0),
          offset: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(20).optional(),
        }),
      },
      async (args) => {
        try {
          enforceToolLimit()
          return result(await relay.call('inspect_raw_blocks', args))
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

    return server
  }
}
