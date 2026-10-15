import type { AnalysisIR, ProjectMap } from './'

export type FeedbackKind = 'confirmed-structure' | 'likely-behavior' | 'design-question' | 'unsupported-feature'

export interface ProjectFeedbackItem {
  readonly id: string
  readonly kind: FeedbackKind
  readonly severity: 'info' | 'warning'
  readonly confidence: 'high' | 'limited'
  readonly title: string
  readonly message: string
  readonly nextStep: string
  readonly evidenceIds: readonly string[]
}

export interface ProjectFeedback {
  readonly format: 'scratch-ai-bridge/project-feedback'
  readonly version: 1
  readonly summary: string
  readonly items: readonly ProjectFeedbackItem[]
  readonly limits: readonly string[]
}

const kindForFact = (kind: ProjectMap['facts'][number]['kind']): FeedbackKind =>
  kind === 'limitation' ? 'unsupported-feature' : 'confirmed-structure'

/**
 * Convert evidence-backed facts and calibrated static diagnostics into formative feedback.
 * @param analysis - Static checks for the imported project.
 * @param map - Factual project map with source evidence.
 * @returns Feedback items that keep observations separate from design questions.
 */
export const createProjectFeedback = (analysis: AnalysisIR, map: ProjectMap): ProjectFeedback => {
  const items: ProjectFeedbackItem[] = map.facts.map((fact) => ({
    id: fact.id,
    kind: kindForFact(fact.kind),
    severity: 'info',
    confidence: fact.confidence,
    title: fact.kind === 'limitation' ? '目前無法完整解讀' : '作品觀察',
    message: fact.claim,
    nextStep:
      fact.kind === 'limitation'
        ? '可以在原 Scratch 專案中執行這段程式，確認這個積木帶來的效果。'
        : '想一想：這段程式對角色或作品有什麼作用？',
    evidenceIds: fact.evidence.map(({ id }) => id),
  }))

  for (const diagnostic of analysis.diagnostics) {
    if (diagnostic.code === 'forever-reinitialize') {
      const related = map.evidence.filter(
        (item) => item.targetName === diagnostic.target && item.scriptIndex === (diagnostic.script ?? 1) - 1,
      )
      items.push({
        id: `diagnostic:${diagnostic.code}:${encodeURIComponent(diagnostic.target ?? '')}:${diagnostic.script ?? 0}`,
        kind: 'design-question',
        severity: 'info',
        confidence: 'limited',
        title: '一個可以檢查的設計選擇',
        message: `${diagnostic.message} 這是程式結構觀察，不代表一定有錯。`,
        nextStep: '如果這個值每一輪都要更新，保留目前寫法；若只想在開始時設定一次，再考慮移到迴圈前。',
        evidenceIds: related.map(({ id }) => id),
      })
      continue
    }
    if (diagnostic.severity !== 'warning') continue
    const related = map.evidence.filter((item) => {
      if (diagnostic.target && item.targetName !== diagnostic.target) return false
      if (diagnostic.script && item.scriptIndex !== diagnostic.script - 1) return false
      return true
    })
    if (related.length === 0) continue
    items.push({
      id: `diagnostic:${diagnostic.code}:${encodeURIComponent(diagnostic.target ?? '')}:${diagnostic.script ?? 0}`,
      kind: 'likely-behavior',
      severity: 'warning',
      confidence: 'limited',
      title: '建議確認',
      message: diagnostic.message,
      nextStep: '在 Scratch 中執行作品，或檢查相關角色的事件與程式，再確認是否符合你的設計。',
      evidenceIds: related.slice(0, 8).map(({ id }) => id),
    })
  }

  const confirmed = map.facts.filter(({ confidence }) => confidence === 'high').length
  return {
    format: 'scratch-ai-bridge/project-feedback',
    version: 1,
    summary: `找到 ${confirmed} 項有積木依據的作品觀察。這份分析來自專案結構，沒有替作品評分。`,
    items,
    limits: [
      '靜態分析無法判定創意、美感、難度、學生是否理解程式或作品的實際手感。',
      '除非明確附上 VM/瀏覽器測試結果，否則不代表作品已執行或 FPS 達標。',
      ...map.facts.filter(({ kind }) => kind === 'limitation').map(({ claim }) => claim),
    ],
  }
}
