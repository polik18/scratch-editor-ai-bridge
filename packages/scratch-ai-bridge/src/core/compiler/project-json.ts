import type { DataFormat } from '@scratch/scratch-storage'
import JSZip from 'jszip'
import { createOfflineScratchStorage } from '../../scratch/storage'
import { getInputCapability } from '../capabilities'
import type {
  CanonicalBlock,
  CanonicalCostume,
  CanonicalInput,
  CanonicalProject,
  CanonicalScalar,
  CanonicalScript,
  CanonicalSound,
  CanonicalTargetBase,
} from '../ir/types'
import { resolveAutomaticVisual } from '../visuals/presets'

export interface ScratchProjectJson {
  targets: ScratchTargetJson[]
  monitors: unknown[]
  extensions: string[]
  meta: {
    semver: string
    vm: string
    agent: string
  }
}

interface ScratchTargetJson {
  isStage: boolean
  name: string
  variables: Record<string, [string, CanonicalScalar] | [string, CanonicalScalar, true]>
  lists: Record<string, [string, CanonicalScalar[]]>
  broadcasts: Record<string, string>
  blocks: Record<string, ScratchBlockJson>
  comments: Record<string, never>
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

interface ScratchProjectBundle {
  project: ScratchProjectJson
  assets: ReadonlyMap<string, Uint8Array>
}

interface ScratchBlockJson {
  opcode: string
  next: string | null
  parent: string | null
  inputs: Record<string, ScratchInput>
  fields: Record<string, [string] | [string, string]>
  shadow: boolean
  topLevel: boolean
  x?: number
  y?: number
}

type ScratchPrimitive = [number, CanonicalScalar] | [11 | 12 | 13, string, string]
type ScratchInputValue = ScratchPrimitive | string
type ScratchInput = [1, ScratchInputValue] | [2, ScratchInputValue | null] | [3, ScratchInputValue, ScratchInputValue]

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

const createAssetRegistry = () => {
  const storage = createOfflineScratchStorage()
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

type AssetRegistry = ReturnType<typeof createAssetRegistry>

const compileCostume = (
  costume: CanonicalCostume,
  isStage: boolean,
  projectName: string,
  targetName: string,
  registry: AssetRegistry,
): ScratchCostumeJson => {
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

const literalPrimitive = (value: CanonicalScalar, inputName: string): ScratchPrimitive => {
  if (typeof value === 'boolean') return [10, value ? 'true' : 'false']
  if (typeof value === 'number') {
    const integerLike = Number.isInteger(value)
    return [integerLike ? 4 : 5, value]
  }

  if (/COLOR/i.test(inputName) && /^#[0-9a-f]{6}$/i.test(value)) return [9, value]
  return [10, value]
}

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

const compileTarget = (
  target: CanonicalTargetBase,
  isStage: boolean,
  targetIndex: number,
  projectName: string,
  symbols: SymbolTable,
  registry: AssetRegistry,
): ScratchTargetJson => {
  const targetKey = isStage ? 'stage' : `sprite:${target.name}`
  const local = createTargetSymbols(target, targetKey)
  const blocks: Record<string, ScratchBlockJson> = {}
  let blockSequence = 0

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

  const compileReporter = (block: CanonicalBlock, parentId: string): string => {
    const id = nextBlockId()
    blocks[id] = {
      opcode: block.opcode,
      next: null,
      parent: parentId,
      inputs: {},
      fields: compileFields(block.fields),
      shadow: false,
      topLevel: false,
    }
    blocks[id].inputs = compileInputs(block.inputs, id, block.opcode)
    return id
  }

  const compileMenuShadow = (
    parentOpcode: string,
    inputName: string,
    value: CanonicalScalar,
    parentId: string,
  ): string | undefined => {
    const shadow = getInputCapability(parentOpcode, inputName)?.shadow
    if (!shadow) return undefined
    const id = nextBlockId()
    blocks[id] = {
      opcode: shadow.opcode,
      next: null,
      parent: parentId,
      inputs: {},
      fields: { [shadow.field]: [String(value)] },
      shadow: true,
      topLevel: false,
    }
    return id
  }

  const compileInput = (
    input: CanonicalInput,
    inputName: string,
    parentId: string,
    parentOpcode: string,
  ): ScratchInput => {
    const menuShadow =
      input.type === 'literal' ? compileMenuShadow(parentOpcode, inputName, input.value, parentId) : undefined
    switch (input.type) {
      case 'literal':
        if (menuShadow) return [1, menuShadow]
        return [1, literalPrimitive(input.value, inputName)]
      case 'variable': {
        const reporter: ScratchPrimitive = [12, input.name, resolveVariable(input.name)]
        const shadow = compileMenuShadow(parentOpcode, inputName, '', parentId)
        return shadow ? [3, reporter, shadow] : [1, reporter]
      }
      case 'list': {
        const reporter: ScratchPrimitive = [13, input.name, resolveList(input.name)]
        const shadow = compileMenuShadow(parentOpcode, inputName, '', parentId)
        return shadow ? [3, reporter, shadow] : [1, reporter]
      }
      case 'broadcast': {
        const reporter: ScratchPrimitive = [11, input.name, resolveBroadcast(input.name)]
        const shadow = compileMenuShadow(parentOpcode, inputName, input.name, parentId)
        return shadow ? [3, reporter, shadow] : [1, reporter]
      }
      case 'block': {
        const reporter = compileReporter(input.block, parentId)
        const shadow = compileMenuShadow(parentOpcode, inputName, '', parentId)
        return shadow ? [3, reporter, shadow] : [2, reporter]
      }
      case 'stack':
        return [2, compileStack(input.blocks, parentId, false)]
    }
  }

  const compileInputs = (
    inputs: CanonicalBlock['inputs'],
    parentId: string,
    parentOpcode: string,
  ): Record<string, ScratchInput> =>
    Object.fromEntries(
      Object.entries(inputs ?? {}).map(([name, input]) => [name, compileInput(input, name, parentId, parentOpcode)]),
    )

  const compileFields = (fields: CanonicalBlock['fields']): Record<string, [string] | [string, string]> => {
    const result: Record<string, [string] | [string, string]> = {}
    for (const [name, value] of Object.entries(fields ?? {})) {
      const text = String(value)
      if (name === 'VARIABLE') result[name] = [text, resolveVariable(text)]
      else if (name === 'LIST') result[name] = [text, resolveList(text)]
      else if (name === 'BROADCAST_OPTION') result[name] = [text, resolveBroadcast(text)]
      else result[name] = [text]
    }
    return result
  }

  const compileStack = (
    canonicalBlocks: CanonicalBlock[],
    initialParent: string | null,
    topLevel: boolean,
    position?: CanonicalScript['position'],
  ): string | null => {
    if (canonicalBlocks.length === 0) return null
    const ids = canonicalBlocks.map(() => nextBlockId())

    canonicalBlocks.forEach((block, index) => {
      const id = ids[index]
      blocks[id] = {
        opcode: block.opcode,
        next: ids[index + 1] ?? null,
        parent: index === 0 ? initialParent : ids[index - 1],
        inputs: {},
        fields: compileFields(block.fields),
        shadow: false,
        topLevel: topLevel && index === 0,
      }
      if (topLevel && index === 0) {
        blocks[id].x = position?.x ?? 48 + ((blockSequence * 17) % 180)
        blocks[id].y = position?.y ?? 48 + ((blockSequence * 29) % 240)
      }
    })

    canonicalBlocks.forEach((block, index) => {
      blocks[ids[index]].inputs = compileInputs(block.inputs, ids[index], block.opcode)
    })

    return ids[0]
  }

  target.scripts.forEach((script) => compileStack(script.blocks, null, true, script.position))

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
  const base: ScratchTargetJson = {
    isStage,
    name: target.name,
    variables,
    lists,
    broadcasts: isStage
      ? Object.fromEntries(Array.from(symbols.broadcasts.entries()).map(([name, id]) => [id, name]))
      : {},
    blocks,
    comments: {},
    currentCostume: 0,
    costumes: sourceCostumes.map((costume) => compileCostume(costume, isStage, projectName, target.name, registry)),
    sounds: target.sounds.map((sound) => compileSound(sound, registry)),
    volume: 100,
    layerOrder: targetIndex,
  }

  if (isStage) {
    Object.assign(base, {
      tempo: 60,
      videoTransparency: 50,
      videoState: 'on',
      textToSpeechLanguage: null,
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

const buildScratchProjectBundle = (project: CanonicalProject): ScratchProjectBundle => {
  const symbols = createSymbolTable(project)
  const registry = createAssetRegistry()
  const stage = compileTarget(project.stage, true, 0, project.name, symbols, registry)
  const sprites = project.sprites.map((sprite, index) =>
    compileTarget(sprite, false, index + 1, project.name, symbols, registry),
  )

  // A sprite may introduce a broadcast that was not declared at the top level. Refresh the
  // stage broadcast dictionary after all targets have been compiled.
  stage.broadcasts = Object.fromEntries(Array.from(symbols.broadcasts.entries()).map(([name, id]) => [id, name]))

  const scratchProject: ScratchProjectJson = {
    targets: [stage, ...sprites],
    monitors: [],
    extensions: [],
    meta: {
      semver: '3.0.0',
      vm: '15.2.0',
      agent: 'Scratch AI Bridge 0.1.0',
    },
  }

  return { project: scratchProject, assets: registry.assets }
}

export const buildScratchProjectJson = (project: CanonicalProject): ScratchProjectJson =>
  buildScratchProjectBundle(project).project

export const buildScratchProjectArchive = async (project: CanonicalProject): Promise<Uint8Array> => {
  const bundle = buildScratchProjectBundle(project)
  const archive = new JSZip()
  archive.file('project.json', JSON.stringify(bundle.project))
  for (const [filename, data] of bundle.assets) archive.file(filename, data)
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
