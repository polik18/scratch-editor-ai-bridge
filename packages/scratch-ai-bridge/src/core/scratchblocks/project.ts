import type {
  CanonicalBlock,
  CanonicalInput,
  CanonicalProject,
  CanonicalScript,
  CanonicalSprite,
  CanonicalStage,
} from '../ir/types'
import { isBlockLine, parseScripts, scanVariables } from './parser'

export interface ScratchblocksTargetSection {
  readonly name: string
  readonly isStage: boolean
  /** `replace`: this fragment replaces the target's scripts instead of adding to them. */
  readonly mode: 'add' | 'replace'
  readonly appearance: readonly string[]
  readonly sounds: readonly string[]
}

export interface ScratchblocksProjectResult {
  readonly project: CanonicalProject
  readonly sections: readonly ScratchblocksTargetSection[]
  readonly warnings: readonly string[]
  readonly recognizedLines: number
  readonly skippedLines: number
}

const HEADER =
  /^(?:={2,}\s*)?(sprite|角色|stage|舞台)\s*[:：]?\s*([^()[\]=]*?)\s*((?:[([][^)\]]*[)\]]\s*)*)\s*(?:={2,})?$/i

/** A line holding only a target name (with optional `(…)` options) right before a hat block: `金魚 (replace)`. */
const BARE_HEADER = /^([^\s()<>[\]:：/]{1,20})\s*((?:\([^)]*\)\s*)*)(?:\s+[^\s(].*)?$/

const NOT_NAMES =
  /^(?:forever|end|else|hide|show|when|stop|wait|say|think|move|repeat|if|一直重複|結束|否則|隱藏|顯示)$/i

const HAT_START = /^(?:when\b|當|receive\b|收到|start_as_clone|<?\s*green flag)/i

const BANNER = /[=＝\-—*【】#]{2,}|^[\s=＝\-—*【】#]+/

const listAfter = (options: string, labels: RegExp): string[] => {
  const match = labels.exec(options)
  if (!match?.[1]) return []
  return match[1]
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const sectionFrom = (name: string, isStage: boolean, options: string): ScratchblocksTargetSection => ({
  name,
  isStage,
  mode: /\b(replace)\b|取代/i.test(options) ? 'replace' : 'add',
  appearance: listAfter(options, /(?:外觀|造型|背景|costumes?|backdrops?|look)\s*[:：=]\s*([^;；)]+)/i),
  sounds: listAfter(options, /(?:音效|聲音|sounds?)\s*[:：=]\s*([^;；)]+)/i),
})

const parseHeader = (line: string, defaultSprite: string): ScratchblocksTargetSection | undefined => {
  const header = HEADER.exec(line)
  if (!header?.[1]) return undefined
  const isStage = /^(stage|舞台)$/i.test(header[1])
  const options = (header[3] as string | undefined) ?? ''
  const name = isStage ? 'Stage' : ((header[2] as string | undefined) ?? '').trim() || defaultSprite
  return sectionFrom(name, isStage, options)
}

/**
 * Split multi-target scratchblocks text into sections. A section starts at
 * - a header: `sprite 大魚 (外觀: Shark; 音效: Chomp)`, `角色 小魚 (replace)`, `stage (背景: Underwater 1)`
 *   (several `(…)` groups are allowed; a run of headers with no lines between them is a list of declarations),
 * - a bare target name right before a hat block: `金魚 (replace)` then `when green flag clicked`,
 * - a banner comment naming a declared target: `// ===== 白貓籃子：左右鍵控制 =====`.
 * Lines before the first section belong to `defaultSprite`.
 * @param source Model output.
 * @param defaultSprite Name for header-less lines.
 * @returns Sections with their raw lines.
 */
const splitSections = (
  source: string,
  defaultSprite: string,
): { section: ScratchblocksTargetSection; lines: string[] }[] => {
  const lines = source.split(/\r?\n/)
  const declared = new Set(
    lines.flatMap((line) => {
      const header = parseHeader(line.trim(), defaultSprite)
      return header && !header.isStage ? [header.name] : []
    }),
  )
  const sections: { section: ScratchblocksTargetSection; lines: string[] }[] = []
  let current: { section: ScratchblocksTargetSection; lines: string[] } | undefined
  const open = (section: ScratchblocksTargetSection): void => {
    const existing = sections.find(
      (entry) => entry.section.name === section.name && entry.section.isStage === section.isStage,
    )
    if (existing) {
      // Later mentions may add appearance/sounds or switch to replace; keep the earliest declaration's details.
      existing.section = {
        ...existing.section,
        mode: section.mode === 'replace' ? 'replace' : existing.section.mode,
        appearance: existing.section.appearance.length ? existing.section.appearance : section.appearance,
        sounds: [...new Set([...existing.section.sounds, ...section.sounds])],
      }
      current = existing
    } else {
      current = { section, lines: [] }
      sections.push(current)
    }
  }
  const nextCodeLine = (from: number): string | undefined =>
    lines
      .slice(from + 1)
      .find((line) => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('```'))
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    const header = parseHeader(line, defaultSprite)
    if (header) {
      open(header)
      return
    }
    if (line.startsWith('//')) {
      const text = line.replace(/^\/\/+/, '').trim()
      const bare = text.replace(/^[\s=＝\-—*【】#]+/, '')
      const named = [...declared].find(
        (name) => bare.startsWith(name) && (BANNER.test(text) || /^[:：（(\s]|$/.test(bare.slice(name.length))),
      )
      if (named) {
        open(sectionFrom(named, false, ''))
        return
      }
    }
    const bare = BARE_HEADER.exec(line)
    if (
      bare?.[1] &&
      !NOT_NAMES.test(bare[1]) &&
      !isBlockLine(line) &&
      HAT_START.test(nextCodeLine(index)?.trim() ?? '')
    ) {
      const [, name, options = ''] = bare
      open(sectionFrom(name, false, options))
      return
    }
    if (!current) {
      if (!line || line.startsWith('```') || line.startsWith('//')) return
      open({ name: defaultSprite, isStage: false, mode: 'add', appearance: [], sounds: [] })
    }
    current?.lines.push(rawLine)
  })
  return sections
}

/**
 * Split model output into one self-contained text per target (a canonical header line plus its lines), so a repair
 * prompt can carry only the sections that failed and the fixed sections can be put back in place.
 * @param source Model output.
 * @param defaultSprite Name for header-less lines.
 * @returns Sections in their original order.
 */
export const scratchblocksSectionTexts = (
  source: string,
  defaultSprite = '主角',
): { readonly name: string; readonly isStage: boolean; readonly text: string }[] =>
  splitSections(source, defaultSprite).map(({ section, lines }) => {
    const options = [
      section.appearance.length ? `${section.isStage ? '背景' : '外觀'}: ${section.appearance.join(', ')}` : '',
      section.sounds.length ? `音效: ${section.sounds.join(', ')}` : '',
      section.mode === 'replace' ? 'replace' : '',
    ].filter(Boolean)
    const header = `${section.isStage ? 'stage' : `sprite ${section.name}`}${options.length ? ` (${options.join('; ')})` : ''}`
    return { name: section.name, isStage: section.isStage, text: [header, ...lines].join('\n').trimEnd() }
  })

const walk = (blocks: readonly CanonicalBlock[], visit: (block: CanonicalBlock) => void): void => {
  for (const value of blocks) {
    visit(value)
    for (const input of Object.values(value.inputs ?? {})) {
      if (input.type === 'block') walk([input.block], visit)
      if (input.type === 'stack') walk(input.blocks, visit)
    }
  }
}

const literalOf = (input: CanonicalInput | undefined): string | undefined =>
  input?.type === 'literal' && typeof input.value === 'string' ? input.value : undefined

/**
 * Parse multi-target scratchblocks text into a Canonical IR project: one sprite per `sprite` section, a stage with its
 * backdrops, global variables, broadcasts, and costumes/sounds named after what the scripts use (official library
 * artwork is resolved later by name).
 * @param source Model output.
 * @param options Project name and the sprite for header-less lines.
 * @param options.name Name stored in the project.
 * @param options.defaultSprite Sprite that receives lines written before any header.
 * @returns Project, sections and parse diagnostics.
 */
export const parseScratchblocksProject = (
  source: string,
  options: { readonly name?: string; readonly defaultSprite?: string } = {},
): ScratchblocksProjectResult => {
  const variables = scanVariables(source)
  const sections = splitSections(source, options.defaultSprite ?? '主角')
  const warnings: string[] = []
  let recognizedLines = 0
  let skippedLines = 0
  const parsed = sections.map(({ section, lines }) => {
    const result = parseScripts(lines.join('\n'), variables)
    recognizedLines += result.recognizedLines
    skippedLines += result.skippedLines
    warnings.push(...result.warnings.map((warning) => `${section.isStage ? '舞台' : section.name}：${warning}`))
    return { section, scripts: result.scripts }
  })

  const broadcasts = new Set<string>()
  const backdrops = new Set<string>()
  const touchTargets = new Set<string>()
  const usage = (scripts: readonly CanonicalScript[]) => {
    const costumes = new Set<string>()
    const sounds = new Set<string>()
    for (const script of scripts)
      walk(script.blocks, (value) => {
        const sent = value.inputs?.BROADCAST_INPUT
        if (sent?.type === 'broadcast') broadcasts.add(sent.name)
        const received = value.fields?.BROADCAST_OPTION
        if (typeof received === 'string') broadcasts.add(received)
        const backdrop =
          literalOf(value.inputs?.BACKDROP) ??
          (typeof value.fields?.BACKDROP === 'string' ? value.fields.BACKDROP : undefined)
        if (backdrop) backdrops.add(backdrop)
        const costume = literalOf(value.inputs?.COSTUME)
        if (costume) costumes.add(costume)
        const sound = literalOf(value.inputs?.SOUND_MENU)
        if (sound) sounds.add(sound)
        for (const name of [literalOf(value.inputs?.TOUCHINGOBJECTMENU), literalOf(value.inputs?.CLONE_OPTION)])
          if (name && !name.startsWith('_')) touchTargets.add(name)
      })
    return { costumes, sounds }
  }

  const spriteSections = parsed.filter(({ section }) => !section.isStage)
  const stageSection = parsed.find(({ section }) => section.isStage)
  const sprites: CanonicalSprite[] = spriteSections.map(({ section, scripts }, index) => {
    const { costumes, sounds } = usage(scripts)
    const costumeNames = [
      ...new Set([...(section.appearance.length ? section.appearance : [section.name]), ...costumes]),
    ]
    const soundNames = [...new Set([...section.sounds, ...sounds])]
    const columns = Math.max(1, spriteSections.length)
    return {
      kind: 'sprite',
      name: section.name,
      variables: [],
      lists: [],
      costumes: costumeNames.map((name) => ({ name, dataFormat: 'svg' })),
      sounds: soundNames.map((name) => ({ name, dataFormat: 'wav' })),
      scripts,
      procedures: [],
      x: columns === 1 ? 0 : Math.round(-160 + (320 * index) / (columns - 1)),
      y: index === 0 ? -100 : 60,
      direction: 90,
      size: 80,
      visible: true,
      draggable: false,
      rotationStyle: 'left-right',
    }
  })
  const stageUsage = usage(stageSection?.scripts ?? [])
  for (const name of touchTargets) {
    if (sprites.some((sprite) => sprite.name === name)) continue
    warnings.push(`「${name}」被碰觸或複製，但沒有它的 sprite 段落；已加入一個沒有程式的角色。`)
    sprites.push({
      kind: 'sprite',
      name,
      variables: [],
      lists: [],
      costumes: [{ name, dataFormat: 'svg' }],
      sounds: [],
      scripts: [],
      procedures: [],
      x: 0,
      y: 80,
      direction: 90,
      size: 60,
      visible: true,
      draggable: false,
      rotationStyle: 'all around',
    })
  }
  const backdropNames = [...new Set([...(stageSection?.section.appearance ?? []), ...backdrops])]
  const stage: CanonicalStage = {
    kind: 'stage',
    name: 'Stage',
    variables: [...variables].map((name) => ({ name, value: 0 })),
    lists: [],
    costumes: (backdropNames.length ? backdropNames : ['Blue Sky']).map((name) => ({ name, dataFormat: 'svg' })),
    sounds: [...new Set([...(stageSection?.section.sounds ?? []), ...stageUsage.sounds])].map((name) => ({
      name,
      dataFormat: 'wav',
    })),
    scripts: stageSection?.scripts ?? [],
    procedures: [],
  }
  return {
    project: {
      format: 'scratch-ai-bridge/canonical-ir',
      version: 1,
      name: options.name ?? 'Scratch project',
      broadcasts: [...broadcasts].map((name) => ({ name })),
      stage,
      sprites,
    },
    sections: parsed.map(({ section }) => section),
    warnings,
    recognizedLines,
    skippedLines,
  }
}
