import type { ScratchProjectJson } from '../compiler/project-json'
import { copyScratchBlockGraph, decodeBlockGraphToCanonicalScripts, type CanonicalBlockMappingEntry } from '../graph'
import {
  CANONICAL_IR_FORMAT,
  CANONICAL_IR_VERSION,
  CANONICAL_JSON_MAX_DEPTH,
  CANONICAL_JSON_MAX_NODES,
  type CanonicalComment,
  type CanonicalCostume,
  type CanonicalJsonValue,
  type CanonicalList,
  type CanonicalMonitor,
  type CanonicalProcedure,
  type CanonicalProject,
  type CanonicalScalar,
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
  comment?: string
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
  comments?: Record<string, unknown>
  currentCostume?: number
  volume?: number
  layerOrder?: number
  tempo?: number
  videoTransparency?: number
  videoState?: string
  textToSpeechLanguage?: string | null
  x?: number
  y?: number
  direction?: number
  size?: number
  visible?: boolean
  draggable?: boolean
  rotationStyle?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const copyImportedBlockGraph = (value: unknown) => {
  if (!isRecord(value)) return copyScratchBlockGraph(value)
  const blocks = Object.fromEntries(
    Object.entries(value).filter(([, node]) => isRecord(node) && typeof node.opcode === 'string'),
  )
  return copyScratchBlockGraph(blocks)
}

export const MAX_SCRATCH_BLOCKS = 100_000
export const MAX_SCRATCH_BLOCK_DEPTH = 128

/**
 * Bound raw ID-linked graph work before the VM or Canonical tree decoder walks an archive.
 * @param project Untrusted Scratch project JSON from an SB3 archive.
 */
export const assertScratchProjectBlockLimits = (project: unknown): void => {
  if (typeof project !== 'object' || project === null || Array.isArray(project)) return
  const targets = (project as { targets?: unknown }).targets
  if (!Array.isArray(targets)) return

  for (const [targetIndex, target] of targets.entries()) {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) continue
    const rawBlocks = (target as { blocks?: unknown }).blocks
    if (typeof rawBlocks !== 'object' || rawBlocks === null || Array.isArray(rawBlocks)) continue
    const blocks = rawBlocks as Record<string, unknown>
    const blockIds = Object.keys(blocks)
    if (blockIds.length > MAX_SCRATCH_BLOCKS) {
      throw new Error(`Scratch target ${targetIndex} exceeds the ${MAX_SCRATCH_BLOCKS.toLocaleString()} block limit`)
    }

    const depthById = new Map<string, number>()
    const stack = blockIds.map((id) => ({ id, depth: 1 }))
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      if (current.depth > MAX_SCRATCH_BLOCK_DEPTH) {
        throw new Error(
          `Scratch target ${targetIndex} block nesting exceeds the ${MAX_SCRATCH_BLOCK_DEPTH}-level limit`,
        )
      }
      if ((depthById.get(current.id) ?? 0) >= current.depth) continue
      depthById.set(current.id, current.depth)
      const block = blocks[current.id]
      if (typeof block !== 'object' || block === null || Array.isArray(block)) continue
      const raw = block as { next?: unknown; inputs?: unknown }
      if (typeof raw.next === 'string' && Object.hasOwn(blocks, raw.next)) {
        stack.push({ id: raw.next, depth: current.depth })
      }
      if (typeof raw.inputs !== 'object' || raw.inputs === null || Array.isArray(raw.inputs)) continue
      for (const descriptor of Object.values(raw.inputs as Record<string, unknown>)) {
        if (!Array.isArray(descriptor)) continue
        for (const reference of descriptor.slice(1)) {
          if (typeof reference === 'string' && Object.hasOwn(blocks, reference)) {
            stack.push({ id: reference, depth: current.depth + 1 })
          }
        }
      }
    }
  }
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
  raw.map((costume, index) => ({
    name: text(costume.name, '').trim() || `Costume ${index + 1}`,
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

const decodeJsonValue = (value: unknown, depth = 0, budget = { nodes: 0 }): CanonicalJsonValue | undefined => {
  budget.nodes += 1
  if (depth > CANONICAL_JSON_MAX_DEPTH || budget.nodes > CANONICAL_JSON_MAX_NODES) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const entries: CanonicalJsonValue[] = []
    for (const entry of value) {
      const decoded = decodeJsonValue(entry, depth + 1, budget)
      if (decoded === undefined) return undefined
      entries.push(decoded)
    }
    return entries
  }
  if (typeof value !== 'object') return undefined
  const result: Record<string, CanonicalJsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    const decoded = decodeJsonValue(entry, depth + 1, budget)
    if (decoded === undefined) return undefined
    Object.defineProperty(result, key, { value: decoded, enumerable: true, configurable: true, writable: true })
  }
  return result
}

const decodeProjectMeta = (value: unknown): Record<string, CanonicalJsonValue> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const decoded = decodeJsonValue(value)
  if (decoded === undefined) {
    throw new Error(
      `Scratch project metadata exceeds the Canonical JSON depth (${CANONICAL_JSON_MAX_DEPTH}) or node (${CANONICAL_JSON_MAX_NODES}) limit`,
    )
  }
  return decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : undefined
}

const decodeComment = (value: unknown): CanonicalComment | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.text !== 'string') return undefined
  return {
    text: raw.text,
    ...(typeof raw.x === 'number' ? { x: raw.x } : {}),
    ...(typeof raw.y === 'number' ? { y: raw.y } : {}),
    ...(typeof raw.width === 'number' ? { width: raw.width } : {}),
    ...(typeof raw.height === 'number' ? { height: raw.height } : {}),
    ...(typeof raw.minimized === 'boolean' ? { minimized: raw.minimized } : {}),
  }
}

const decodeComments = (target: RawScratchTarget): Record<string, CanonicalComment> =>
  Object.fromEntries(
    Object.entries(target.comments ?? {}).flatMap(([id, value]) => {
      const comment = decodeComment(value)
      return comment ? [[id, comment]] : []
    }),
  )

const parseMutationArray = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) return value as unknown[]
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const isValidProcedureWarp = (value: unknown): boolean =>
  value === undefined || typeof value === 'boolean' || value === 'true' || value === 'false'

const decodeProcedures = (
  target: RawScratchTarget,
  targetPath: string,
  targetIndex: number,
  mapping: CanonicalBlockMappingEntry[],
  normalizationItems: ProcedureNormalizationItem[],
): CanonicalProcedure[] => {
  const targetIdentity = { targetIndex, targetName: target.name, isStage: target.isStage }
  const blocks = copyImportedBlockGraph(target.blocks ?? {})
  const comments = decodeComments(target)
  const parsed: {
    procedure: CanonicalProcedure
    definition: RawScratchBlock
    definitionId: string
    prototypeId: string
  }[] = []
  for (const [definitionId, definition] of Object.entries(blocks)) {
    if (definition.opcode !== 'procedures_definition') continue
    const customBlockInput = definition.inputs?.custom_block
    const prototypeId =
      Array.isArray(customBlockInput) && typeof customBlockInput[1] === 'string' ? customBlockInput[1] : undefined
    const prototype = prototypeId ? blocks[prototypeId] : undefined
    const mutation = prototype?.mutation
    if (!prototypeId || !mutation || typeof mutation.proccode !== 'string') continue
    const argumentIds = parseMutationArray(mutation.argumentids)
    const argumentNames = parseMutationArray(mutation.argumentnames)
    const argumentDefaults = parseMutationArray(mutation.argumentdefaults)
    const markers = mutation.proccode.match(/%(?:s|n|b)/g) ?? []
    if (
      !argumentIds ||
      !argumentNames ||
      !argumentDefaults ||
      !isValidProcedureWarp(mutation.warp) ||
      new Set(argumentNames).size !== argumentNames.length ||
      argumentIds.length !== argumentNames.length ||
      argumentIds.length !== argumentDefaults.length ||
      argumentIds.length !== markers.length ||
      !argumentNames.every((name) => typeof name === 'string' && name.length > 0)
    ) {
      continue
    }

    parsed.push({
      definition,
      definitionId,
      prototypeId,
      procedure: {
        name: mutation.proccode.replace(/\s*%(?:s|n|b)/g, '').trim(),
        parameters: argumentNames.map((name, index) => ({
          name: String(name),
          kind: markers[index] === '%b' ? 'boolean' : markers[index] === '%n' ? 'number' : 'string-number',
          default: scalar(argumentDefaults[index]),
        })),
        warp: mutation.warp === true || mutation.warp === 'true',
        body: [],
      },
    })
  }
  const procedures = parsed.map(({ procedure }) => procedure)
  for (const [procedureIndex, { definition, definitionId, prototypeId, procedure }] of parsed.entries()) {
    mapping.push(
      {
        irPath: `${targetPath}/procedures/${procedureIndex}`,
        blockId: definitionId,
        opcode: definition.opcode,
        ...targetIdentity,
      },
      {
        irPath: `${targetPath}/procedures/${procedureIndex}/prototype`,
        blockId: prototypeId,
        opcode: 'procedures_prototype',
        ...targetIdentity,
      },
    )
    if (typeof definition.next !== 'string') continue
    const bodyGraph = copyImportedBlockGraph(blocks)
    for (const block of Object.values(bodyGraph)) block.topLevel = false
    if (Object.hasOwn(bodyGraph, definition.next)) bodyGraph[definition.next].topLevel = true
    procedure.body =
      decodeBlockGraphToCanonicalScripts(bodyGraph, procedures, comments, {
        mapping,
        target: targetIdentity,
        procedureScope: procedure,
        onArgumentReporterFallback: ({ blockId, opcode, argumentName }) => {
          normalizationItems.push({
            targetName: target.name,
            blockId,
            opcode,
            argumentName,
            code: 'out-of-scope-argument-reporter',
            outcome: 'normalized',
            message: `Argument reporter "${argumentName}" is outside its matching custom procedure and uses Scratch's default value.`,
          })
        },
        pathForScript: () => `${targetPath}/procedures/${procedureIndex}/body`,
      })[0]?.blocks ?? []
  }
  return procedures
}

const decodeTargetScripts = (
  target: RawScratchTarget,
  targetPath: string,
  targetIndex: number,
  mapping: CanonicalBlockMappingEntry[],
  procedures: readonly CanonicalProcedure[],
  normalizationItems: ProcedureNormalizationItem[],
) => {
  const blocks = copyImportedBlockGraph(target.blocks ?? {})
  const comments = decodeComments(target)
  for (const [id, block] of Object.entries(blocks)) {
    if (block.opcode === 'procedures_definition' || block.opcode === 'procedures_prototype') delete blocks[id]
  }
  return decodeBlockGraphToCanonicalScripts(blocks, procedures, comments, {
    mapping,
    target: { targetIndex, targetName: target.name, isStage: target.isStage },
    onArgumentReporterFallback: ({ blockId, opcode, argumentName }) => {
      normalizationItems.push({
        targetName: target.name,
        blockId,
        opcode,
        argumentName,
        code: 'out-of-scope-argument-reporter',
        outcome: 'normalized',
        message: `Argument reporter "${argumentName}" is outside its matching custom procedure and uses Scratch's default value.`,
      })
    },
    pathForScript: (scriptIndex) => `${targetPath}/scripts/${scriptIndex}/blocks`,
  })
}

const decodeWorkspaceComments = (target: RawScratchTarget): CanonicalComment[] =>
  Object.values(target.comments ?? {}).flatMap((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
    const raw = value as Record<string, unknown>
    if (raw.blockId !== null && raw.blockId !== undefined) return []
    const comment = decodeComment(value)
    return comment ? [comment] : []
  })

const decodeMonitors = (value: unknown): CanonicalMonitor[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const raw = entry as Record<string, unknown>
    const params = raw.params
    const monitorValue = raw.value
    if (
      typeof raw.id !== 'string' ||
      typeof raw.opcode !== 'string' ||
      typeof raw.mode !== 'string' ||
      (typeof raw.spriteName !== 'string' && raw.spriteName !== null) ||
      typeof raw.visible !== 'boolean' ||
      typeof params !== 'object' ||
      params === null ||
      Array.isArray(params)
    ) {
      return []
    }
    const paramsRecord = params as Record<string, unknown>
    if (
      Object.values(paramsRecord).some(
        (item) => item !== null && !['string', 'number', 'boolean'].includes(typeof item),
      )
    )
      return []
    if (
      !Array.isArray(monitorValue) &&
      monitorValue !== null &&
      !['string', 'number', 'boolean'].includes(typeof monitorValue)
    ) {
      return []
    }
    if (
      Array.isArray(monitorValue) &&
      monitorValue.some((item) => item !== null && !['string', 'number', 'boolean'].includes(typeof item))
    ) {
      return []
    }
    return [
      {
        id: raw.id,
        opcode: raw.opcode,
        params: paramsRecord as CanonicalMonitor['params'],
        spriteName: raw.spriteName,
        mode: raw.mode,
        value:
          monitorValue === null
            ? null
            : Array.isArray(monitorValue)
              ? (monitorValue as CanonicalMonitor['value'])
              : scalar(monitorValue),
        ...(typeof raw.x === 'number' ? { x: raw.x } : {}),
        ...(typeof raw.y === 'number' ? { y: raw.y } : {}),
        ...(typeof raw.width === 'number' ? { width: raw.width } : {}),
        ...(typeof raw.height === 'number' ? { height: raw.height } : {}),
        visible: raw.visible,
        ...(typeof raw.min === 'number' ? { min: raw.min } : {}),
        ...(typeof raw.max === 'number' ? { max: raw.max } : {}),
      },
    ]
  })
}

export interface ProcedureNormalizationItem {
  targetName: string
  definitionId?: string
  blockId?: string
  proccode?: string
  opcode?: string
  argumentName?: string
  code: 'legacy-shadow-prototype' | 'invalid-procedure-metadata' | 'out-of-scope-argument-reporter'
  outcome: 'normalized' | 'skipped'
  message: string
}

export interface ProcedureNormalizationReport {
  format: 'scratch-ai-bridge/procedure-normalization-report'
  items: ProcedureNormalizationItem[]
}

const inspectProcedureNormalization = (targets: readonly RawScratchTarget[]): ProcedureNormalizationReport => {
  const items: ProcedureNormalizationItem[] = []
  for (const target of targets) {
    const blocks = copyImportedBlockGraph(target.blocks ?? {})
    for (const [definitionId, definition] of Object.entries(blocks)) {
      if (definition.opcode !== 'procedures_definition') continue
      const customBlockInput = definition.inputs?.custom_block
      const inputType: unknown = Array.isArray(customBlockInput) ? customBlockInput[0] : undefined
      const prototypeId =
        Array.isArray(customBlockInput) && typeof customBlockInput[1] === 'string' ? customBlockInput[1] : undefined
      const prototype = prototypeId ? blocks[prototypeId] : undefined
      const mutation = prototype?.mutation
      const proccode = typeof mutation?.proccode === 'string' ? mutation.proccode : undefined
      const argumentIds = parseMutationArray(mutation?.argumentids)
      const argumentNames = parseMutationArray(mutation?.argumentnames)
      const argumentDefaults = parseMutationArray(mutation?.argumentdefaults)
      const markers: string[] = proccode?.match(/%(?:s|n|b)/g) ?? []
      const metadataValid = Boolean(
        prototype?.opcode === 'procedures_prototype' &&
        proccode &&
        argumentIds &&
        argumentNames &&
        argumentDefaults &&
        isValidProcedureWarp(mutation?.warp) &&
        new Set(argumentNames).size === argumentNames.length &&
        argumentIds.length === argumentNames.length &&
        argumentIds.length === argumentDefaults.length &&
        argumentIds.length === markers.length &&
        argumentIds.every((value) => typeof value === 'string') &&
        argumentNames.every((value) => typeof value === 'string' && value.length > 0),
      )
      if (!metadataValid) {
        items.push({
          targetName: target.name,
          definitionId,
          ...(proccode ? { proccode } : {}),
          code: 'invalid-procedure-metadata',
          outcome: 'skipped',
          message:
            'Procedure metadata is incomplete or inconsistent; the procedure cannot be represented in Canonical IR.',
        })
        continue
      }
      if (inputType === 1 || prototype?.shadow === true || Object.keys(prototype?.inputs ?? {}).length > 0) {
        items.push({
          targetName: target.name,
          definitionId,
          ...(proccode ? { proccode } : {}),
          code: 'legacy-shadow-prototype',
          outcome: 'normalized',
          message:
            'Legacy shadow prototype and argument reporters are normalized to the current prototype representation.',
        })
      }
    }
  }
  return { format: 'scratch-ai-bridge/procedure-normalization-report', items }
}

export const projectJsonToCanonicalWithReport = (
  project: ScratchProjectJson | Record<string, unknown>,
  projectName = 'Imported Scratch Project',
): {
  canonical: CanonicalProject
  procedureNormalizationReport: ProcedureNormalizationReport
  canonicalBlockMappings: CanonicalBlockMappingEntry[]
} => {
  assertScratchProjectBlockLimits(project)
  const targets = Array.isArray((project as { targets?: unknown }).targets)
    ? (project as { targets: RawScratchTarget[] }).targets
    : []
  const stageRaw = targets.find((target) => target.isStage) ?? targets.at(0)
  if (!stageRaw) throw new Error('Scratch project has no targets')

  const canonicalBlockMappings: CanonicalBlockMappingEntry[] = []
  const outOfScopeArgumentReporters: ProcedureNormalizationItem[] = []
  const toBase = (target: RawScratchTarget, targetPath: string, targetIndex: number) => {
    const procedures = decodeProcedures(
      target,
      targetPath,
      targetIndex,
      canonicalBlockMappings,
      outOfScopeArgumentReporters,
    )
    return {
      name: target.name,
      ...(typeof target.currentCostume === 'number' ? { currentCostume: target.currentCostume } : {}),
      ...(typeof target.volume === 'number' ? { volume: target.volume } : {}),
      ...(typeof target.layerOrder === 'number' ? { layerOrder: target.layerOrder } : {}),
      variables: decodeVariables(target.variables),
      lists: decodeLists(target.lists),
      costumes: decodeCostumes(target.costumes),
      sounds: decodeSounds(target.sounds),
      scripts: decodeTargetScripts(
        target,
        targetPath,
        targetIndex,
        canonicalBlockMappings,
        procedures,
        outOfScopeArgumentReporters,
      ),
      procedures,
      comments: decodeWorkspaceComments(target),
    }
  }

  const stage = {
    kind: 'stage' as const,
    ...toBase(stageRaw, '/stage', targets.indexOf(stageRaw)),
    ...(typeof stageRaw.tempo === 'number' ? { tempo: stageRaw.tempo } : {}),
    ...(typeof stageRaw.videoTransparency === 'number' ? { videoTransparency: stageRaw.videoTransparency } : {}),
    ...(typeof stageRaw.videoState === 'string' ? { videoState: stageRaw.videoState } : {}),
    ...(typeof stageRaw.textToSpeechLanguage === 'string' || stageRaw.textToSpeechLanguage === null
      ? { textToSpeechLanguage: stageRaw.textToSpeechLanguage }
      : {}),
  }

  const sprites = targets
    .filter((target) => !target.isStage)
    .map((target, spriteIndex) => ({
      kind: 'sprite' as const,
      ...toBase(target, `/sprites/${spriteIndex}`, targets.indexOf(target)),
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
  const meta = decodeProjectMeta((project as { meta?: unknown }).meta)

  const canonical: CanonicalProject = {
    format: CANONICAL_IR_FORMAT,
    version: CANONICAL_IR_VERSION,
    name: projectName,
    stage,
    sprites,
    broadcasts: Array.from(broadcastNames, (name) => ({ name })),
    ...(Array.isArray((project as { extensions?: unknown }).extensions)
      ? {
          extensions: (project as { extensions: unknown[] }).extensions.filter(
            (extension): extension is string => typeof extension === 'string',
          ),
        }
      : {}),
    ...(meta ? { meta } : {}),
    monitors: decodeMonitors((project as { monitors?: unknown }).monitors),
  }
  const procedureNormalizationReport = inspectProcedureNormalization(targets)
  procedureNormalizationReport.items.push(...outOfScopeArgumentReporters)
  return {
    canonical,
    procedureNormalizationReport,
    canonicalBlockMappings,
  }
}

export const projectJsonToCanonical = (
  project: ScratchProjectJson | Record<string, unknown>,
  projectName = 'Imported Scratch Project',
): CanonicalProject => projectJsonToCanonicalWithReport(project, projectName).canonical
