/** Convert the supported GameDesign JSON contract into Canonical IR. */
import { getBlockCapability } from '../core/capabilities/registry.js'
import type { BlockDef, GameDesign } from '../core/ir/design-interface.js'
import type {
  CanonicalBlock,
  CanonicalBroadcast,
  CanonicalInput,
  CanonicalList,
  CanonicalProject,
  CanonicalScript,
  CanonicalSprite,
  CanonicalStage,
  CanonicalVariable,
} from '../core/ir/types.js'

const scalar = (value: unknown, path: string): string | number | boolean => {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new Error(`${path} must be a string, number, or boolean`)
  }
  return value
}

const assertKnownKeys = (value: object, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${path}/${key} is not supported`)
  }
}

const toBlock = (value: unknown, path: string): CanonicalBlock => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be a block object`)
  }
  const block = value as BlockDef
  assertKnownKeys(block, ['opcode', 'next', 'parent', 'inputs', 'fields'], path)
  if (typeof block.opcode !== 'string' || block.opcode.length === 0) {
    throw new Error(`${path}/opcode must be a non-empty string`)
  }
  if (block.next !== undefined || block.parent !== undefined) {
    throw new Error(
      `${path} uses raw next/parent links; GameDesign stacks are ordered by array position, use Canonical IR for explicit graph links`,
    )
  }

  const inputs: Record<string, CanonicalInput> = {}
  for (const [name, input] of Object.entries(block.inputs ?? {})) {
    inputs[name] = toInput(input, `${path}/inputs/${name}`)
  }

  const fields: Record<string, string | number | boolean> = {}
  for (const [name, field] of Object.entries(block.fields ?? {})) {
    fields[name] = scalar(field, `${path}/fields/${name}`)
  }

  return {
    opcode: block.opcode as CanonicalBlock['opcode'],
    ...(Object.keys(inputs).length ? { inputs } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
  }
}

const toInput = (value: unknown, path: string): CanonicalInput => {
  if (Array.isArray(value)) {
    return { type: 'stack', blocks: value.map((block, index) => toBlock(block, `${path}/${index}`)) }
  }
  if (value === null || value === undefined) throw new Error(`${path} cannot be null`)
  if (typeof value !== 'object') return { type: 'literal', value: scalar(value, path) }

  const record = value as Record<string, unknown>
  if (typeof record.type === 'string') {
    if (!['literal', 'variable', 'list', 'broadcast', 'block', 'stack'].includes(record.type)) {
      throw new Error(`${path}/type uses unsupported input type "${record.type}"`)
    }
    assertKnownKeys(record, ['type', 'value', 'name', 'block', 'blocks'], path)
    switch (record.type) {
      case 'literal':
        return { type: 'literal', value: scalar(record.value, `${path}/value`) }
      case 'variable':
      case 'list':
      case 'broadcast':
        if (typeof record.name !== 'string' || record.name.length === 0) {
          throw new Error(`${path}/name must be a non-empty string`)
        }
        return { type: record.type, name: record.name }
      case 'block':
        return { type: 'block', block: toBlock(record.block, `${path}/block`) }
      case 'stack':
        if (!Array.isArray(record.blocks)) throw new Error(`${path}/blocks must be an array`)
        return {
          type: 'stack',
          blocks: record.blocks.map((block, index) => toBlock(block, `${path}/blocks/${index}`)),
        }
      default:
        throw new Error(`${path}/type uses unsupported input type "${record.type}"`)
    }
  }

  if (Object.hasOwn(record, 'value') && Object.keys(record).every((key) => key === 'value')) {
    return { type: 'literal', value: scalar(record.value, `${path}/value`) }
  }
  throw new Error(`${path} must be a Canonical input, literal value, or array of blocks`)
}

const toScripts = (design: GameDesign, targetName: string): CanonicalScript[] =>
  (design.scripts ?? [])
    .map((script, scriptIndex) => ({ script, scriptIndex }))
    .filter(({ script }) => script.target === targetName)
    .map(({ script, scriptIndex }) => {
      if (!Array.isArray(script.blocks) || script.blocks.length === 0) {
        throw new Error(`/scripts/${scriptIndex}/blocks must contain at least one block`)
      }
      return {
        position: { x: script.x ?? 0, y: script.y ?? 0 },
        blocks: script.blocks.map((block, blockIndex) =>
          toBlock(block, `/scripts/${scriptIndex}/blocks/${blockIndex}`),
        ),
      }
    })

const toVariables = (design: GameDesign, sprite?: string): CanonicalVariable[] =>
  (design.variables ?? [])
    .filter((item) => item.sprite === sprite)
    .map((item, index) => {
      if (!item.name) throw new Error(`/variables/${index}/name must be a non-empty string`)
      return {
        name: item.name,
        value: scalar(item.value, `/variables/${index}/value`),
        ...(item.cloud ? { cloud: true } : {}),
      }
    })

const toLists = (design: GameDesign, sprite?: string): CanonicalList[] =>
  (design.lists ?? [])
    .filter((item) => item.sprite === sprite)
    .map((item, index) => {
      if (!item.name) throw new Error(`/lists/${index}/name must be a non-empty string`)
      if (!Array.isArray(item.values)) throw new Error(`/lists/${index}/values must be an array`)
      return {
        name: item.name,
        value: item.values.map((value, itemIndex) => scalar(value, `/lists/${index}/values/${itemIndex}`)),
      }
    })

const collectBroadcasts = (design: GameDesign): CanonicalBroadcast[] => {
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.type === 'broadcast' && typeof record.name === 'string') names.add(record.name)
    if (record.opcode === 'event_whenbroadcastreceived' && typeof record.fields === 'object' && record.fields) {
      const name = (record.fields as Record<string, unknown>).BROADCAST_OPTION
      if (typeof name === 'string') names.add(name)
    }
    Object.values(record).forEach(visit)
  }
  visit(design.scripts ?? [])
  return [...names].sort().map((name) => ({ name }))
}

const collectExtensions = (design: GameDesign): string[] => {
  const extensions = new Set(design.extensions ?? [])
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.opcode === 'string') {
      const capability = getBlockCapability(record.opcode)
      if (capability?.extensionId) extensions.add(capability.extensionId)
    }
    Object.values(record).forEach(visit)
  }
  visit(design.scripts ?? [])
  return [...extensions].sort()
}

const countDesignBlocks = (blocks: readonly BlockDef[]): number =>
  blocks.reduce((total, block) => {
    const nested = Object.values(block.inputs ?? {}).reduce<number>((count, input) => {
      if (Array.isArray(input)) return count + countDesignBlocks(input as BlockDef[])
      if (!input || typeof input !== 'object') return count
      const record = input as Record<string, unknown>
      if (record.type === 'block') return count + countDesignBlocks([record.block as BlockDef])
      if (record.type === 'stack' && Array.isArray(record.blocks))
        return count + countDesignBlocks(record.blocks as BlockDef[])
      return count
    }, 0)
    return total + 1 + nested
  }, 0)

const assertUniqueNames = (values: readonly { name: string }[], path: string): void => {
  const names = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (!value.name.trim()) throw new Error(`${path}/${index}/name must not be empty`)
    if (names.has(value.name)) throw new Error(`${path}/${index}/name duplicates "${value.name}"`)
    names.add(value.name)
  }
}

const assertScopedUniqueNames = (values: readonly { name: string; sprite?: string }[], path: string): void => {
  const namesByTarget = new Map<string, Set<string>>()
  for (const [index, value] of values.entries()) {
    if (!value.name.trim()) throw new Error(`${path}/${index}/name must not be empty`)
    const target = value.sprite ?? 'Stage'
    const names = namesByTarget.get(target) ?? new Set<string>()
    if (names.has(value.name))
      throw new Error(`${path}/${index}/name duplicates "${value.name}" on target "${target}"`)
    names.add(value.name)
    namesByTarget.set(target, names)
  }
}

/** Convert a validated GameDesign object to Canonical IR without dropping nested data. */
export function designToCanonicalIR(design: GameDesign): CanonicalProject {
  if (!design || typeof design !== 'object') throw new Error('Game design must be an object')
  assertKnownKeys(
    design,
    [
      'id',
      'title',
      'type',
      'sprites',
      'blocks',
      'difficulty',
      'version',
      'created',
      'designDoc',
      'outputSb3',
      'outputJson',
      'stage',
      'extensions',
      'spritesDef',
      'variables',
      'lists',
      'scripts',
    ],
    '',
  )
  if (typeof design.title !== 'string' || !design.title.trim()) throw new Error('/title must be a non-empty string')
  if (design.spritesDef !== undefined && !Array.isArray(design.spritesDef)) {
    throw new Error('/spritesDef must be an array; the legacy sprites count is metadata only')
  }
  for (const [index, sprite] of (design.spritesDef ?? []).entries()) {
    assertKnownKeys(
      sprite,
      [
        'name',
        'costumes',
        'x',
        'y',
        'direction',
        'size',
        'visible',
        'draggable',
        'rotationStyle',
        'currentCostume',
        'volume',
      ],
      `/spritesDef/${index}`,
    )
    if (typeof sprite.name !== 'string') throw new Error(`/spritesDef/${index}/name must be a string`)
  }
  if (design.stage)
    assertKnownKeys(
      design.stage,
      ['name', 'costumes', 'currentCostume', 'tempo', 'videoTransparency', 'videoState'],
      '/stage',
    )
  if (
    design.extensions !== undefined &&
    (!Array.isArray(design.extensions) || design.extensions.some((id) => typeof id !== 'string' || !id))
  ) {
    throw new Error('/extensions must be an array of non-empty strings')
  }
  if (design.variables !== undefined && !Array.isArray(design.variables))
    throw new Error('/variables must be an array')
  if (design.lists !== undefined && !Array.isArray(design.lists)) throw new Error('/lists must be an array')
  if (design.scripts !== undefined && !Array.isArray(design.scripts)) throw new Error('/scripts must be an array')
  for (const [index, variable] of (design.variables ?? []).entries()) {
    assertKnownKeys(variable, ['name', 'value', 'sprite', 'cloud'], `/variables/${index}`)
  }
  for (const [index, list] of (design.lists ?? []).entries()) {
    assertKnownKeys(list, ['name', 'values', 'sprite'], `/lists/${index}`)
  }
  for (const [index, script] of (design.scripts ?? []).entries()) {
    assertKnownKeys(script, ['target', 'x', 'y', 'blocks'], `/scripts/${index}`)
  }
  assertUniqueNames(design.spritesDef ?? [], '/spritesDef')
  assertScopedUniqueNames(design.variables ?? [], '/variables')
  assertScopedUniqueNames(design.lists ?? [], '/lists')

  const stageName = design.stage?.name || 'Stage'
  const spriteNames = new Set((design.spritesDef ?? []).map(({ name }) => name))
  if (spriteNames.has(stageName))
    throw new Error(`/spritesDef contains a sprite named "${stageName}", which conflicts with the Stage target`)
  for (const [index, script] of (design.scripts ?? []).entries()) {
    if (script.target !== stageName && !spriteNames.has(script.target))
      throw new Error(`/scripts/${index}/target references unknown sprite or Stage target "${script.target}"`)
  }
  for (const [kind, entries] of [
    ['variables', design.variables ?? []],
    ['lists', design.lists ?? []],
  ] as const) {
    for (const [index, entry] of entries.entries()) {
      if (entry.sprite && !spriteNames.has(entry.sprite)) {
        throw new Error(`/${kind}/${index}/sprite references unknown sprite "${entry.sprite}"`)
      }
    }
  }

  const sprites: CanonicalSprite[] = (design.spritesDef ?? []).map((sprite) => ({
    kind: 'sprite',
    name: sprite.name,
    x: sprite.x ?? 0,
    y: sprite.y ?? 0,
    direction: sprite.direction ?? 90,
    size: sprite.size ?? 100,
    visible: sprite.visible ?? true,
    draggable: sprite.draggable ?? false,
    rotationStyle: sprite.rotationStyle ?? 'all around',
    currentCostume: sprite.currentCostume ?? 0,
    volume: sprite.volume ?? 100,
    costumes: (sprite.costumes?.length ? sprite.costumes : [`${sprite.name} costume`]).map((name) => ({
      name,
      dataFormat: 'svg',
    })),
    sounds: [],
    variables: toVariables(design, sprite.name),
    lists: toLists(design, sprite.name),
    scripts: toScripts(design, sprite.name),
    procedures: [],
  }))

  const stageDef = design.stage
  const stageCostumes = stageDef?.costumes?.length ? stageDef.costumes : ['backdrop1']
  const stage: CanonicalStage = {
    kind: 'stage',
    name: stageDef?.name || 'Stage',
    tempo: stageDef?.tempo ?? 60,
    videoTransparency: stageDef?.videoTransparency ?? 50,
    videoState: stageDef?.videoState,
    textToSpeechLanguage: 'en',
    currentCostume: stageDef?.currentCostume ?? 0,
    volume: 100,
    costumes: stageCostumes.map((name) => ({ name, dataFormat: 'svg' })),
    sounds: [],
    variables: toVariables(design),
    lists: toLists(design),
    scripts: toScripts(design, stageDef?.name || 'Stage'),
    procedures: [],
  }

  const actualBlocks = (design.scripts ?? []).reduce((count, script) => count + countDesignBlocks(script.blocks), 0)
  if (design.sprites !== undefined && design.sprites > 0 && design.sprites !== sprites.length) {
    throw new Error(`/sprites declares ${design.sprites}, but /spritesDef contains ${sprites.length}`)
  }
  if (design.blocks !== undefined && design.blocks > 0 && design.blocks !== actualBlocks) {
    throw new Error(`/blocks declares ${design.blocks}, but /scripts contains ${actualBlocks} top-level blocks`)
  }

  return {
    format: 'scratch-ai-bridge/canonical-ir',
    version: 1,
    name: design.title,
    stage,
    sprites,
    broadcasts: collectBroadcasts(design),
    extensions: collectExtensions(design),
    meta: { version: design.version || '1.0', scratch: '3.0', language: 'en' },
    monitors: [],
  }
}
