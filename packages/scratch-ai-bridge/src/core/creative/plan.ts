import type { RubricCheck } from '../grading/rubric'
import type { IntentAnchors, IntentFeature } from './anchors'
import { featureChecks } from './cards'

/** One vertical slice: small enough to build, run and judge on its own. */
export interface ProjectSlice {
  readonly id: string
  readonly goal: string
  readonly features: readonly IntentFeature[]
  readonly acceptance: readonly { readonly feature: string; readonly check: RubricCheck }[]
}

export interface ProjectPlan {
  readonly projectType: IntentAnchors['projectType']
  readonly slices: readonly ProjectSlice[]
}

const CORE_FEATURES: Readonly<Record<IntentAnchors['projectType'], readonly IntentFeature[]>> = {
  game: ['keys', 'click', 'collision', 'falling'],
  animation: ['animation', 'scenes'],
  story: ['dialogue', 'scenes'],
  'interactive-art': ['click', 'keys', 'effects'],
  music: ['sound', 'music', 'click', 'keys'],
  quiz: ['ask'],
  tutorial: ['dialogue', 'ask'],
  simulation: ['score', 'timer', 'clones'],
  mixed: ['keys', 'click', 'dialogue', 'animation'],
  custom: ['keys', 'click', 'dialogue', 'animation'],
}

const CORE_GOAL: Readonly<Record<IntentAnchors['projectType'], string>> = {
  game: '先做出能玩的核心：主角能被操作，和最重要的目標或障礙產生互動。',
  animation: '先做出第一段能播放的畫面：主要角色動起來，畫面有變化。',
  story: '先做出第一幕：角色登場並說出開場對白。',
  'interactive-art': '先做出最核心的輸入→回饋：操作後畫面立刻有可觀察的變化。',
  music: '先做出能發出聲音的核心：按鍵或點擊就播放聲音。',
  quiz: '先做出第一題：提出問題、判斷回答、給出回饋。',
  tutorial: '先做出第一個教學步驟：說明並請學習者做一次。',
  simulation: '先做出模型的核心狀態：至少一個變數會隨時間或互動改變。',
  mixed: '先做出最能代表這個作品的一段互動或畫面。',
  custom: '先做出最能代表這個作品的一段互動或畫面。',
}

/**
 * Split the idea into vertical slices: the core experience first, then content, feedback/media and progression.
 * Only features the anchors actually contain are planned, so nothing is added that the idea did not ask for.
 * @param anchors Intent anchors.
 * @returns Ordered slices, each with runtime acceptance checks.
 */
export const createProjectPlan = (anchors: IntentAnchors): ProjectPlan => {
  const present = new Set(anchors.features)
  const take = (features: readonly IntentFeature[]): IntentFeature[] =>
    features.filter((feature) => present.has(feature))
  const used = new Set<IntentFeature>()
  const slice = (
    id: string,
    goal: string,
    wanted: readonly IntentFeature[],
    always = false,
  ): ProjectSlice | undefined => {
    const features = take(wanted).filter((feature) => !used.has(feature))
    if (features.length === 0 && !always) return undefined
    features.forEach((feature) => used.add(feature))
    return { id, goal, features, acceptance: featureChecks(anchors, features) }
  }
  const slices = [
    slice('core', CORE_GOAL[anchors.projectType], CORE_FEATURES[anchors.projectType], true),
    slice(
      'content',
      `加入其他角色與內容${anchors.characters.length > 1 ? `（${anchors.characters.slice(1).join('、')}）` : ''}，讓作品的主要流程完整。`,
      ['clones', 'falling', 'collision', 'click', 'keys', 'dialogue', 'animation', 'ask'],
    ),
    slice('feedback', '加入讓受眾感受到回饋的聲音、場景、對白與動畫。', [
      'sound',
      'music',
      'scenes',
      'dialogue',
      'animation',
      'effects',
    ]),
    slice('progression', '加入狀態與收尾：分數／生命／時間／關卡，以及結束或結局。', [
      'score',
      'lives',
      'timer',
      'levels',
      'ending',
    ]),
  ].filter((value): value is ProjectSlice => value !== undefined)
  return { projectType: anchors.projectType, slices }
}
