import type {
  BehaviorUse,
  GameSpec,
  Level,
  Look,
  RuleAction,
  RuleTrigger,
  SpecDiagnostic,
  SpecEntity,
  SpecRule,
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
}

const BEHAVIOR_ALIASES: Record<BehaviorUse['name'], readonly string[]> = {
  platformer: ['platformer', 'platform', 'jumper', '平台移動', '平台跳躍', '跳躍移動', '橫向移動'],
  topdown: ['topdown', 'top-down', 'top down', '俯視移動', '四方向移動', '上下左右移動', '迷宮移動'],
  patrol: ['patrol', 'enemy', 'walker', '巡邏', '來回巡邏', '敵人', '來回走'],
  collectible: ['collectible', 'collect', 'pickup', 'item', '收集品', '收集', '道具', '寶物'],
  hazard: ['hazard', 'danger', 'trap', 'spike', '危險物', '陷阱', '尖刺', '危險'],
  goal: ['goal', 'exit', 'finish', 'flag', '終點', '出口', '目標', '旗子'],
}

const PARAM_ALIASES: Record<string, readonly string[]> = {
  jump: ['jump', 'jumpheight', '跳躍', '跳', '跳躍力', '跳躍高度'],
  speed: ['speed', '速度'],
  range: ['range', 'distance', '範圍', '距離'],
  stompable: ['stompable', 'stomp', '可踩扁', '可踩', '踩扁'],
  points: ['points', 'score', 'value', '分數', '分', '點數'],
}

const LEVEL_ALIASES: Record<Level, readonly string[]> = {
  low: ['low', 'slow', 'small', 'weak', '1', '低', '慢', '小', '弱'],
  mid: ['mid', 'medium', 'normal', 'default', '2', '中', '普通', '一般'],
  high: ['high', 'fast', 'big', 'strong', '3', '高', '快', '大', '強'],
}

/** Name words that strongly imply a behavior, for entities that appear only in the legend. */
const BEHAVIOR_GUESSES: readonly [Exclude<BehaviorUse['name'], 'platformer' | 'topdown'>, RegExp][] = [
  ['goal', /終點|旗|出口|目標|goal|flag|exit|finish/i],
  ['hazard', /陷阱|尖刺|刺|岩漿|火焰|炸彈|trap|spike|lava|bomb/i],
  ['patrol', /敵|怪|史萊姆|蝙蝠|enemy|monster|slime/i],
  ['collectible', /星|金幣|硬幣|錢|寶石|寶物|鑰匙|蘋果|起司|coin|star|gem|key|apple|item/i],
]

const LOOKS: readonly Look[] = ['hero', 'slime', 'coin', 'spike', 'flag', 'box', 'key', 'star']
const DEFAULT_LOOK: Record<BehaviorUse['name'], Look> = {
  platformer: 'hero',
  topdown: 'hero',
  patrol: 'slime',
  collectible: 'coin',
  hazard: 'spike',
  goal: 'flag',
}

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
 * treats it as written before the closer that follows it (two closers in the wrong order).
 * @param text - JSON text with possibly mismatched brackets.
 * @param strategy - How to read a closer that does not match.
 * @returns Text whose brackets nest.
 */
const rebalanceJson = (text: string, strategy: 'close-open' | 'swap'): string => {
  const closer: Record<string, string> = { '{': '}', '[': ']' }
  const stack: string[] = []
  let out = ''
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === '\\') out += text[(index += 1)] ?? ''
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
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
export const extractJson = (text: string): { readonly value: Json; readonly repaired: boolean } => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('找不到 JSON 物件：請只輸出一個 { … } 的作品描述。')
  const body = text.slice(start, end + 1)
  try {
    return { value: JSON.parse(body), repaired: false }
  } catch (error) {
    const candidates = (['close-open', 'swap'] as const).flatMap((strategy) => {
      try {
        return [JSON.parse(rebalanceJson(body, strategy)) as Json]
      } catch {
        return []
      }
    })
    if (candidates.length === 0) throw error
    const best = candidates.reduce((left, right) => (recognizedFields(right) > recognizedFields(left) ? right : left))
    return { value: best, repaired: true }
  }
}

export interface NormalizeResult {
  readonly spec?: GameSpec
  readonly diagnostics: readonly SpecDiagnostic[]
}

export const normalizeGameSpec = (raw: Json): NormalizeResult => {
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

  const title = asText(pick(raw, 'title') ?? '我的作品')

  // ---------- level of a parameter ----------
  const level = (value: Json, where: string): Level => {
    if (value === undefined) return 'mid'
    const found = resolveAlias(asText(value), LEVEL_ALIASES)
    if (found) return found.key
    warn('UNKNOWN_LEVEL', where, `看不懂等級「${asText(value)}」，先用「中」。`, '使用 低／中／高。')
    return 'mid'
  }
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
  const behavior = (entry: Json, where: string): BehaviorUse | undefined => {
    let nameWord: string | undefined
    let params: JsonObject = {}
    if (typeof entry === 'string') nameWord = entry
    else if (isObject(entry)) {
      const keys = Object.keys(entry)
      const explicit = entry.name ?? entry.type ?? entry['名稱']
      if (typeof explicit === 'string') {
        nameWord = explicit
        params = entry
      } else if (keys.length === 1) {
        nameWord = keys[0]
        params = isObject(entry[keys[0]]) ? (entry[keys[0]] as JsonObject) : {}
      }
    }
    if (!nameWord) {
      error(
        'BEHAVIOR_SHAPE',
        where,
        '行為要寫成名稱字串，或 { "行為名稱": { 參數 } }。',
        '例如 "收集品" 或 { "收集品": { "分數": 10 } }。',
      )
      return undefined
    }
    const resolved = resolveAlias(nameWord, BEHAVIOR_ALIASES)
    if (!resolved) {
      error(
        'UNKNOWN_BEHAVIOR',
        where,
        `沒有「${nameWord}」這個行為。`,
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
        return { name: 'topdown', params: { speed: level(param.speed, `${where}.速度`) } }
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
    }
  }

  // ---------- entities ----------
  const rawEntities = pick(raw, 'entities')
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

  const entities: SpecEntity[] = []
  for (const [name, definition] of entityEntries) {
    const where = `角色.${name}`
    let rawBehaviors: Json = isObject(definition) ? pick(definition, 'behaviors') : definition
    if (rawBehaviors === undefined) rawBehaviors = []
    const list = Array.isArray(rawBehaviors) ? rawBehaviors : [rawBehaviors]
    const behaviors = list
      .map((entry, index) => behavior(entry, `${where}.行為[${index}]`))
      .filter((item): item is BehaviorUse => item !== undefined)
    const lookWord = isObject(definition) ? pick(definition, 'look') : undefined
    const look =
      typeof lookWord === 'string' && LOOKS.includes(lookWord as Look)
        ? (lookWord as Look)
        : behaviors[0]
          ? DEFAULT_LOOK[behaviors[0].name]
          : 'box'
    const color = isObject(definition) ? pick(definition, 'color') : undefined
    entities.push({ name, behaviors, look, ...(typeof color === 'string' ? { color } : {}) })
  }
  const entityNames = entities.map((entity) => entity.name)
  const resolveEntity = (word: string, where: string): string | undefined => {
    if (entityNames.includes(word)) return word
    const near = closestName(word, entityNames)
    if (near) {
      fixed('ENTITY_NAME', where, `「${word}」視為角色「${near}」。`)
      return near
    }
    error('UNKNOWN_ENTITY', where, `沒有叫「${word}」的角色。`, `目前的角色：${entityNames.join('、') || '（無）'}。`)
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
    const look: Look = /星|star/i.test(name) ? 'star' : guess ? DEFAULT_LOOK[guess] : 'box'
    entities.push({ name, behaviors, look })
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

  const players = entities.filter((entity) =>
    entity.behaviors.some((item) => item.name === 'platformer' || item.name === 'topdown'),
  )
  if (players.length === 0)
    error('NO_PLAYER', '角色', '沒有玩家可以操控的角色。', '替主角加上行為「平台移動」或「俯視移動」。')
  if (players.length > 1)
    error(
      'MULTIPLE_PLAYERS',
      '角色',
      `有 ${players.length} 個玩家角色（${players.map((item) => item.name).join('、')}），目前只支援一個。`,
      '只保留一個角色有「平台移動」或「俯視移動」。',
    )

  // ---------- map and legend ----------
  const rawMap = pick(raw, 'map')
  let map: string[] = Array.isArray(rawMap)
    ? rawMap.map(String)
    : typeof rawMap === 'string'
      ? rawMap.split('\n')
      : []
  map = map
    .map((row) => row.replace(/\s+$/, ''))
    .filter((row, index, rows) => row.length > 0 || index < rows.length - 1)
  while (map.length > 0 && map[0].trim() === '') map.shift()
  if (map.length === 0) error('NO_MAP', '地圖', '沒有地圖。', '用文字畫出關卡，例如 "地圖": ["P...G", "#####"]。')
  const legend: Record<string, string> = {}
  const wallChars = new Set(DEFAULT_WALL_CHARS)
  const rawLegend = pick(raw, 'legend')
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
  if (map.length > MAP_MAX_ROWS)
    error(
      'MAP_TOO_TALL',
      '地圖',
      `地圖有 ${map.length} 列，最多 ${MAP_MAX_ROWS} 列。`,
      `刪掉 ${map.length - MAP_MAX_ROWS} 列。`,
    )
  const width = Math.max(0, ...map.map((row) => [...row].length))
  if (width > MAP_MAX_COLUMNS) {
    if (map.every((row) => [...row].slice(MAP_MAX_COLUMNS).every(droppable))) {
      map = map.map((row) => [...row].slice(0, MAP_MAX_COLUMNS).join(''))
      fixed('MAP_CROPPED', '地圖', `地圖超過 ${MAP_MAX_COLUMNS} 欄，已裁掉右邊只有空白或牆的部分。`)
    } else
      error(
        'MAP_TOO_WIDE',
        '地圖',
        `地圖最寬 ${width} 欄，最多 ${MAP_MAX_COLUMNS} 欄。`,
        `每列縮短到 ${MAP_MAX_COLUMNS} 個字。`,
      )
  }
  if (croppedRows > 0)
    fixed('MAP_CROPPED', '地圖', `地圖超過 ${MAP_MAX_ROWS} 列，已刪掉最上面 ${croppedRows} 列空白。`)
  const columns = Math.min(MAP_MAX_COLUMNS, Math.max(0, ...map.map((row) => [...row].length)))
  map = map.map((row) => [...row].concat(Array(Math.max(0, columns - [...row].length)).fill('.')).join(''))

  // A player that is described but not drawn is placed where it can start: on the leftmost floor for platformers,
  // in the first open cell for top-down games.
  const player = players.length === 1 ? players[0] : undefined
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
      for (let row = 0; row < map.length && !spot; row += 1)
        for (let column = 0; column < columns && !spot; column += 1) if (open(row, column)) spot = { row, column }
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
    const placed = Object.entries(legend).some(([char, name]) => name === entity.name && used.has(char))
    if (!placed)
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
    const verbs: [RuleTrigger['kind'], RegExp][] = [
      ['collect', /(collects?|收集|吃到|拿到|撿到|吃)\s*(.+)$/i],
      ['stomp', /(stomps?|踩扁|踩到|踩)\s*(.+)$/i],
      ['touch', /(touch(?:es)?|reach(?:es)?|碰到|抵達|到達|走到)\s*(.+)$/i],
    ]
    for (const [kind, pattern] of verbs) {
      const match = pattern.exec(t)
      if (match) {
        const entity = resolveEntity(match[2].trim(), where)
        return entity ? ({ kind, entity } as RuleTrigger) : undefined
      }
    }
    error(
      'UNKNOWN_TRIGGER',
      where,
      `看不懂條件「${text}」。`,
      '可用：開始、時間到、收集 X、碰到 X、踩扁 X、分數 >= N。',
    )
    return undefined
  }
  const parseAction = (text: string, where: string): RuleAction | undefined => {
    const t = text.trim()
    const change = /^(score|分數|lives|生命)\s*([+-]\s*\d+)$/i.exec(t)
    if (change)
      return { kind: /score|分數/i.test(change[1]) ? 'score' : 'lives', delta: Number(change[2].replace(/\s/g, '')) }
    const speech = /^(say|說|顯示|show)\s*[:：]?\s*["「]?(.+?)["」]?$/i.exec(t)
    if (speech) return { kind: 'say', text: speech[2] }
    if (/^(win|勝利|過關|贏)$/i.test(t)) return { kind: 'win' }
    if (/^(lose|失敗|輸|遊戲結束|game over)$/i.test(t)) return { kind: 'lose' }
    error('UNKNOWN_ACTION', where, `看不懂動作「${text}」。`, '可用：分數 +N、生命 -N、說 文字、過關、失敗。')
    return undefined
  }

  const rules: SpecRule[] = []
  const rawRules = pick(raw, 'rules')
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
      error(
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
    const actions = doList
      .map((text, actionIndex) => parseAction(text, `${where}.做[${actionIndex}]`))
      .filter((item): item is RuleAction => item !== undefined)
    if (when && actions.length > 0) rules.push({ when, actions })
  })

  const settings = pick(raw, 'settings')
  const lives = Math.max(
    1,
    Math.round(
      number((isObject(settings) ? pick(settings, 'lives') : undefined) ?? pick(raw, 'lives'), 3, '設定.生命'),
    ),
  )

  const rawTime = (isObject(settings) ? pick(settings, 'time') : undefined) ?? pick(raw, 'time')
  let timeLimit = rawTime === undefined ? undefined : Math.max(1, Math.round(number(rawTime, 60, '設定.時間')))
  if (timeLimit === undefined && rules.some((rule) => rule.when.kind === 'time-up')) {
    timeLimit = 60
    fixed('TIME_DEFAULTED', '設定.時間', '規則用到「時間到」但沒有設定時間，先用 60 秒。')
  }

  const hasGoal = entities.some((entity) => entity.behaviors.some((item) => item.name === 'goal'))
  const hasWinRule = rules.some((rule) => rule.actions.some((action) => action.kind === 'win'))
  if (!hasGoal && !hasWinRule)
    warn(
      'NO_WIN_CONDITION',
      '角色',
      '作品沒有過關方式。',
      '加一個有「終點」行為的角色，或加規則「分數 >= N → 過關」。',
    )

  const spec: GameSpec = {
    title,
    map,
    legend,
    wallChars: [...wallChars],
    entities,
    rules,
    lives,
    ...(timeLimit === undefined ? {} : { timeLimit }),
  }
  return { spec, diagnostics }
}
