import { jumpReach } from './physics'

const EXAMPLE = `{
  "標題": "金幣森林",
  "地圖": [
    "..........ooo......",
    ".........=====.....",
    "...oo..............",
    "..=====.......E...G",
    "P.....E....########",
    "#######...#########"
  ],
  "圖例": { "P": "主角", "o": "金幣", "E": "史萊姆", "G": "旗子" },
  "角色": {
    "主角": { "行為": [{ "平台移動": { "跳躍": "中" } }] },
    "金幣": { "行為": [{ "收集品": { "分數": 10 } }] },
    "史萊姆": { "行為": [{ "巡邏": { "範圍": 2 } }] },
    "旗子": { "行為": ["終點"] }
  },
  "規則": ["收集 金幣 → 說 叮！", "分數 >= 50 → 說 好多金幣！"]
}`

/**
 * The whole authoring contract a model needs for Game Spec: six behavior cards, the rule vocabulary and one
 * example. Kept deliberately short so small models can hold all of it in context.
 * @param request - What the student wants to make.
 * @returns The complete prompt.
 */
export const createGameSpecInstruction = (request: string): string => {
  const mid = jumpReach('mid', 'mid')
  const high = jumpReach('high', 'mid')
  return `你要用「作品描述」做一個 Scratch 遊戲。只輸出一個 JSON 物件，不要任何其他文字。

格式：{ "標題", "地圖", "圖例", "角色", "規則", "設定": { "生命": 3 } }

地圖：字串陣列，最多 20 欄 × 15 列。# 是牆／地面，. 是空白；其他符號寫在圖例中，對應到角色名稱。
同一個符號可以放很多次（例如很多金幣）。

行為（每個角色選一個或多個，只能用這些）：
- 平台移動 {跳躍: 低/中/高, 速度: 慢/中/快}：玩家角色。左右走、上鍵跳。跳躍「中」最多往上 ${mid.up} 格，「高」最多 ${high.up} 格；最下面一列要有地面。
- 俯視移動 {速度}：玩家角色。上下左右走，適合迷宮。
- 巡邏 {範圍: 格數, 可踩扁: true/false, 分數}：敵人，左右來回走。平台遊戲中從上方踩會消滅它，從側面碰到會扣命。
- 收集品 {分數}：玩家碰到就得分並消失。
- 危險物：玩家碰到會扣一條命。
- 終點：玩家碰到就過關。
整個遊戲只能有一個玩家角色。

規則（選用）："條件 → 動作, 動作"
條件：開始、收集 X、碰到 X、踩扁 X、分數 >= N
動作：分數 +N、生命 -N、說 文字、過關、失敗

範例：
${EXAMPLE}

作品需求：
${request.trim()}`
}

/**
 * Follow-up message after a build: the author's own spec plus the plain-language feedback lines to fix.
 * @param specText - The spec the model wrote last time.
 * @param feedback - Feedback lines from the build.
 * @returns The repair prompt.
 */
export const createGameSpecRepairInstruction = (specText: string, feedback: string): string =>
  `你上次的作品描述有下面的問題。依照每一行「→」後面的建議修改，輸出修改後的完整 JSON，不要任何其他文字。

問題：
${feedback.trim()}

上次的作品描述：
${specText.trim()}`
