import { spearman } from './calibrate'

/** One teacher's blind score for one work, optionally per criterion. */
export interface TeacherScore {
  readonly studentId: string
  readonly teacher: string
  readonly score: number
  readonly criteria?: Readonly<Record<string, number>>
}

/** The automatic side of one work, taken from a grade report. */
export interface AutoScore {
  readonly studentId: string
  /** Raw rubric score (0–100); null while pending. */
  readonly rawScore: number | null
  readonly criteria: Readonly<Record<string, number | null>>
  readonly reviewRequired: boolean
  readonly evidenceCoverage: number
  /**
   * Set when the grade is still pending (for example a criterion only a teacher can judge): compare only the
   * automatically decided criteria, on both sides, scaled to 0–100.
   */
  readonly scope?: { readonly criteria: readonly string[]; readonly maxPoints: number; readonly earned: number }
}

export interface CalibrationThresholds {
  /** Minimum Spearman between automatic and median teacher scores. */
  readonly minSpearman: number
  /** Minimum mean pairwise Spearman between teachers (otherwise the rubric itself is unclear). */
  readonly minTeacherAgreement: number
  /** A work counts as a large disagreement when |auto − teacher median| exceeds this (raw points). */
  readonly disagreement: number
  /** Share of large disagreements that must already be in the review queue. */
  readonly minReviewRecall: number
  /** Share of works allowed in 90–100 by the automatic raw score. */
  readonly maxTopShare: number
}

export const DEFAULT_CALIBRATION_THRESHOLDS: CalibrationThresholds = {
  minSpearman: 0.7,
  minTeacherAgreement: 0.7,
  disagreement: 15,
  minReviewRecall: 0.8,
  maxTopShare: 0.4,
}

export interface CalibrationReport {
  readonly format: 'scratch-ai-bridge/grade-calibration'
  readonly version: 1
  readonly works: number
  readonly teachers: readonly string[]
  readonly spearman: number | null
  readonly meanAbsoluteError: number | null
  readonly criterionMeanAbsoluteError: Readonly<Record<string, number>>
  readonly teacherAgreement: number | null
  readonly largeDisagreements: readonly {
    readonly studentId: string
    readonly auto: number
    readonly teacherMedian: number
    readonly flagged: boolean
  }[]
  readonly reviewRecall: number | null
  readonly topShare: number | null
  readonly coverageScoreCorrelation: number | null
  readonly pendingExcluded: number
  /** Works compared only on their automatically decided criteria. */
  readonly partialScope: number
  /** True only when every check passed; otherwise results stay "試行正式評量". */
  readonly officialReady: boolean
  readonly failures: readonly string[]
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const round = (value: number): number => Math.round(value * 1000) / 1000

/**
 * V2-12 calibration: compare automatic grades with blind teacher scores. Reports rank correlation, per-criterion error,
 * agreement between teachers, how many large disagreements the review queue already caught, score inflation and
 * whether lower evidence coverage ever means higher scores. Only when every check passes may grades be called official.
 * @param autos Automatic grades.
 * @param teachers Blind teacher scores (at least two teachers for agreement).
 * @param thresholds Pass thresholds.
 * @returns Calibration report.
 */
export const compareWithTeachers = (
  autos: readonly AutoScore[],
  teachers: readonly TeacherScore[],
  thresholds: CalibrationThresholds = DEFAULT_CALIBRATION_THRESHOLDS,
): CalibrationReport => {
  const teacherNames = [...new Set(teachers.map(({ teacher }) => teacher))].sort()
  const comparable = (auto: AutoScore): number | null =>
    auto.rawScore ??
    (auto.scope && auto.scope.maxPoints > 0 ? (auto.scope.earned / auto.scope.maxPoints) * 100 : null)
  const teacherValue = (auto: AutoScore, teacher: TeacherScore): number | null => {
    const scope = auto.scope
    if (auto.rawScore !== null || !scope) return teacher.score
    const values = scope.criteria.map((id) => teacher.criteria?.[id])
    if (values.some((value) => value === undefined)) return null
    return ((values as number[]).reduce((sum, value) => sum + value, 0) / scope.maxPoints) * 100
  }
  const rows = autos.flatMap((auto) => {
    const value = comparable(auto)
    if (value === null) return []
    const own = teachers.filter(({ studentId }) => studentId === auto.studentId)
    const teacherValues = own.flatMap((teacher) => {
      const scored = teacherValue(auto, teacher)
      return scored === null ? [] : [scored]
    })
    if (teacherValues.length === 0) return []
    return [{ auto: { ...auto, rawScore: value }, teacherMedian: median(teacherValues), own }]
  })
  const pendingExcluded = autos.filter((auto) => comparable(auto) === null).length
  const partialScope = autos.filter(
    (auto) => auto.rawScore === null && rows.some((row) => row.auto.studentId === auto.studentId),
  ).length
  const failures: string[] = []
  const rho = spearman(
    rows.map(({ auto }) => auto.rawScore),
    rows.map(({ teacherMedian }) => teacherMedian),
  )
  const mae = rows.length
    ? round(
        rows.reduce((sum, { auto, teacherMedian }) => sum + Math.abs(auto.rawScore - teacherMedian), 0) / rows.length,
      )
    : null

  const criterionIds = [...new Set(rows.flatMap(({ auto }) => Object.keys(auto.criteria)))]
  const criterionMeanAbsoluteError: Record<string, number> = {}
  for (const id of criterionIds) {
    const pairs = rows.flatMap(({ auto, own }) => {
      const teacherValues = own.flatMap(({ criteria }) => (criteria && id in criteria ? [criteria[id]] : []))
      const value = id in auto.criteria ? auto.criteria[id] : null
      return value === null || teacherValues.length === 0 ? [] : [Math.abs(value - median(teacherValues))]
    })
    if (pairs.length)
      criterionMeanAbsoluteError[id] = round(pairs.reduce((sum, value) => sum + value, 0) / pairs.length)
  }

  const pairwise: number[] = []
  for (let left = 0; left < teacherNames.length; left += 1)
    for (let right = left + 1; right < teacherNames.length; right += 1) {
      const shared = rows.flatMap(({ own }) => {
        const a = own.find(({ teacher }) => teacher === teacherNames[left])
        const b = own.find(({ teacher }) => teacher === teacherNames[right])
        return a && b ? [[a.score, b.score] as const] : []
      })
      const value = spearman(
        shared.map(([a]) => a),
        shared.map(([, b]) => b),
      )
      if (value !== null) pairwise.push(value)
    }
  const teacherAgreement = pairwise.length
    ? round(pairwise.reduce((sum, value) => sum + value, 0) / pairwise.length)
    : null

  const largeDisagreements = rows
    .filter(({ auto, teacherMedian }) => Math.abs(auto.rawScore - teacherMedian) > thresholds.disagreement)
    .map(({ auto, teacherMedian }) => ({
      studentId: auto.studentId,
      auto: auto.rawScore,
      teacherMedian,
      flagged: auto.reviewRequired,
    }))
  const reviewRecall = largeDisagreements.length
    ? round(largeDisagreements.filter(({ flagged }) => flagged).length / largeDisagreements.length)
    : null
  const topShare = rows.length ? round(rows.filter(({ auto }) => auto.rawScore >= 90).length / rows.length) : null
  const coverageScoreCorrelation = spearman(
    rows.map(({ auto }) => auto.evidenceCoverage),
    rows.map(({ auto }) => auto.rawScore),
  )

  if (rows.length < 30) failures.push(`只有 ${rows.length} 件可比較的作品，校準至少需要 30 件。`)
  if (teacherNames.length < 2) failures.push('至少需要兩位教師獨立盲評。')
  if (rho === null || rho < thresholds.minSpearman)
    failures.push(
      `自動分與教師中位數的 Spearman ${rho === null ? '無法計算' : round(rho)} 低於 ${thresholds.minSpearman}。`,
    )
  if (teacherNames.length >= 2 && (teacherAgreement === null || teacherAgreement < thresholds.minTeacherAgreement))
    failures.push(
      `教師間一致性 ${teacherAgreement ?? '無法計算'} 低於 ${thresholds.minTeacherAgreement}；請先釐清 rubric。`,
    )
  if (reviewRecall !== null && reviewRecall < thresholds.minReviewRecall)
    failures.push(
      `大幅落差的作品只有 ${Math.round(reviewRecall * 100)}% 進了複核佇列（需要 ${Math.round(thresholds.minReviewRecall * 100)}%）。`,
    )
  if (topShare !== null && topShare > thresholds.maxTopShare)
    failures.push(`${Math.round(topShare * 100)}% 的作品原始分在 90 以上，可能虛高。`)
  if (coverageScoreCorrelation !== null && coverageScoreCorrelation < -0.3)
    failures.push(`證據覆蓋率越低分數越高（Spearman ${round(coverageScoreCorrelation)}）。`)

  return {
    format: 'scratch-ai-bridge/grade-calibration',
    version: 1,
    works: rows.length,
    teachers: teacherNames,
    spearman: rho === null ? null : round(rho),
    meanAbsoluteError: mae,
    criterionMeanAbsoluteError,
    teacherAgreement,
    largeDisagreements,
    reviewRecall,
    topShare,
    coverageScoreCorrelation: coverageScoreCorrelation === null ? null : round(coverageScoreCorrelation),
    pendingExcluded,
    partialScope,
    officialReady: failures.length === 0,
    failures,
  }
}
