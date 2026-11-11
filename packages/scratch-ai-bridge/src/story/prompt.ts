import { PRESET_EXAMPLES } from './backdrops'
import { STORY_LENGTH } from './types'

const EXAMPLE = `{
  "標題": "小石魚回家",
  "主角": "小石魚",
  "角色": { "小石魚": { "外觀": "Fish" }, "白鷺": { "外觀": "Parrot" } },
  "場景": [
    {
      "名稱": "清澈的溪流",
      "背景": "溪流",
      "動作": [
        "旁白 很久以前，基隆河的溪水清澈見底。",
        "小石魚 出現 在 左邊",
        "小石魚 游到 中間 3秒",
        "小石魚 說「這裡是我的家！」",
        "白鷺 出現 在 右上",
        "同時 白鷺 飛到 右邊 2秒",
        "白鷺 說「小心，河道要改變了。」"
      ]
    },
    {
      "名稱": "改變後的河道",
      "背景": "城市",
      "動作": ["旁白 截彎取直後，水流變快了。", "小石魚 出現 在 右邊", "小石魚 想「新家在哪裡？」", "等 2秒"]
    }
  ],
  "結尾": ["一起守護基隆河", "劇終"],
  "資料來源": ["經濟部水利署 基隆河介紹"]
}`

/**
 * The Story Spec format for agents and models that write an animation: characters, scenes with backdrops and
 * plain action lines, and the length rule.
 * @returns The authoring guide.
 */
export const createStoryGuide = (): string =>
  `格式：{ "標題", "主角", "角色": { 名稱: { "外觀", "大小" } }, "場景": [ { "名稱", "背景", "動作": [] } ], "結尾": [], "資料來源": [] }

角色的「外觀」寫 Scratch 內建角色的英文名稱（例如 Fish、Parrot、Duck、Crab、Frog、Penguin、Sailboat、Tree1），
不寫就用角色名稱找最接近的。「大小」是百分比，預設 100。
背景：內建的有 ${PRESET_EXAMPLES.join('、')}，也可以寫 Scratch 背景的英文名稱（例如 Underwater 1、Forest、Farm）。

動作一行一件事，依順序播放：
- 角色 出現 [在 位置]／角色 消失
- 角色 移到 位置 [N秒]（也可寫 走到、游到、飛到）；位置：左邊、中間、右邊、左上、右上、左下、右下、舞台左外、舞台右外，或座標 (100, -50)
- 角色 說「…」[N秒]／角色 想「…」[N秒]（秒數不寫就依字數自動算）
- 角色 變大／變小／大小 N／轉身／動起來 [N秒]
- 旁白 …（顯示在下方的字幕，每句最多 48 字）
- 等 N秒
- 播放 音效名稱（Scratch 音效，例如 Water Drop）
在一行前面加「同時」，會和上一行一起開始。

規定：至少要有主角，主角要出場；至少兩幕而且背景不同（換場會自動淡出淡入）；
全長（含片頭 4 秒、片尾 4 秒、每次換場 0.5 秒）必須在 ${STORY_LENGTH.min}～${STORY_LENGTH.max} 秒。太短就多加對白、旁白或「等 N秒」。

範例（太短，只示範格式）：
${EXAMPLE}`

/**
 * @param request - What the student wants the animation to be about.
 * @returns The prompt for a model that writes the whole story.
 */
export const createStoryInstruction = (request: string): string =>
  `你要用「動畫描述」做一部 Scratch 動畫。只輸出一個 JSON 物件，不要任何其他文字。

${createStoryGuide()}

動畫需求：
${request.trim()}`
