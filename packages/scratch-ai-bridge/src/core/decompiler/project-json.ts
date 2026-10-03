import type { ScratchProjectJson } from '../compiler/project-json'
import {
  CANONICAL_IR_FORMAT,
  CANONICAL_IR_VERSION,
  type CanonicalBlock,
  type CanonicalCostume,
  type CanonicalInput,
  type CanonicalList,
  type CanonicalProject,
  type CanonicalScalar,
  type CanonicalScript,
  type CanonicalSound,
  type CanonicalVariable,
} from '../ir/types'

interface RawScratchBlock {
  opcode: string
  next?: string | null
  parent?: string | null
  inputs?: Record<string, unknown>
  fields?: Record<string, unknown>
  shadow?: boolean
  topLevel?: boolean
  x?: number
  y?: number
  mutation?: Record<string, unknown>
}

interface RawScratchTarget {
  isStage: boolean
  name: string
  variables?: Record<string, unknown>
  lists?: Record<string, unknown>
  broadcasts?: Record<string, string>
  blocks?: Record<string, RawScratchBlock | unknown[]>
  costumes?: Record<string, unknown>[]
  sounds?: Record<string, unknown>[]
  x?: number
  y?: number
  direction?: number
  size?: number
  visible?: boolean
  draggable?: boolean
  rotationStyle?: string
}

const scalar = (value: unknown): CanonicalScalar => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

const text = (value: unknown, fallback: string): string => String(scalar(value ?? fallback))

const fieldValue = (field: unknown): CanonicalScalar => {
  if (Array.isArray(field)) return scalar(field[0])
  return scalar(field)
}

const decodeVariables = (raw: Record<string, unknown> = {}): CanonicalVariable[] =>
  Object.values(raw).flatMap((value) => {
    if (!Array.isArray(value) || value.length < 2) return []
    return [
      {
        name: String(value[0]),
        value: scalar(value[1]),
        ...(value[2] === true ? { cloud: true } : {}),
      },
    ]
  })

const decodeLists = (raw: Record<string, unknown> = {}): CanonicalList[] =>
  Object.values(raw).flatMap((value) => {
    if (!Array.isArray(value) || value.length < 2) return []
    const listValue = Array.isArray(value[1]) ? value[1].map(scalar) : []
    return [{ name: String(value[0]), value: listValue }]
  })

const decodeCostumes = (raw: Record<string, unknown>[] = []): CanonicalCostume[] =>
  raw.map((costume) => ({
    name: text(costume.name, 'costume'),
    dataFormat: text(costume.dataFormat, 'svg') as CanonicalCostume['dataFormat'],
    ...(typeof costume.rotationCenterX === 'number' ? { rotationCenterX: costume.rotationCenterX } : {}),
    ...(typeof costume.rotationCenterY === 'number' ? { rotationCenterY: costume.rotationCenterY } : {}),
    ...(typeof costume.bitmapResolution === 'number' ? { bitmapResolution: costume.bitmapResolution } : {}),
  }))

const decodeSounds = (raw: Record<string, unknown>[] = []): CanonicalSound[] =>
  raw.map((sound) => ({
    name: text(sound.name, 'sound'),
    dataFormat: text(sound.dataFormat, 'wav') as CanonicalSound['dataFormat'],
    ...(typeof sound.rate === 'number' ? { rate: sound.rate } : {}),
    ...(typeof sound.sampleCount === 'number' ? { sampleCount: sound.sampleCount } : {}),
  }))

const primitiveToInput = (primitive: unknown): CanonicalInput => {
  if (!Array.isArray(primitive)) return { type: 'literal', value: scalar(primitive) }
  const primitiveType = Number(primitive[0])
  if (primitiveType === 11) return { type: 'broadcast', name: String(primitive[1] ?? '') }
  if (primitiveType === 12) return { type: 'variable', name: String(primitive[1] ?? '') }
  if (primitiveType === 13) return { type: 'list', name: String(primitive[1] ?? '') }
  return { type: 'literal', value: scalar(primitive[1]) }
}

const decodeScripts = (rawBlocks: Record<string, RawScratchBlock | unknown[]> = {}): CanonicalScript[] => {
  const blocks = rawBlocks
  const isBlock = (value: RawScratchBlock | unknown[] | undefined): value is RawScratchBlock =>
    Boolean(value && !Array.isArray(value) && typeof value === 'object' && 'opcode' in value)

  const decodeBlock = (id: string, stack: Set<string>): CanonicalBlock => {
    if (stack.has(id)) {
      return { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: '[cycle]' } } }
    }
    const raw = blocks[id]
    if (!isBlock(raw)) {
      return { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: '[missing block]' } } }
    }

    const nextStack = new Set(stack)
    nextStack.add(id)
    const inputs: Record<string, CanonicalInput> = {}
    for (const [name, encoded] of Object.entries(raw.inputs ?? {})) {
      if (!Array.isArray(encoded)) continue
      const encodedInput: unknown[] = encoded
      const inputType = Number(encodedInput[0])
      const active: unknown = encodedInput[1]
      if (typeof active === 'string') {
        if (name.startsWith('SUBSTACK')) {
          inputs[name] = { type: 'stack', blocks: decodeChain(active, nextStack) }
        } else {
          inputs[name] = { type: 'block', block: decodeBlock(active, nextStack) }
        }
      } else if (inputType === 3 && typeof encodedInput[1] === 'string') {
        inputs[name] = { type: 'block', block: decodeBlock(encodedInput[1], nextStack) }
      } else {
        inputs[name] = primitiveToInput(active)
      }
    }

    const fields = Object.fromEntries(
      Object.entries(raw.fields ?? {}).map(([name, value]) => [name, fieldValue(value)]),
    )

    return {
      // Canonical IR v1's declared opcode union covers the first supported subset. The
      // decompiler deliberately preserves other Scratch opcode strings for analysis.
      opcode: raw.opcode as CanonicalBlock['opcode'],
      ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    }
  }

  const decodeChain = (startId: string, stack = new Set<string>()): CanonicalBlock[] => {
    const result: CanonicalBlock[] = []
    const visited = new Set(stack)
    let id: string | null | undefined = startId
    while (id && !visited.has(id)) {
      const raw: RawScratchBlock | unknown[] | undefined = blocks[id]
      if (!isBlock(raw)) break
      result.push(decodeBlock(id, visited))
      visited.add(id)
      id = raw.next
    }
    return result
  }

  return Object.entries(blocks)
    .filter(([, block]) => isBlock(block) && block.topLevel === true && block.shadow !== true)
    .sort(([, a], [, b]) => {
      if (!isBlock(a) || !isBlock(b)) return 0
      return (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0)
    })
    .map(([id, block]) => {
      const raw = block as RawScratchBlock
      return {
        blocks: decodeChain(id),
        ...(typeof raw.x === 'number' && typeof raw.y === 'number' ? { position: { x: raw.x, y: raw.y } } : {}),
      }
    })
}

export const projectJsonToCanonical = (
  project: ScratchProjectJson | Record<string, unknown>,
  projectName = 'Imported Scratch Project',
): CanonicalProject => {
  const targets = Array.isArray((project as { targets?: unknown }).targets)
    ? (project as { targets: RawScratchTarget[] }).targets
    : []
  const stageRaw = targets.find((target) => target.isStage) ?? targets.at(0)
  if (!stageRaw) throw new Error('Scratch project has no targets')

  const toBase = (target: RawScratchTarget) => ({
    name: target.name,
    variables: decodeVariables(target.variables),
    lists: decodeLists(target.lists),
    costumes: decodeCostumes(target.costumes),
    sounds: decodeSounds(target.sounds),
    scripts: decodeScripts(target.blocks),
    procedures: [],
  })

  const stage = {
    kind: 'stage' as const,
    ...toBase(stageRaw),
  }

  const sprites = targets
    .filter((target) => !target.isStage)
    .map((target) => ({
      kind: 'sprite' as const,
      ...toBase(target),
      x: target.x ?? 0,
      y: target.y ?? 0,
      direction: target.direction ?? 90,
      size: target.size ?? 100,
      visible: target.visible ?? true,
      draggable: target.draggable ?? false,
      rotationStyle: (target.rotationStyle ?? 'all around') as CanonicalProject['sprites'][number]['rotationStyle'],
    }))

  const broadcastNames = new Set<string>()
  for (const target of targets) {
    for (const name of Object.values(target.broadcasts ?? {})) broadcastNames.add(String(name))
  }

  return {
    format: CANONICAL_IR_FORMAT,
    version: CANONICAL_IR_VERSION,
    name: projectName,
    stage,
    sprites,
    broadcasts: Array.from(broadcastNames, (name) => ({ name })),
  }
}
