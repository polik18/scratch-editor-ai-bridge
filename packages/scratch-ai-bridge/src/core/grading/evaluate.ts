import { evaluateChecks, type RuntimeEvidence, type StaticEvidence } from './evidence'
import { validateRubric, type Rubric, type RubricCriterion } from './rubric'

/**
 * A judgment for one criterion from an AI provider or the teacher. Teacher judgments override everything; AI
 * judgments are used only for criteria the automatic checks cannot decide.
 */
export interface CriterionJudgment {
  readonly criterionId: string
  readonly source: 'ai' | 'teacher'
  /** For `partial`: the awarded level's ratio. */
  readonly ratio?: number
  /** For `components`: which sub-items passed. */
  readonly components?: Readonly<Record<string, boolean>>
  /** For `binary`. */
  readonly passed?: boolean
  /** 0–1; AI judgments below 0.7 go to the review queue. */
  readonly confidence?: number
  readonly note?: string
}

export type CriterionStatus = 'passed' | 'partial' | 'failed' | 'pending'

export interface CriterionGrade {
  readonly id: string
  readonly title: string
  readonly maxPoints: number
  readonly earnedPoints: number | null
  readonly status: CriterionStatus
  readonly source: 'auto' | 'ai' | 'teacher' | 'none'
  readonly evidence: readonly string[]
  readonly confidence: number
  readonly reviewRequired: boolean
  readonly reviewReasons: readonly string[]
  readonly teacherNote?: string
  readonly components?: readonly {
    readonly id: string
    readonly maxPoints: number
    readonly earnedPoints: number | null
    readonly evidence: readonly string[]
  }[]
}

export interface FormalGrade {
  readonly format: 'scratch-ai-bridge/formal-grade'
  readonly version: 1
  readonly layer: 'formal-grade'
  /** `trial`: graded with a draft/unapproved rubric — never an official grade. */
  readonly status: 'graded' | 'pending' | 'trial'
  readonly rubric: {
    readonly id: string
    readonly title: string
    readonly projectType: Rubric['projectType']
    readonly hash: string
    readonly origin: NonNullable<Rubric['origin']>
    readonly approved: boolean
  }
  /** Absolute rubric score (0–totalPoints scaled to 0–100). Null while any criterion is pending or runtime did not run. */
  readonly rawScore: number | null
  /** Points already decided, for the teacher's view while the grade is pending. */
  readonly provisionalPoints: number
  readonly maxPoints: number
  readonly criteria: readonly CriterionGrade[]
  readonly diagnostic: {
    readonly layer: 'static-diagnostic'
    readonly rubric: 'sb3-static-v3'
    readonly score: number | null
    readonly coverage: number
  }
  readonly runtimeStatus: RuntimeEvidence['status']
  /** Share of the rubric's points whose result is decided by evidence (0–1). */
  readonly evidenceCoverage: number
  /** Points-weighted confidence of the decided criteria (0–1). */
  readonly confidence: number
  readonly reviewRequired: boolean
  readonly reviewReasons: readonly string[]
  /** All conditions for a score of 90+ hold: runtime passed, no pending criteria, at least one runtime criterion earned points. */
  readonly highScoreEvidence: boolean
  readonly limitations: readonly string[]
}

const round2 = (value: number): number => Math.round(value * 100) / 100
const AUTO_PASS_CONFIDENCE = 0.85
const AUTO_FAIL_CONFIDENCE = 0.7
const AI_REVIEW_THRESHOLD = 0.7

const usesRuntime = (criterion: RubricCriterion): boolean =>
  criterion.evidence.some((source) => source === 'runtime' || source === 'audio' || source === 'visual')

const fromJudgment = (
  criterion: RubricCriterion,
  judgment: CriterionJudgment,
): { earned: number | null; evidence: string[] } => {
  const note = judgment.note ? [`${judgment.source === 'teacher' ? '教師' : 'AI'}：${judgment.note}`] : []
  if (criterion.mode === 'binary' && typeof judgment.passed === 'boolean')
    return { earned: judgment.passed ? criterion.points : 0, evidence: note }
  const judgedRatio = judgment.ratio
  if (criterion.mode === 'partial' && typeof judgedRatio === 'number') {
    const level = criterion.levels?.find(({ ratio }) => Math.abs(ratio - judgedRatio) < 1e-9)
    if (!level)
      return { earned: null, evidence: [...note, `判定的級距 ${judgedRatio} 不在教師定義的級距中，已忽略。`] }
    return { earned: criterion.points * level.ratio, evidence: [`級距：${level.description}`, ...note] }
  }
  if (criterion.mode === 'components' && judgment.components) {
    const components = criterion.components ?? []
    if (!components.every(({ id }) => typeof judgment.components?.[id] === 'boolean'))
      return { earned: null, evidence: [...note, '判定沒有涵蓋所有子項目，已忽略。'] }
    return {
      earned: components.reduce((sum, { id, points }) => sum + (judgment.components?.[id] ? points : 0), 0),
      evidence: note,
    }
  }
  return { earned: null, evidence: [...note, '判定格式與項目的判分模式不符，已忽略。'] }
}

const gradeCriterion = (
  criterion: RubricCriterion,
  staticEvidence: StaticEvidence,
  runtime: RuntimeEvidence,
  judgments: readonly CriterionJudgment[],
): CriterionGrade => {
  const base = { id: criterion.id, title: criterion.title, maxPoints: criterion.points }
  const reasons: string[] = criterion.reviewRequired ? ['教師指定此項需人工複核。'] : []
  const finish = (
    earned: number | null,
    source: CriterionGrade['source'],
    evidence: readonly string[],
    confidence: number,
    extra: Partial<CriterionGrade> = {},
  ): CriterionGrade => {
    const earnedPoints = earned === null ? null : round2(earned)
    const status: CriterionStatus =
      earnedPoints === null
        ? 'pending'
        : earnedPoints >= criterion.points
          ? 'passed'
          : earnedPoints > 0
            ? 'partial'
            : 'failed'
    if (status === 'pending') reasons.push('缺少可判定的證據。')
    return {
      ...base,
      earnedPoints,
      status,
      source,
      evidence,
      confidence: earned === null ? 0 : confidence,
      reviewRequired: reasons.length > 0,
      reviewReasons: [...new Set(reasons)],
      ...extra,
    }
  }

  const teacher = judgments.find((judgment) => judgment.criterionId === criterion.id && judgment.source === 'teacher')
  if (teacher) {
    const { earned, evidence } = fromJudgment(criterion, teacher)
    if (earned !== null)
      return finish(earned, 'teacher', evidence, 1, teacher.note ? { teacherNote: teacher.note } : {})
  }

  // Automatic checks.
  let auto: {
    earned: number | null
    evidence: string[]
    falseNegative: boolean
    components?: CriterionGrade['components']
  } | null = null
  if (criterion.mode === 'binary' && criterion.checks?.length) {
    const outcome = evaluateChecks(criterion.checks, staticEvidence, runtime)
    auto = {
      earned: outcome.result === 'pending' ? null : outcome.result === 'pass' ? criterion.points : 0,
      evidence: [...outcome.evidence],
      falseNegative: outcome.suspectFalseNegative,
    }
  } else if (criterion.mode === 'partial' && criterion.levels?.some(({ checks }) => checks?.length)) {
    const levels = [...criterion.levels].sort((left, right) => right.ratio - left.ratio)
    const evidence: string[] = []
    let falseNegative = false
    let earned: number | null = null
    for (const level of levels) {
      if (!level.checks?.length) {
        // A level only a person can judge: award it automatically only when it is the zero level.
        if (level.ratio === 0) earned = 0
        else evidence.push(`級距「${level.description}」需要人工判定。`)
        break
      }
      const outcome = evaluateChecks(level.checks, staticEvidence, runtime)
      if (outcome.result === 'pending') {
        evidence.push(...outcome.evidence)
        break
      }
      falseNegative ||= outcome.suspectFalseNegative
      if (outcome.result === 'pass') {
        earned = criterion.points * level.ratio
        evidence.unshift(`級距：${level.description}`, ...outcome.evidence)
        break
      }
      evidence.push(`未達「${level.description}」：${outcome.evidence.join(' ')}`)
    }
    auto = { earned, evidence, falseNegative }
  } else if (criterion.mode === 'components' && criterion.components?.some(({ checks }) => checks?.length)) {
    let falseNegative = false
    const components = (criterion.components ?? []).map((component) => {
      if (!component.checks?.length)
        return { id: component.id, maxPoints: component.points, earnedPoints: null, evidence: ['需要人工判定。'] }
      const outcome = evaluateChecks(component.checks, staticEvidence, runtime)
      falseNegative ||= outcome.suspectFalseNegative
      return {
        id: component.id,
        maxPoints: component.points,
        earnedPoints: outcome.result === 'pending' ? null : outcome.result === 'pass' ? component.points : 0,
        evidence: outcome.evidence,
      }
    })
    const earned = components.some(({ earnedPoints }) => earnedPoints === null)
      ? null
      : components.reduce((sum, { earnedPoints }) => sum + (earnedPoints ?? 0), 0)
    auto = {
      earned,
      evidence: components.map(
        ({ id, earnedPoints, maxPoints, evidence }) =>
          `${id} ${earnedPoints ?? '?'}／${maxPoints}：${evidence.join(' ')}`,
      ),
      falseNegative,
      components,
    }
  }

  const ai = judgments.find((judgment) => judgment.criterionId === criterion.id && judgment.source === 'ai')
  if (auto && auto.earned !== null) {
    if (auto.falseNegative && auto.earned < criterion.points)
      reasons.push('程式中有相關積木，但自動試玩沒有觸發；可能是測試情境沒走到，請教師確認。')
    const confidence = auto.earned >= criterion.points ? AUTO_PASS_CONFIDENCE : AUTO_FAIL_CONFIDENCE
    return finish(
      auto.earned,
      'auto',
      auto.evidence,
      auto.falseNegative ? 0.5 : confidence,
      auto.components ? { components: auto.components } : {},
    )
  }
  if (ai) {
    const { earned, evidence } = fromJudgment(criterion, ai)
    if (earned !== null) {
      const confidence = Math.max(0, Math.min(1, ai.confidence ?? 0.5))
      if (confidence < AI_REVIEW_THRESHOLD) reasons.push('AI 評量信心不足。')
      return finish(
        earned,
        'ai',
        [...(auto?.evidence ?? []), ...evidence],
        confidence,
        auto?.components ? { components: auto.components } : {},
      )
    }
  }
  return finish(
    null,
    'none',
    auto?.evidence ?? ['這一項沒有自動檢查，需要 AI 評量或教師判定。'],
    0,
    auto?.components ? { components: auto.components } : {},
  )
}

/**
 * The single formal-grade core used by CLI, API and MCP. It grades strictly by the given rubric's criteria and
 * points; it never adds criteria, never rewards size, and never produces a formal score without runtime evidence.
 * @param input Rubric, static and runtime evidence, and optional AI/teacher judgments.
 * @param input.rubric Teacher rubric or built-in fallback.
 * @param input.staticEvidence What the SB3 contains.
 * @param input.runtime What a real playtest observed (`NOT_RUN` when skipped).
 * @param input.judgments Optional AI/teacher judgments per criterion.
 * @returns A formal grade with per-criterion evidence, confidence and review status.
 */
export const evaluateProject = (input: {
  readonly rubric: Rubric
  readonly staticEvidence: StaticEvidence
  readonly runtime: RuntimeEvidence
  readonly judgments?: readonly CriterionJudgment[]
}): FormalGrade => {
  const { rubric, staticEvidence, runtime } = input
  const validation = validateRubric(rubric)
  if (!validation.ok || !validation.rubricHash) throw new Error('rubric-invalid')
  const criteria = rubric.criteria.map((criterion) =>
    gradeCriterion(criterion, staticEvidence, runtime, input.judgments ?? []),
  )
  const total = rubric.totalPoints
  const decided = criteria.filter(({ earnedPoints }) => earnedPoints !== null)
  const decidedPoints = decided.reduce((sum, { maxPoints }) => sum + maxPoints, 0)
  const provisionalPoints = round2(decided.reduce((sum, { earnedPoints }) => sum + (earnedPoints ?? 0), 0))
  const pending = criteria.some(({ status }) => status === 'pending')
  const reviewReasons: string[] = []
  if (runtime.status === 'not-run') reviewReasons.push('作品尚未實際執行；未執行的作品不能產生正式分數。')
  if (runtime.status === 'failed') reviewReasons.push(`作品無法順利執行：${runtime.error ?? '啟動失敗'}`)
  if (pending)
    reviewReasons.push(`有 ${criteria.filter(({ status }) => status === 'pending').length} 個評量項目待判定。`)
  if (staticEvidence.coverage < 0.9)
    reviewReasons.push(`Bridge 只辨識 ${Math.round(staticEvidence.coverage * 100)}% 的積木，部分功能可能看不懂。`)
  if (!validation.approved) reviewReasons.push('rubric 尚未經教師核准，只能當試行評量。')
  for (const criterion of criteria)
    for (const reason of criterion.reviewReasons)
      if (criterion.status !== 'pending') reviewReasons.push(`${criterion.title}：${reason}`)
  const rawScore = runtime.status === 'not-run' || pending ? null : round2((provisionalPoints / total) * 100)
  const confidence =
    decidedPoints === 0
      ? 0
      : round2(decided.reduce((sum, { maxPoints, confidence }) => sum + maxPoints * confidence, 0) / decidedPoints)
  const runtimeCriteria = rubric.criteria.filter(usesRuntime).map(({ id }) => id)
  const highScoreEvidence =
    runtime.status === 'passed' &&
    !pending &&
    criteria.some(({ id, earnedPoints }) => runtimeCriteria.includes(id) && (earnedPoints ?? 0) > 0)
  return {
    format: 'scratch-ai-bridge/formal-grade',
    version: 1,
    layer: 'formal-grade',
    status: !validation.approved ? 'trial' : rawScore === null ? 'pending' : 'graded',
    rubric: {
      id: rubric.id,
      title: rubric.title,
      projectType: rubric.projectType,
      hash: validation.rubricHash,
      origin: rubric.origin ?? 'teacher',
      approved: validation.approved,
    },
    rawScore,
    provisionalPoints,
    maxPoints: total,
    criteria,
    diagnostic: {
      layer: 'static-diagnostic',
      rubric: 'sb3-static-v3',
      score: staticEvidence.diagnosticScore,
      coverage: staticEvidence.coverage,
    },
    runtimeStatus: runtime.status,
    evidenceCoverage: round2(decidedPoints / total),
    confidence,
    reviewRequired: reviewReasons.length > 0 || criteria.some(({ reviewRequired }) => reviewRequired),
    reviewReasons: [...new Set(reviewReasons)],
    highScoreEvidence,
    limitations: [
      '正式分數只依 rubric 的項目與配分計算；積木數、角色數與檔案大小不會加分。',
      '自動試玩只能觸發部分情境；沒有觸發的功能會標記人工複核，而不是直接判定學生錯誤。',
      ...(rubric.origin === 'fallback' ? ['使用內建通用評量表；教師提供自己的 rubric 時以教師規準為準。'] : []),
    ],
  }
}
