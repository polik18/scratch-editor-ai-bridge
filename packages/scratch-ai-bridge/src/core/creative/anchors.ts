import type { ProjectType } from '../grading/rubric'
import { ZH_BACKDROP_KEYWORDS, ZH_SOUND_KEYWORDS, ZH_SPRITE_KEYWORDS } from '../visuals/library-zh'

/** Observable features an idea can ask for. Each maps to capability cards and runtime checks. */
export type IntentFeature =
  | 'keys'
  | 'click'
  | 'collision'
  | 'score'
  | 'lives'
  | 'timer'
  | 'levels'
  | 'clones'
  | 'falling'
  | 'sound'
  | 'music'
  | 'scenes'
  | 'dialogue'
  | 'ask'
  | 'animation'
  | 'ending'
  | 'effects'

/** Something the idea asks for that Scratch or the Bridge cannot do directly. */
export interface UnsupportedIntent {
  readonly id: string
  readonly phrase: string
  readonly decision: 'approximate' | 'substitute' | 'defer'
  readonly suggestion: string
}

/**
 * The few anchors Bridge extracts after free creation. They steer which capability cards stage B/C see and which
 * runtime checks prove the idea survived; they are never sent back as a form to fill in.
 */
export interface IntentAnchors {
  readonly projectType: ProjectType
  readonly characters: readonly string[]
  readonly scenes: readonly string[]
  readonly soundHints: readonly string[]
  readonly features: readonly IntentFeature[]
  readonly unsupported: readonly UnsupportedIntent[]
  readonly audience?: string
}

/** Explicit category nouns. When several appear, the earliest one in the text names the work. */
const TYPE_NOUNS: readonly [ProjectType, RegExp][] = [
  ['game', /遊戲|game/i],
  ['animation', /動畫|animation/i],
  ['story', /故事|童話|繪本|story/i],
  ['quiz', /問答|測驗|猜謎|quiz/i],
  ['tutorial', /教學|tutorial/i],
  ['simulation', /模擬|simulation/i],
  ['music', /樂器|演奏|作曲|music/i],
  ['interactive-art', /互動藝術|藝術作品|interactive art/i],
]

/** Weaker cues used only when no category noun appears. */
const TYPE_CUES: readonly [ProjectType, RegExp][] = [
  ['quiz', /考考|題目/],
  ['tutorial', /教你|學會|步驟/],
  ['simulation', /生態|實驗/],
  ['music', /節奏|鋼琴|打鼓/],
  ['interactive-art', /畫畫|萬花筒/],
  ['story', /對話劇|主角的冒險/],
  ['animation', /短片|影片/],
  ['game', /闖關|得分|分數|玩家/],
]

const typeOf = (text: string): ProjectType | undefined => {
  const nouns = TYPE_NOUNS.flatMap(([type, pattern]) => {
    const match = pattern.exec(text)
    return match ? [{ type, index: match.index }] : []
  }).sort((left, right) => left.index - right.index)
  return nouns[0]?.type ?? TYPE_CUES.find(([, pattern]) => pattern.test(text))?.[0]
}

const FEATURE_RULES: readonly [IntentFeature, RegExp][] = [
  ['keys', /方向鍵|左右鍵|上下鍵|空白鍵|按鍵|鍵盤|arrow|space ?key|WASD/i],
  ['click', /點擊|點一下|按一下|點選|滑鼠點|click/i],
  ['collision', /碰到|碰觸|撞到|接到|吃到|吃掉|躲|擊中|打中|touch/i],
  ['score', /分數|得分|加分|扣分|計分|score/i],
  ['lives', /生命|血量|命|lives/i],
  ['timer', /計時|倒數|時間|秒|timer/i],
  ['levels', /關卡|第二關|過關|level/i],
  ['clones', /很多|一群|不斷|源源不絕|越來越多|一直掉|分身|複製|clone/i],
  ['falling', /掉下|落下|從天上|從上面/i],
  ['sound', /音效|聲音|叫聲|sound/i],
  ['music', /音樂|配樂|背景音樂|music/i],
  // A single backdrop ("背景是海底") is a setting, recorded in `scenes`; only scene changes need runtime proof.
  ['scenes', /換景|轉場|換場景|切換場景|場景切換|下一幕|第二幕|幕之間|scene change|next scene/i],
  ['dialogue', /對白|對話|說話|旁白|台詞|說出|dialog/i],
  ['ask', /提問|問題|回答|輸入名字|ask/i],
  ['animation', /動畫|動作|跳舞|揮手|走路|飛|造型|animate/i],
  ['ending', /結束|結局|贏|輸|game over|過關|完成|ending/i],
  ['effects', /特效|變色|透明|閃爍|漸漸|effect/i],
]

const UNSUPPORTED_RULES: readonly (Omit<UnsupportedIntent, 'phrase'> & { readonly pattern: RegExp })[] = [
  {
    id: 'drag',
    pattern: /拖曳|拖拉|拖動|drag/i,
    decision: 'substitute',
    suggestion: '改成點擊角色後跟著滑鼠移動（go to [mouse-pointer]），再點一次放下。',
  },
  {
    id: 'online-multiplayer',
    pattern: /連線|線上對戰|多人上線|online/i,
    decision: 'substitute',
    suggestion: '改成同一台電腦雙人：一人用 WASD、一人用方向鍵。',
  },
  { id: '3d', pattern: /3D|立體|三維/i, decision: 'approximate', suggestion: '用大小變化與上下位置表現遠近。' },
  {
    id: 'camera',
    pattern: /鏡頭|攝影機|視訊|相機|webcam/i,
    decision: 'defer',
    suggestion: '視訊偵測需要 extension，暫時改用按鍵或點擊觸發，保留為待實作。',
  },
  {
    id: 'voice',
    pattern: /語音辨識|聲控|說話控制|voice/i,
    decision: 'defer',
    suggestion: '語音辨識暫不支援；改用按鍵或提問輸入，保留為待實作。',
  },
  {
    id: 'save',
    pattern: /存檔|儲存進度|排行榜|雲端/i,
    decision: 'defer',
    suggestion: '存檔與排行榜需要雲端變數，暫時只在本次遊玩中記錄。',
  },
  {
    id: 'pen',
    pattern: /畫筆|畫線|軌跡|筆跡|pen/i,
    decision: 'defer',
    suggestion: '畫筆 extension 尚未接入轉譯；可先用分身留下痕跡近似。',
  },
  {
    id: 'physics',
    pattern: /重力|物理|彈跳|gravity/i,
    decision: 'approximate',
    suggestion: '用變數記錄速度，每格 change y by 速度、速度逐漸減少來近似重力。',
  },
  {
    id: 'video',
    pattern: /影片檔|播放影片|mp4/i,
    decision: 'substitute',
    suggestion: '用多個造型或背景輪播代替影片。',
  },
]

/** Common words that contain a one-character asset keyword ("玩家" is not a house). */
const COMPOUNDS = /玩家|大家|國家|專家|家長|人家|天空中|花費|水準/g

const findKeywords = (source: string, dictionary: Readonly<Record<string, readonly string[]>>): string[] => {
  const text = source.replace(COMPOUNDS, '\u3000')
  const hits = Object.keys(dictionary)
    .filter((keyword) => text.includes(keyword))
    .sort((left, right) => right.length - left.length)
  // Prefer the longest match ("小魚" over "魚") and drop keywords contained in a longer hit.
  return hits.filter((keyword, index) => !hits.slice(0, index).some((longer) => longer.includes(keyword)))
}

/**
 * Extract intent anchors from the user's request and the free-creation text, without asking the model for any format.
 * @param request The user's original request.
 * @param brief The model's free-form creative text (stage A).
 * @returns Anchors used to pick capability cards, plan slices and verify the result.
 */
export const extractIntentAnchors = (request: string, brief: string): IntentAnchors => {
  const text = `${request}\n${brief}`
  const projectType = typeOf(request) ?? typeOf(brief) ?? 'mixed'
  const features = FEATURE_RULES.filter(([, pattern]) => pattern.test(text)).map(([feature]) => feature)
  const unsupported = UNSUPPORTED_RULES.flatMap(({ pattern, ...rule }) => {
    const match = pattern.exec(text)
    return match ? [{ ...rule, phrase: match[0] }] : []
  })
  const audience = /(?:給|適合|讓)([^，。,\n]{1,12}?)(?:玩|看|使用|學習)/.exec(text)?.[1]
  return {
    projectType,
    characters: findKeywords(text, ZH_SPRITE_KEYWORDS).slice(0, 8),
    scenes: findKeywords(text, ZH_BACKDROP_KEYWORDS).slice(0, 5),
    soundHints: findKeywords(text, ZH_SOUND_KEYWORDS).slice(0, 5),
    features,
    unsupported,
    ...(audience ? { audience: audience.trim() } : {}),
  }
}
