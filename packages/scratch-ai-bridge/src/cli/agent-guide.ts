import { INSTRUCTION_LINE_CHARS } from '../spec/levels'
import { BEHAVIOR_ALIASES, MAP_MAX_COLUMNS, MAP_MAX_ROWS } from '../spec/normalize'
import { MAX_LEVELS } from '../spec/types'
import { SUBTITLE_MAX_CHARS } from '../story/backdrops'
import { STORY_ACTION_EXAMPLES } from '../story/normalize'
import { STORY_LENGTH } from '../story/types'
import { outputRoot } from './output-layout'

/**
 * The page an AI agent reads first (`bridge -- start`). It is built from the code — commands, behaviors, actions,
 * limits and output paths — so it stays right as the tool changes; skills and AGENTS.md only point here.
 */

export interface CommandEntry {
  readonly name: string
  readonly goal: string
  readonly usage: string
}

/** Every CLI command, what it is for and how to call it. tests/cli/agent-guide.test.ts checks main.ts against this. */
export const COMMANDS: readonly CommandEntry[] = [
  { name: 'start', goal: '先讀這一頁', usage: 'start' },
  { name: 'guide', goal: '遊戲（game）或動畫（story）描述的完整格式', usage: 'guide [game|story]' },
  {
    name: 'spec',
    goal: '你自己寫遊戲描述，建置成 .sb3',
    usage: 'spec output/games/<名稱>/<名稱>.spec.json --playtest [--request <題目檔或文字>] [--force]',
  },
  {
    name: 'story',
    goal: '你自己寫動畫描述，建置成 .sb3',
    usage: 'story output/games/<名稱>/<名稱>.spec.json --playtest [--request <題目檔或文字>] [--force]',
  },
  {
    name: 'make',
    goal: '交給本機模型寫描述，工具建置、試玩、修正',
    usage: 'make "<需求>" [--story] --playtest [--rounds 0-3]',
  },
  { name: 'inspect', goal: '分析一個 .sb3', usage: 'inspect <檔案.sb3> --format student-markdown|markdown|json' },
  { name: 'batch', goal: '分析整個資料夾的 .sb3', usage: 'batch <資料夾>' },
  { name: 'generate', goal: '從 Canonical IR 建置（進階，一般不用）', usage: 'generate <ir.json> --out <檔案.sb3>' },
  { name: 'clean', goal: '刪掉做作品的過程檔', usage: 'clean [--all]' },
]

/**
 * Things the tool cannot do yet. Write these under 做不到 instead of working around them; remove an entry here when
 * the feature lands.
 */
export const KNOWN_GAPS: readonly string[] = [
  '拖曳、放置物件（可改成點擊）',
  '自訂廣播名稱、指定第幾秒發生（動畫可用「目標秒數」控制總長）',
  '每關各自計時（時間是整場共用）',
  '換成指定造型、圖像特效、字卡',
  '跟著滑鼠移動的玩家、搬運物品、問答',
  '遊戲角色使用官方素材（遊戲目前用內建造型；動畫可以用官方素材）',
]

const chineseName = (aliases: readonly string[]): string =>
  aliases.find((alias) => /[一-鿿]/.test(alias)) ?? aliases.at(0) ?? ''

/**
 * @returns The start page for AI agents, in Chinese.
 */
export const createAgentStartPage = (): string => {
  const behaviors = Object.values(BEHAVIOR_ALIASES).map(chineseName).join('、')
  const actions = STORY_ACTION_EXAMPLES.map((item) => item.name).join('、')
  const commands = COMMANDS.map((command) => `- ${command.goal}：\`${command.usage}\``).join('\n')
  return `# Scratch AI Bridge：給 AI 的使用說明

這一頁由程式產生，內容和目前的版本一致。指令都在 repo 第一層執行：npm run --silent bridge -- <指令>

## 想做什麼 → 用什麼
${commands}
- 修改使用者在 Bridge 網頁中開著的作品：MCP 工具 inspect_project → propose_live_patch（由使用者在網頁確認）

做遊戲：先 \`guide\`，再寫描述、\`spec\`。做動畫：先 \`guide story\`，再寫描述、\`story\`。
有題目時加 \`--request <題目檔或文字>\`，工具會對照題目要求的關數、長度和名稱。

## 規則
1. 不要自己寫 project.json、.sb3 或 Scratch 積木 JSON，一律用上面的指令產生。
2. 報告的 feedback 每一行「→」後面就是修改方法；照著改描述，加 --force 重建同一件作品。
3. 新作品用 output/games/ 裡還沒有的名稱，不要覆蓋別人的作品（被 --force 取代的舊版會留在 _過程/舊版/）。
4. 做出來的東西都在 ${outputRoot()}；不要在 packages/ 裡新增檔案。
5. 遇到權限錯誤就停下來告訴使用者。

## 什麼時候算完成
看報告的 \`done\`：true 才算完成；false 時 \`notDone\` 會列出還差什麼。
- 建置成功、試玩沒有失敗、每一關都走得到終點。
- 有 --request 或用 make 時：題目要求的關數、動畫長度、指定名稱（例如河流名稱）都做到了。
- 題目要的功能做不到時，寫進描述的「做不到」，並告訴使用者。

## 目前做得到的
- 遊戲行為：${behaviors}。
- 遊戲結構：開場說明頁、最多 ${MAX_LEVELS} 關（每關的「分數 >= N」算這一關得到的分數）、一個玩家、地圖最多 ${MAP_MAX_COLUMNS} 欄 × ${MAP_MAX_ROWS} 列、說明每行約 ${INSTRUCTION_LINE_CHARS} 字。
- 動畫動作：${actions}。動畫長度 ${STORY_LENGTH.min}～${STORY_LENGTH.max} 秒，寫「目標秒數」時工具會自動調整節奏；字幕每句最多 ${SUBTITLE_MAX_CHARS} 字。
- 動畫的角色、背景、音效可以用 Scratch 官方素材，寫中文描述也會找最接近的，近似的會在報告註明。

## 還做不到（寫進「做不到」）
${KNOWN_GAPS.map((gap) => `- ${gap}`).join('\n')}
`
}
