import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { createGameSpecGuide } from '../spec/prompt.js'
import { createStoryGuide } from '../story/prompt.js'
import type { BrowserBridgeRelay } from './companion.js'

/** Sent to MCP hosts on initialize so an agent knows which tool fits before reading any docs. */
export const BRIDGE_MCP_INSTRUCTIONS = `Scratch AI Bridge 有三種用法：
1. 做新遊戲：用 make_game。你寫一個 Game Spec JSON（格式在 make_game 的說明裡），工具會產生 .sb3 並回報 feedback。
   有錯就照 feedback 中「→」後面的建議修改，再呼叫一次。不要自己寫 project.json 或 .sb3。
2. 做動畫（60～180 秒、至少換一次背景）：用 make_story，格式在它的說明裡，用法同上。
3. 修改使用者在 Bridge 網頁中開著的作品：先 inspect_project，再依需要 read_script/find；角色不確定時用 ask_student，最後 propose_live_patch（只會產生待審候選，由使用者在網頁確認）。
   這些工具需要使用者先開啟 Bridge 網頁並連線。`

export interface BridgeMcpOptions {
  /** Parent of the game folders make_game creates; defaults to the package's output/games. */
  readonly gamesDir?: string
}

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const failure = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
})

export const createBridgeMcpFactory = (
  relay: BrowserBridgeRelay,
  options: BridgeMcpOptions = {},
): (() => McpServer) => {
  const requestTimes: number[] = []
  const gamesDir = options.gamesDir ? path.resolve(options.gamesDir) : undefined
  return () => {
    const server = new McpServer(
      { name: 'scratch-ai-bridge', version: '0.3.0' },
      { instructions: BRIDGE_MCP_INSTRUCTIONS },
    )
    const enforceToolLimit = (): void => {
      const now = Date.now()
      while (requestTimes.length > 0 && now - (requestTimes.at(0) ?? now) >= 60_000) requestTimes.shift()
      if (requestTimes.length >= 20) throw new Error('MCP 每分鐘工具呼叫上限為 20 次，請稍後再試。')
      requestTimes.push(now)
    }

    server.registerTool(
      'make_story',
      {
        description: `用動畫描述（Story Spec）JSON 做一部 Scratch 動畫（.sb3）。不需要開啟網頁。
回傳 status、output、seconds（全長）與 feedback；有「錯誤」時照「→」後面的建議修改再呼叫一次。

${createStoryGuide()}`,
        inputSchema: z.object({
          spec: z
            .union([
              z
                .string()
                .min(2)
                .max(64 * 1024),
              z.record(z.string(), z.unknown()),
            ])
            .describe('動畫描述：JSON 物件，或 JSON 文字'),
          name: z.string().min(1).max(60).optional().describe('資料夾與檔名；省略時用標題'),
          playtest: z.boolean().optional().describe('true：以十倍速播完整部動畫，檢查每一幕的背景與片長'),
        }),
      },
      async ({ spec, name, playtest }) => {
        try {
          enforceToolLimit()
          const { makeStoryFromSpec } = await import('./make-game.js')
          return result(
            await makeStoryFromSpec(spec, {
              ...(gamesDir ? { gamesDir } : {}),
              ...(name ? { name } : {}),
              playtest: playtest ?? false,
            }),
          )
        } catch (error) {
          return failure(error)
        }
      },
    )

    server.registerTool(
      'make_game',
      {
        description: `用 Game Spec JSON 做一個新的 Scratch 遊戲（.sb3）。不需要開啟網頁。
回傳 status、output（.sb3 路徑）與 feedback；feedback 有「錯誤」或「試玩未通過」時，照「→」後面的建議修改 spec 再呼叫一次。

${createGameSpecGuide()}`,
        inputSchema: z.object({
          spec: z
            .union([
              z
                .string()
                .min(2)
                .max(64 * 1024),
              z.record(z.string(), z.unknown()),
            ])
            .describe('Game Spec：JSON 物件，或 JSON 文字'),
          name: z.string().min(1).max(60).optional().describe('檔名（不含副檔名）；省略時用標題'),
          playtest: z
            .boolean()
            .optional()
            .describe('true：在真的 Scratch 預覽中自動試玩（約 30–90 秒，需要先 build 套件）'),
        }),
      },
      async ({ spec, name, playtest }) => {
        try {
          enforceToolLimit()
          const { makeGameFromSpec } = await import('./make-game.js')
          return result(
            await makeGameFromSpec(spec, {
              ...(gamesDir ? { gamesDir } : {}),
              ...(name ? { name } : {}),
              playtest: playtest ?? false,
            }),
          )
        } catch (error) {
          return failure(error)
        }
      },
    )

    server.registerTool(
      'inspect_project',
      {
        description:
          '檢查使用者在 Bridge 網頁中開著的遊戲，回傳可修改結構與 revision。只讀取。需要網頁已連線；要做新遊戲請改用 make_game。',
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
          query: z.string().min(1).max(256).optional(),
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
      'read_script',
      {
        description: '讀取原始 SB3 讀本中的一段可讀程式；需提供 inspect_project 回傳的 revision 與 script ID。',
        inputSchema: z.object({ baseRevision: z.string().min(1).max(100), scriptId: z.string().min(1).max(256) }),
      },
      async (args) => {
        try {
          enforceToolLimit()
          return result(await relay.call('read_script', args))
        } catch (error) {
          return failure(error)
        }
      },
    )

    server.registerTool(
      'find',
      {
        description: '在目前原始 SB3 的讀本中搜尋文字；需提供目前 revision。',
        inputSchema: z.object({ baseRevision: z.string().min(1).max(100), query: z.string().min(1).max(256) }),
      },
      async (args) => {
        try {
          enforceToolLimit()
          return result(await relay.call('find', args))
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
          blockId: z.string().min(1).max(256).optional(),
          opcode: z.string().min(1).max(256).optional(),
          query: z.string().min(1).max(256).optional(),
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
      'ask_student',
      {
        description: '當角色或畫面指涉不確定時，請使用者從選項中選擇；不要猜測目標。',
        inputSchema: z.object({
          question: z.string().min(1).max(300),
          choices: z.array(z.string().min(1).max(120)).min(1).max(8),
        }),
      },
      async (args) => {
        try {
          enforceToolLimit()
          return result(await relay.call('ask_student', args))
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
