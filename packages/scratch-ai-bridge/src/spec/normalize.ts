import { type AssetPick, pickSprite } from '../core/visuals/assets'
import type {
  BehaviorUse,
  Direction,
  GameSpec,
  Level,
  Look,
  RuleAction,
  RuleTrigger,
  SpecDiagnostic,
  SpecEntity,
  SpecRule,
  TopdownParams,
} from './types'

export const MAP_MAX_COLUMNS = 20
export const MAP_MAX_ROWS = 15

const EMPTY_CHARS = new Set(['.', ' ', '_'])
const DEFAULT_WALL_CHARS = ['#', '=']
const WALL_WORDS = new Set([
  'wall',
  'walls',
  'ground',
  'platform',
  'block',
  'solid',
  '牆',
  '牆壁',
  '地面',
  '平台',
  '磚塊',
  '地板',
])

const KEY_ALIASES: Record<string, readonly string[]> = {
  title: ['title', 'name', '標題', '作品', '名稱', '遊戲名稱'],
  map: ['map', 'level', '地圖', '關卡'],
  legend: ['legend', '圖例', '符號'],
  entities: ['entities', 'sprites', 'characters', 'actors', '角色', '物件'],
  rules: ['rules', '規則'],
  settings: ['settings', '設定'],
  lives: ['lives', '生命', '命'],
  time: ['time', 'timer', 'timelimit', 'seconds', '時間', '時限', '倒數', '秒數'],
  behaviors: ['behaviors', 'behaviour', 'behaviours', 'behavior', '行為'],
  look: ['look', 'costume', 'appearance', '外觀', '造型'],
  color: ['color', 'colour', '顏色'],
  when: ['when', 'on', 'trigger', '當', '條件'],
  do: ['do', 'then', 'actions', 'action', '做', '動作', '就'],
  unsupported: ['unsupported', 'cannot', 'limitations', 'notdone', '做不到', '無法做到', '沒做到', '限制'],
  instructions: ['instructions', 'howtoplay', 'help', '說明', '規則說明', '操作說明', '玩法', '遊戲說明'],
  clear: ['clear', 'win', 'wincondition', '過關', '過關條件', '通關', '通關條件'],
}

export const BEHAVIOR_ALIASES: Readonly<Record<BehaviorUse['name'], readonly string[]>> = {
  platformer: ['platformer', 'platform', 'jumper', '平台移動', '平台跳躍', '跳躍移動', '橫向移動'],
  topdown: ['topdown', 'top-down', 'top down', '俯視移動', '四方向移動', '上下左右移動', '迷宮移動'],
  patrol: ['patrol', 'enemy', 'walker', '巡邏', '來回巡邏', '敵人', '來回走'],
  collectible: ['collectible', 'collect', 'pickup', 'item', '收集品', '收集', '道具', '寶物'],
  hazard: ['hazard', 'danger', 'trap', 'spike', '危險物', '陷阱', '尖刺', '危險'],
  goal: ['goal', 'exit', 'finish', 'flag', '終點', '出口', '目標', '旗子'],
  faller: ['faller', 'falling', 'spawner', 'dropper', '掉落物', '掉落', '落下', '生成器', '飄浮物', '移動障礙'],
  projectile: ['projectile', 'bullet', 'shoot', 'shooter', 'laser', '子彈', '射擊', '發射', '雷射', '飛彈'],
  target: ['target', 'shootable', 'hittable', '可射中', '可被射中', '被射中', '靶', '射擊目標'],
  clickable: ['clickable', 'click', 'tap', '點擊目標', '點擊', '可點擊', '點', '滑鼠點擊'],
  popup: ['popup', 'pop up', 'popper', '冒出', '隨機出現', '出現', '閃現'],
}

const PARAM_ALIASES: Record<string, readonly string[]> = {
  jump: ['jump', 'jumpheight', '跳躍', '跳', '跳躍力', '跳躍高度'],
  speed: ['speed', '速度'],
  range: ['range', 'distance', '範圍', '距離'],
  stompable: ['stompable', 'stomp', '可踩扁', '可踩', '踩扁'],
  points: ['points', 'score', 'value', '分數', '分', '點數'],
  interval: ['interval', 'every', 'rate', '間隔', '頻率', '每隔', '秒'],
  direction: ['direction', 'axis', 'dir', '方向', '移動方向', '軸', '往'],
  accelerate: ['accelerate', 'speedup', 'faster', '加速', '越來越快'],
  key: ['key', 'button', '按鍵', '鍵', '發射鍵'],
  stay: ['stay', 'duration', 'show', '停留', '停留時間', '出現時間'],
}

const DIRECTION_ALIASES: Record<Direction | 'facing', readonly string[]> = {
  down: ['down', 'fall', '下', '往下', '向下', '掉落', '落下'],
  up: ['up', 'rise', 'float', '上', '往上', '向上', '飄', '飄上'],
  left: ['left', '左', '往左', '向左'],
  right: ['right', '右', '往右', '向右'],
  facing: ['facing', 'forward', 'front', '面向', '前方', '面對', '前'],
}

const AXIS_ALIASES: Record<TopdownParams['axis'], readonly string[]> = {
  horizontal: ['horizontal', 'x', 'leftright', 'left-right', '左右', '水平', '橫向'],
  vertical: ['vertical', 'y', 'updown', 'up-down', '上下', '垂直', '直向'],
  both: ['both', 'all', 'any', '全部', '四方向', '上下左右', '八方向'],
}

/** Spoken key names → Scratch key option names. */
const KEY_NAMES: readonly [string, RegExp][] = [
  ['space', /^(space|空白|空白鍵|空格|空格鍵|spacebar)$/i],
  ['up arrow', /^(up|up arrow|上|上鍵|向上鍵)$/i],
  ['down arrow', /^(down|down arrow|下|下鍵|向下鍵)$/i],
  ['left arrow', /^(left|left arrow|左|左鍵)$/i],
  ['right arrow', /^(right|right arrow|右|右鍵)$/i],
]

const LEVEL_ALIASES: Record<Level, readonly string[]> = {
  low: ['low', 'slow', 'small', 'weak', '1', '低', '慢', '小', '弱'],
  mid: ['mid', 'medium', 'normal', 'default', '2', '中', '普通', '一般'],
  high: ['high', 'fast', 'big', 'strong', '3', '高', '快', '大', '強'],
}

/** Name words that strongly imply a behavior, for entities that appear only in the legend. */
const BEHAVIOR_GUESSES: readonly [
  Extract<BehaviorUse['name'], 'goal' | 'hazard' | 'patrol' | 'collectible'>,
  RegExp,
][] = [
  ['goal', /終點|旗|出口|目標|goal|flag|exit|finish/i],
  ['hazard', /陷阱|尖刺|刺|岩漿|火焰|炸彈|trap|spike|lava|bomb/i],
  ['patrol', /敵|怪|史萊姆|蝙蝠|enemy|monster|slime/i],
  ['collectible', /星|金幣|硬幣|錢|寶石|寶物|鑰匙|蘋果|起司|coin|star|gem|key|apple|item/i],
]

const LOOKS: readonly Look[] = [
  'hero',
  'slime',
  'coin',
  'spike',
  'flag',
  'box',
  'key',
  'star',
  'apple',
  'rock',
  'balloon',
  'bullet',
  'car',
  'mole',
]
const DEFAULT_LOOK: Record<BehaviorUse['name'], Look> = {
  platformer: 'hero',
  topdown: 'hero',
  patrol: 'slime',
  collectible: 'coin',
  hazard: 'spike',
  goal: 'flag',
  faller: 'rock',
  projectile: 'bullet',
  target: 'slime',
  clickable: 'balloon',
  popup: 'mole',
}

/** Name words that pick a look, so a "蘋果" looks like an apple whatever its behavior. */
const LOOK_GUESSES: readonly [Look, RegExp][] = [
  ['apple', /蘋果|apple/i],
  ['rock', /隕石|石頭|岩|meteor|rock|asteroid/i],
  ['balloon', /氣球|泡泡|balloon|bubble/i],
  ['bullet', /雷射|子彈|飛彈|laser|bullet|missile/i],
  ['car', /車|car/i],
  ['mole', /地鼠|鼴鼠|mole/i],
  ['star', /星|star/i],
  ['coin', /金幣|硬幣|錢|coin/i],
  ['key', /鑰匙|key/i],
  ['spike', /刺|陷阱|spike|trap/i],
  ['flag', /旗|終點|flag|goal/i],
  ['slime', /敵|怪|外星|水母|史萊姆|enemy|alien|monster|slime/i],
]

/**
 * Look for an entity without an explicit one: its name first ("蘋果" looks like an apple), then its first behavior.
 * @param name - Entity name.
 * @param behaviors - Entity behaviors.
 * @returns The chosen look.
 */
const guessLook = (name: string, behaviors: readonly BehaviorUse[]): Look =>
  LOOK_GUESSES.find(([, pattern]) => pattern.test(name))?.[0] ??
  (behaviors[0] && !(behaviors[0].name === 'platformer' || behaviors[0].name === 'topdown')
    ? DEFAULT_LOOK[behaviors[0].name]
    : behaviors[0]
      ? 'hero'
      : 'box')

/**
 * Whether a character's own name is enough to pick official artwork: the matched word must be the head noun at the
 * end of the name, so 「香魚」 becomes a fish but 「魚道」 (a fish ladder) and 「電魚網」 (a net) do not.
 * @param name - Character name.
 * @param pick - From {@link pickSprite}.
 * @returns Whether to use the pick.
 */
const namesArtwork = (name: string, pick: AssetPick): boolean =>
  pick.match === 'exact' ||
  (pick.word !== undefined &&
    name.endsWith(pick.word) &&
    (pick.match === 'approximate' || [...pick.word].length >= 2))

type Json = unknown
type JsonObject = Record<string, Json>

const isObject = (value: Json): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const simplify = (text: string): string => text.toLowerCase().replace(/[\s_-]/g, '')

/**
 * Author-facing text for any JSON value (objects are shown as JSON, not `[object Object]`).
 * @param value - Any parsed JSON value.
 * @returns Text to show or to match against aliases.
 */
const asText = (value: Json): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value)

const editDistance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/**
 * Finds the canonical key whose alias list contains `word`, tolerating case, spacing and small typos.
 * @param word - Author-written word.
 * @param table - Canonical key → accepted aliases.
 * @returns The matched key and whether the match was exact, or undefined.
 */
const resolveAlias = <K extends string>(
  word: string,
  table: Readonly<Record<K, readonly string[]>>,
): { readonly key: K; readonly exact: boolean } | undefined => {
  const wanted = simplify(word)
  let best: { key: K; distance: number } | undefined
  for (const [key, aliases] of Object.entries(table) as [K, readonly string[]][]) {
    for (const alias of aliases) {
      const distance = editDistance(wanted, simplify(alias))
      if (distance === 0) return { key, exact: true }
      if (!best || distance < best.distance) best = { key, distance }
    }
  }
  const tolerance = wanted.length <= 3 ? 0 : wanted.length <= 6 ? 1 : 2
  return best && best.distance <= tolerance ? { key: best.key, exact: false } : undefined
}

/**
 * Reads a field by any of its aliases. Exact alias matches win; a typo only counts when it is not another field's name.
 * @param object - Author-written object.
 * @param key - Canonical field name.
 * @returns The field value, or undefined when absent.
 */
const pick = (object: JsonObject, key: keyof typeof KEY_ALIASES): Json => {
  const entries = Object.entries(object)
  const exact = entries.find(([name]) => KEY_ALIASES[key].some((alias) => simplify(alias) === simplify(name)))
  if (exact) return exact[1]
  const fuzzy = entries.find(([name]) => {
    const resolved = resolveAlias(name, KEY_ALIASES)
    return resolved?.key === key && !resolved.exact
  })
  return fuzzy?.[1]
}

export const closestName = (word: string, names: readonly string[]): string | undefined => {
  const wanted = simplify(word)
  let best: { name: string; distance: number } | undefined
  for (const name of names) {
    const distance = editDistance(wanted, simplify(name))
    if (!best || distance < best.distance) best = { name, distance }
  }
  const tolerance = Math.max(1, Math.floor(wanted.length / 3))
  return best && best.distance <= tolerance ? best.name : undefined
}

/**
 * Rewrites brackets outside strings so they nest, removing trailing commas. A closer that does not match the open
 * container is read one of two ways: `close-open` closes the inner containers first (a missing closer), `swap`
 * treats it as written before the closer that follows it (two closers in the wrong order). An object opened where
 * a key belongs (`{ "a": 1, { "b": 2 } }`) closes the object before it, turning the pair into list items.
 * @param text - JSON text with possibly mismatched brackets.
 * @param strategy - How to read a closer that does not match.
 * @returns Text whose brackets nest.
 */
const rebalanceJson = (text: string, strategy: 'close-open' | 'swap'): string => {
  const closer: Record<string, string> = { '{': '}', '[': ']' }
  const stack: string[] = []
  let out = ''
  let inString = false
  let previous = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === '\\') out += text[(index += 1)] ?? ''
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    if (char === '{' && previous === ',' && stack[stack.length - 1] === '{') {
      const comma = out.lastIndexOf(',')
      out = `${out.slice(0, comma)}}${out.slice(comma)}`
      stack.pop()
    }
    if (!/\s/.test(char)) previous = char
    if (char === '{' || char === '[') stack.push(char)
    if (char === '}' || char === ']') {
      const opener = char === '}' ? '{' : '['
      if (!stack.includes(opener)) continue
      const top = stack[stack.length - 1]
      if (top !== opener && strategy === 'swap' && stack[stack.length - 2] === opener) {
        const next = /\S/.exec(text.slice(index + 1))
        if (next?.[0] === closer[top]) {
          out += closer[top] + char
          stack.splice(-2, 2)
          index += next.index + 1
          continue
        }
      }
      while (stack[stack.length - 1] !== opener) out += closer[stack.pop() ?? '{']
      stack.pop()
    }
    out += char
  }
  while (stack.length > 0) out += closer[stack.pop() ?? '{']
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Counts top-level fields that are spec fields, to choose between bracket repairs.
 * @param value - Parsed candidate.
 * @returns Number of recognized top-level fields.
 */
const recognizedFields = (value: Json): number =>
  isObject(value) ? Object.keys(value).filter((name) => resolveAlias(name, KEY_ALIASES)).length : 0

/**
 * Extracts the first JSON object from free text (models often wrap JSON in prose or code fences) and, when it does
 * not parse, retries once with mismatched brackets and trailing commas repaired.
 * @param text - Model or author output.
 * @returns The parsed JSON value and whether a repair was needed.
 */
/**
 * Moves text written after a closing quote back inside it: `"小魚 說「你好」" 5秒,` becomes `"小魚 說「你好」 5秒",`.
 * Small models often put seconds or notes there, which is not JSON.
 * @param body - JSON text.
 * @returns The text with such tails moved inside their strings.
 */
const absorbTrailingText = (body: string): string =>
  body.replace(
    /"((?:[^"\\\n]|\\.)*)"[ \t]+([^",\]}\n:]+?)[ \t]*(?=[,\]}\n])/g,
    (_, inside: string, tail: string) => `"${inside} ${tail.trim()}"`,
  )

/**
 * The line a JSON parse error points at, so feedback can show the author what to change.
 * @param body - JSON text.
 * @param error - The parse error.
 * @returns 「第 N 行：…」, or an empty string when the position is unknown.
 */
const errorLine = (body: string, error: unknown): string => {
  const position = Number(/position (\d+)/.exec(error instanceof Error ? error.message : '')?.[1])
  if (!Number.isFinite(position)) return ''
  const line = body.slice(0, position).split('\n').length
  return `第 ${line} 行：${(body.split('\n')[line - 1] ?? '').trim().slice(0, 80)}`
}

export const extractJson = (text: string): { readonly value: Json; readonly repaired: boolean } => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('找不到 JSON 物件：請只輸出一個 { … } 的作品描述。')
  const body = text.slice(start, end + 1)
  try {
    return { value: JSON.parse(body), repaired: false }
  } catch (error) {
    const absorbed = absorbTrailingText(body)
    const candidates = [
      absorbed,
      ...(['close-open', 'swap'] as const).map((strategy) => rebalanceJson(absorbed, strategy)),
    ].flatMap((candidate) => {
      try {
        return [JSON.parse(candidate) as Json]
      } catch {
        return []
      }
    })
    if (candidates.length === 0) {
      const where = errorLine(body, error)
      throw new Error(
        `JSON 格式錯誤${where ? `，${where}` : ''}。常見原因：秒數或說明寫在引號外面（要寫成 "小魚 說「你好」 5秒"）、少了逗號、多了逗號。`,
      )
    }
    const best = candidates.reduce((left, right) => (recognizedFields(right) > recognizedFields(left) ? right : left))
    return { value: best, repaired: true }
  }
}

/** Top-level fields that models sometimes write inside "角色" by closing a bracket too late. */
const LIFTABLE_FIELDS = ['rules', 'settings', 'unsupported', 'map', 'legend', 'title'] as const

/**
 * Moves top-level fields found inside the entities object back to the top level.
 * @param raw - Parsed spec object.
 * @param fixed - Records a fixed diagnostic.
 * @returns The spec object with misplaced fields moved.
 */
const liftMisplacedFields = (
  raw: JsonObject,
  fixed: (code: string, where: string, message: string) => void,
): JsonObject => {
  const entitiesKey = Object.keys(raw).find((name) => resolveAlias(name, KEY_ALIASES)?.key === 'entities')
  const inner = entitiesKey === undefined ? undefined : raw[entitiesKey]
  if (entitiesKey === undefined || !isObject(inner)) return raw
  const lifted: JsonObject = { ...raw }
  const remaining: JsonObject = {}
  for (const [name, value] of Object.entries(inner)) {
    const field = resolveAlias(name, KEY_ALIASES)
    const liftable = field?.exact === true && (LIFTABLE_FIELDS as readonly string[]).includes(field.key)
    if (field && liftable && pick(raw, field.key) === undefined) {
      lifted[name] = value
      fixed('FIELD_LIFTED', `角色.${name}`, `「${name}」寫在角色裡面，已移回最外層。`)
    } else remaining[name] = value
  }
  lifted[entitiesKey] = remaining
  return lifted
}

/** One level's worth of spec, before levels and the opening card are added. */
export type SingleLevelSpec = Omit<GameSpec, 'instructions' | 'levels'>

export interface SingleLevelResult {
  readonly spec?: SingleLevelSpec
  readonly diagnostics: readonly SpecDiagnostic[]
}

export interface SingleLevelOptions {
  /**
   * Entities drawn on another level's map. Missing from this map is then on purpose: they are not placed here
   * automatically, not turned into falling copies and not reported as missing.
   */
  readonly drawnElsewhere?: ReadonlySet<string>
}

/**
 * Normalizes a spec with one map. {@link normalizeGameSpec} in `levels.ts` calls it once per level.
 * @param raw - Parsed spec JSON.
 * @param options - Context from the other levels.
 * @returns The normalized single-level spec and diagnostics.
 */
export const normalizeSingleLevel = (raw: Json, options: SingleLevelOptions = {}): SingleLevelResult => {
  const elsewhere = options.drawnElsewhere ?? new Set<string>()
  const diagnostics: SpecDiagnostic[] = []
  const error = (code: string, where: string, message: string, suggestion?: string): void => {
    diagnostics.push({ severity: 'error', code, where, message, ...(suggestion ? { suggestion } : {}) })
  }
  const warn = (code: string, where: string, message: string, suggestion?: string): void => {
    diagnostics.push({ severity: 'warning', code, where, message, ...(suggestion ? { suggestion } : {}) })
  }
  const fixed = (code: string, where: string, message: string): void => {
    diagnostics.push({ severity: 'fixed', code, where, message })
  }

  if (!isObject(raw)) {
    error(
      'SPEC_NOT_OBJECT',
      '整份描述',
      '作品描述必須是一個 JSON 物件。',
      '用 { "標題": …, "角色": …, "地圖": … } 的形式。',
    )
    return { diagnostics }
  }

  const source = liftMisplacedFields(raw, fixed)
  const title = asText(pick(source, 'title') ?? '我的作品')

  // ---------- level of a parameter ----------
  const level = (value: Json, where: string): Level => {
    if (value === undefined) return 'mid'
    const found = resolveAlias(asText(value), LEVEL_ALIASES)
    if (found) return found.key
    warn('UNKNOWN_LEVEL', where, `看不懂等級「${asText(value)}」，先用「中」。`, '使用 低／中／高。')
    return 'mid'
  }
  const choose = <K extends string>(value: Json, table: Readonly<Record<K, readonly string[]>>, fallback: K): K =>
    value === undefined ? fallback : (resolveAlias(asText(value), table)?.key ?? fallback)
  const number = (value: Json, fallback: number, where: string): number => {
    if (value === undefined) return fallback
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
    warn('NOT_A_NUMBER', where, `「${asText(value)}」不是數字，先用 ${fallback}。`)
    return fallback
  }
  const boolean = (value: Json, fallback: boolean): boolean => {
    if (value === undefined) return fallback
    if (typeof value === 'boolean') return value
    return ['true', 'yes', '是', '可以', '要', '1'].includes(asText(value).trim().toLowerCase())
  }

  // ---------- behaviors ----------
  /**
   * One list entry may hold several behaviors, e.g. { "掉落物": {…}, "收集品": {…} } or { "危險物": true }.
   * @param entry - One item of an entity's behavior list.
   * @param where - Location for diagnostics.
   * @returns The behaviors it describes.
   */
  const behaviors = (entry: Json, where: string): BehaviorUse[] => {
    if (typeof entry === 'string') return [behavior(entry, {}, where)].filter((item) => item !== undefined)
    if (isObject(entry)) {
      const explicit = entry.name ?? entry.type ?? entry['名稱']
      if (typeof explicit === 'string') return [behavior(explicit, entry, where)].filter((item) => item !== undefined)
      return Object.entries(entry)
        .filter(([, value]) => value !== false)
        .map(([name, value]) => behavior(name, isObject(value) ? value : {}, where))
        .filter((item) => item !== undefined)
    }
    warn(
      'BEHAVIOR_SHAPE',
      where,
      '行為要寫成名稱字串，或 { "行為名稱": { 參數 } }，已略過。',
      '例如 "收集品" 或 { "收集品": { "分數": 10 } }。',
    )
    return []
  }

  const behavior = (nameWord: string, params: JsonObject, where: string): BehaviorUse | undefined => {
    const resolved = resolveAlias(nameWord, BEHAVIOR_ALIASES)
    if (!resolved) {
      warn(
        'UNKNOWN_BEHAVIOR',
        where,
        `沒有「${nameWord}」這個行為，已略過。`,
        `可用行為：${Object.values(BEHAVIOR_ALIASES)
          .map((aliases) => aliases.find((alias) => /[一-鿿]/.test(alias)))
          .join('、')}。`,
      )
      return undefined
    }
    if (!resolved.exact) fixed('BEHAVIOR_ALIAS', where, `「${nameWord}」視為行為「${resolved.key}」。`)
    const param: Record<string, Json> = {}
    for (const [key, value] of Object.entries(params)) {
      const found = resolveAlias(key, PARAM_ALIASES)
      if (found) param[found.key] = value
    }
    switch (resolved.key) {
      case 'platformer':
        return {
          name: 'platformer',
          params: { jump: level(param.jump, `${where}.跳躍`), speed: level(param.speed, `${where}.速度`) },
        }
      case 'topdown':
        return {
          name: 'topdown',
          params: { speed: level(param.speed, `${where}.速度`), axis: choose(param.direction, AXIS_ALIASES, 'both') },
        }
      case 'patrol':
        return {
          name: 'patrol',
          params: {
            speed: level(param.speed, `${where}.速度`),
            range: Math.max(1, Math.round(number(param.range, 3, `${where}.範圍`))),
            stompable: boolean(param.stompable, true),
            points: number(param.points, 50, `${where}.分數`),
          },
        }
      case 'collectible':
        return { name: 'collectible', params: { points: number(param.points, 10, `${where}.分數`) } }
      case 'hazard':
        return { name: 'hazard', params: {} }
      case 'goal':
        return { name: 'goal', params: {} }
      case 'faller': {
        const direction = choose<Direction | 'facing'>(param.direction, DIRECTION_ALIASES, 'down')
        return {
          name: 'faller',
          params: {
            speed: level(param.speed, `${where}.速度`),
            interval: Math.max(0.2, number(param.interval, 1.5, `${where}.間隔`)),
            direction: direction === 'facing' ? 'down' : direction,
            accelerate: boolean(param.accelerate, false),
          },
        }
      }
      case 'projectile': {
        const keyWord = param.key === undefined ? 'space' : asText(param.key).trim()
        const key =
          KEY_NAMES.find(([, pattern]) => pattern.test(keyWord))?.[0] ??
          (/^[a-z0-9]$/i.test(keyWord) ? keyWord.toLowerCase() : 'space')
        return {
          name: 'projectile',
          params: {
            key,
            direction: choose(param.direction, DIRECTION_ALIASES, 'up'),
            speed: level(param.speed, `${where}.速度`),
          },
        }
      }
      case 'target':
        return { name: 'target', params: { points: number(param.points, 10, `${where}.分數`) } }
      case 'clickable':
        return { name: 'clickable', params: { points: number(param.points, 10, `${where}.分數`) } }
      case 'popup':
        return { name: 'popup', params: { stay: Math.max(0.2, number(param.stay, 1, `${where}.停留`)) } }
    }
  }

  // ---------- entities ----------
  const rawEntities = pick(source, 'entities')
  const entityEntries: [string, Json][] = isObject(rawEntities)
    ? Object.entries(rawEntities)
    : Array.isArray(rawEntities)
      ? rawEntities.map((item, index): [string, Json] => [
          isObject(item) && typeof item.name === 'string' ? item.name : `角色${index + 1}`,
          item,
        ])
      : []
  if (entityEntries.length === 0)
    error('NO_ENTITIES', '角色', '沒有任何角色。', '加上 "角色": { "主角": { "行為": ["平台移動"] } }。')

  const officialFor = (name: string): string | undefined => {
    const chosen = pickSprite(name)
    return chosen.name && namesArtwork(name, chosen) ? chosen.name : undefined
  }
  const noteOfficial = (name: string, where: string, official: string, lookWord: string): void => {
    const chosen = pickSprite(lookWord || name)
    fixed(
      'OFFICIAL_LOOK',
      where,
      `「${name}」用 Scratch 官方角色 ${official}${chosen.match === 'approximate' && chosen.note ? `（${chosen.note}）` : ''}。`,
    )
  }

  const entities: SpecEntity[] = []
  for (const [name, definition] of entityEntries) {
    const where = `角色.${name}`
    let rawBehaviors: Json = isObject(definition) ? pick(definition, 'behaviors') : definition
    if (rawBehaviors === undefined) rawBehaviors = []
    const list = Array.isArray(rawBehaviors) ? rawBehaviors : [rawBehaviors]
    const uses = list.flatMap((entry, index) => behaviors(entry, `${where}.行為[${index}]`))
    const rawLook = isObject(definition) ? pick(definition, 'look') : undefined
    const lookWord = typeof rawLook === 'string' ? rawLook.trim() : ''
    const preset = LOOKS.includes(lookWord as Look)
    const look = preset ? (lookWord as Look) : guessLook(name, uses)
    let official: string | undefined
    if (lookWord && !preset) {
      const chosen = pickSprite(lookWord)
      if (chosen.name && chosen.match !== 'category') official = chosen.name
      else
        warn(
          'UNKNOWN_LOOK',
          `${where}.外觀`,
          `找不到叫「${lookWord}」的 Scratch 官方角色，改用內建造型「${look}」。`,
          `外觀寫官方角色的英文名稱（例如 Fish、Crab、Dove）或常見的中文（例如 魚、螃蟹、鴿子），也可以寫內建造型 ${LOOKS.join('、')}。`,
        )
    } else if (!lookWord) official = officialFor(name)
    if (official) noteOfficial(name, where, official, lookWord)
    const color = isObject(definition) ? pick(definition, 'color') : undefined
    entities.push({
      name,
      behaviors: uses,
      look,
      ...(typeof color === 'string' ? { color } : {}),
      ...(official ? { official } : {}),
    })
  }
  /**
   * Adds a behavior to an entity, keeping entity order.
   * @param name - Entity name.
   * @param use - Behavior to add.
   */
  const addBehavior = (name: string, use: BehaviorUse): void => {
    const index = entities.findIndex((entity) => entity.name === name)
    if (index >= 0) entities[index] = { ...entities[index], behaviors: [...entities[index].behaviors, use] }
  }
  const hasUse = (entity: SpecEntity, name: BehaviorUse['name']): boolean =>
    entity.behaviors.some((item) => item.name === name)
  const isPlayer = (entity: SpecEntity): boolean => hasUse(entity, 'platformer') || hasUse(entity, 'topdown')
  // Pop-ups in a game without a player exist to be clicked.
  if (!entities.some(isPlayer))
    for (const entity of [...entities])
      if (hasUse(entity, 'popup') && !hasUse(entity, 'clickable')) {
        addBehavior(entity.name, { name: 'clickable', params: { points: 10 } })
        fixed('CLICKABLE_ADDED', `角色.${entity.name}`, `「${entity.name}」會冒出但沒有玩家，已加上「點擊目標」。`)
      }
  const entityNames = entities.map((entity) => entity.name)
  const resolveEntity = (word: string, where: string, soft = false): string | undefined => {
    if (entityNames.includes(word)) return word
    const near = closestName(word, entityNames)
    if (near) {
      fixed('ENTITY_NAME', where, `「${word}」視為角色「${near}」。`)
      return near
    }
    ;(soft ? warn : error)(
      'UNKNOWN_ENTITY',
      where,
      `沒有叫「${word}」的角色${soft ? '，這條規則已略過' : ''}。`,
      `目前的角色：${entityNames.join('、') || '（無）'}。`,
    )
    return undefined
  }

  /**
   * Creates an entity named only in the legend; its behavior is guessed from words in its name.
   * @param name - Entity name from the legend.
   * @param where - Location for the diagnostic.
   * @returns The entity name.
   */
  const inferEntity = (name: string, where: string): string => {
    const guess = BEHAVIOR_GUESSES.find(([, pattern]) => pattern.test(name))?.[0]
    const behaviors: BehaviorUse[] =
      guess === 'collectible'
        ? [{ name: 'collectible', params: { points: 10 } }]
        : guess === 'patrol'
          ? [{ name: 'patrol', params: { speed: 'mid', range: 3, stompable: true, points: 50 } }]
          : guess === 'hazard' || guess === 'goal'
            ? [{ name: guess, params: {} }]
            : []
    const look = guessLook(name, behaviors)
    const official = officialFor(name)
    if (official) noteOfficial(name, where, official, '')
    entities.push({ name, behaviors, look, ...(official ? { official } : {}) })
    entityNames.push(name)
    if (guess) {
      const label = BEHAVIOR_ALIASES[guess].find((alias) => /[\u4e00-\u9fff]/.test(alias)) ?? guess
      fixed('ENTITY_INFERRED', where, `「${name}」沒有寫在角色裡，已依名稱當作「${label}」。`)
    } else
      warn(
        'ENTITY_INFERRED',
        where,
        `「${name}」沒有寫在角色裡，先當作沒有行為的裝飾。`,
        `在 "角色" 加上 "${name}": { "行為": [...] }。`,
      )
    return name
  }

  // Only one character can be steered. Requests with two controlled things (竹筏 and 擺渡人) keep the first as the
  // player and the others as characters that stay put, so the game still builds.
  const steered = entities.filter(isPlayer)
  for (const extra of steered.slice(1)) {
    const index = entities.indexOf(extra)
    const remaining = extra.behaviors.filter((use) => use.name !== 'platformer' && use.name !== 'topdown')
    entities[index] = { ...extra, behaviors: remaining }
    warn(
      'MULTIPLE_PLAYERS',
      `角色.${extra.name}`,
      `只能有一個玩家角色，「${extra.name}」改成不能操控（玩家是「${steered[0]?.name ?? ''}」）。`,
      `要用滑鼠操作「${extra.name}」就加「點擊目標」；只是畫面上的角色就刪掉它的「平台移動」／「俯視移動」。`,
    )
  }
  const players = entities.filter(isPlayer)
  const hasBehavior = (name: BehaviorUse['name']): boolean =>
    entities.some((entity) => entity.behaviors.some((item) => item.name === name))
  if (players.length === 0 && !hasBehavior('clickable'))
    error(
      'NO_PLAYER',
      '角色',
      '沒有玩家可以操控的角色，也沒有可以點擊的角色。',
      '替主角加上「平台移動」或「俯視移動」；用滑鼠玩的遊戲則替角色加上「點擊目標」。',
    )
  if (players.length === 0 && hasBehavior('projectile'))
    error(
      'PROJECTILE_NO_PLAYER',
      '角色',
      '有「子彈」但沒有玩家角色可以發射。',
      '加一個有「俯視移動」或「平台移動」的玩家。',
    )
  if (hasBehavior('target') && !hasBehavior('projectile'))
    warn(
      'TARGET_NO_PROJECTILE',
      '角色',
      '有「可射中」的角色，但沒有「子彈」，射不到它。',
      '加一個有「子彈」行為的角色。',
    )

  // ---------- map and legend ----------
  const rawMap = pick(source, 'map')
  let map: string[] = Array.isArray(rawMap)
    ? rawMap.map(String)
    : typeof rawMap === 'string'
      ? rawMap.split('\n')
      : []
  map = map
    .map((row) => row.replace(/\s+$/, ''))
    .filter((row, index, rows) => row.length > 0 || index < rows.length - 1)
  while (map.length > 0 && map[0].trim() === '') map.shift()
  if (map.length === 0 && players.length > 0) {
    // Without a map, platformers get a floor to stand on and top-down games a single open row.
    map = Array.from({ length: hasUse(players[0], 'platformer') ? 8 : 1 }, () => '.'.repeat(MAP_MAX_COLUMNS))
    fixed('MAP_CREATED', '地圖', '沒有地圖，已建立一張空白地圖。')
  }
  const legend: Record<string, string> = {}
  const wallChars = new Set(DEFAULT_WALL_CHARS)
  const rawLegend = pick(source, 'legend')
  if (isObject(rawLegend)) {
    for (const [symbol, target] of Object.entries(rawLegend)) {
      const char = [...symbol][0]
      if (!char) continue
      const word = String(target)
      if (WALL_WORDS.has(simplify(word))) {
        wallChars.add(char)
        continue
      }
      if (EMPTY_CHARS.has(char)) continue
      if (!entityNames.includes(word) && !closestName(word, entityNames)) {
        legend[char] = inferEntity(word, `圖例.${char}`)
        wallChars.delete(char)
        continue
      }
      const entity = resolveEntity(word, `圖例.${char}`)
      if (entity) {
        legend[char] = entity
        wallChars.delete(char)
      }
    }
  }
  // Extra rows or columns holding only empty space or walls are cropped; anything else is the author's to fix.
  const droppable = (char: string): boolean => EMPTY_CHARS.has(char) || wallChars.has(char)
  const cropRows = (): number => {
    let cropped = 0
    while (map.length > MAP_MAX_ROWS && [...map[0]].every(droppable)) {
      map.shift()
      cropped += 1
    }
    return cropped
  }
  const croppedRows = cropRows()
  // Content beyond the stage is cut (keeping the bottom rows, where the floor usually is) with a warning rather
  // than refusing the whole game; anything that a cut removes and the author needs is placed again below.
  const lost = (rows: readonly string[]): string[] => [
    ...new Set(rows.flatMap((row) => [...row]).filter((char) => !droppable(char))),
  ]
  if (map.length > MAP_MAX_ROWS) {
    const removed = map.slice(0, map.length - MAP_MAX_ROWS)
    map = map.slice(map.length - MAP_MAX_ROWS)
    warn(
      'MAP_CROPPED_CONTENT',
      '地圖',
      `地圖超過 ${MAP_MAX_ROWS} 列，已刪掉最上面 ${removed.length} 列（含「${lost(removed).join('')}」）。`,
      `地圖最多 ${MAP_MAX_ROWS} 列。`,
    )
  }
  const width = Math.max(0, ...map.map((row) => [...row].length))
  if (width > MAP_MAX_COLUMNS) {
    // Keep the 20 columns that hold the most characters (the player's column always), so a goal at the far end of
    // a wide map is not the part that is lost.
    const cellsAt = (column: number): number => map.filter((row) => !droppable([...row][column] ?? '.')).length
    const playerColumns = map.flatMap((row) =>
      [...row].flatMap((char, column) => (players.some((player) => legend[char] === player.name) ? [column] : [])),
    )
    let start = 0
    let bestCount = -1
    for (let candidate = 0; candidate + MAP_MAX_COLUMNS <= width; candidate += 1) {
      if (playerColumns.some((column) => column < candidate || column >= candidate + MAP_MAX_COLUMNS)) continue
      let count = 0
      for (let column = candidate; column < candidate + MAP_MAX_COLUMNS; column += 1) count += cellsAt(column)
      if (count > bestCount) {
        bestCount = count
        start = candidate
      }
    }
    const removed = map.map((row) =>
      [...row].filter((_, column) => column < start || column >= start + MAP_MAX_COLUMNS).join(''),
    )
    map = map.map((row) => [...row].slice(start, start + MAP_MAX_COLUMNS).join(''))
    const chars = lost(removed)
    const kept = `第 ${start + 1}～${start + MAP_MAX_COLUMNS} 欄`
    if (chars.length === 0)
      fixed('MAP_CROPPED', '地圖', `地圖超過 ${MAP_MAX_COLUMNS} 欄，只保留${kept}（裁掉的只有空白或牆）。`)
    else
      warn(
        'MAP_CROPPED_CONTENT',
        '地圖',
        `地圖最寬 ${width} 欄，只保留角色最多的${kept}，「${chars.join('')}」被裁掉。`,
        `每列最多 ${MAP_MAX_COLUMNS} 個字：把地圖改窄，或把角色放近一點。`,
      )
  }
  if (croppedRows > 0)
    fixed('MAP_CROPPED', '地圖', `地圖超過 ${MAP_MAX_ROWS} 列，已刪掉最上面 ${croppedRows} 列空白。`)
  const columns = Math.min(MAP_MAX_COLUMNS, Math.max(0, ...map.map((row) => [...row].length)))
  map = map.map((row) => [...row].concat(Array(Math.max(0, columns - [...row].length)).fill('.')).join(''))

  const player = players.length === 1 ? players[0] : undefined
  const platformerGame = player !== undefined && hasUse(player, 'platformer')
  if (platformerGame && map.length > 0 && !map.some((row) => [...row].some((char) => wallChars.has(char)))) {
    const ground = '#'.repeat(columns)
    if ([...map[map.length - 1]].every((char) => EMPTY_CHARS.has(char))) map[map.length - 1] = ground
    else if (map.length < MAP_MAX_ROWS) map.push(ground)
    else map[map.length - 1] = ground
    fixed('GROUND_ADDED', `地圖 第 ${map.length} 列`, '平台遊戲沒有地面，已在最下面加一排地面。')
  }

  /**
   * Draws an entity on the map at a cell, choosing a free legend character for it.
   * @param name - Entity to draw.
   * @param spot - Cell to draw on.
   * @param spot.row - Map row.
   * @param spot.column - Map column.
   * @param code - Diagnostic code.
   * @param message - Diagnostic message.
   */
  const placeEntity = (name: string, spot: { row: number; column: number }, code: string, message: string): void => {
    const cells = map.map((row) => [...row])
    const usedChars = new Set(cells.flat())
    const char =
      Object.entries(legend).find(([key, owner]) => owner === name && !usedChars.has(key))?.[0] ??
      [[...name][0], '@', '&', '$', '%', '~', '!'].find(
        (candidate) =>
          !usedChars.has(candidate) && !legend[candidate] && !wallChars.has(candidate) && !EMPTY_CHARS.has(candidate),
      ) ??
      '@'
    legend[char] = name
    cells[spot.row][spot.column] = char
    map = cells.map((row) => row.join(''))
    fixed(code, `地圖 第 ${spot.row + 1} 列第 ${spot.column + 1} 欄`, message)
  }
  const openCell = (row: number, column: number): boolean => EMPTY_CHARS.has([...(map[row] ?? '')][column] ?? '#')
  /**
   * Floor cells for platformers (open with a wall below), open cells otherwise, in reading order.
   * @returns Cells an entity can be placed on.
   */
  const standingCells = (): { row: number; column: number }[] => {
    const found: { row: number; column: number }[] = []
    for (let row = 0; row < map.length; row += 1)
      for (let column = 0; column < columns; column += 1)
        if (
          openCell(row, column) &&
          (!platformerGame || (row + 1 < map.length && wallChars.has([...map[row + 1]][column])))
        )
          found.push({ row, column })
    return found
  }

  // A player that is described but not drawn is placed where it can start: on the leftmost floor for platformers,
  // in the first open cell for top-down games.
  const drawn = (name: string): boolean =>
    map.some((row) => [...row].some((char) => legend[char] === name || ([...name][0] === char && !legend[char])))
  if (player && map.length > 0 && !drawn(player.name)) {
    const isPlatformer = player.behaviors.some((item) => item.name === 'platformer')
    const cells = map.map((row) => [...row])
    const open = (row: number, column: number): boolean => EMPTY_CHARS.has(cells[row]?.[column] ?? '#')
    let spot: { row: number; column: number } | undefined
    if (isPlatformer) {
      for (let column = 0; column < columns && !spot; column += 1)
        for (let row = map.length - 2; row >= 0 && !spot; row -= 1)
          if (open(row, column) && wallChars.has(cells[row + 1][column])) spot = { row, column }
    } else {
      const axis = player.behaviors.find((item) => item.name === 'topdown')?.params
      const candidates: { row: number; column: number }[] = []
      for (let row = 0; row < map.length; row += 1)
        for (let column = 0; column < columns; column += 1) if (open(row, column)) candidates.push({ row, column })
      // Left-right players belong at the bottom centre (things fall towards them), up-down players at the left.
      const score = (cell: { row: number; column: number }): number =>
        axis && 'axis' in axis && axis.axis === 'horizontal'
          ? -cell.row * 100 + Math.abs(cell.column - columns / 2)
          : axis && 'axis' in axis && axis.axis === 'vertical'
            ? cell.column * 100 + Math.abs(cell.row - map.length / 2)
            : cell.row * 100 + cell.column
      spot = candidates.reduce<{ row: number; column: number } | undefined>(
        (best, cell) => (!best || score(cell) < score(best) ? cell : best),
        undefined,
      )
    }
    if (spot) {
      const usedChars = new Set(cells.flat())
      const char =
        Object.entries(legend).find(([key, name]) => name === player.name && !usedChars.has(key))?.[0] ??
        [[...player.name][0], '@', '&', '$'].find(
          (candidate) => !usedChars.has(candidate) && !legend[candidate] && !wallChars.has(candidate),
        ) ??
        '@'
      legend[char] = player.name
      cells[spot.row][spot.column] = char
      map = cells.map((row) => row.join(''))
      fixed(
        'PLAYER_AUTO_PLACED',
        `地圖 第 ${spot.row + 1} 列第 ${spot.column + 1} 欄`,
        `地圖上沒有玩家「${player.name}」，已自動放在這裡。`,
      )
    }
  }

  // A platformer player with no floor anywhere below its start would fall off the stage forever; move it to the
  // nearest cell it can stand on.
  if (player && platformerGame) {
    const rowOf = map.findIndex((row) => [...row].some((char) => legend[char] === player.name))
    if (rowOf >= 0) {
      const columnOf = [...map[rowOf]].findIndex((char) => legend[char] === player.name)
      const floorBelow = map.slice(rowOf + 1).some((row) => wallChars.has([...row][columnOf]))
      if (!floorBelow) {
        const cells = map.map((row) => [...row])
        cells[rowOf][columnOf] = '.'
        map = cells.map((row) => row.join(''))
        const spots = standingCells()
        if (spots.length > 0) {
          const spot = spots.reduce((best, cell) =>
            Math.abs(cell.row - rowOf) + Math.abs(cell.column - columnOf) <
            Math.abs(best.row - rowOf) + Math.abs(best.column - columnOf)
              ? cell
              : best,
          )
          placeEntity(
            player.name,
            spot,
            'PLAYER_MOVED',
            `「${player.name}」腳下沒有地面，開場會掉出舞台，已移到最近可以站的地方。`,
          )
        }
      }
    }
  }

  const isDrawn = (name: string): boolean =>
    map.some((row) => [...row].some((char) => legend[char] === name || ([...name][0] === char && !legend[char])))
  if (player) {
    for (const entity of entities) {
      if (entity === player || isDrawn(entity.name) || elsewhere.has(entity.name)) continue
      const spots = standingCells()
      if (spots.length === 0) break
      if (hasUse(entity, 'goal')) {
        // Furthest from the start: the right end of the floor (platformers) or the last open cell.
        const spot = platformerGame
          ? spots.reduce((best, cell) =>
              cell.column > best.column || (cell.column === best.column && cell.row > best.row) ? cell : best,
            )
          : spots[spots.length - 1]
        placeEntity(entity.name, spot, 'ENTITY_AUTO_PLACED', `地圖上沒有「${entity.name}」，已放在離起點最遠的地方。`)
      } else if (hasUse(entity, 'patrol')) {
        const middle = Math.floor(columns * 0.6)
        const spot = spots.reduce((best, cell) =>
          Math.abs(cell.column - middle) < Math.abs(best.column - middle) ? cell : best,
        )
        placeEntity(entity.name, spot, 'ENTITY_AUTO_PLACED', `地圖上沒有「${entity.name}」，已放在地圖中段。`)
      }
    }
  }
  // Things that are not on the map can still take part by entering from the stage edges.
  for (const entity of [...entities]) {
    if (isPlayer(entity) || isDrawn(entity.name) || elsewhere.has(entity.name)) continue
    if (hasUse(entity, 'faller') || hasUse(entity, 'projectile') || hasUse(entity, 'popup')) continue
    if (!['collectible', 'hazard', 'target', 'clickable'].some((name) => hasUse(entity, name as BehaviorUse['name'])))
      continue
    const direction: Direction = /氣球|泡泡|balloon|bubble/i.test(entity.name) ? 'up' : 'down'
    addBehavior(entity.name, {
      name: 'faller',
      params: { speed: 'mid', interval: 1.5, direction, accelerate: false },
    })
    fixed(
      'FALLER_ADDED',
      `角色.${entity.name}`,
      `「${entity.name}」沒有畫在地圖上，已改成從舞台${direction === 'up' ? '下方飄上來' : '上方掉下來'}。`,
    )
  }

  // An entity whose name starts with a map character it already owns needs no legend entry.
  const used = new Set(map.flatMap((row) => [...row]))
  for (const char of used) {
    if (EMPTY_CHARS.has(char) || wallChars.has(char) || legend[char]) continue
    const byInitial = entities.filter((entity) => [...entity.name][0] === char)
    if (byInitial.length === 1) {
      legend[char] = byInitial[0].name
      fixed('LEGEND_INFERRED', `圖例.${char}`, `地圖上的「${char}」視為角色「${byInitial[0].name}」。`)
      continue
    }
    const rowIndex = map.findIndex((row) => row.includes(char))
    error(
      'UNKNOWN_MAP_CHAR',
      `地圖 第 ${rowIndex + 1} 列`,
      `地圖上的「${char}」沒有在圖例中說明。`,
      `在 "圖例" 加上 "${char}": "角色名稱"，或改成 "#"（牆）／"."（空白）。`,
    )
  }
  for (const entity of entities) {
    // Falling copies and projectiles enter from the stage edges, so they need no map cell.
    if (entity.behaviors.some((item) => item.name === 'faller' || item.name === 'projectile')) continue
    const placed = Object.entries(legend).some(([char, name]) => name === entity.name && used.has(char))
    if (!placed && !elsewhere.has(entity.name))
      warn(
        'ENTITY_NOT_PLACED',
        `角色.${entity.name}`,
        `「${entity.name}」沒有出現在地圖上，遊戲中看不到它。`,
        '在圖例替它指定一個符號，並畫進地圖。',
      )
  }

  // ---------- rules ----------
  const parseTrigger = (text: string, where: string): RuleTrigger | undefined => {
    const t = text.trim()
    if (/^(start|開始|遊戲開始|一開始)$/i.test(t)) return { kind: 'start' }
    if (/^(時間到|時間結束|倒數結束|計時結束|time'?s? ?up|timeout)$/i.test(t)) return { kind: 'time-up' }
    const score = /(score|分數)\s*(>=|≥|>|達到|到達|超過|=)\s*(-?\d+)/i.exec(t)
    if (score)
      return { kind: 'score-at-least', value: Number(score[3]) + (score[2] === '>' || score[2] === '超過' ? 1 : 0) }
    const every = /^(每|every)\s*(\d+(?:\.\d+)?)?\s*(秒|s|sec|secs|seconds?)(鐘)?$/i.exec(t)
    if (every) return { kind: 'every', seconds: Math.max(0.1, every[2] ? Number(every[2]) : 1) }
    const compare = /^(.+?)\s*(>=|≥|<=|≤|==|>|<|=)\s*(-?\d+(?:\.\d+)?)$/.exec(t)
    if (compare) {
      const ops: Record<string, '>=' | '<=' | '>' | '<' | '='> = {
        '>=': '>=',
        '≥': '>=',
        '<=': '<=',
        '≤': '<=',
        '>': '>',
        '<': '<',
        '=': '=',
        '==': '=',
      }
      const op = ops[compare[2]]
      return {
        kind: 'compare',
        variable: variableName(compare[1], where, op === '<=' || op === '<'),
        op,
        value: Number(compare[3]),
      }
    }
    const verbs: [RuleTrigger['kind'], RegExp][] = [
      ['hit', /(射中|打中|擊中|hits?|shoots?)\s*(.+)$/i],
      ['click', /(點到|點擊|點中|點破|clicks?|taps?)\s*(.+)$/i],
      ['miss', /(漏掉|漏接|沒接到|錯過|misse?s?|掉出)\s*(.+)$/i],
      ['collect', /(collects?|收集|吃到|拿到|撿到|吃)\s*(.+)$/i],
      ['stomp', /(stomps?|踩扁|踩到|踩)\s*(.+)$/i],
      ['touch', /(touch(?:es)?|reach(?:es)?|碰到|抵達|到達|走到)\s*(.+)$/i],
    ]
    for (const [kind, pattern] of verbs) {
      const match = pattern.exec(t)
      if (match) {
        const entity = resolveEntity(match[2].trim(), where, true)
        return entity ? ({ kind, entity } as RuleTrigger) : undefined
      }
    }
    warn(
      'UNKNOWN_TRIGGER',
      where,
      `看不懂條件「${text}」，這條規則已略過。`,
      '可用：開始、每 N 秒、時間到、收集 X、碰到 X、踩扁 X、射中 X、點到 X、漏掉 X、分數 >= N。',
    )
    return undefined
  }
  const parseAction = (text: string, where: string): RuleAction | undefined => {
    const t = text.trim()
    const change = /^(score|分數|lives|生命|time|時間)\s*([+-]\s*\d+)\s*(秒)?$/i.exec(t)
    if (change)
      return {
        kind: /score|分數/i.test(change[1]) ? 'score' : /lives|生命/i.test(change[1]) ? 'lives' : 'time',
        delta: Number(change[2].replace(/\s/g, '')),
      }
    const counter = /^(.+?)\s*([+-]\s*\d+(?:\.\d+)?)$/.exec(t)
    if (counter && !/[>=<]/.test(counter[1]))
      return {
        kind: 'var',
        name: variableName(counter[1], where, counter[2].trim().startsWith('-')),
        delta: Number(counter[2].replace(/\s/g, '')),
      }
    const speech = /^(say|說|顯示|show)\s*[:：]?\s*["「]?(.+?)["」]?$/i.exec(t)
    if (speech) return { kind: 'say', text: speech[2] }
    if (/^(win|勝利|過關|贏)$/i.test(t)) return { kind: 'win' }
    if (/^(lose|失敗|輸|遊戲結束|game over)$/i.test(t)) return { kind: 'lose' }
    warn(
      'UNKNOWN_ACTION',
      where,
      `看不懂動作「${text}」，已略過。`,
      '可用：分數 +N、生命 -N、時間 +N、說 文字、過關、失敗。',
    )
    return undefined
  }

  /** Custom counters used by rules; `falls` marks counters that go down or are checked for running out. */
  const counters = new Map<string, { falls: boolean }>()
  /**
   * Maps a variable word in a rule to the stage variable it means, registering custom counters.
   * @param word - Word from the rule.
   * @param where - Location for diagnostics.
   * @param falls - Whether this use decreases the counter or checks it for running out.
   * @returns The stage variable name.
   */
  const variableName = (word: string, where: string, falls: boolean): string => {
    const name = word.trim()
    if (/^(score|分數)$/i.test(name)) return '分數'
    if (/^(lives|生命|命)$/i.test(name)) return '生命'
    if (/^(time|時間|剩餘時間)$/i.test(name)) return '時間'
    if (!counters.has(name)) fixed('VARIABLE_CREATED', where, `已建立計數器「${name}」。`)
    counters.set(name, { falls: (counters.get(name)?.falls ?? false) || falls })
    return name
  }

  const rules: SpecRule[] = []
  const rawRules = pick(source, 'rules')
  const ruleList = Array.isArray(rawRules) ? rawRules : rawRules === undefined ? [] : [rawRules]
  ruleList.forEach((entry, index) => {
    const where = `規則[${index}]`
    let whenText: string | undefined
    let doList: string[] = []
    if (typeof entry === 'string') {
      const [left, right] = entry.split(/->|→|=>|，就|就/)
      whenText = left.replace(/^(當|when)\s*/i, '')
      doList = right ? right.split(/[,，、;；]/) : []
    } else if (isObject(entry)) {
      whenText = asText(pick(entry, 'when') ?? '')
      const actions = pick(entry, 'do')
      doList = (Array.isArray(actions) ? actions : actions === undefined ? [] : [actions]).map(String)
    }
    if (!whenText || doList.length === 0) {
      warn(
        'RULE_SHAPE',
        where,
        '規則要有條件和動作。',
        '例如 { "當": "收集 金幣", "做": ["分數 +10"] } 或 "收集 金幣 → 分數 +10"。',
      )
      return
    }
    if (
      /^\s*(lives|生命)\s*(<=|≤|<|==|=|用完|歸零|為)\s*[01]?\s*$/i.test(whenText) &&
      doList.every((text) => /^\s*(lose|失敗|輸|遊戲結束|game over)\s*$/i.test(text))
    ) {
      fixed('RULE_BUILT_IN', where, '「生命用完就失敗」已經內建，不需要這條規則。')
      return
    }
    const when = parseTrigger(whenText, `${where}.當`)
    if (when?.kind === 'hit') {
      const target = entities.find((entity) => entity.name === when.entity)
      if (target && !hasUse(target, 'target')) {
        addBehavior(target.name, { name: 'target', params: { points: 0 } })
        fixed('TARGET_ADDED', `角色.${target.name}`, `規則要射中「${target.name}」，已替它加上「可射中」。`)
      }
    }
    if (when?.kind === 'click') {
      const target = entities.find((entity) => entity.name === when.entity)
      if (target && !hasUse(target, 'clickable')) {
        addBehavior(target.name, { name: 'clickable', params: { points: 0 } })
        fixed('CLICKABLE_ADDED', `角色.${target.name}`, `規則要點擊「${target.name}」，已替它加上「點擊目標」。`)
      }
    }
    const actions = doList
      .map((text, actionIndex) => parseAction(text, `${where}.做[${actionIndex}]`))
      .filter((item): item is RuleAction => item !== undefined)
    if (when && actions.length > 0) rules.push({ when, actions })
  })

  const settings = pick(source, 'settings')
  const lives = Math.max(
    1,
    Math.round(
      number((isObject(settings) ? pick(settings, 'lives') : undefined) ?? pick(source, 'lives'), 3, '設定.生命'),
    ),
  )

  const rawTime = (isObject(settings) ? pick(settings, 'time') : undefined) ?? pick(source, 'time')
  let timeLimit = rawTime === undefined ? undefined : Math.max(1, Math.round(number(rawTime, 60, '設定.時間')))
  const usesTime = rules.some(
    (rule) =>
      rule.when.kind === 'time-up' ||
      (rule.when.kind === 'compare' && rule.when.variable === '時間') ||
      rule.actions.some((action) => action.kind === 'time'),
  )
  if (timeLimit === undefined && usesTime) {
    timeLimit = 60
    fixed('TIME_DEFAULTED', '設定.時間', '規則用到時間但沒有設定時間，先用 60 秒。')
  }

  // Numbers in settings that are not lives or time set custom counters' starting values.
  const variables: Record<string, number> = {}
  const settingValues = isObject(settings) ? settings : {}
  for (const [name, value] of Object.entries(settingValues)) {
    if (resolveAlias(name, KEY_ALIASES)) continue
    if (typeof value === 'number' || (typeof value === 'string' && Number.isFinite(Number(value))))
      variables[name] = Number(value)
  }
  for (const [name, { falls }] of counters) {
    if (name in variables) continue
    variables[name] = falls ? 10 : 0
    if (falls) fixed('VARIABLE_DEFAULTED', `設定.${name}`, `「${name}」沒有設定開始的數值，先用 10。`)
  }

  const rawUnsupported = pick(source, 'unsupported')
  const unsupported = (
    Array.isArray(rawUnsupported) ? rawUnsupported : rawUnsupported === undefined ? [] : [rawUnsupported]
  )
    .map(asText)
    .filter((text) => text.trim().length > 0)
  for (const text of unsupported)
    // Recorded for the report's `unsupported` list; not something the author can fix by editing the spec.
    fixed('UNSUPPORTED_REQUEST', '做不到', `作品沒有做到：${text}`)

  const hasGoal = entities.some((entity) => entity.behaviors.some((item) => item.name === 'goal'))
  const hasWinRule = rules.some((rule) => rule.actions.some((action) => action.kind === 'win'))
  if (!hasGoal && !hasWinRule)
    warn(
      'NO_WIN_CONDITION',
      '角色',
      '作品沒有過關方式。',
      '加一個有「終點」行為的角色，或加規則「分數 >= N → 過關」。',
    )

  const spec: SingleLevelSpec = {
    title,
    map,
    legend,
    wallChars: [...wallChars],
    entities,
    rules,
    lives,
    ...(timeLimit === undefined ? {} : { timeLimit }),
    unsupported,
    variables,
  }
  return { spec, diagnostics }
}

export { asText as fieldText, isObject as isJsonObject, pick as pickField, resolveAlias as resolveFieldAlias }
export { KEY_ALIASES }
