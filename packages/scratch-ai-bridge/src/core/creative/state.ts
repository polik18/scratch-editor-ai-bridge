import type { CanonicalProject, CanonicalSprite } from '../ir/types'
import { parseScratchblocksProject, type ScratchblocksProjectResult } from '../scratchblocks'

/** The project built so far plus every earlier version, so a bad fragment can be rolled back without a rewrite. */
export interface CreativeState {
  readonly project?: CanonicalProject
  readonly history: readonly CanonicalProject[]
}

export const EMPTY_STATE: CreativeState = { history: [] }

/** The translator gives a stage without backdrops this default; it is not a backdrop the model asked for. */
const DEFAULT_BACKDROP = 'Blue Sky'
const realBackdrops = <T extends { readonly name: string }>(costumes: readonly T[]): T[] =>
  costumes.filter(({ name }) => name !== DEFAULT_BACKDROP)

const unionByName = <T extends { readonly name: string }>(left: readonly T[], right: readonly T[]): T[] => [
  ...left,
  ...right.filter((item) => !left.some((existing) => existing.name === item.name)),
]

/**
 * Strip code fences and thinking blocks a chat model may wrap around its output.
 * @param reply Raw model reply.
 * @returns Bare scratchblocks text.
 */
export const stripReply = (reply: string): string =>
  reply
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-z]*\n?/gi, '')
    // Prose a model adds around the blocks ("修正處：", "- `receive` → `broadcast`") is never a block line.
    .replace(/^\s*(?:[-*•]\s.*|(?:修正|修改|說明|注意|備註)[^\n]*[:：]\s*)$/gm, '')
    .trim()

/**
 * Lines where the model recorded how it approximated something Scratch cannot do.
 * @param reply Model reply.
 * @returns The text after each "// 近似：" marker, in order.
 */
export const approximationNotes = (reply: string): string[] =>
  [...reply.matchAll(/^\s*\/\/\s*近似[:：]\s*(.+)$/gm)].map((match) => match[1].trim()).filter(Boolean)

/**
 * Merge one fragment into the project: new targets are added, existing ones get the new scripts appended (or replaced
 * with `(replace)`), and costumes, sounds, variables and broadcasts are unioned.
 * @param state Current state.
 * @param reply Fragment text from the model.
 * @param name Project name.
 * @returns The new state, the parse result and warnings that still apply after merging.
 */
export const applyFragment = (
  state: CreativeState,
  reply: string,
  name: string,
): {
  readonly state: CreativeState
  readonly parsed: ScratchblocksProjectResult
  readonly warnings: readonly string[]
} => {
  const parsed = parseScratchblocksProject(stripReply(reply), {
    name,
    defaultSprite: state.project?.sprites[0]?.name ?? '主角',
  })
  const fragment = parsed.project
  const current = state.project
  if (!current) return { state: { project: fragment, history: state.history }, parsed, warnings: parsed.warnings }
  const sectionFor = (targetName: string, isStage: boolean) =>
    parsed.sections.find((section) => section.name === targetName && section.isStage === isStage)
  const sprites: CanonicalSprite[] = current.sprites.map((sprite) => {
    const incoming = fragment.sprites.find((candidate) => candidate.name === sprite.name)
    if (!incoming) return sprite
    const section = sectionFor(sprite.name, false)
    if (!section) return sprite // a placeholder the parser added for a touch target that already exists
    return {
      ...sprite,
      scripts: section.mode === 'replace' ? incoming.scripts : [...sprite.scripts, ...incoming.scripts],
      costumes:
        section.mode === 'replace' && section.appearance.length
          ? incoming.costumes
          : unionByName(sprite.costumes, incoming.costumes),
      sounds: unionByName(sprite.sounds, incoming.sounds),
    }
  })
  for (const sprite of fragment.sprites)
    if (!sprites.some((existing) => existing.name === sprite.name)) sprites.push(sprite)
  const stageSection = sectionFor('Stage', true)
  const stage = {
    ...current.stage,
    variables: unionByName(current.stage.variables, fragment.stage.variables),
    scripts:
      stageSection?.mode === 'replace'
        ? fragment.stage.scripts
        : [...current.stage.scripts, ...fragment.stage.scripts],
    costumes: realBackdrops(fragment.stage.costumes).length
      ? unionByName(
          realBackdrops(current.stage.costumes).length ? current.stage.costumes : [],
          realBackdrops(fragment.stage.costumes),
        )
      : current.stage.costumes,
    sounds: unionByName(current.stage.sounds, fragment.stage.sounds),
  }
  const existingNames = new Set(current.sprites.map((sprite) => sprite.name))
  const warnings = parsed.warnings.filter(
    (warning) => ![...existingNames].some((existing) => warning.includes(`「${existing}」被碰觸`)),
  )
  return {
    state: {
      project: { ...current, broadcasts: unionByName(current.broadcasts, fragment.broadcasts), stage, sprites },
      history: [...state.history, current],
    },
    parsed,
    warnings,
  }
}

/**
 * Roll back the last applied fragment.
 * @param state Current state.
 * @returns The previous state (unchanged when there is no history).
 */
export const undoFragment = (state: CreativeState): CreativeState => {
  const previous = state.history.at(-1)
  return previous ? { project: previous, history: state.history.slice(0, -1) } : state
}
