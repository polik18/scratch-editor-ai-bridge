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
    name: 'create',
    goal: '任何類型的 Scratch 作品：模型先自由構想，再由 Bridge 分段轉成積木、建置並試玩',
    usage: 'create "<需求>" --playtest [--mode a-b|a-b-c] [--replies <回覆資料夾>]',
  },
  {
    name: 'make',
    goal: '交給本機模型寫描述，工具建置、試玩、修正',
    usage: 'make "<需求>" [--story] --playtest [--rounds 0-3]',
  },
  {
    name: 'inspect',
    goal: '分析一個 .sb3 或輸出給 AI 的作品讀本',
    usage: 'inspect <檔案.sb3> --format student-markdown|markdown|json|ai-reader',
  },
  {
    name: 'fetch',
    goal: '下載公開 Scratch 作品並輸出讀本',
    usage: 'fetch <Scratch 網址或作品編號> [--out <資料夾>]',
  },
  { name: 'batch', goal: '診斷整個資料夾的 .sb3（靜態結構診斷，不是成績）', usage: 'batch <資料夾>' },
  {
    name: 'grade',
    goal: '依教師 rubric 實際試玩並評量 .sb3，輸出正式成績表（grades.csv、review-queue.csv）',
    usage:
      'grade <資料夾或檔案.sb3> --rubric <rubric.json> --playtest [--manifest <班級.csv>] [--policy <grading-policy.json>] [--judgments <判定.json>] [--overrides <教師調整.csv>]',
  },
  {
    name: 'calibrate',
    goal: '用教師盲評校準自動評分（排名相關、各項誤差、教師一致性、複核召回）；通過前只能稱為試行正式評量',
    usage:
      'calibrate prepare <作品資料夾> --rubric <rubric.json> --out <新資料夾> --playtest | calibrate <自動評分報告> --teachers <老師1.csv,老師2.csv>',
  },
  {
    name: 'rubric',
    goal: '把老師的文字規準轉成 rubric 草案、檢查並核准（核准後才會產生正式成績）',
    usage:
      'rubric draft <規準.txt> --id <id> --title <標題> --project-type <類型> | rubric validate <rubric.json> | rubric approve <rubric.json> --by <核准者>',
  },
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
- 評量學生作品：MCP 工具 validate_rubric、draft_rubric、grade_sb3、grade_sb3_batch（同一個評量核心）

評量：\`batch\` 和 \`inspect\` 的分數只是靜態結構診斷，不能當成績。正式成績用 \`grade --playtest\`；沒有實際執行、
rubric 未核准或有待判定項目時，報告會標成 pending／trial，並列在 review-queue.csv，不要自行補分。

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
- 建置成功、實際試玩（--playtest）通過、每一關都走得到終點；沒有試玩過的作品 done 一定是 false。
- 有 --request 或用 make 時：題目要求的關數、動畫長度、指定名稱（例如河流名稱）都做到了。
- 題目要的功能做不到時，寫進描述的「做不到」，並告訴使用者。

## 目前做得到的
- 遊戲行為：${behaviors}。
- 遊戲結構：開場說明頁、最多 ${MAX_LEVELS} 關（每關的「分數 >= N」算這一關得到的分數）、一個玩家、地圖最多 ${MAP_MAX_COLUMNS} 欄 × ${MAP_MAX_ROWS} 列、說明每行約 ${INSTRUCTION_LINE_CHARS} 字。
- 動畫動作：${actions}。動畫長度 ${STORY_LENGTH.min}～${STORY_LENGTH.max} 秒，寫「目標秒數」時工具會自動調整節奏；字幕每句最多 ${SUBTITLE_MAX_CHARS} 字。
- 遊戲角色和動畫的角色、背景、音效會用 Scratch 官方素材，寫中文描述也會找最接近的，近似的會在報告註明。遊戲角色名稱看不出是什麼時，寫「外觀」。

## 還做不到（寫進「做不到」）
${KNOWN_GAPS.map((gap) => `- ${gap}`).join('\n')}
`
}
