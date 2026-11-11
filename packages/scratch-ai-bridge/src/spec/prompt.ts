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
export const createGameSpecInstruction = (request: string): string =>
  `你要用「作品描述」做一個 Scratch 遊戲。只輸出一個 JSON 物件，不要任何其他文字。

${createGameSpecGuide()}

作品需求：
${request.trim()}`

/**
 * The format, behavior cards, rule vocabulary and example without the request, for agents that write the spec
 * themselves and hand it to a tool (`make_game`, `spec`).
 * @returns The authoring guide.
 */
export const createGameSpecGuide = (): string => {
  const mid = jumpReach('mid', 'mid')
  const high = jumpReach('high', 'mid')
  return `格式：{ "標題", "說明", "地圖", "圖例", "角色", "規則", "設定": { "生命": 3, "時間": 秒數 }, "做不到": [] }

地圖：字串陣列，最多 20 欄 × 15 列。# 是牆／地面，. 是空白；其他符號寫在圖例中，對應到角色名稱。
同一個符號可以放很多次（例如很多金幣）。玩家角色一定要畫在地圖上。

行為（每個角色選一個或多個，只能用這些）：
- 平台移動 {跳躍: 低/中/高, 速度: 慢/中/快}：玩家。左右走、上鍵跳。跳躍「中」最多往上 ${mid.up} 格，「高」${high.up} 格；最下面要有地面。
- 俯視移動 {速度, 方向: 左右/上下/全部}：玩家。用方向鍵走；「左右」適合接東西、閃躲遊戲（地圖只要一列，玩家放在那列）。
- 巡邏 {範圍: 格數, 可踩扁: true/false, 分數}：敵人左右來回。平台遊戲中從上方踩會消滅，其他碰到扣命。
- 收集品 {分數}：玩家碰到就得分並消失。
- 危險物：玩家碰到扣一條命。
- 終點：玩家碰到就過關。
- 掉落物 {速度, 間隔: 秒, 方向: 下/上/左/右, 加速: true/false}：不用畫在地圖上，會一直從舞台邊緣出現並移動。
  再加「收集品」就是要接住的東西，加「危險物」就是要閃開的東西。
- 子彈 {按鍵: 空白鍵, 方向: 上/下/左/右/面向}：不用畫在地圖上，按鍵時從玩家射出。
- 可射中 {分數}：被子彈打到就得分並消失（常和「掉落物」一起用）。
- 點擊目標 {分數}：用滑鼠點到就得分。可以沒有玩家角色。
- 冒出 {停留: 秒}：畫在地圖上的位置會隨機冒出又躲回去（打地鼠）。
最多一個玩家角色。

規則（選用）："條件 → 動作, 動作"
條件：開始、每 N 秒、時間到、收集 X、碰到 X、踩扁 X、射中 X、點到 X、漏掉 X、分數 >= N
動作：分數 +N、生命 -N、時間 +N、說 文字、過關、失敗
生命用完會自動失敗。要倒數計時就在設定寫「時間」。

說明（選用）：字串陣列，最多 6 行，開場畫面會顯示，按空白鍵才開始。沒寫就自動產生操作說明。
兩關（選用）：把「地圖」換成 "關卡": [ { "名稱", "地圖", "過關": "分數 >= 50" }, { "名稱", "地圖" } ]，最多 2 關。
每關可以有自己的「規則」「圖例」；外層的「規則」每關都有效。每關都要能過關（「過關」條件或畫一個「終點」）。
分數會累積，第二關的過關分數要比第一關高。
需求中真的做不到的部分（例如雙人、球反彈），寫在 "做不到" 裡，不要假裝做到。

範例：
${EXAMPLE}`
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
