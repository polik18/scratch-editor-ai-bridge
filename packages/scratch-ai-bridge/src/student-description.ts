import type { CanonicalProject } from './core/ir/types'
import { buildFromSpecText, formatSpecDiagnostics } from './spec'
import { extractJson } from './spec/normalize'
import { createGameSpecInstruction, createGameSpecRepairInstruction } from './spec/prompt'
import { buildStoryFromText } from './story'
import { createStoryInstruction } from './story/prompt'

/**
 * The web page's description route: the AI writes a short game or animation description (the same Game Spec and
 * Story Spec the command line uses) and Bridge turns it into blocks. Descriptions are a fraction of the size of
 * block-level Canonical IR and most block mistakes cannot be written in them, so students copy back and forth far
 * less. Every problem is listed at once, each with its fix after 「→」.
 */

export type DescriptionKind = 'game' | 'story'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether a pasted reply is a description rather than block-level Canonical IR.
 * @param text - The AI reply as pasted, possibly with prose or code fences.
 * @returns The description kind, or undefined for Canonical IR and anything else.
 */
export const descriptionKind = (text: string): DescriptionKind | undefined => {
  let value: unknown
  try {
    value = extractJson(text).value
  } catch {
    return undefined
  }
  if (!isRecord(value) || typeof value.format === 'string') return undefined
  if ('場景' in value) return 'story'
  if ('地圖' in value || '關卡' in value || '圖例' in value) return 'game'
  return undefined
}

export interface DescriptionBuild {
  readonly kind: DescriptionKind
  /** Present when the description built; the page compiles it like any other project. */
  readonly project?: CanonicalProject
  readonly title?: string
  /** Every problem and note, one per line, each with its fix after 「→」; empty when there is nothing to say. */
  readonly feedback: string
  readonly errors: number
  readonly warnings: number
}

/**
 * @param text - The pasted description.
 * @param kind - From {@link descriptionKind}.
 * @returns The project, or the feedback that explains what to change.
 */
export const buildDescription = (text: string, kind: DescriptionKind): DescriptionBuild => {
  const built = kind === 'story' ? buildStoryFromText(text) : buildFromSpecText(text)
  const shown = built.diagnostics.filter((item) => item.severity !== 'fixed')
  const title = 'story' in built ? built.story?.title : 'spec' in built ? built.spec?.title : undefined
  return {
    kind,
    ...(built.project ? { project: built.project } : {}),
    ...(title ? { title } : {}),
    feedback: formatSpecDiagnostics(shown),
    errors: shown.filter((item) => item.severity === 'error').length,
    warnings: shown.filter((item) => item.severity === 'warning').length,
  }
}

/**
 * The first message to the AI.
 * @param kind - Game or animation.
 * @param request - The student's idea.
 * @param brief - Gameplay the student already agreed on with the AI, if any.
 * @returns The prompt.
 */
export const createDescriptionInstruction = (kind: DescriptionKind, request: string, brief = ''): string => {
  const full = brief.trim() ? `${request.trim()}\n\n已確認的玩法：\n${brief.trim()}` : request
  return kind === 'story' ? createStoryInstruction(full) : createGameSpecInstruction(full)
}

/**
 * @param text - The description that has problems.
 * @param feedback - From {@link buildDescription}, possibly with playtest findings appended.
 * @returns The message asking the AI to fix every problem in one reply.
 */
export const createDescriptionRepairPrompt = (text: string, feedback: string): string =>
  createGameSpecRepairInstruction(text, feedback)

/**
 * @param text - The current description.
 * @param change - What the student wants changed.
 * @returns The message asking the AI for the whole revised description.
 */
export const createDescriptionRevisionPrompt = (text: string, change: string): string =>
  `請依照下面的修改需求，改寫目前的作品描述。格式和之前一樣；沒有要改的部分保持原樣。
輸出修改後的完整 JSON，不要任何其他文字。

修改需求：
${change.trim()}

目前的作品描述：
${text.trim()}`

/**
 * Feedback lines for what the page's automatic playtest found, in the description's 「→」 form.
 * @param issues - Problems the playtest found.
 * @returns One line per problem.
 */
export const playtestFeedbackLines = (issues: readonly string[]): string =>
  issues.map((issue) => `[試玩發現] ${issue} → 修改描述裡相關的角色、行為或規則，讓遊戲實際玩起來是這樣。`).join('\n')
