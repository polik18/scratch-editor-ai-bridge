import { md5 } from '@noble/hashes/legacy'
import { bytesToHex } from '@noble/hashes/utils'
import type { RawSb3Project } from '../archive'
import type { CanonicalCostume, CanonicalSound } from '../ir/types'

export type AssetCatalogKind = 'costume' | 'backdrop' | 'sound' | 'sprite'

export interface CatalogCostumeEntry {
  readonly kind: 'costume' | 'backdrop'
  readonly name: string
  readonly assetId: string
  readonly md5ext: string
  readonly dataFormat: 'svg' | 'png' | 'jpg'
  readonly bitmapResolution?: number
  readonly rotationCenterX?: number
  readonly rotationCenterY?: number
  readonly tags: readonly string[]
}

export interface CatalogSoundEntry {
  readonly kind: 'sound'
  readonly name: string
  readonly assetId: string
  readonly md5ext: string
  readonly dataFormat: 'wav' | 'mp3'
  readonly rate?: number
  readonly sampleCount?: number
  readonly tags: readonly string[]
}

export interface CatalogSpriteEntry {
  readonly kind: 'sprite'
  readonly name: string
  readonly tags: readonly string[]
  readonly costumes: readonly CatalogCostumeEntry[]
  readonly sounds: readonly CatalogSoundEntry[]
}

export type CatalogEntry = CatalogCostumeEntry | CatalogSoundEntry | CatalogSpriteEntry

export interface AssetLibraryCatalog {
  readonly catalogRevision: string
  readonly costumes: readonly CatalogCostumeEntry[]
  readonly backdrops: readonly CatalogCostumeEntry[]
  readonly sounds: readonly CatalogSoundEntry[]
  readonly sprites: readonly CatalogSpriteEntry[]
}

export interface AssetLibraryReference {
  readonly kind: 'costume' | 'backdrop' | 'sound' | 'sprite'
  readonly name: string
  readonly md5ext?: string
  readonly catalogRevision?: string
}

export type AssetProvenanceKind =
  'scratch-catalog-exact' | 'embedded-non-catalog' | 'missing-archive-entry' | 'checksum-mismatch'

export interface ProjectAssetProvenanceItem {
  readonly targetIndex: number
  readonly targetName: string
  readonly isStage: boolean
  readonly kind: 'costume' | 'backdrop' | 'sound'
  readonly name: string
  readonly assetId: string
  readonly md5ext: string
  readonly dataFormat: string
  readonly entryPresent: boolean
  readonly md5Verified: boolean
  readonly provenance: AssetProvenanceKind
  readonly catalogMatches: readonly string[]
  readonly catalogRevision: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toTags = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const parseCostumeEntry = (raw: unknown, kind: 'costume' | 'backdrop'): CatalogCostumeEntry => {
  if (
    !isRecord(raw) ||
    typeof raw.name !== 'string' ||
    typeof raw.assetId !== 'string' ||
    typeof raw.md5ext !== 'string' ||
    (raw.dataFormat !== 'svg' && raw.dataFormat !== 'png' && raw.dataFormat !== 'jpg')
  ) {
    throw new Error(`Invalid ${kind} catalog entry`)
  }
  return {
    kind,
    name: raw.name,
    assetId: raw.assetId,
    md5ext: raw.md5ext,
    dataFormat: raw.dataFormat,
    ...(typeof raw.bitmapResolution === 'number' ? { bitmapResolution: raw.bitmapResolution } : {}),
    ...(typeof raw.rotationCenterX === 'number' ? { rotationCenterX: raw.rotationCenterX } : {}),
    ...(typeof raw.rotationCenterY === 'number' ? { rotationCenterY: raw.rotationCenterY } : {}),
    tags: toTags(raw.tags),
  }
}

const parseSoundEntry = (raw: unknown): CatalogSoundEntry => {
  if (
    !isRecord(raw) ||
    typeof raw.name !== 'string' ||
    typeof raw.assetId !== 'string' ||
    typeof raw.md5ext !== 'string' ||
    (raw.dataFormat !== 'wav' && raw.dataFormat !== 'mp3')
  ) {
    throw new Error('Invalid sound catalog entry')
  }
  return {
    kind: 'sound',
    name: raw.name,
    assetId: raw.assetId,
    md5ext: raw.md5ext,
    dataFormat: raw.dataFormat,
    ...(typeof raw.rate === 'number' ? { rate: raw.rate } : {}),
    ...(typeof raw.sampleCount === 'number' ? { sampleCount: raw.sampleCount } : {}),
    tags: toTags(raw.tags),
  }
}

export const createAssetLibraryCatalog = (input: {
  readonly catalogRevision: string
  readonly costumes?: readonly unknown[]
  readonly backdrops?: readonly unknown[]
  readonly sounds?: readonly unknown[]
  readonly sprites?: readonly unknown[]
}): AssetLibraryCatalog => {
  if (!input.catalogRevision.trim()) throw new Error('catalogRevision must be a non-empty string')
  const costumes = (input.costumes ?? []).map((entry) => parseCostumeEntry(entry, 'costume'))
  const backdrops = (input.backdrops ?? []).map((entry) => parseCostumeEntry(entry, 'backdrop'))
  const sounds = (input.sounds ?? []).map((entry) => parseSoundEntry(entry))
  const sprites: CatalogSpriteEntry[] = (input.sprites ?? []).map((raw) => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !Array.isArray(raw.costumes) || raw.costumes.length === 0) {
      throw new Error('Invalid sprite catalog entry')
    }
    return {
      kind: 'sprite',
      name: raw.name,
      tags: toTags(raw.tags),
      costumes: raw.costumes.map((costume) => parseCostumeEntry(costume, 'costume')),
      sounds: Array.isArray(raw.sounds) ? raw.sounds.map((sound) => parseSoundEntry(sound)) : [],
    }
  })
  return {
    catalogRevision: input.catalogRevision,
    costumes,
    backdrops,
    sounds,
    sprites,
  }
}

export const queryAssetLibrary = (
  catalog: AssetLibraryCatalog,
  options: {
    readonly kind: AssetCatalogKind
    readonly query?: string
    readonly tag?: string
    readonly md5ext?: string
    readonly offset?: number
    readonly limit?: number
  },
) => {
  const offset = options.offset ?? 0
  const limit = options.limit ?? 20
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 30) {
    throw new Error('Invalid catalog page request')
  }
  const source: readonly CatalogEntry[] =
    options.kind === 'costume'
      ? catalog.costumes
      : options.kind === 'backdrop'
        ? catalog.backdrops
        : options.kind === 'sound'
          ? catalog.sounds
          : catalog.sprites
  const queryLower = options.query?.trim().toLowerCase()
  const tagLower = options.tag?.trim().toLowerCase()
  const filtered = source.filter((entry) => {
    if (options.md5ext !== undefined) {
      if (entry.kind === 'sprite') {
        if (!entry.costumes.some((c) => c.md5ext === options.md5ext)) return false
      } else if (entry.md5ext !== options.md5ext) {
        return false
      }
    }
    if (tagLower && !entry.tags.some((t) => t.toLowerCase() === tagLower)) return false
    if (queryLower) {
      const nameMatches = entry.name.toLowerCase().includes(queryLower)
      const tagMatches = entry.tags.some((t) => t.toLowerCase().includes(queryLower))
      if (!nameMatches && !tagMatches) return false
    }
    return true
  })
  const items = filtered.slice(offset, offset + limit)
  return {
    catalogRevision: catalog.catalogRevision,
    kind: options.kind,
    offset,
    items,
    nextOffset: offset + items.length < filtered.length ? offset + items.length : null,
    total: filtered.length,
  }
}

const verifyAssetBytes = (bytes: Uint8Array, expectedAssetId: string, expectedMd5ext: string): string => {
  const actualAssetId = bytesToHex(md5(bytes))
  if (actualAssetId !== expectedAssetId || !expectedMd5ext.startsWith(`${actualAssetId}.`)) {
    throw new Error(
      `Catalog asset MD5 mismatch for "${expectedMd5ext}": expected ${expectedAssetId}, got ${actualAssetId}`,
    )
  }
  return Buffer.from(bytes).toString('base64')
}

export const resolveVerifiedCatalogAsset = async (
  catalog: AssetLibraryCatalog,
  reference: AssetLibraryReference,
  loadBytes: (md5ext: string) => Promise<Uint8Array>,
): Promise<
  | {
      readonly kind: 'costume' | 'backdrop'
      readonly catalogRevision: string
      readonly provenance: 'scratch-catalog-exact'
      readonly assetId: string
      readonly md5ext: string
      readonly costume: CanonicalCostume
    }
  | {
      readonly kind: 'sound'
      readonly catalogRevision: string
      readonly provenance: 'scratch-catalog-exact'
      readonly assetId: string
      readonly md5ext: string
      readonly sound: CanonicalSound
    }
  | {
      readonly kind: 'sprite'
      readonly catalogRevision: string
      readonly provenance: 'scratch-catalog-exact'
      readonly name: string
      readonly costumes: readonly CanonicalCostume[]
      readonly sounds: readonly CanonicalSound[]
    }
> => {
  if (reference.catalogRevision && reference.catalogRevision !== catalog.catalogRevision) {
    throw new Error(
      `Catalog revision mismatch: requested ${reference.catalogRevision}, current ${catalog.catalogRevision}`,
    )
  }
  if (reference.kind === 'sprite') {
    const matches = catalog.sprites.filter((entry) => entry.name === reference.name)
    if (matches.length === 0) throw new Error(`Catalog sprite "${reference.name}" was not found`)
    if (matches.length > 1) {
      throw new Error(`Catalog sprite "${reference.name}" is ambiguous (${matches.length} entries)`)
    }
    const sprite = matches[0]
    const costumes: CanonicalCostume[] = []
    for (const entry of sprite.costumes) {
      const bytes = await loadBytes(entry.md5ext)
      const base64 = verifyAssetBytes(bytes, entry.assetId, entry.md5ext)
      costumes.push({
        name: entry.name,
        dataFormat: entry.dataFormat,
        data: base64,
        ...(entry.bitmapResolution !== undefined ? { bitmapResolution: entry.bitmapResolution } : {}),
        ...(entry.rotationCenterX !== undefined ? { rotationCenterX: entry.rotationCenterX } : {}),
        ...(entry.rotationCenterY !== undefined ? { rotationCenterY: entry.rotationCenterY } : {}),
      })
    }
    const sounds: CanonicalSound[] = []
    for (const entry of sprite.sounds) {
      const bytes = await loadBytes(entry.md5ext)
      const base64 = verifyAssetBytes(bytes, entry.assetId, entry.md5ext)
      sounds.push({
        name: entry.name,
        dataFormat: entry.dataFormat,
        data: base64,
        ...(entry.rate !== undefined ? { rate: entry.rate } : {}),
        ...(entry.sampleCount !== undefined ? { sampleCount: entry.sampleCount } : {}),
      })
    }
    return {
      kind: 'sprite',
      catalogRevision: catalog.catalogRevision,
      provenance: 'scratch-catalog-exact',
      name: sprite.name,
      costumes,
      sounds,
    }
  }

  if (reference.kind === 'sound') {
    const matches = catalog.sounds.filter(
      (entry) =>
        entry.name === reference.name && (reference.md5ext === undefined || entry.md5ext === reference.md5ext),
    )
    if (matches.length === 0) {
      throw new Error(
        `Catalog sound "${reference.name}"${reference.md5ext ? ` (${reference.md5ext})` : ''} was not found`,
      )
    }
    if (matches.length > 1) {
      throw new Error(`Catalog sound "${reference.name}" is ambiguous; specify md5ext`)
    }
    const entry = matches[0]
    const bytes = await loadBytes(entry.md5ext)
    const base64 = verifyAssetBytes(bytes, entry.assetId, entry.md5ext)
    return {
      kind: 'sound',
      catalogRevision: catalog.catalogRevision,
      provenance: 'scratch-catalog-exact',
      assetId: entry.assetId,
      md5ext: entry.md5ext,
      sound: {
        name: entry.name,
        dataFormat: entry.dataFormat,
        data: base64,
        ...(entry.rate !== undefined ? { rate: entry.rate } : {}),
        ...(entry.sampleCount !== undefined ? { sampleCount: entry.sampleCount } : {}),
      },
    }
  }

  const pool = reference.kind === 'backdrop' ? catalog.backdrops : catalog.costumes
  const matches = pool.filter(
    (entry) => entry.name === reference.name && (reference.md5ext === undefined || entry.md5ext === reference.md5ext),
  )
  if (matches.length === 0) {
    throw new Error(
      `Catalog ${reference.kind} "${reference.name}"${reference.md5ext ? ` (${reference.md5ext})` : ''} was not found`,
    )
  }
  if (matches.length > 1) {
    throw new Error(`Catalog ${reference.kind} "${reference.name}" is ambiguous; specify md5ext`)
  }
  const entry = matches[0]
  const bytes = await loadBytes(entry.md5ext)
  const base64 = verifyAssetBytes(bytes, entry.assetId, entry.md5ext)
  return {
    kind: reference.kind,
    catalogRevision: catalog.catalogRevision,
    provenance: 'scratch-catalog-exact',
    assetId: entry.assetId,
    md5ext: entry.md5ext,
    costume: {
      name: entry.name,
      dataFormat: entry.dataFormat,
      data: base64,
      ...(entry.bitmapResolution !== undefined ? { bitmapResolution: entry.bitmapResolution } : {}),
      ...(entry.rotationCenterX !== undefined ? { rotationCenterX: entry.rotationCenterX } : {}),
      ...(entry.rotationCenterY !== undefined ? { rotationCenterY: entry.rotationCenterY } : {}),
    },
  }
}

export const inspectProjectAssetProvenance = (
  project: RawSb3Project,
  catalog: AssetLibraryCatalog,
): readonly ProjectAssetProvenanceItem[] => {
  const entriesByName = new Map(project.entries.map((entry) => [entry.name, entry.bytes]))
  const costumeMatchesByMd5ext = new Map<string, string[]>()
  for (const entry of [...catalog.costumes, ...catalog.backdrops]) {
    const list = costumeMatchesByMd5ext.get(entry.md5ext) ?? []
    if (!list.includes(`${entry.kind}:${entry.name}`)) list.push(`${entry.kind}:${entry.name}`)
    costumeMatchesByMd5ext.set(entry.md5ext, list)
  }
  const soundMatchesByMd5ext = new Map<string, string[]>()
  for (const entry of catalog.sounds) {
    const list = soundMatchesByMd5ext.get(entry.md5ext) ?? []
    if (!list.includes(`sound:${entry.name}`)) list.push(`sound:${entry.name}`)
    soundMatchesByMd5ext.set(entry.md5ext, list)
  }

  const rawTargets = Array.isArray(project.projectJson.targets) ? project.projectJson.targets : []
  const items: ProjectAssetProvenanceItem[] = []
  rawTargets.forEach((rawTarget: unknown, targetIndex: number) => {
    if (!isRecord(rawTarget) || typeof rawTarget.name !== 'string') return
    const isStage = rawTarget.isStage === true
    const targetName = rawTarget.name
    const costumes = Array.isArray(rawTarget.costumes) ? rawTarget.costumes : []
    for (const rawCostume of costumes) {
      if (!isRecord(rawCostume)) continue
      const name = typeof rawCostume.name === 'string' ? rawCostume.name : ''
      const assetId = typeof rawCostume.assetId === 'string' ? rawCostume.assetId : ''
      const dataFormat = typeof rawCostume.dataFormat === 'string' ? rawCostume.dataFormat : ''
      const md5ext = typeof rawCostume.md5ext === 'string' ? rawCostume.md5ext : `${assetId}.${dataFormat}`
      const bytes = entriesByName.get(md5ext)
      const entryPresent = bytes !== undefined
      const md5Verified = bytes !== undefined && bytesToHex(md5(bytes)) === assetId
      const catalogMatches = md5Verified ? (costumeMatchesByMd5ext.get(md5ext) ?? []) : []
      const provenance: AssetProvenanceKind = !entryPresent
        ? 'missing-archive-entry'
        : !md5Verified
          ? 'checksum-mismatch'
          : catalogMatches.length > 0
            ? 'scratch-catalog-exact'
            : 'embedded-non-catalog'
      items.push({
        targetIndex,
        targetName,
        isStage,
        kind: isStage ? 'backdrop' : 'costume',
        name,
        assetId,
        md5ext,
        dataFormat,
        entryPresent,
        md5Verified,
        provenance,
        catalogMatches,
        catalogRevision: catalog.catalogRevision,
      })
    }
    const sounds = Array.isArray(rawTarget.sounds) ? rawTarget.sounds : []
    for (const rawSound of sounds) {
      if (!isRecord(rawSound)) continue
      const name = typeof rawSound.name === 'string' ? rawSound.name : ''
      const assetId = typeof rawSound.assetId === 'string' ? rawSound.assetId : ''
      const dataFormat = typeof rawSound.dataFormat === 'string' ? rawSound.dataFormat : ''
      const md5ext = typeof rawSound.md5ext === 'string' ? rawSound.md5ext : `${assetId}.${dataFormat}`
      const bytes = entriesByName.get(md5ext)
      const entryPresent = bytes !== undefined
      const md5Verified = bytes !== undefined && bytesToHex(md5(bytes)) === assetId
      const catalogMatches = md5Verified ? (soundMatchesByMd5ext.get(md5ext) ?? []) : []
      const provenance: AssetProvenanceKind = !entryPresent
        ? 'missing-archive-entry'
        : !md5Verified
          ? 'checksum-mismatch'
          : catalogMatches.length > 0
            ? 'scratch-catalog-exact'
            : 'embedded-non-catalog'
      items.push({
        targetIndex,
        targetName,
        isStage,
        kind: 'sound',
        name,
        assetId,
        md5ext,
        dataFormat,
        entryPresent,
        md5Verified,
        provenance,
        catalogMatches,
        catalogRevision: catalog.catalogRevision,
      })
    }
  })
  return items
}
