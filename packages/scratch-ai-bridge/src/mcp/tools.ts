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
   這些工具需要使用者先開啟 Bridge 網頁並連線。
4. 評量學生作品：老師的文字規準用 draft_rubric 轉草案（老師核准後才算數），validate_rubric 檢查，
   grade_sb3／grade_sb3_batch 依 rubric 實際試玩評分，get_grade_report 讀取成績表。只評 rubric 寫的項目；
   pending／trial／reviewRequired 的結果不得自行補分。學生作品不會送到外部模型。`

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

    const rubricInput = z
      .union([
        z
          .string()
          .min(2)
          .max(256 * 1024),
        z.record(z.string(), z.unknown()),
      ])
      .describe('rubric：JSON 物件或 JSON 文字（format "scratch-ai-bridge/rubric"）')
    const judgmentSchema = z.object({
      criterionId: z.string().min(1).max(64),
      source: z.enum(['ai', 'teacher']),
      ratio: z.number().min(0).max(1).optional(),
      passed: z.boolean().optional(),
      components: z.record(z.string(), z.boolean()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      note: z.string().max(500).optional(),
    })
    const runTool = async (task: () => unknown) => {
      try {
        enforceToolLimit()
        return result(await task())
      } catch (error) {
        return failure(error)
      }
    }

    server.registerTool(
      'validate_rubric',
      {
        description:
          '檢查教師 rubric：格式、配分總和、criterion ID、級距、子項目與自動檢查；回傳 rubricHash 與是否已核准。',
        inputSchema: z.object({ rubric: rubricInput }),
      },
      async ({ rubric }) => runTool(async () => (await import('./grade-tools.js')).validateRubricTool(rubric)),
    )

    server.registerTool(
      'draft_rubric',
      {
        description:
          '把老師的文字評量規準（每行一項、結尾寫「N 分」）轉成 rubric 草案。草案保留老師的項目與配分，只建議自動檢查與測試步驟；草案未核准，不能產生正式成績，AI 不得自行核准或改配分。',
        inputSchema: z.object({
          text: z.string().min(1).max(20_000),
          id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
          title: z.string().min(1).max(200),
          projectType: z.enum([
            'game',
            'animation',
            'story',
            'interactive-art',
            'music',
            'quiz',
            'tutorial',
            'simulation',
            'mixed',
            'custom',
          ]),
        }),
      },
      async (args) => runTool(async () => (await import('./grade-tools.js')).draftRubricTool(args)),
    )

    server.registerTool(
      'grade_sb3',
      {
        description:
          '依教師 rubric 評量一份 .sb3（檔案須在 Bridge 的 output/ 底下）。正式分數需要 playtest: true（在真的 Scratch 預覽中試玩，需先 build）與已核准的 rubric；否則回傳 pending／trial。回傳各項目得分、證據、信心、reviewRequired，以及靜態診斷分（不是成績）。',
        inputSchema: z.object({
          file: z.string().min(1).max(1024).describe('output/ 底下的 .sb3 路徑'),
          rubric: rubricInput.optional(),
          projectType: z.string().optional().describe('沒有 rubric 時用內建通用評量表的作品類型'),
          playtest: z.boolean().optional(),
          judgments: z.array(judgmentSchema).max(100).optional().describe('AI 或教師對無法自動判定項目的判定'),
          trial: z.boolean().optional().describe('允許未核准的 rubric，結果標為試行'),
        }),
      },
      async (args) => runTool(async () => (await import('./grade-tools.js')).gradeSb3Tool(args)),
    )

    server.registerTool(
      'grade_sb3_batch',
      {
        description:
          '依同一份 rubric 批次評量一個班級資料夾（須在 output/ 底下），輸出 grades.csv、review-queue.csv、class-summary.json 與逐筆報告到 output/reports/。同一年級／班級／作業才做班內相對校準（預設 80～100、眾數約 90），原始分保留。',
        inputSchema: z.object({
          directory: z.string().min(1).max(1024),
          rubric: rubricInput.optional(),
          projectType: z.string().optional(),
          manifest: z
            .string()
            .max(1024)
            .optional()
            .describe('studentId,file[,gradeLevel,classId,assignmentId] 的 CSV／JSON'),
          policy: z.string().max(1024).optional().describe('grading-policy.json'),
          judgments: z.string().max(1024).optional().describe('判定 JSON 檔路徑'),
          overrides: z.string().max(1024).optional().describe('教師調整 CSV／JSON 檔路徑'),
          playtest: z.boolean().optional(),
          trial: z.boolean().optional(),
          gradeLevel: z.string().max(64).optional(),
          classId: z.string().max(64).optional(),
          assignmentId: z.string().max(64).optional(),
          reportName: z.string().max(80).optional(),
        }),
      },
      async (args) => runTool(async () => (await import('./grade-tools.js')).gradeBatchTool(args)),
    )

    server.registerTool(
      'get_grade_report',
      {
        description:
          '讀取 grade_sb3_batch 的報告：summary、grades.csv、review-queue.csv 或某位學生代碼的詳報。不會回傳姓名對照表。',
        inputSchema: z.object({
          reportDirectory: z.string().min(1).max(1024),
          part: z.string().min(1).max(64),
        }),
      },
      async (args) => runTool(async () => (await import('./grade-tools.js')).getGradeReportTool(args)),
    )

    return server
  }
}
