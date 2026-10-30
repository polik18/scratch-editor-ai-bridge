import type { DataFormat } from '@scratch/scratch-storage'
import JSZip from 'jszip'
import { createOfflineScratchStorage } from '../../scratch/storage'
import { getBlockCapability } from '../capabilities/registry'
import { encodeCanonicalScriptsToBlockGraph, type EncodedScratchBlockGraph } from '../graph'
import type {
  CanonicalCostume,
  CanonicalComment,
  CanonicalJsonValue,
  CanonicalMonitor,
  CanonicalProject,
  CanonicalScalar,
  CanonicalSound,
  CanonicalTargetBase,
} from '../ir/types'
import { resolveAutomaticVisual } from '../visuals/presets'

export interface ScratchProjectJson {
  targets: ScratchTargetJson[]
  monitors: CanonicalMonitor[]
  extensions: string[]
  meta: Record<string, CanonicalJsonValue>
}

interface ScratchTargetJson {
  isStage: boolean
  name: string
  variables: Record<string, [string, CanonicalScalar] | [string, CanonicalScalar, true]>
  lists: Record<string, [string, CanonicalScalar[]]>
  broadcasts: Record<string, string>
  blocks: EncodedScratchBlockGraph
  comments: Record<string, ScratchCommentJson>
  currentCostume: number
  costumes: ScratchCostumeJson[]
  sounds: ScratchSoundJson[]
  volume: number
  layerOrder?: number
  tempo?: number
  videoTransparency?: number
  videoState?: string
  textToSpeechLanguage?: string | null
  visible?: boolean
  x?: number
  y?: number
  size?: number
  direction?: number
  draggable?: boolean
  rotationStyle?: string
}

interface ScratchCostumeJson {
  assetId: string
  name: string
  bitmapResolution: number
  md5ext: string
  dataFormat: string
  rotationCenterX: number
  rotationCenterY: number
}

interface ScratchSoundJson {
  assetId: string
  name: string
  dataFormat: string
  format: string
  rate: number
  sampleCount: number
  md5ext: string
}

interface ScratchCommentJson extends CanonicalComment {
  id: string
  blockId: string | null
}

interface ScratchProjectBundle {
  project: ScratchProjectJson
  assets: ReadonlyMap<string, Uint8Array>
}

const silentWav = (): Uint8Array => {
  const result = new Uint8Array(46)
  const view = new DataView(result.buffer)
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) result[offset + index] = value.charCodeAt(index)
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 38, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 22_050, true)
  view.setUint32(28, 44_100, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, 2, true)
  view.setInt16(44, 0, true)
  return result
}

const decodeAssetData = (data: string, dataFormat: string): Uint8Array => {
  const decodeBase64 = (value: string): Uint8Array => {
    const decoded = atob(value.replace(/\s/g, ''))
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  }
  const dataUrl = /^data:[^,]*?(;base64)?,(.*)$/s.exec(data)
  if (dataUrl) {
    const payload = dataUrl[2]
    return dataUrl[1] ? decodeBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload))
  }
  if (dataFormat === 'svg' && data.trimStart().startsWith('<')) {
    return new TextEncoder().encode(data)
  }
  return decodeBase64(data)
}

const createAssetRegistry = async () => {
  const storage = await createOfflineScratchStorage()
  const assets = new Map<string, Uint8Array>()

  const add = (kind: 'costume' | 'sound', dataFormat: string, data: Uint8Array): string => {
    if (data.byteLength === 0) throw new Error(`Asset data for ${dataFormat} is empty`)
    const assetType =
      kind === 'sound'
        ? storage.AssetType.Sound
        : dataFormat === 'svg'
          ? storage.AssetType.ImageVector
          : storage.AssetType.ImageBitmap
    const asset = storage.createAsset(assetType, dataFormat as DataFormat, data, '', true)
    const assetId = String(asset.assetId)
    assets.set(`${assetId}.${dataFormat}`, data)
    return assetId
  }

  return { add, assets }
}

type AssetRegistry = Awaited<ReturnType<typeof createAssetRegistry>>

const compileCostume = (
  costume: CanonicalCostume,
  isStage: boolean,
  projectName: string,
  targetName: string,
  registry: AssetRegistry,
): ScratchCostumeJson => {
  if (costume.assetIssue) {
    throw new Error(`Cannot compile costume "${costume.name}": source asset has ${costume.assetIssue}`)
  }
  const costumeData = costume.data
  const hasData = typeof costumeData === 'string' && costumeData.length > 0
  const automaticVisual = hasData
    ? undefined
    : resolveAutomaticVisual({ isStage, projectName, targetName, costumeName: costume.name })
  const dataFormat = hasData ? costume.dataFormat : 'svg'
  const data = hasData
    ? decodeAssetData(costumeData, dataFormat)
    : new TextEncoder().encode(automaticVisual?.data ?? '')
  const assetId = registry.add('costume', dataFormat, data)

  return {
    assetId,
    name: costume.name,
    bitmapResolution: dataFormat === 'svg' ? 1 : (costume.bitmapResolution ?? 2),
    md5ext: `${assetId}.${dataFormat}`,
    dataFormat,
    rotationCenterX: costume.rotationCenterX ?? automaticVisual?.rotationCenterX ?? (isStage ? 240 : 0.5),
    rotationCenterY: costume.rotationCenterY ?? automaticVisual?.rotationCenterY ?? (isStage ? 180 : 0.5),
  }
}

const compileSound = (sound: CanonicalSound, registry: AssetRegistry): ScratchSoundJson => {
  if (sound.assetIssue) {
    throw new Error(`Cannot compile sound "${sound.name}": source asset has ${sound.assetIssue}`)
  }
  const soundData = sound.data
  const hasData = typeof soundData === 'string' && soundData.length > 0
  const dataFormat = hasData ? sound.dataFormat : 'wav'
  const data = hasData ? decodeAssetData(soundData, dataFormat) : silentWav()
  const assetId = registry.add('sound', dataFormat, data)

  return {
    assetId,
    name: sound.name,
    dataFormat,
    format: '',
    rate: sound.rate ?? (hasData ? 44_100 : 22_050),
    sampleCount: sound.sampleCount ?? (hasData ? 0 : 1),
    md5ext: `${assetId}.${dataFormat}`,
  }
}

const hash = (value: string): string => {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

const stableId = (kind: string, value: string): string => `sab_${kind}_${hash(value)}`

interface SymbolTable {
  stageVariables: Map<string, string>
  stageLists: Map<string, string>
  broadcasts: Map<string, string>
}

const createSymbolTable = (project: CanonicalProject): SymbolTable => ({
  stageVariables: new Map(
    project.stage.variables.map((variable) => [variable.name, stableId('var', `stage:${variable.name}`)]),
  ),
  stageLists: new Map(project.stage.lists.map((list) => [list.name, stableId('list', `stage:${list.name}`)])),
  broadcasts: new Map(project.broadcasts.map((broadcast) => [broadcast.name, stableId('broadcast', broadcast.name)])),
})

interface TargetSymbols {
  variables: Map<string, string>
  lists: Map<string, string>
}

const createTargetSymbols = (target: CanonicalTargetBase, targetKey: string): TargetSymbols => ({
  variables: new Map(
    target.variables.map((variable) => [variable.name, stableId('var', `${targetKey}:${variable.name}`)]),
  ),
  lists: new Map(target.lists.map((list) => [list.name, stableId('list', `${targetKey}:${list.name}`)])),
})

const compileTarget = async (
  target: CanonicalTargetBase,
  isStage: boolean,
  targetIndex: number,
  projectName: string,
  symbols: SymbolTable,
  registry: AssetRegistry,
): Promise<ScratchTargetJson> => {
  const targetKey = isStage ? 'stage' : `sprite:${target.name}`
  const local = createTargetSymbols(target, targetKey)
  let blockSequence = 0
  let commentSequence = 0
  const comments: Record<string, ScratchCommentJson> = {}

  const nextBlockId = (): string => `sab_block_${targetIndex}_${(blockSequence += 1).toString(36)}`

  const resolveVariable = (name: string): string =>
    local.variables.get(name) ?? symbols.stageVariables.get(name) ?? stableId('var', `missing:${name}`)
  const resolveList = (name: string): string =>
    local.lists.get(name) ?? symbols.stageLists.get(name) ?? stableId('list', `missing:${name}`)
  const resolveBroadcast = (name: string): string => {
    const existing = symbols.broadcasts.get(name)
    if (existing) return existing
    const id = stableId('broadcast', name)
    symbols.broadcasts.set(name, id)
    return id
  }
  const addComment = (comment: CanonicalComment, blockId: string | null): string => {
    const id = `sab_comment_${targetIndex}_${(++commentSequence).toString(36)}`
    comments[id] = {
      ...comment,
      id,
      blockId,
      x: comment.x ?? 0,
      y: comment.y ?? 0,
      width: comment.width ?? 200,
      height: comment.height ?? 200,
      minimized: comment.minimized ?? false,
    }
    return id
  }
  const procedureDefinitions = target.procedures.map((procedure) => ({
    ...procedure,
    definitionId: nextBlockId(),
    prototypeId: nextBlockId(),
    argumentIds: procedure.parameters.map(() => nextBlockId()),
  }))
  const procedureCodecData = procedureDefinitions.map(
    ({ definitionId: _definitionId, prototypeId: _prototypeId, ...procedure }) => procedure,
  )
  const blocks = encodeCanonicalScriptsToBlockGraph(target.scripts, {
    nextId: nextBlockId,
    resolveVariable,
    resolveList,
    resolveBroadcast,
    procedures: procedureCodecData,
    addComment: (comment, blockId) => addComment(comment, blockId),
  })

  procedureDefinitions.forEach((procedure, procedureIndex) => {
    const { definitionId, prototypeId, argumentIds } = procedure
    const proccode = [
      procedure.name,
      ...procedure.parameters.map((parameter) =>
        parameter.kind === 'boolean' ? '%b' : parameter.kind === 'number' ? '%n' : '%s',
      ),
    ]
      .filter(Boolean)
      .join(' ')
    const bodyGraph = encodeCanonicalScriptsToBlockGraph([{ blocks: procedure.body }], {
      nextId: nextBlockId,
      resolveVariable,
      resolveList,
      resolveBroadcast,
      procedures: procedureCodecData,
      addComment: (comment, blockId) => addComment(comment, blockId),
    })
    const bodyRoot = Object.entries(bodyGraph).find(([, block]) => block.topLevel)?.[0] ?? null

    for (const [id, block] of Object.entries(bodyGraph)) {
      block.topLevel = false
      delete block.x
      delete block.y
      block.parent ??= definitionId
      Object.defineProperty(blocks, id, { value: block, enumerable: true, configurable: true, writable: true })
    }

    Object.defineProperty(blocks, prototypeId, {
      value: {
        opcode: 'procedures_prototype',
        next: null,
        parent: definitionId,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode,
          argumentids: JSON.stringify(argumentIds),
          argumentnames: JSON.stringify(procedure.parameters.map(({ name }) => name)),
          argumentdefaults: JSON.stringify(procedure.parameters.map(({ default: value }) => value)),
          warp: procedure.warp ? 'true' : 'false',
        },
      },
      enumerable: true,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(blocks, definitionId, {
      value: {
        opcode: 'procedures_definition',
        next: bodyRoot,
        parent: null,
        inputs: { custom_block: [2, prototypeId] },
        fields: {},
        shadow: false,
        topLevel: true,
        x: 48,
        y: 48 + procedureIndex * 64,
      },
      enumerable: true,
      configurable: true,
      writable: true,
    })
  })

  const variables = Object.fromEntries(
    target.variables.map((variable) => {
      const id = resolveVariable(variable.name)
      const tuple: [string, CanonicalScalar] | [string, CanonicalScalar, true] = variable.cloud
        ? [variable.name, variable.value, true]
        : [variable.name, variable.value]
      return [id, tuple]
    }),
  )

  const lists = Object.fromEntries(
    target.lists.map((list) => [resolveList(list.name), [list.name, list.value] as [string, CanonicalScalar[]]]),
  )

  const sourceCostumes =
    target.costumes.length > 0
      ? target.costumes
      : [{ name: isStage ? 'backdrop1' : 'costume1', dataFormat: 'svg' as const }]
  for (const comment of target.comments ?? []) addComment(comment, null)
  const base: ScratchTargetJson = {
    isStage,
    name: target.name,
    variables,
    lists,
    broadcasts: isStage
      ? Object.fromEntries(Array.from(symbols.broadcasts.entries()).map(([name, id]) => [id, name]))
      : {},
    blocks,
    comments,
    currentCostume: target.currentCostume ?? 0,
    costumes: sourceCostumes.map((costume) => compileCostume(costume, isStage, projectName, target.name, registry)),
    sounds: target.sounds.map((sound) => compileSound(sound, registry)),
    volume: target.volume ?? 100,
    layerOrder: target.layerOrder ?? targetIndex,
  }

  if (isStage) {
    const stage = target as CanonicalProject['stage']
    Object.assign(base, {
      tempo: stage.tempo ?? 60,
      videoTransparency: stage.videoTransparency ?? 50,
      videoState: stage.videoState ?? 'on',
      textToSpeechLanguage: stage.textToSpeechLanguage ?? null,
    })
  } else {
    const sprite = target as CanonicalProject['sprites'][number]
    Object.assign(base, {
      visible: sprite.visible,
      x: sprite.x,
      y: sprite.y,
      size: sprite.size,
      direction: sprite.direction,
      draggable: sprite.draggable,
      rotationStyle: sprite.rotationStyle,
    })
  }

  return base
}

const compileMonitors = (project: CanonicalProject): CanonicalMonitor[] =>
  (project.monitors ?? []).map((monitor) => {
    const name =
      monitor.opcode === 'data_variable'
        ? monitor.params.VARIABLE
        : monitor.opcode === 'data_listcontents'
          ? monitor.params.LIST
          : undefined
    if (typeof name !== 'string') return monitor

    const target = monitor.spriteName
      ? project.sprites.find((sprite) => sprite.name === monitor.spriteName)
      : project.stage
    const localSymbol =
      monitor.opcode === 'data_variable'
        ? target?.variables.find((variable) => variable.name === name)
        : target?.lists.find((list) => list.name === name)
    const stageSymbol =
      monitor.opcode === 'data_variable'
        ? project.stage.variables.find((variable) => variable.name === name)
        : project.stage.lists.find((list) => list.name === name)
    const resolvedTarget = localSymbol ? target : stageSymbol ? project.stage : undefined
    const resolvedName = localSymbol ?? stageSymbol
    if (!resolvedTarget || !resolvedName) return monitor
    const resolvedKey = resolvedTarget === project.stage ? 'stage' : `sprite:${resolvedTarget.name}`
    const symbolId = stableId(monitor.opcode === 'data_variable' ? 'var' : 'list', `${resolvedKey}:${name}`)
    return { ...monitor, id: symbolId }
  })

const inferExtensions = (project: CanonicalProject): string[] => {
  const extensions = new Set(project.extensions ?? [])
  const visitBlocks = (blocks: CanonicalProject['stage']['scripts'][number]['blocks']): void => {
    for (const block of blocks) {
      const extensionId = getBlockCapability(block.opcode)?.extensionId
      if (extensionId) extensions.add(extensionId)
      for (const input of Object.values(block.inputs ?? {})) {
        if (input.type === 'block') visitBlocks([input.block])
        else if (input.type === 'stack') visitBlocks(input.blocks)
      }
    }
  }
  for (const target of [project.stage, ...project.sprites]) {
    for (const script of target.scripts) visitBlocks(script.blocks)
  }
  return [...extensions].sort()
}

const buildScratchProjectBundle = async (project: CanonicalProject): Promise<ScratchProjectBundle> => {
  const symbols = createSymbolTable(project)
  const registry = await createAssetRegistry()
  const stage = await compileTarget(project.stage, true, 0, project.name, symbols, registry)
  const sprites = await Promise.all(
    project.sprites.map((sprite, index) => compileTarget(sprite, false, index + 1, project.name, symbols, registry)),
  )

  // A sprite may introduce a broadcast that was not declared at the top level. Refresh the
  // stage broadcast dictionary after all targets have been compiled.
  stage.broadcasts = Object.fromEntries(Array.from(symbols.broadcasts.entries()).map(([name, id]) => [id, name]))

  const scratchProject: ScratchProjectJson = {
    targets: [stage, ...sprites],
    monitors: compileMonitors(project),
    extensions: inferExtensions(project),
    meta: {
      semver: '3.0.0',
      vm: '15.2.0',
      agent: 'Scratch AI Bridge 0.1.0',
      ...project.meta,
    },
  }

  return { project: scratchProject, assets: registry.assets }
}

export const buildScratchProjectJson = async (project: CanonicalProject): Promise<ScratchProjectJson> =>
  (await buildScratchProjectBundle(project)).project

/**
 * Build a Scratch project archive from a Canonical Project.
 * Optionally retain original ZIP entries (costumes, sounds, etc.) from the source SB3.
 */
export const buildScratchProjectArchive = async (
  project: CanonicalProject,
  opts?: { retainOriginalEntries?: Map<string, Uint8Array> },
): Promise<Uint8Array> => {
  const bundle = await buildScratchProjectBundle(project)
  const archive = new JSZip()
  archive.file('project.json', new TextEncoder().encode(JSON.stringify(bundle.project)))
  for (const [filename, data] of bundle.assets) archive.file(filename, data)
  // Retain original ZIP entries if provided
  if (opts?.retainOriginalEntries) {
    for (const [filename, data] of opts.retainOriginalEntries) {
      // Skip project.json — we just overwrote it
      if (filename === 'project.json') continue
      // Skip assets that were already generated (we prefer the new version)
      if (bundle.assets.has(filename)) continue
      archive.file(filename, data)
    }
  }
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
