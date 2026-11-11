/**
 * Plain-language help for editing the values of an imported project by hand: Chinese names, which items are the
 * program's own bookkeeping, whether the game's scripts set the value again (so a change would not last), and the
 * lines of script an AI needs to explain what a value does.
 */

type Json = Record<string, unknown>

export type ValueKind = 'number' | 'boolean' | 'text' | 'costume' | 'direction'

export interface ValueItem {
  /** `x`, `size`, … or `variable:<id>`. */
  readonly key: string
  readonly label: string
  readonly value: string | number | boolean
  readonly kind: ValueKind
  readonly hint?: string
  /** Costume names, for `costume`. */
  readonly options?: readonly string[]
  /** Hidden unless the student asks for everything. */
  readonly internal: boolean
}

const PROPERTIES: Readonly<
  Partial<
    Record<
      string,
      { readonly label: string; readonly kind: ValueKind; readonly hint?: string; readonly sets: readonly string[] }
    >
  >
> = {
  x: {
    label: 'x 座標（左右位置）',
    kind: 'number',
    hint: '-240 是最左邊，240 是最右邊',
    sets: [
      'motion_gotoxy',
      'motion_setx',
      'motion_changexby',
      'motion_goto',
      'motion_glidesecstoxy',
      'motion_glideto',
    ],
  },
  y: {
    label: 'y 座標（上下位置）',
    kind: 'number',
    hint: '-180 是最下面，180 是最上面',
    sets: [
      'motion_gotoxy',
      'motion_sety',
      'motion_changeyby',
      'motion_goto',
      'motion_glidesecstoxy',
      'motion_glideto',
    ],
  },
  direction: {
    label: '方向',
    kind: 'direction',
    hint: '90 向右、-90 向左、0 向上、180 向下',
    sets: ['motion_pointindirection', 'motion_pointtowards', 'motion_turnright', 'motion_turnleft'],
  },
  size: {
    label: '大小（%）',
    kind: 'number',
    hint: '100 是原本的大小',
    sets: ['looks_setsizeto', 'looks_changesizeby'],
  },
  visible: { label: '顯示或隱藏', kind: 'boolean', sets: ['looks_show', 'looks_hide'] },
  currentCostume: {
    label: '造型',
    kind: 'costume',
    sets: ['looks_switchcostumeto', 'looks_nextcostume', 'looks_switchbackdropto', 'looks_nextbackdrop'],
  },
  volume: {
    label: '音量（%）',
    kind: 'number',
    hint: '0 到 100',
    sets: ['sound_setvolumeto', 'sound_changevolumeby'],
  },
  tempo: { label: '節奏（每分鐘拍數）', kind: 'number', sets: ['music_setTempo', 'music_changeTempo'] },
}

const STAGE_PROPERTIES = ['currentCostume', 'volume', 'tempo']
const SPRITE_PROPERTIES = ['x', 'y', 'direction', 'size', 'visible', 'currentCostume', 'volume']

/** Variables a Bridge game keeps for its own physics; they change every frame. */
const BRIDGE_PHYSICS = new Set(['vx', 'onGround', 'invincible'])

const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter((item): item is Json => typeof item === 'object' && item !== null) : []
const asRecord = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}

/**
 * @param projectJson - project.json of the SB3.
 * @returns Whether Bridge generated the game, so its bookkeeping sprites and physics variables can be hidden.
 */
export const isBridgeGame = (projectJson: Json): boolean =>
  records(projectJson.targets).some((target) => target.name === '_Walls' || target.name === '_Banner')

/**
 * @param name - Sprite name.
 * @returns Whether the sprite is the program's own bookkeeping (walls, banners, intro card).
 */
export const isInternalTarget = (name: string): boolean => name.startsWith('_')

/**
 * @param projectJson - project.json of the SB3.
 * @param targetName - Sprite or stage name.
 * @returns The values a student can change on that target, in a sensible order.
 */
export const valueItems = (projectJson: Json, targetName: string): ValueItem[] => {
  const target = records(projectJson.targets).find((item) => item.name === targetName)
  if (!target) return []
  const bridge = isBridgeGame(projectJson)
  const items: ValueItem[] = []
  for (const [id, entry] of Object.entries(asRecord(target.variables))) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[2] === true) continue
    const value: unknown = entry[1]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    items.push({
      key: `variable:${id}`,
      label: `變數「${entry[0]}」`,
      value,
      kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text',
      internal: entry[0].startsWith('_') || (bridge && BRIDGE_PHYSICS.has(entry[0])),
    })
  }
  const costumes = records(target.costumes).map((costume) => (typeof costume.name === 'string' ? costume.name : ''))
  for (const key of target.isStage === true ? STAGE_PROPERTIES : SPRITE_PROPERTIES) {
    const value: unknown = target[key]
    const property = PROPERTIES[key]
    if (!property || (typeof value !== 'number' && typeof value !== 'boolean')) continue
    items.push({
      key,
      label: target.isStage === true && key === 'currentCostume' ? '背景' : property.label,
      value,
      kind: property.kind,
      ...(property.hint ? { hint: property.hint } : {}),
      ...(property.kind === 'costume' ? { options: costumes } : {}),
      internal: false,
    })
  }
  return items
}

const variableId = (key: string): string | undefined => (key.startsWith('variable:') ? key.slice(9) : undefined)

const hatOf = (blocks: Json, id: string): Json | undefined => {
  let block = asRecord(blocks[id])
  for (let guard = 0; guard < 500 && typeof block.parent === 'string'; guard += 1)
    block = asRecord(blocks[block.parent])
  return block
}

const literal = (input: unknown): string | undefined => {
  if (!Array.isArray(input)) return undefined
  const shadow: unknown = input[1]
  return Array.isArray(shadow) && (typeof shadow[1] === 'string' || typeof shadow[1] === 'number')
    ? String(shadow[1])
    : undefined
}

const usesVariable = (block: Json, id: string): boolean =>
  (Array.isArray(asRecord(block.fields).VARIABLE) && (asRecord(block.fields).VARIABLE as unknown[])[1] === id) ||
  Object.values(asRecord(block.inputs)).some(
    (input) => Array.isArray(input) && input.some((part) => Array.isArray(part) && part[0] === 12 && part[2] === id),
  )

/**
 * Whether the game's own scripts set this value, so a change made here would not last.
 * @param projectJson - project.json of the SB3.
 * @param targetName - Sprite or stage name.
 * @param key - From {@link ValueItem.key}.
 * @returns A sentence for the student, or undefined when nothing sets it.
 */
export const resetNote = (projectJson: Json, targetName: string, key: string): string | undefined => {
  const id = variableId(key)
  const sets = id ? ['data_setvariableto', 'data_changevariableby'] : (PROPERTIES[key]?.sets ?? [])
  const targets = records(projectJson.targets)
  const owner = targets.find((item) => item.name === targetName)
  const scope = id || (owner?.isStage === true && key === 'currentCostume') ? targets : owner ? [owner] : []
  let atStart: string | undefined
  let during = false
  for (const target of scope) {
    const blocks = asRecord(target.blocks)
    for (const [blockId, raw] of Object.entries(blocks)) {
      const block = asRecord(raw)
      if (typeof block.opcode !== 'string' || !sets.includes(block.opcode)) continue
      if (id && !usesVariable(block, id)) continue
      if (owner?.isStage === true && key === 'currentCostume' && !block.opcode.includes('backdrop')) continue
      if (hatOf(blocks, blockId)?.opcode === 'event_whenflagclicked' && block.opcode !== 'data_changevariableby')
        atStart ??= literal(asRecord(block.inputs).VALUE) ?? ''
      else during = true
    }
  }
  if (atStart !== undefined)
    return `按綠旗開始時，程式會把它設${atStart ? `成 ${atStart}` : '定好'}，所以在這裡改，重玩後會變回去。`
  return during ? '遊戲進行中，程式會改變它；在這裡改只影響現在這一刻。' : undefined
}

const describe = (block: Json): string => {
  const fields = Object.entries(asRecord(block.fields))
    .map(([name, value]) => `${name}=${Array.isArray(value) ? String(value[0]) : String(value)}`)
    .join(' ')
  const inputs = Object.entries(asRecord(block.inputs))
    .map(([name, value]) => {
      const text = literal(value)
      return text === undefined ? '' : `${name}=${text}`
    })
    .filter(Boolean)
    .join(' ')
  return [String(block.opcode), fields, inputs].filter(Boolean).join(' ')
}

/**
 * The script lines that touch a value, as short text an AI can read.
 * @param projectJson - project.json of the SB3.
 * @param targetName - Sprite or stage name.
 * @param key - From {@link ValueItem.key}.
 * @param limit - Most lines to return.
 * @returns Lines like 「香魚｜event_whenflagclicked → data_setvariableto VARIABLE=生命 VALUE=3」.
 */
export const usageLines = (projectJson: Json, targetName: string, key: string, limit = 24): string[] => {
  const id = variableId(key)
  const sets = id ? [] : (PROPERTIES[key]?.sets ?? [])
  const targets = records(projectJson.targets)
  const scope = id ? targets : targets.filter((item) => item.name === targetName)
  const lines: string[] = []
  for (const target of scope) {
    const blocks = asRecord(target.blocks)
    for (const [blockId, raw] of Object.entries(blocks)) {
      const block = asRecord(raw)
      if (typeof block.opcode !== 'string') continue
      if (id ? !usesVariable(block, id) : !sets.includes(block.opcode)) continue
      const hat = hatOf(blocks, blockId)
      const parent = asRecord(blocks[String(block.parent)])
      lines.push(
        `${String(target.name)}｜${hat ? describe(hat) : '?'} → ${
          parent.opcode && parent !== hat ? `${describe(parent)} → ` : ''
        }${describe(block)}`,
      )
      if (lines.length >= limit) return lines
    }
  }
  return lines
}

/**
 * @param item - The value the student picked.
 * @param targetName - Its sprite or stage.
 * @param lines - From {@link usageLines}.
 * @param note - From {@link resetNote}.
 * @returns A prompt asking for a two-sentence explanation a 10-year-old understands.
 */
export const createValueExplanationPrompt = (
  item: ValueItem,
  targetName: string,
  lines: readonly string[],
  note: string | undefined,
): string => `你在幫國小學生看懂 Scratch 作品裡的一個數值。用繁體中文，最多兩句話，說明它在遊戲裡代表什麼、改大或改小會怎樣。
不要寫程式碼，不要提到 opcode 或積木的英文名稱；看不出來就說「看不出來它的用途」。

角色：${targetName}
數值：${item.label}，目前是 ${String(item.value)}
${note ? `已知：${note}\n` : ''}用到它的程式（每行是「角色｜事件 → 上一個積木 → 這個積木」）：
${lines.length > 0 ? lines.join('\n') : '（沒有程式用到它）'}`
