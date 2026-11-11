import {
  BACKDROP_KEYWORDS,
  findLibraryBackdrop,
  findLibrarySound,
  findLibrarySprite,
  LIBRARY_BACKDROPS,
  LIBRARY_SOUNDS,
  LIBRARY_SPRITES,
  matchLibrarySound,
  SPRITE_KEYWORDS,
  type LibraryBackdrop,
  type LibrarySprite,
} from './library'
import {
  APPROXIMATIONS,
  BACKDROP_CATALOG,
  PERSON_SUFFIXES,
  soundInfo,
  SPRITE_CATALOG,
  type BackdropScene,
  type SoundCategory,
  type SpriteCategory,
} from './library-catalog'

/**
 * One place that turns a name or description into an official Scratch asset, for every path in the bridge (Game
 * Spec, Story Spec, model prompts, MCP, CLI, web). Each pick says how it matched and what else would fit, so
 * reports can tell authors which assets are stand-ins.
 */

export type AssetKind = 'sprite' | 'backdrop' | 'sound'

/**
 * - `exact`: the text is the asset's name.
 * - `keyword`: a Chinese or English word in the text names the asset.
 * - `approximate`: nothing official fits; a stand-in from the approximation table (see `note`).
 * - `category`: nothing matched the words; the first asset of the requested category.
 * - `none`: nothing found.
 */
export type MatchKind = 'exact' | 'keyword' | 'approximate' | 'category' | 'none'

export interface AssetPick {
  readonly kind: AssetKind
  readonly name?: string
  readonly match: MatchKind
  /** Why a stand-in was used, in the author's language. */
  readonly note?: string
  /** Other assets of the same category, best first. */
  readonly alternatives: readonly string[]
}

const simplify = (text: string): string => text.trim().toLowerCase()

type Stand = Readonly<Record<string, { readonly name: string; readonly note: string }>>

interface Candidate {
  readonly name: string
  readonly match: 'keyword' | 'approximate'
  readonly note?: string
  readonly score: number
}

/**
 * Finds the best asset for free text. Longer words score higher, and a word at the end of the text scores extra
 * because Chinese puts the head noun last: 「毒魚陷阱」 is a trap, 「山上的溪流」 a stream, 「渡船伯」 a person.
 * @param text - What the author wrote.
 * @param tables - Where to look.
 * @param tables.keywords - Chinese word → library names.
 * @param tables.english - Library names to find as whole English words.
 * @param tables.stand - Stand-ins for words with no exact asset.
 * @param tables.suffixes - Person roles that count only at the end of the text.
 * @returns The best candidate, if any.
 */
const bestMatch = (
  text: string,
  tables: {
    readonly keywords: Readonly<Record<string, readonly string[]>>
    readonly english: readonly string[]
    readonly stand: Stand
    readonly suffixes?: Stand
  },
): Candidate | undefined => {
  const weight = (word: string): number => [...word].length * 2 + (text.endsWith(word) ? 3 : 0)
  const candidates: Candidate[] = []
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  for (const name of tables.english) {
    const words = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    if (words.length >= 3 && lower.includes(` ${words} `))
      candidates.push({ name, match: 'keyword', score: 20 + words.length })
  }
  for (const [word, names] of Object.entries(tables.keywords))
    if (names[0] && text.includes(word)) candidates.push({ name: names[0], match: 'keyword', score: weight(word) })
  for (const [word, stand] of Object.entries(tables.stand))
    if (text.includes(word))
      candidates.push({ name: stand.name, match: 'approximate', note: stand.note, score: weight(word) })
  for (const [word, stand] of Object.entries(tables.suffixes ?? {}))
    if (text.endsWith(word))
      candidates.push({ name: stand.name, match: 'approximate', note: stand.note, score: weight(word) + 2 })
  const best = candidates.sort((a, b) => b.score - a.score || (a.match === 'keyword' ? -1 : 1)).at(0)
  if (!best || best.match === 'approximate') return best
  // The word matched an asset that is itself only a stand-in for something more specific in the text (苦花魚 → Fish).
  const stand = Object.entries(tables.stand).find(([word, entry]) => entry.name === best.name && text.includes(word))
  return stand ? { ...best, match: 'approximate', note: stand[1].note } : best
}

const categoryOfSprite = (name: string): SpriteCategory | undefined => SPRITE_CATALOG[name]?.category
const categoryOfBackdrop = (name: string): BackdropScene | undefined => BACKDROP_CATALOG[name]?.category

const alternativesOf = <C extends string>(
  name: string | undefined,
  category: C | undefined,
  entries: readonly string[],
  categoryOf: (name: string) => C | undefined,
): string[] =>
  category ? entries.filter((entry) => entry !== name && categoryOf(entry) === category).slice(0, 5) : []

/**
 * Picks the official sprite for a character name or description.
 * @param text - Character name or description, e.g. 苦花魚, 小貓, Fish.
 * @param options - Fallbacks.
 * @param options.category - When no word matches, use this category's first sprite.
 * @returns The pick with how it matched and same-category alternatives.
 */
export const pickSprite = (text: string, options: { readonly category?: SpriteCategory } = {}): AssetPick => {
  const names = LIBRARY_SPRITES.map((sprite) => sprite.name)
  const done = (name: string | undefined, match: MatchKind, note?: string): AssetPick => ({
    kind: 'sprite',
    ...(name ? { name } : {}),
    match,
    ...(note ? { note } : {}),
    alternatives: alternativesOf(name, name ? categoryOfSprite(name) : options.category, names, categoryOfSprite),
  })
  const exact = findLibrarySprite(text)
  if (exact) return done(exact.name, 'exact')
  const best = bestMatch(text, {
    keywords: SPRITE_KEYWORDS,
    english: names,
    stand: APPROXIMATIONS.sprite,
    suffixes: PERSON_SUFFIXES,
  })
  if (best) return done(best.name, best.match, best.note)
  if (options.category) {
    const first = names.find((name) => categoryOfSprite(name) === options.category)
    if (first) return done(first, 'category', `找不到「${text}」，用同類的 ${first} 代替`)
  }
  return done(undefined, 'none')
}

/**
 * Picks the official backdrop for a scene description.
 * @param text - Scene name or description, e.g. 溪流, 河濱公園, Underwater 1.
 * @returns The pick with how it matched and same-scene alternatives.
 */
export const pickBackdrop = (text: string): AssetPick => {
  const names = LIBRARY_BACKDROPS.map((backdrop) => backdrop.name)
  const done = (name: string | undefined, match: MatchKind, note?: string): AssetPick => ({
    kind: 'backdrop',
    ...(name ? { name } : {}),
    match,
    ...(note ? { note } : {}),
    alternatives: alternativesOf(name, name ? categoryOfBackdrop(name) : undefined, names, categoryOfBackdrop),
  })
  const exact = findLibraryBackdrop(text)
  if (exact) return done(exact.name, 'exact')
  const best = bestMatch(text, { keywords: BACKDROP_KEYWORDS, english: names, stand: APPROXIMATIONS.backdrop })
  if (best) return done(best.name, best.match, best.note)
  return done(undefined, 'none')
}

/**
 * Picks an official sound by name, description or category.
 * @param text - Sound name or description, e.g. 水花, 勝利, Coin.
 * @param options - Fallbacks.
 * @param options.category - When no word matches, use this category's first sound.
 * @returns The pick with how it matched and same-category alternatives.
 */
export const pickSound = (text: string, options: { readonly category?: SoundCategory } = {}): AssetPick => {
  const names = LIBRARY_SOUNDS.map((sound) => sound.name)
  const categoryOf = (name: string): SoundCategory | undefined => soundInfo(name)?.category
  const done = (name: string | undefined, match: MatchKind, note?: string): AssetPick => ({
    kind: 'sound',
    ...(name ? { name } : {}),
    match,
    ...(note ? { note } : {}),
    alternatives: alternativesOf(name, name ? categoryOf(name) : options.category, names, categoryOf),
  })
  const exact = LIBRARY_SOUNDS.find((sound) => simplify(sound.name) === simplify(text))
  if (exact) return done(exact.name, 'exact')
  // Numbered variants: "Water Drop" names Water Drop 1, "Laser" names Laser1.
  const numbered = LIBRARY_SOUNDS.find((sound) =>
    new RegExp(`^${simplify(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?\\d+$`).test(simplify(sound.name)),
  )
  if (simplify(text).length >= 3 && numbered) return done(numbered.name, 'exact')
  const matched = matchLibrarySound(text)
  const stand = Object.entries(APPROXIMATIONS.sound).find(([word]) => text.includes(word))?.[1]
  if (matched) return done(matched[0], 'keyword')
  if (stand) return done(stand.name, 'approximate', stand.note)
  if (options.category) {
    const first = EVENT_SOUNDS[options.category]?.[0] ?? names.find((name) => categoryOf(name) === options.category)
    if (first) return done(first, 'category')
  }
  return done(undefined, 'none')
}

/** Default sound for each game event, best first; sprites' own sounds are preferred when they fit. */
export const EVENT_SOUNDS: Readonly<Partial<Record<SoundCategory, readonly string[]>>> = {
  collect: ['Collect', 'Coin', 'Chomp'],
  jump: ['Jump', 'Boing'],
  hit: ['Oops', 'Bonk'],
  shoot: ['Pew', 'Laser1'],
  click: ['Pop', 'Computer Beep'],
  win: ['Win', 'Tada', 'Triumph'],
  lose: ['Lose', 'Dun Dun Dunnn'],
  appear: ['Zoop', 'Teleport2'],
  music: ['Dance Around', 'Video Game 1', 'Garden'],
  ambience: ['Tropical Birds', 'Rain', 'Crickets'],
}

/**
 * The sound to play for a game event: the sprite's own sound of that category when it has one, otherwise the
 * library default for the event.
 * @param event - Event category.
 * @param sprite - Library sprite that triggers the event, if any.
 * @returns Sound name, or undefined when the event has no default.
 */
export const eventSound = (event: SoundCategory, sprite?: LibrarySprite): string | undefined => {
  const own = sprite?.sounds.find(([name]) => soundInfo(name)?.category === event)
  return own?.[0] ?? EVENT_SOUNDS[event]?.find((name) => findLibrarySound(name))
}

/**
 * The costumes that make a motion loop (walk, swim, flap): the largest group of costumes named like
 * `Fish-a/-b/-c`, `Giga Walk1/2/3` or `Story-a-1/2/3`.
 * @param sprite - Library sprite.
 * @returns Costume names in order; empty when the sprite has no loop.
 */
export const motionCostumes = (sprite: LibrarySprite): string[] => {
  const groups = new Map<string, string[]>()
  for (const [name] of sprite.costumes) {
    const prefix = /^(.*?)[\s-]?(?:[a-h]|\d{1,2})$/i.exec(name)?.[1]
    if (prefix === undefined) continue
    groups.set(prefix, [...(groups.get(prefix) ?? []), name])
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? []
  return best.length >= 2 ? best : []
}

/**
 * @param sprite - Library sprite.
 * @param index - Costume index; the first costume by default.
 * @returns Width and height in stage pixels, from the index or, when missing, twice the rotation centre.
 */
export const costumeSize = (
  sprite: LibrarySprite,
  index = 0,
): { readonly width: number; readonly height: number } => {
  const costume = sprite.costumes.at(index) ?? sprite.costumes.at(0)
  if (!costume) return { width: 0, height: 0 }
  const [, , centerX, centerY, resolution, width, height] = costume
  return width && height
    ? { width, height }
    : { width: (centerX * 2) / (resolution || 1), height: (centerY * 2) / (resolution || 1) }
}

/**
 * @param name - Library sound name.
 * @returns Length in seconds, or undefined for an unknown sound.
 */
export const soundSeconds = (name: string): number | undefined => {
  const tuple = findLibrarySound(name)
  return tuple ? tuple[3] / tuple[2] : undefined
}

export interface AssetSummary {
  readonly kind: AssetKind
  readonly name: string
  readonly zh: readonly string[]
  readonly category: string
  readonly tags: readonly string[]
  /** Sprites: costume count and motion loop length; backdrops: 1. */
  readonly costumes?: number
  readonly motion?: number
  /** Sprites: their own sounds. */
  readonly sounds?: readonly string[]
  /** Sounds: length in seconds. */
  readonly seconds?: number
  /** Sprites and backdrops: first costume size in stage pixels. */
  readonly size?: { readonly width: number; readonly height: number }
}

const spriteSummary = (sprite: LibrarySprite): AssetSummary => ({
  kind: 'sprite',
  name: sprite.name,
  zh: SPRITE_CATALOG[sprite.name]?.zh ?? [],
  category: SPRITE_CATALOG[sprite.name]?.category ?? 'thing',
  tags: sprite.tags,
  costumes: sprite.costumes.length,
  motion: motionCostumes(sprite).length,
  sounds: sprite.sounds.map(([name]) => name),
  size: costumeSize(sprite),
})

const backdropSummary = (backdrop: LibraryBackdrop): AssetSummary => {
  const [, , centerX, centerY, resolution, width, height] = backdrop.costume
  return {
    kind: 'backdrop',
    name: backdrop.name,
    zh: BACKDROP_CATALOG[backdrop.name]?.zh ?? [],
    category: BACKDROP_CATALOG[backdrop.name]?.category ?? 'nature',
    tags: backdrop.tags,
    costumes: 1,
    size:
      width && height ? { width, height } : { width: (centerX * 2) / resolution, height: (centerY * 2) / resolution },
  }
}

/**
 * Searches the whole official library by English name, Chinese name, tag or category.
 * @param options - What to search.
 * @param options.kind - Sprites, backdrops or sounds.
 * @param options.query - Words to look for; empty lists the category or the whole kind.
 * @param options.category - Only this category (for example water-animal, water, collect).
 * @param options.limit - At most this many results (default 20).
 * @returns Matching assets, best first.
 */
export const searchAssets = (options: {
  readonly kind: AssetKind
  readonly query?: string
  readonly category?: string
  readonly limit?: number
}): AssetSummary[] => {
  const all: AssetSummary[] =
    options.kind === 'sprite'
      ? LIBRARY_SPRITES.map(spriteSummary)
      : options.kind === 'backdrop'
        ? LIBRARY_BACKDROPS.map(backdropSummary)
        : LIBRARY_SOUNDS.map((sound) => ({
            kind: 'sound' as const,
            name: sound.name,
            zh: soundInfo(sound.name)?.zh ?? [],
            category: soundInfo(sound.name)?.category ?? 'effect',
            tags: sound.tags,
            seconds: Math.round((sound.sound[3] / sound.sound[2]) * 10) / 10,
          }))
  const query = simplify(options.query ?? '')
  const words = query.split(/[\s,，、]+/).filter(Boolean)
  const score = (entry: AssetSummary): number => {
    if (words.length === 0) return 1
    let total = 0
    for (const word of words) {
      if (simplify(entry.name) === word) total += 10
      else if (simplify(entry.name).includes(word)) total += 5
      if (entry.zh.some((name) => name === word)) total += 8
      else if (entry.zh.some((name) => name.includes(word) || word.includes(name))) total += 4
      if (entry.tags.includes(word) || entry.category === word) total += 3
    }
    return total
  }
  return all
    .filter((entry) => !options.category || entry.category === options.category)
    .map((entry) => ({ entry, score: score(entry) }))
    .filter(({ score: value }) => value > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 20)
    .map(({ entry }) => entry)
}

/**
 * @param pick - A pick from this module.
 * @param subject - What the pick was for, e.g. the character name.
 * @returns One report line, e.g. 「苦花魚 → Fish（近似：沒有苦花魚素材…）」.
 */
export const describePick = (pick: AssetPick, subject: string): string => {
  if (!pick.name) return `${subject} → 找不到官方素材，用備援圖`
  const how =
    pick.match === 'approximate'
      ? `近似：${pick.note ?? ''}`
      : pick.match === 'category'
        ? `同類替代：${pick.note ?? ''}`
        : pick.match === 'exact'
          ? '指定'
          : '依名稱'
  const others = pick.alternatives.length > 0 ? `；也可換成 ${pick.alternatives.slice(0, 3).join('、')}` : ''
  return `${subject} → ${pick.name}（${how}）${others}`
}

export type { BackdropScene, SoundCategory, SpriteCategory } from './library-catalog'
