import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { CanonicalCostume, CanonicalProject, CanonicalSound, CanonicalTargetBase } from '../ir/types'
import { BACKDROP_CATALOG, soundInfo, SPRITE_CATALOG, type CatalogInfo } from './library-catalog'
import libraryIndex from './library-index.json'
import {
  ZH_BACKDROP_KEYWORDS as ZH_BACKDROP_BASE,
  ZH_SOUND_KEYWORDS as ZH_SOUND_BASE,
  ZH_SPRITE_KEYWORDS as ZH_SPRITE_BASE,
} from './library-zh'

/**
 * The hand-written keyword table plus every Chinese name in the catalog, so each library entry can be found by a
 * Chinese word. Entries from the hand-written table come first for a shared keyword.
 * @param base - Keyword → library names.
 * @param catalog - Library name → catalog entry with Chinese names.
 * @returns Merged keyword table.
 */
const withCatalogNames = (
  base: Readonly<Record<string, readonly string[]>>,
  catalog: Readonly<Record<string, CatalogInfo<string> | undefined>>,
): Readonly<Record<string, readonly string[]>> => {
  const merged = new Map(Object.entries(base).map(([word, names]) => [word, [...names]]))
  for (const [name, entry] of Object.entries(catalog))
    for (const word of entry?.zh ?? []) {
      const names = merged.get(word) ?? []
      if (!names.includes(name)) names.push(name)
      merged.set(word, names)
    }
  return Object.fromEntries(merged)
}

const ZH_SPRITE_KEYWORDS = withCatalogNames(ZH_SPRITE_BASE, SPRITE_CATALOG)
const ZH_BACKDROP_KEYWORDS = withCatalogNames(ZH_BACKDROP_BASE, BACKDROP_CATALOG)

/** Chinese keyword → library names for sprites and backdrops, hand-written entries plus every catalog name. */
export const SPRITE_KEYWORDS = ZH_SPRITE_KEYWORDS
export const BACKDROP_KEYWORDS = ZH_BACKDROP_KEYWORDS

type CostumeTuple = [
  name: string,
  md5ext: string,
  rotationCenterX: number,
  rotationCenterY: number,
  bitmapResolution: number,
  /** Width and height in stage pixels, measured by the index generator. */
  width?: number,
  height?: number,
]
type SoundTuple = [name: string, md5ext: string, rate: number, sampleCount: number]

export interface LibrarySprite {
  readonly name: string
  readonly tags: readonly string[]
  readonly costumes: readonly CostumeTuple[]
  readonly sounds: readonly SoundTuple[]
}

export interface LibraryBackdrop {
  readonly name: string
  readonly tags: readonly string[]
  readonly costume: CostumeTuple
}

export interface LibrarySound {
  readonly name: string
  readonly tags: readonly string[]
  readonly sound: SoundTuple
}

const index = libraryIndex as unknown as {
  sprites: LibrarySprite[]
  backdrops: LibraryBackdrop[]
  sounds: LibrarySound[]
}

export const LIBRARY_SPRITES: readonly LibrarySprite[] = index.sprites
export const LIBRARY_BACKDROPS: readonly LibraryBackdrop[] = index.backdrops
export const LIBRARY_SOUNDS: readonly LibrarySound[] = index.sounds

const ZH_SOUND_KEYWORDS = withCatalogNames(
  ZH_SOUND_BASE,
  Object.fromEntries(LIBRARY_SOUNDS.map((sound) => [sound.name, soundInfo(sound.name)])),
)

export const SCRATCH_ASSET_ORIGIN = 'https://assets.scratch.mit.edu'

const key = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ')

const byName = <T extends { name: string }>(entries: readonly T[]): Map<string, T> =>
  new Map(entries.map((entry) => [key(entry.name), entry]))

const spritesByName = byName(LIBRARY_SPRITES)
const backdropsByName = byName(LIBRARY_BACKDROPS)
const soundsByName = byName(LIBRARY_SOUNDS)
const spriteCostumesByName = new Map<string, { sprite: LibrarySprite; costume: CostumeTuple }>()
const spriteSoundsByName = new Map<string, SoundTuple>()
for (const sprite of LIBRARY_SPRITES) {
  for (const costume of sprite.costumes) {
    if (!spriteCostumesByName.has(key(costume[0]))) spriteCostumesByName.set(key(costume[0]), { sprite, costume })
  }
  for (const sound of sprite.sounds) {
    if (!spriteSoundsByName.has(key(sound[0]))) spriteSoundsByName.set(key(sound[0]), sound)
  }
}

export const findLibrarySprite = (name: string): LibrarySprite | undefined => spritesByName.get(key(name))
export const findLibraryBackdrop = (name: string): LibraryBackdrop | undefined => backdropsByName.get(key(name))
export const findLibrarySound = (name: string): SoundTuple | undefined =>
  soundsByName.get(key(name))?.sound ?? spriteSoundsByName.get(key(name))

const keywordMatches = (text: string, table: Readonly<Record<string, readonly string[]>>): string[] => {
  // Longer keywords first so 北極熊 wins over 熊 and 遊戲結束 is considered before shorter words.
  const keywords = Object.keys(table)
    .filter((keyword) => text.includes(keyword))
    .sort((a, b) => b.length - a.length)
  return [...new Set(keywords.flatMap((keyword) => table[keyword] ?? []))]
}

const englishMatches = <T extends { name: string }>(text: string, entries: readonly T[]): string[] => {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  return entries
    .filter((entry) => {
      const name = entry.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
      return name.length >= 3 && lower.includes(` ${name} `)
    })
    .map((entry) => entry.name)
}

/**
 * Sprite library entry that best matches a free-text role description (Chinese keywords or English names).
 * @param text - Sprite or costume name, or any role description.
 * @returns Matching library sprite, if any.
 */
export const matchLibrarySprite = (text: string): LibrarySprite | undefined => {
  const exact = findLibrarySprite(text)
  if (exact) return exact
  const name = [...englishMatches(text, LIBRARY_SPRITES), ...keywordMatches(text, ZH_SPRITE_KEYWORDS)][0]
  return name ? findLibrarySprite(name) : undefined
}

export const matchLibraryBackdrop = (text: string): LibraryBackdrop | undefined => {
  const exact = findLibraryBackdrop(text)
  if (exact) return exact
  const name = [...englishMatches(text, LIBRARY_BACKDROPS), ...keywordMatches(text, ZH_BACKDROP_KEYWORDS)][0]
  return name ? findLibraryBackdrop(name) : undefined
}

export const matchLibrarySound = (text: string): SoundTuple | undefined => {
  const exact = findLibrarySound(text)
  if (exact) return exact
  const name = keywordMatches(text, ZH_SOUND_KEYWORDS)[0]
  return name ? findLibrarySound(name) : undefined
}

export interface LibraryCandidates {
  readonly sprites: readonly LibrarySprite[]
  readonly backdrops: readonly LibraryBackdrop[]
  readonly sounds: readonly string[]
}

const STAPLE_SPRITES = ['Cat', 'Avery Walking', 'Ball', 'Star', 'Heart', 'Rocks', 'Apple', 'Button2', 'Arrow1']
const STAPLE_BACKDROPS = ['Blue Sky', 'Forest', 'Space', 'Underwater 1', 'School', 'Night City']
const STAPLE_SOUNDS = ['Pop', 'Coin', 'Collect', 'Jump', 'Laser1', 'Bonk', 'Oops', 'Win', 'Lose', 'Video Game 1']

const unique = <T>(values: readonly (T | undefined)[]): T[] => [
  ...new Set(values.filter((value): value is T => value !== undefined)),
]

/**
 * Choose a small set of library entries relevant to a project idea so the prompt stays short and the model can
 * only pick assets that exist.
 * @param text - Project idea and brief.
 * @param limits - Maximum number of entries per kind.
 * @param limits.sprites - Sprite limit (default 24).
 * @param limits.backdrops - Backdrop limit (default 10).
 * @param limits.sounds - Sound limit (default 16).
 * @returns Candidate sprites, backdrops and sound names.
 */
export const selectLibraryCandidates = (
  text: string,
  limits: { sprites?: number; backdrops?: number; sounds?: number } = {},
): LibraryCandidates => {
  const spriteNames = unique([
    ...keywordMatches(text, ZH_SPRITE_KEYWORDS),
    ...englishMatches(text, LIBRARY_SPRITES),
    ...STAPLE_SPRITES,
  ])
  const backdropNames = unique([
    ...keywordMatches(text, ZH_BACKDROP_KEYWORDS),
    ...englishMatches(text, LIBRARY_BACKDROPS),
    ...STAPLE_BACKDROPS,
  ])
  const soundNames = unique([...keywordMatches(text, ZH_SOUND_KEYWORDS), ...STAPLE_SOUNDS])
  return {
    sprites: unique(spriteNames.map(findLibrarySprite)).slice(0, limits.sprites ?? 24),
    backdrops: unique(backdropNames.map(findLibraryBackdrop)).slice(0, limits.backdrops ?? 10),
    sounds: soundNames.filter((name) => findLibrarySound(name)).slice(0, limits.sounds ?? 16),
  }
}

/**
 * Prompt lines listing the candidate assets with the exact costume and sound names the model may use.
 * @param candidates - Result of selectLibraryCandidates.
 * @returns Multi-line prompt text.
 */
export const formatLibraryCandidates = (candidates: LibraryCandidates): string =>
  [
    '可用角色素材（名稱 → 造型名稱；音效）：',
    ...candidates.sprites.map((sprite) => {
      const costumes = sprite.costumes.slice(0, 6).map(([name]) => name)
      const sounds = sprite.sounds.slice(0, 3).map(([name]) => name)
      return `- ${sprite.name} → ${costumes.join(', ')}${sounds.length ? `；${sounds.join(', ')}` : ''}`
    }),
    `可用背景：${candidates.backdrops.map((backdrop) => backdrop.name).join(', ')}`,
    `可用音效：${candidates.sounds.join(', ')}`,
  ].join('\n')

export type LibraryAssetFetcher = ((md5ext: string) => Promise<Uint8Array>) & {
  readonly cacheHits?: ReadonlySet<string>
}

const LIBRARY_CACHE_NAME = 'scratch-ai-bridge.asset-library.v1'

/**
 * Fetch official library assets by md5ext and verify the bytes against the MD5 in the name before use.
 * @param fetcher - fetch implementation (browser or Node).
 * @returns Caching fetcher keyed by md5ext.
 */
export const createScratchAssetFetcher = (fetcher: typeof fetch = fetch): LibraryAssetFetcher => {
  const cache = new Map<string, Promise<Uint8Array>>()
  const cacheHits = new Set<string>()
  const persistentCachePromise =
    typeof globalThis.caches === 'undefined'
      ? Promise.resolve<Cache | undefined>(undefined)
      : globalThis.caches.open(LIBRARY_CACHE_NAME).catch(() => undefined)
  const requestAsset = async (md5ext: string): Promise<Uint8Array> => {
    if (!/^[0-9a-f]{32}\.(svg|png|wav)$/.test(md5ext)) throw new Error(`Unexpected library asset name ${md5ext}`)
    const url = `${SCRATCH_ASSET_ORIGIN}/internalapi/asset/${md5ext}/get/`
    const persistentCache = await persistentCachePromise
    const cachedResponse = await persistentCache?.match(url)
    if (cachedResponse) {
      const cachedBytes = new Uint8Array(await cachedResponse.arrayBuffer())
      if (bytesToHex(md5(cachedBytes)) === md5ext.slice(0, 32)) {
        cacheHits.add(md5ext)
        return cachedBytes
      }
    }
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`Scratch asset ${md5ext} returned HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytesToHex(md5(bytes)) !== md5ext.slice(0, 32)) throw new Error(`Scratch asset ${md5ext} failed MD5 check`)
    try {
      await persistentCache?.put(
        url,
        new Response(bytes, { headers: { 'content-type': response.headers.get('content-type') ?? '' } }),
      )
    } catch {
      // Cache Storage is an enhancement; a private browser or quota failure must not block compilation.
    }
    return bytes
  }
  const request = Object.assign(
    (md5ext: string) => {
      const cached = cache.get(md5ext)
      if (cached) return cached
      const request = requestAsset(md5ext)
      cache.set(md5ext, request)
      request.catch(() => cache.delete(md5ext))
      return request
    },
    { cacheHits },
  )
  return request
}

const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', wav: 'audio/wav' }

const toDataUrl = (bytes: Uint8Array, format: string): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${MIME[format] ?? 'application/octet-stream'};base64,${btoa(binary)}`
}

const formatOf = (md5ext: string): string => md5ext.slice(md5ext.lastIndexOf('.') + 1)

export interface LibraryResolutionReport {
  /** Costumes and backdrops filled with official library artwork. */
  readonly libraryCostumes: number
  /** Extra animation costumes appended from a matched library sprite. */
  readonly addedAnimationCostumes: number
  readonly librarySounds: number
  /** Costumes still without artwork; the compiler draws a simple placeholder for these. */
  readonly placeholderCostumes: readonly string[]
  /** Sounds still without audio; the compiler stores silence for these. */
  readonly silentSounds: readonly string[]
  /** Official assets served from the browser's persistent Cache Storage. */
  readonly cacheHits: readonly string[]
  /** Inline SVG written by the model that was replaced with library artwork. */
  readonly replacedModelSvg: number
  readonly fetchFailures: readonly string[]
}

export interface ResolveLibraryAssetsOptions {
  /**
   * Replace SVG artwork the model drew itself when a library match exists. Only use this for model-generated
   * projects; artwork from imported SB3 files must be kept.
   */
  readonly replaceModelSvg?: boolean
}

interface CostumePlan {
  readonly costume: CostumeTuple
  readonly sprite?: LibrarySprite
}

const planSpriteCostume = (target: CanonicalTargetBase, costume: CanonicalCostume): CostumePlan | undefined => {
  const exactCostume = spriteCostumesByName.get(key(costume.name))
  if (exactCostume) return exactCostume
  const sprite = matchLibrarySprite(costume.name) ?? matchLibrarySprite(target.name)
  const first = sprite?.costumes[0]
  return sprite && first ? { costume: first, sprite } : undefined
}

const planBackdrop = (projectName: string, costume: CanonicalCostume): CostumePlan | undefined => {
  const backdrop = matchLibraryBackdrop(costume.name) ?? matchLibraryBackdrop(projectName)
  return backdrop ? { costume: backdrop.costume } : undefined
}

const isModelSvg = (costume: CanonicalCostume): boolean =>
  costume.dataFormat === 'svg' && typeof costume.data === 'string' && costume.data.length > 0

/**
 * Fill costumes and sounds that have no data with official Scratch library assets. Entries with no match, or whose
 * download fails, are left for the compiler's placeholder.
 * @param project - Canonical project; it is not modified.
 * @param fetchAsset - Downloads library asset bytes by md5ext.
 * @param options - Resolution options.
 * @returns A new project with library assets filled in, and a report of what was used.
 */
export const resolveLibraryAssets = async (
  project: CanonicalProject,
  fetchAsset: LibraryAssetFetcher,
  options: ResolveLibraryAssetsOptions = {},
): Promise<{ project: CanonicalProject; report: LibraryResolutionReport }> => {
  const result = structuredClone(project)
  let libraryCostumes = 0
  let addedAnimationCostumes = 0
  let librarySounds = 0
  let replacedModelSvg = 0
  const placeholderCostumes: string[] = []
  const silentSounds: string[] = []
  const cacheHits = new Set<string>()
  const fetchFailures: string[] = []

  const load = async (md5ext: string): Promise<string | undefined> => {
    try {
      const bytes = await fetchAsset(md5ext)
      if (fetchAsset.cacheHits?.has(md5ext)) cacheHits.add(md5ext)
      return toDataUrl(bytes, formatOf(md5ext))
    } catch (error) {
      fetchFailures.push(`${md5ext}: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  const fillCostume = async (costume: CanonicalCostume, tuple: CostumeTuple): Promise<boolean> => {
    const data = await load(tuple[1])
    if (!data) return false
    costume.data = data
    costume.dataFormat = formatOf(tuple[1]) as CanonicalCostume['dataFormat']
    costume.rotationCenterX = tuple[2]
    costume.rotationCenterY = tuple[3]
    costume.bitmapResolution = tuple[4]
    delete costume.assetIssue
    return true
  }

  const fillSound = async (sound: CanonicalSound, tuple: SoundTuple): Promise<boolean> => {
    const data = await load(tuple[1])
    if (!data) return false
    sound.data = data
    sound.dataFormat = 'wav'
    sound.rate = tuple[2]
    sound.sampleCount = tuple[3]
    return true
  }

  const resolveTarget = async (target: CanonicalTargetBase, isStage: boolean): Promise<void> => {
    const pending = target.costumes.filter(
      (costume) => !costume.data || (options.replaceModelSvg === true && isModelSvg(costume)),
    )
    let matchedSprite: LibrarySprite | undefined
    await Promise.all(
      pending.map(async (costume) => {
        const hadModelSvg = isModelSvg(costume)
        const plan = isStage ? planBackdrop(result.name, costume) : planSpriteCostume(target, costume)
        if (plan && (await fillCostume(costume, plan.costume))) {
          libraryCostumes += 1
          if (hadModelSvg) replacedModelSvg += 1
          matchedSprite ??= plan.sprite
          return
        }
        if (!hadModelSvg) placeholderCostumes.push(`${target.name}/${costume.name}`)
      }),
    )

    // A single requested costume that matched a whole library sprite gets that sprite's other costumes, so
    // "next costume" animates, and its sounds when the model listed none.
    if (!isStage && matchedSprite && target.costumes.length === 1) {
      const existing = new Set(target.costumes.map((costume) => key(costume.name)))
      const extras = matchedSprite.costumes.slice(1).filter(([name]) => !existing.has(key(name)))
      const added = await Promise.all(
        extras.map(async (tuple) => {
          const costume: CanonicalCostume = { name: tuple[0], dataFormat: 'svg' }
          return (await fillCostume(costume, tuple)) ? costume : undefined
        }),
      )
      for (const costume of added) {
        if (!costume) continue
        target.costumes.push(costume)
        addedAnimationCostumes += 1
      }
      if (target.sounds.length === 0) {
        for (const tuple of matchedSprite.sounds) {
          const sound: CanonicalSound = { name: tuple[0], dataFormat: 'wav' }
          if (await fillSound(sound, tuple)) {
            target.sounds.push(sound)
            librarySounds += 1
          }
        }
      }
    }

    await Promise.all(
      target.sounds
        .filter((sound) => !sound.data)
        .map(async (sound) => {
          const tuple = matchLibrarySound(sound.name)
          if (tuple && (await fillSound(sound, tuple))) {
            librarySounds += 1
            return
          }
          silentSounds.push(`${target.name}/${sound.name}`)
        }),
    )
  }

  await resolveTarget(result.stage, true)
  for (const sprite of result.sprites) await resolveTarget(sprite, false)

  return {
    project: result,
    report: {
      libraryCostumes,
      addedAnimationCostumes,
      librarySounds,
      placeholderCostumes,
      silentSounds,
      cacheHits: [...cacheHits],
      replacedModelSvg,
      fetchFailures,
    },
  }
}

/**
 * Student-facing sentences describing which assets came from the library and which are placeholders.
 * @param report - Result report of resolveLibraryAssets.
 * @returns Text for the status line; empty when nothing to say.
 */
export const describeLibraryResolution = (report: LibraryResolutionReport): string => {
  const parts: string[] = []
  if (report.libraryCostumes + report.addedAnimationCostumes > 0)
    parts.push(`已放入 ${report.libraryCostumes + report.addedAnimationCostumes} 個 Scratch 官方造型／背景`)
  if (report.librarySounds > 0) parts.push(`${report.librarySounds} 個官方音效`)
  const sentences = parts.length > 0 ? [`${parts.join('、')}。`] : []
  if (report.placeholderCostumes.length > 0)
    sentences.push(
      `${report.placeholderCostumes.length} 個造型找不到對應素材，先用簡單圖形代替（${report.placeholderCostumes.slice(0, 3).join('、')}），可在 Scratch 裡換掉。`,
    )
  if (report.silentSounds.length > 0)
    sentences.push(`${report.silentSounds.length} 個音效找不到對應素材，目前是無聲的。`)
  if (report.cacheHits.length > 0) sentences.push(`離線時使用了 ${report.cacheHits.length} 個本機快取素材。`)
  if (report.fetchFailures.length > 0) sentences.push('部分官方素材下載失敗（可能沒有網路），已改用簡單圖形。')
  return sentences.join('')
}
