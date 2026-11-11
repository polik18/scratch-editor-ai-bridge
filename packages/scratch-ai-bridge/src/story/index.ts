import type { CanonicalProject } from '../core/ir/types'
import { extractJson } from '../spec/normalize'
import type { SpecScenario } from '../spec/scenario'
import type { SpecDiagnostic } from '../spec/types'
import { compileStory, STORY_NAMES } from './compile'
import { normalizeStory, storySeconds } from './normalize'
import { STORY_TIMING, type Story } from './types'

export { compileStory, STORY_NAMES } from './compile'
export { normalizeStory, parseAction, storySeconds } from './normalize'
export { createStoryGuide, createStoryInstruction } from './prompt'
export type * from './types'

export interface StoryBuildResult {
  readonly story?: Story
  readonly project?: CanonicalProject
  readonly diagnostics: readonly SpecDiagnostic[]
}

/**
 * Text → normalized story → Canonical IR. Stops before compiling when any error remains.
 * @param text - Story JSON, optionally wrapped in prose or code fences.
 * @returns Story, diagnostics and, when no error remains, the project.
 */
export const buildStoryFromText = (text: string): StoryBuildResult => {
  let raw: unknown
  try {
    ;({ value: raw } = extractJson(text))
  } catch (error) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'STORY_NOT_JSON',
          where: '整份描述',
          message: error instanceof Error ? error.message : String(error),
          suggestion: '只輸出一個 JSON 物件，不要加其他文字。',
        },
      ],
    }
  }
  const { story, diagnostics } = normalizeStory(raw)
  if (!story || diagnostics.some((item) => item.severity === 'error'))
    return { ...(story ? { story } : {}), diagnostics }
  return { story, project: compileStory(story), diagnostics }
}

/** Speed used by the playtest: the animation runs ten times faster, so a three-minute story takes about 20 s. */
export const PLAYTEST_TIME_SCALE = 0.1

/**
 * @param story - Normalized story.
 * @param sceneIndex - Scene index, from 0.
 * @returns Index of the scene's backdrop among the stage costumes, in the order {@link compileStory} adds them.
 */
export const sceneBackdropIndex = (story: Story, sceneIndex: number): number => {
  const names: string[] = []
  for (const scene of story.scenes) {
    const name = scene.backdrop.kind === 'preset' ? `preset:${scene.backdrop.preset}` : scene.backdrop.name
    if (!names.includes(name)) names.push(name)
  }
  const target = story.scenes[sceneIndex]
  const key = target.backdrop.kind === 'preset' ? `preset:${target.backdrop.preset}` : target.backdrop.name
  // The title card is costume 0.
  return names.indexOf(key) + 1
}

/**
 * One playtest that watches the whole animation at ten times speed: the title card, every scene's backdrop in
 * order, the ending card, and a running time that matches the computed length.
 * @param story - Normalized story.
 * @returns A scenario named 播放整部動畫 that keeps the title card instead of dismissing an intro.
 */
export const createStoryScenario = (story: Story): SpecScenario => {
  const scene = { variable: STORY_NAMES.scene } as const
  const backdrop = { stage: 'backdrop' } as const
  const scaledSeconds = (storySeconds(story) - STORY_TIMING.lead) * PLAYTEST_TIME_SCALE + STORY_TIMING.lead
  const steps: SpecScenario['steps'][number][] = [
    { kind: 'wait', ms: 300 },
    { kind: 'set', variable: STORY_NAMES.timeScale, value: PLAYTEST_TIME_SCALE },
    {
      kind: 'expect',
      label: '開頭是片頭標題',
      subject: backdrop,
      op: '==',
      value: 0,
      hint: '動畫開頭沒有顯示片頭標題。',
    },
  ]
  story.scenes.forEach((_, index) => {
    steps.push(
      { kind: 'until', subject: scene, op: '==', value: index + 1, ms: 30_000 },
      {
        kind: 'expect',
        label: `第 ${index + 1} 幕換成自己的背景`,
        subject: backdrop,
        op: '==',
        value: sceneBackdropIndex(story, index),
        hint: `第 ${index + 1} 幕開始時背景沒有換。`,
      },
    )
  })
  const endingBackdrop =
    new Set(story.scenes.map((item) => (item.backdrop.kind === 'preset' ? item.backdrop.preset : item.backdrop.name)))
      .size + 1
  steps.push(
    { kind: 'until', subject: { variable: STORY_NAMES.done }, op: '==', value: 1, ms: 60_000 },
    {
      kind: 'expect',
      label: '最後播到片尾',
      subject: backdrop,
      op: '==',
      value: endingBackdrop,
      hint: '動畫沒有播到片尾。',
    },
    {
      kind: 'expect',
      label: `播完的時間符合計算的片長（十倍速約 ${scaledSeconds.toFixed(1)} 秒）`,
      subject: { clock: 'seconds' },
      op: 'within',
      value: scaledSeconds,
      tolerance: 2 + story.scenes.length * 0.4,
      hint: '實際播放時間和計算的片長差太多，請檢查動作的秒數。',
    },
  )
  return { name: '播放整部動畫', keepIntro: true, steps }
}
