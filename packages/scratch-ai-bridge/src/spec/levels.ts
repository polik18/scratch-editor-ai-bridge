import {
  fieldText,
  isJsonObject,
  KEY_ALIASES,
  normalizeSingleLevel,
  pickField,
  type SingleLevelSpec,
} from './normalize'
import {
  MAX_LEVELS,
  type GameSpec,
  type SpecDiagnostic,
  type SpecEntity,
  type SpecLevel,
  type SpecRule,
} from './types'

type JsonObject = Record<string, unknown>

export interface NormalizeResult {
  readonly spec?: GameSpec
  readonly diagnostics: readonly SpecDiagnostic[]
}

/**
 * Field names that hold the level list. `關卡` and `地圖` also mean a single map, so only an array of objects counts;
 * models put the level list under either name.
 */
const LEVEL_KEYS = ['levels', 'stages', ...KEY_ALIASES.map].map((key) => key.toLowerCase())
const MAX_INSTRUCTION_LINES = 6
/** Characters per line on the opening card before a line wraps. */
export const INSTRUCTION_LINE_CHARS = 22
const ORDINALS = ['一', '二', '三']

const levelList = (raw: JsonObject): { readonly key: string; readonly levels: unknown[] } | undefined => {
  for (const [key, value] of Object.entries(raw))
    if (
      LEVEL_KEYS.includes(key.trim().toLowerCase()) &&
      Array.isArray(value) &&
      value.some((item) => isJsonObject(item))
    )
      return { key, levels: value }
  return undefined
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value])

const without = (object: JsonObject, keys: readonly string[]): JsonObject =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))

const keysOf = (object: JsonObject, field: keyof typeof KEY_ALIASES): string[] => {
  const aliases = KEY_ALIASES[field].map((alias) => alias.toLowerCase())
  return Object.keys(object).filter((key) => aliases.includes(key.trim().toLowerCase()))
}

// `分數 >= 100` and the like become `分數 >= 100 → 過關`; a full rule is kept as written.
const clearRule = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  return /→|->|=>/.test(value) ? value : `${value} → 過關`
}

const sameDiagnostic = (a: SpecDiagnostic, b: SpecDiagnostic): boolean =>
  a.code === b.code && a.where === b.where && a.message === b.message

const keyLabel = (key: string): string =>
  key === 'space' ? '空白鍵' : key.length === 1 ? `${key.toUpperCase()} 鍵` : key

const describeTrigger = (rule: SpecRule): string | undefined => {
  const when = rule.when
  switch (when.kind) {
    case 'score-at-least':
      return `分數達到 ${when.value}`
    case 'compare':
      return `${when.variable} ${when.op} ${when.value}`
    case 'touch':
    case 'collect':
      return `碰到「${when.entity}」`
    case 'time-up':
      return '撐到時間結束'
    case 'stomp':
      return `踩扁「${when.entity}」`
    case 'hit':
      return `射中「${when.entity}」`
    case 'click':
      return `點到「${when.entity}」`
    default:
      return undefined
  }
}

/**
 * @param level - A normalized level.
 * @returns Names of the entities its map actually draws.
 */
const drawnNames = (level: SpecLevel): Set<string> =>
  new Set(level.map.flatMap((row) => [...row].flatMap((char) => (level.legend[char] ? [level.legend[char]] : []))))

/**
 * How to win one level, in one short phrase.
 * @param level - A normalized level: its map, legend and rules.
 * @param entities - Entities of the game.
 * @returns The phrase, or undefined when the level has no way to win.
 */
const clearPhrase = (level: SpecLevel, entities: readonly SpecEntity[]): string | undefined => {
  const byRule = level.rules
    .filter((rule) => rule.actions.some((action) => action.kind === 'win'))
    .map(describeTrigger)
    .find(Boolean)
  if (byRule) return byRule
  const placed = drawnNames(level)
  const goal = entities.find(
    (entity) => placed.has(entity.name) && entity.behaviors.some((use) => use.name === 'goal'),
  )
  return goal ? `走到「${goal.name}」` : undefined
}

/**
 * The opening card's lines when the author wrote none: controls, what to collect or avoid, how to win, lives and time.
 * @param spec - Normalized spec without instructions.
 * @returns At most six short lines.
 */
export const defaultInstructions = (spec: Omit<GameSpec, 'instructions'>): string[] => {
  const lines: string[] = []
  const placedAnywhere = new Set(spec.levels.flatMap((level) => Object.values(level.legend)))
  for (const entity of spec.entities)
    for (const use of entity.behaviors) {
      if (use.name === 'platformer') lines.push('← → 移動，↑ 跳')
      if (use.name === 'topdown')
        lines.push(
          use.params.axis === 'horizontal' ? '← → 移動' : use.params.axis === 'vertical' ? '↑ ↓ 移動' : '方向鍵移動',
        )
      if (use.name === 'projectile') lines.push(`${keyLabel(use.params.key)}發射「${entity.name}」`)
    }
  const clickables = spec.entities.filter((entity) => entity.behaviors.some((use) => use.name === 'clickable'))
  if (clickables.length > 0) lines.push(`用滑鼠點「${clickables.map((entity) => entity.name).join('」「')}」得分`)
  const named = (name: string): string[] =>
    spec.entities
      .filter(
        (entity) =>
          entity.behaviors.some((use) => use.name === name) &&
          (placedAnywhere.has(entity.name) || entity.behaviors.some((use) => use.name === 'faller')),
      )
      .map((entity) => entity.name)
  const collect = named('collectible')
  if (collect.length > 0) lines.push(`收集「${collect.join('」「')}」得分`)
  const avoid = [...named('hazard'), ...named('patrol')]
  if (avoid.length > 0) lines.push(`小心「${[...new Set(avoid)].join('」「')}」`)
  const clears = spec.levels.map((level) => clearPhrase(level, spec.entities))
  if (spec.levels.length > 1)
    clears.forEach((phrase, index) => {
      if (phrase) lines.push(`第${ORDINALS[index]}關：${phrase}就過關`)
    })
  else if (clears[0]) lines.push(`${clears[0]}就過關`)
  const limits = [`${spec.lives} 條命`, ...(spec.timeLimit === undefined ? [] : [`限時 ${spec.timeLimit} 秒`])]
  lines.push(limits.join('，'))
  return [...new Set(lines)].slice(0, MAX_INSTRUCTION_LINES)
}

const levelFrom = (spec: SingleLevelSpec, name: string): SpecLevel => ({
  name,
  map: spec.map,
  legend: spec.legend,
  wallChars: spec.wallChars,
  rules: spec.rules,
})

/**
 * Raw spec → normalized spec with one or two levels and the opening card's lines. A spec with a plain `地圖` is one
 * level; `關卡: [{ 名稱, 地圖, 規則, 過關 }, …]` gives each level its own map and rules on top of the game-wide ones.
 * @param raw - Parsed spec JSON.
 * @returns The normalized spec and diagnostics.
 */
export const normalizeGameSpec = (raw: unknown): NormalizeResult => {
  const instructionsOf = (spec: Omit<GameSpec, 'instructions'>, source: JsonObject): string[] => {
    const written = asArray(pickField(source, 'instructions'))
      .flatMap((line) => fieldText(line).split('\n'))
      .map((line) => line.trim())
      .filter(Boolean)
    return written.length > 0 ? written : defaultInstructions(spec)
  }
  const found = isJsonObject(raw) ? levelList(raw) : undefined
  if (!isJsonObject(raw) || !found) {
    const single = normalizeSingleLevel(raw)
    if (!single.spec) return { diagnostics: single.diagnostics }
    const base = { ...single.spec, levels: [levelFrom(single.spec, '')] }
    const instructions = instructionsOf(base, isJsonObject(raw) ? raw : {})
    return {
      spec: { ...base, instructions },
      diagnostics: [...single.diagnostics, ...instructionWarnings(instructions)],
    }
  }

  const diagnostics: SpecDiagnostic[] = []
  if (found.levels.length > MAX_LEVELS)
    diagnostics.push({
      severity: 'error',
      code: 'TOO_MANY_LEVELS',
      where: found.key,
      message: `寫了 ${found.levels.length} 關，最多 ${MAX_LEVELS} 關。`,
      suggestion: `把關卡合併成 ${MAX_LEVELS} 關以內。`,
    })
  const outerMaps = keysOf(raw, 'map').filter((key) => key !== found.key)
  // Characters and settings belong to the whole game. Models often write them inside each level instead; those
  // are merged into the outer fields (outer values win), so every level sees the same characters.
  const outerName = { entities: '角色', settings: '設定' } as const
  const lifted: JsonObject = {}
  for (const field of ['entities', 'settings'] as const) {
    const merged: JsonObject = {}
    for (const item of found.levels) {
      const inner = isJsonObject(item) ? pickField(item, field) : undefined
      if (isJsonObject(inner)) Object.assign(merged, inner)
    }
    if (Object.keys(merged).length === 0) continue
    const outer = pickField(raw, field)
    const key = outerName[field]
    lifted[key] = { ...merged, ...(isJsonObject(outer) ? outer : {}) }
    diagnostics.push({
      severity: 'fixed',
      code: 'LEVEL_FIELD_LIFTED',
      where: found.key,
      message: `各關裡的「${key}」已合併到最外層，每一關都用同一組。`,
    })
  }
  const shared = {
    ...without(raw, [found.key, ...outerMaps, ...keysOf(raw, 'entities'), ...keysOf(raw, 'settings')]),
    ...lifted,
  }
  for (const field of ['entities', 'settings'] as const)
    if (!(outerName[field] in lifted)) {
      const outer = Object.entries(raw).find(([key]) => keysOf(raw, field).includes(key))
      if (outer) shared[outer[0]] = outer[1]
    }
  if (outerMaps.length > 0)
    diagnostics.push({
      severity: 'warning',
      code: 'MAP_OUTSIDE_LEVELS',
      where: '地圖',
      message: '有「關卡」時，最外層的「地圖」不會用到。',
      suggestion: '把地圖寫進各關的「地圖」。',
    })
  const sharedRules = asArray(pickField(raw, 'rules'))
  const sharedLegend = pickField(raw, 'legend')
  const entitiesRaw = pickField(shared, 'entities')
  const entityNames = Object.keys(isJsonObject(entitiesRaw) ? entitiesRaw : {})
  // Which entities each level draws, read from its map characters and legend before normalizing.
  const drawn = found.levels.slice(0, MAX_LEVELS).map((item) => {
    const level = isJsonObject(item) ? item : {}
    const levelLegend = pickField(level, 'legend')
    const legend: JsonObject = {
      ...(isJsonObject(sharedLegend) ? sharedLegend : {}),
      ...(isJsonObject(levelLegend) ? levelLegend : {}),
    }
    const names = new Set<string>()
    for (const char of new Set(asArray(pickField(level, 'map')).flatMap((row) => [...fieldText(row)]))) {
      const word = legend[char]
      if (typeof word === 'string') names.add(word)
      else for (const name of entityNames) if ([...name][0] === char) names.add(name)
    }
    return names
  })
  const results = found.levels.slice(0, MAX_LEVELS).map((item, index) => {
    const level = isJsonObject(item) ? item : {}
    const levelLegend = pickField(level, 'legend')
    const sharedLegend = pickField(raw, 'legend')
    const legend = {
      ...(isJsonObject(sharedLegend) ? sharedLegend : {}),
      ...(isJsonObject(levelLegend) ? levelLegend : {}),
    }
    const clear = pickField(level, 'clear')
    const rules = [...sharedRules, ...asArray(pickField(level, 'rules')), ...asArray(clear).map(clearRule)]
    const levelRaw: JsonObject = {
      ...without(shared, [...keysOf(shared, 'legend'), ...keysOf(shared, 'rules')]),
      地圖: pickField(level, 'map') ?? [],
      圖例: legend,
      規則: rules,
    }
    return {
      name: fieldText(pickField(level, 'title') ?? `第${ORDINALS[index]}關`),
      result: normalizeSingleLevel(levelRaw, {
        drawnElsewhere: new Set(
          drawn.flatMap((names, other) =>
            other === index ? [] : [...names].filter((name) => !drawn[index]?.has(name)),
          ),
        ),
      }),
    }
  })

  const first = results[0].result
  results.forEach(({ result }, index) => {
    const label = `第${ORDINALS[index]}關`
    for (const item of result.diagnostics) {
      if (index > 0 && first.diagnostics.some((earlier) => sameDiagnostic(earlier, item))) continue
      // Whether each level can be won is checked below, against what that level's map draws.
      if (item.code === 'NO_WIN_CONDITION') continue
      const perLevel = /^(地圖|圖例|規則)/.test(item.where)
      diagnostics.push({ ...item, where: perLevel ? `${label}.${item.where}` : item.where })
    }
  })
  const specs = results.flatMap(({ result }) => (result.spec ? [result.spec] : []))
  if (specs.length < results.length) return { diagnostics }

  const entities = [...specs[0].entities]
  for (const spec of specs.slice(1))
    for (const entity of spec.entities)
      if (!entities.some((known) => known.name === entity.name)) entities.push(entity)
  const levels = specs.map((spec, index) => levelFrom(spec, results[index]?.name ?? ''))
  levels.forEach((level, index) => {
    if (!clearPhrase(level, entities))
      diagnostics.push({
        severity: 'error',
        code: 'NO_WIN_CONDITION',
        where: levelLabel(index),
        message: '這一關沒有過關方式。',
        suggestion: '在這一關加「過關」，例如 "過關": "分數 >= 50"，或在地圖上畫一個「終點」角色。',
      })
  })
  diagnostics.push(...scoreThresholdErrors(levels))
  const variables = Object.assign({}, ...specs.map((spec) => spec.variables)) as Record<string, number>
  const base = { ...specs[0], entities, variables, levels }
  const instructions = instructionsOf(base, raw)
  diagnostics.push(...instructionWarnings(instructions))
  return { spec: { ...base, instructions }, diagnostics }
}

/**
 * Score keeps adding up across levels, so a later level that clears at a lower or equal score would end at once.
 * @param levels - Normalized levels.
 * @returns One error per level whose score target is not above the previous level's.
 */
const scoreThresholdErrors = (levels: readonly SpecLevel[]): SpecDiagnostic[] => {
  const target = (level: SpecLevel): number | undefined => {
    for (const rule of level.rules)
      if (rule.when.kind === 'score-at-least' && rule.actions.some((action) => action.kind === 'win'))
        return rule.when.value
    return undefined
  }
  const errors: SpecDiagnostic[] = []
  for (let index = 1; index < levels.length; index += 1) {
    const before = target(levels[index - 1])
    const now = target(levels[index])
    if (before !== undefined && now !== undefined && now <= before)
      errors.push({
        severity: 'error',
        code: 'LEVEL_SCORE_NOT_HIGHER',
        where: `第${ORDINALS[index]}關.過關`,
        message: `分數會累積到下一關，這一關的過關分數 ${now} 沒有比上一關的 ${before} 高，一開始就會過關。`,
        suggestion: `改成比 ${before} 大的分數，例如 ${before + now}。`,
      })
  }
  return errors
}

const instructionWarnings = (lines: readonly string[]): SpecDiagnostic[] => {
  const warnings: SpecDiagnostic[] = []
  if (lines.length > MAX_INSTRUCTION_LINES)
    warnings.push({
      severity: 'warning',
      code: 'INSTRUCTIONS_TOO_LONG',
      where: '說明',
      message: `說明有 ${lines.length} 行，開場畫面只放得下 ${MAX_INSTRUCTION_LINES} 行，多的會被省略。`,
      suggestion: `精簡成 ${MAX_INSTRUCTION_LINES} 行以內。`,
    })
  if (lines.some((line) => [...line].length > INSTRUCTION_LINE_CHARS))
    warnings.push({
      severity: 'warning',
      code: 'INSTRUCTION_LINE_LONG',
      where: '說明',
      message: `有說明超過 ${INSTRUCTION_LINE_CHARS} 個字，會自動換行。`,
      suggestion: '每行一件事，寫短一點。',
    })
  return warnings
}

/**
 * The spec as seen while one level is played: that level's map, legend, walls and rules at the top level.
 * Checks and scenarios written for single-map specs run unchanged on each view.
 * @param spec - Normalized spec.
 * @param index - Level index, from 0.
 * @returns A single-level spec for that level.
 */
export const levelView = (spec: GameSpec, index: number): GameSpec => {
  const level = spec.levels[index]
  return {
    ...spec,
    map: level.map,
    legend: level.legend,
    wallChars: level.wallChars,
    rules: level.rules,
    levels: [level],
  }
}

/**
 * @param index - Level index, from 0.
 * @returns The level's label used in diagnostics, e.g. 第二關.
 */
export const levelLabel = (index: number): string => `第${ORDINALS[index] ?? index + 1}關`
