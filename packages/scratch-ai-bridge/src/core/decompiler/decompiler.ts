import { DataFormat } from '@scratch/scratch-storage'
import {
  createVM,
  getProjectJson,
  loadSb3,
  prepareVmForBitmapAssetImport,
  saveSb3,
  type ScratchVMHandle,
  type Sb3Input,
} from '../../scratch'
import { createOfflineScratchStorage } from '../../scratch/storage'
import { exportLosslessSb3, importLosslessSb3, type RawSb3ArchiveEntry, type RawSb3Project } from '../archive'
import { extractProjectBlockGraphs, type CanonicalBlockMappingEntry, type ScratchTargetBlockGraph } from '../graph'
import type { CanonicalCostume, CanonicalProject } from '../ir/types'
import { resolveAutomaticVisual } from '../visuals/presets'
import { createVmNormalizationReport, type VmNormalizationReport } from './normalization-report'
import {
  assertScratchProjectBlockLimits,
  projectJsonToCanonical,
  projectJsonToCanonicalWithReport,
  type ProcedureNormalizationReport,
} from './project-json'

const projectHasBitmapCostume = (projectJson: Record<string, unknown>): boolean => {
  if (!Array.isArray(projectJson.targets)) return false
  return projectJson.targets.some((target) => {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return false
    const costumes = (target as { costumes?: unknown }).costumes
    return (
      Array.isArray(costumes) &&
      costumes.some((costume: unknown) => {
        if (typeof costume !== 'object' || costume === null || Array.isArray(costume)) return false
        return (costume as { dataFormat?: unknown }).dataFormat !== 'svg'
      })
    )
  })
}

const loadProjectVm = async (
  input: Sb3Input,
  projectJson: Record<string, unknown>,
): Promise<{ vm: ScratchVMHandle; cleanupRenderer: () => void }> => {
  const vm = await createVM()
  let cleanupRenderer: () => void = () => undefined
  try {
    if (projectHasBitmapCostume(projectJson) && typeof document !== 'undefined') {
      cleanupRenderer = await prepareVmForBitmapAssetImport(vm)
    }
    await loadSb3(input, vm)
    return { vm, cleanupRenderer }
  } catch (error) {
    vm.quit()
    cleanupRenderer()
    throw error
  }
}

const createVmSafeProject = async (
  source: RawSb3Project,
  input: Sb3Input,
  projectName: string,
): Promise<{ input: Sb3Input; projectJson: Record<string, unknown> }> => {
  const projectJson = structuredClone(source.projectJson)
  if (!Array.isArray(projectJson.targets)) return { input, projectJson }
  const targets: unknown[] = projectJson.targets
  const entryByName = new Map(source.entries.map((entry) => [entry.name, entry]))
  const addedEntries: RawSb3ArchiveEntry[] = []
  const storage = await createOfflineScratchStorage()
  let fallbackIndex = 0

  for (const [targetIndex, rawTarget] of targets.entries()) {
    if (typeof rawTarget !== 'object' || rawTarget === null || Array.isArray(rawTarget)) continue
    const target = rawTarget as Record<string, unknown>
    if (!Array.isArray(target.costumes)) continue
    for (const rawCostume of target.costumes) {
      if (typeof rawCostume !== 'object' || rawCostume === null || Array.isArray(rawCostume)) continue
      const costume = rawCostume as Record<string, unknown>
      const dataFormat = typeof costume.dataFormat === 'string' ? costume.dataFormat : ''
      if (!dataFormat) continue
      const path = typeof costume.md5ext === 'string' ? costume.md5ext : ''
      const entry = entryByName.get(path)
      const bytes = entry?.bytes
      const expectedId = typeof costume.assetId === 'string' ? costume.assetId : path.split('/').at(-1)?.split('.')[0]
      const assetType = dataFormat === DataFormat.SVG ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap
      const actualId = bytes
        ? String(storage.createAsset(assetType, dataFormat as DataFormat, bytes, '', true).assetId).toLowerCase()
        : ''
      if (bytes && expectedId?.toLowerCase() === actualId) continue

      const visual = resolveAutomaticVisual({
        isStage: target.isStage === true,
        projectName,
        targetName: typeof target.name === 'string' ? target.name : `Target ${targetIndex + 1}`,
        costumeName: typeof costume.name === 'string' ? costume.name : `Costume ${fallbackIndex + 1}`,
      })
      let fallbackBytes = new TextEncoder().encode(visual.data)
      let fallbackAsset = storage.createAsset(storage.AssetType.ImageVector, DataFormat.SVG, fallbackBytes, '', true)
      let assetId = String(fallbackAsset.assetId).toLowerCase()
      let fallbackPath = `${assetId}.svg`
      let collisionIndex = 0
      while (entryByName.has(fallbackPath) && entryByName.get(fallbackPath)?.bytes !== fallbackBytes) {
        collisionIndex += 1
        fallbackBytes = new TextEncoder().encode(
          `${visual.data}\n<!-- Scratch VM import fallback ${collisionIndex} -->`,
        )
        fallbackAsset = storage.createAsset(storage.AssetType.ImageVector, DataFormat.SVG, fallbackBytes, '', true)
        assetId = String(fallbackAsset.assetId).toLowerCase()
        fallbackPath = `${assetId}.svg`
      }

      costume.assetId = assetId
      costume.md5ext = fallbackPath
      costume.dataFormat = DataFormat.SVG
      costume.bitmapResolution = 1
      costume.rotationCenterX = visual.rotationCenterX
      costume.rotationCenterY = visual.rotationCenterY
      if (!entryByName.has(fallbackPath)) {
        const newEntry: RawSb3ArchiveEntry = {
          centralDirectoryIndex: source.entries.length + addedEntries.length,
          name: fallbackPath,
          filenameBytes: new TextEncoder().encode(fallbackPath),
          filenameEncoding: 'utf-8',
          isDirectory: false,
          bytes: fallbackBytes,
          sha256: '',
          compressionMethod: 8,
          crc32: '',
          compressedSize: 0,
          uncompressedSize: fallbackBytes.byteLength,
          flags: 0,
          externalAttributes: 0,
          localHeaderOffset: 0,
          date:
            source.entries.find((candidate) => candidate.name === source.projectEntryName)?.date ??
            new Date(0).toISOString(),
        }
        entryByName.set(fallbackPath, newEntry)
        addedEntries.push(newEntry)
      }
      fallbackIndex += 1
    }
  }

  if (fallbackIndex === 0) return { input, projectJson }
  const projectJsonBytes = new TextEncoder().encode(JSON.stringify(projectJson))
  const safeArchive = await exportLosslessSb3({
    ...source,
    projectJson,
    projectJsonBytes,
    entries: [...source.entries, ...addedEntries],
  })
  return { input: safeArchive, projectJson }
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}

const retainAssetData = async (
  canonical: CanonicalProject,
  projectJson: Record<string, unknown>,
  entries: readonly { name: string; bytes: Uint8Array }[],
): Promise<void> => {
  const targets = Array.isArray(projectJson.targets) ? projectJson.targets : []
  const entryByName = new Map(entries.map((entry) => [entry.name, entry.bytes]))
  const canonicalTargets = [canonical.stage, ...canonical.sprites]
  const storage = await createOfflineScratchStorage()
  for (const rawTarget of targets) {
    if (typeof rawTarget !== 'object' || rawTarget === null || Array.isArray(rawTarget)) continue
    const target = rawTarget as Record<string, unknown>
    const output = canonicalTargets.find((candidate) => candidate.name === target.name)
    if (!output) continue
    for (const kind of ['costumes', 'sounds'] as const) {
      const rawAssets = target[kind]
      if (!Array.isArray(rawAssets)) continue
      const canonicalAssets = output[kind]
      for (const [index, rawAsset] of rawAssets.entries()) {
        if (typeof rawAsset !== 'object' || rawAsset === null || Array.isArray(rawAsset)) continue
        const descriptor = rawAsset as Record<string, unknown>
        const path = typeof descriptor.md5ext === 'string' ? descriptor.md5ext : ''
        const asset = entryByName.get(path)
        const canonicalAsset = canonicalAssets[index]
        if (kind === 'costumes') {
          for (const key of ['bitmapResolution', 'rotationCenterX', 'rotationCenterY'] as const) {
            if (typeof descriptor[key] === 'number') (canonicalAsset as CanonicalCostume)[key] = descriptor[key]
          }
        }
        const format = canonicalAsset.dataFormat
        if (asset === undefined) {
          canonicalAsset.assetIssue = 'missing-archive-entry'
          continue
        }
        const expectedId =
          typeof descriptor.assetId === 'string' ? descriptor.assetId : path.split('/').at(-1)?.split('.')[0]
        const assetType =
          kind === 'sounds'
            ? storage.AssetType.Sound
            : format === 'svg'
              ? storage.AssetType.ImageVector
              : storage.AssetType.ImageBitmap
        const actualId = storage.createAsset(assetType, format as DataFormat, asset, '', true).assetId
        if (expectedId && String(actualId).toLowerCase() !== expectedId.toLowerCase()) {
          canonicalAsset.assetIssue = 'checksum-mismatch'
        }
        const mime =
          kind === 'sounds'
            ? format === 'mp3'
              ? 'audio/mpeg'
              : 'audio/wav'
            : format === 'svg'
              ? 'image/svg+xml'
              : format === 'jpg' || format === 'jpeg'
                ? 'image/jpeg'
                : format === 'bmp'
                  ? 'image/bmp'
                  : 'image/png'
        canonicalAsset.data = `data:${mime};base64,${toBase64(asset)}`
      }
    }
  }
}

const retainProjectMetadata = (canonical: CanonicalProject, source: CanonicalProject): void => {
  canonical.extensions = source.extensions
  canonical.meta = source.meta
  const targets = [canonical.stage, ...canonical.sprites]
  const sourceTargets = [source.stage, ...source.sprites]
  for (const target of targets) {
    const original = sourceTargets.find(({ name }) => name === target.name)
    if (!original) continue
    const sourceVariables = new Map(original.variables.map((variable) => [variable.name, variable]))
    for (const variable of target.variables) {
      if (sourceVariables.get(variable.name)?.cloud === true) variable.cloud = true
    }
    for (const key of ['currentCostume', 'volume', 'layerOrder'] as const) {
      if (original[key] !== undefined) target[key] = original[key]
    }
    if (target.kind === 'sprite' && original.kind === 'sprite') {
      target.x = original.x
      target.y = original.y
      target.direction = original.direction
      target.size = original.size
      target.visible = original.visible
      target.draggable = original.draggable
      target.rotationStyle = original.rotationStyle
    }
    if (target.kind !== 'stage' || original.kind !== 'stage') continue
    for (const key of ['tempo', 'videoTransparency', 'videoState', 'textToSpeechLanguage'] as const) {
      if (original[key] !== undefined) Object.assign(target, { [key]: original[key] })
    }
  }
}

export interface DecompiledScratchProject {
  canonical: CanonicalProject
  canonicalBlockMappings: CanonicalBlockMappingEntry[]
  rawBlockGraphs: ScratchTargetBlockGraph[]
  rawArchive: RawSb3Project
  archiveWarnings: string[]
  procedureNormalizationReport: ProcedureNormalizationReport
}

export interface VmNormalizedScratchProject {
  readonly archive: Blob
  readonly report: VmNormalizationReport
}

/**
 * Load an SB3 through the official Scratch VM and return its VM-written archive plus an exhaustive change report.
 * The source archive remains available through `importLosslessSb3`/`exportLosslessSb3` and is never mutated.
 * @param input Original SB3 archive bytes.
 * @returns VM-normalized SB3 and JSON/asset differences from the source.
 */
export const normalizeThroughVm = async (input: Sb3Input): Promise<VmNormalizedScratchProject> => {
  const sourceArchive = await importLosslessSb3(input)
  assertScratchProjectBlockLimits(sourceArchive.projectJson)
  const { vm, cleanupRenderer } = await loadProjectVm(input, sourceArchive.projectJson)
  try {
    const normalizedBlob = await saveSb3(vm)
    const normalizedArchive = await importLosslessSb3(normalizedBlob)
    return {
      archive: normalizedBlob,
      report: createVmNormalizationReport(sourceArchive, normalizedArchive),
    }
  } finally {
    vm.quit()
    cleanupRenderer()
  }
}

export const decompileSb3 = async (
  input: Sb3Input,
  projectName = 'Imported Scratch Project',
): Promise<CanonicalProject> => {
  const archive = await importLosslessSb3(input)
  assertScratchProjectBlockLimits(archive.projectJson)
  const safeInput = await createVmSafeProject(archive, input, projectName)
  const { vm, cleanupRenderer } = await loadProjectVm(safeInput.input, safeInput.projectJson)
  try {
    const canonical = projectJsonToCanonical(getProjectJson(vm), projectName)
    retainProjectMetadata(canonical, projectJsonToCanonical(archive.projectJson, projectName))
    await retainAssetData(canonical, archive.projectJson, archive.entries)
    return canonical
  } finally {
    vm.quit()
    cleanupRenderer()
  }
}

/**
 * Decompile an SB3 while retaining a graph snapshot from the unnormalized source JSON.
 * @param input SB3 bytes or a browser Blob.
 * @param projectName Display name for the Canonical IR projection.
 * @returns Canonical IR, source block graphs, and archive-boundary warnings.
 */
export const decompileSb3WithBlockGraphs = async (
  input: Sb3Input,
  projectName = 'Imported Scratch Project',
): Promise<DecompiledScratchProject> => {
  const archive = await importLosslessSb3(input)
  assertScratchProjectBlockLimits(archive.projectJson)
  const safeInput = await createVmSafeProject(archive, input, projectName)
  const { vm, cleanupRenderer } = await loadProjectVm(safeInput.input, safeInput.projectJson)
  try {
    const vmProject = projectJsonToCanonicalWithReport(getProjectJson(vm), projectName)
    const canonical = vmProject.canonical
    retainProjectMetadata(canonical, projectJsonToCanonical(archive.projectJson, projectName))
    await retainAssetData(canonical, archive.projectJson, archive.entries)
    return {
      canonical,
      canonicalBlockMappings: vmProject.canonicalBlockMappings,
      rawBlockGraphs: extractProjectBlockGraphs(archive.projectJson),
      rawArchive: archive,
      archiveWarnings: [...archive.warnings],
      procedureNormalizationReport: projectJsonToCanonicalWithReport(archive.projectJson, projectName)
        .procedureNormalizationReport,
    }
  } finally {
    vm.quit()
    cleanupRenderer()
  }
}
