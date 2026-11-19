import type { FormalGrade } from './evaluate'

export interface GradingPolicy {
  readonly mode: 'cohort-calibrated' | 'absolute'
  readonly scoreRange: { readonly min: number; readonly max: number }
  readonly targetMode: number
  readonly relativeWeight: number
  readonly cohortKey: readonly ('gradeLevel' | 'classId' | 'assignmentId' | 'rubricVersion')[]
  readonly minimumCohortSize: number
  readonly recommendedCohortSize: number
  readonly tiePolicy: 'midrank'
  readonly incompletePolicy: 'pending-or-below-range'
  /** Raw score a work needs to enter the score range; below it the work is `below-range`. */
  readonly minimumRawForRange: number
  /** Confidence a work needs to enter the score range; below it the work stays pending for review. */
  readonly minimumConfidence: number
  /** Final scores at or above this need `highScoreEvidence`. */
  readonly highScoreThreshold: number
}

export const DEFAULT_GRADING_POLICY: GradingPolicy = {
  mode: 'cohort-calibrated',
  scoreRange: { min: 80, max: 100 },
  targetMode: 90,
  relativeWeight: 0.5,
  cohortKey: ['gradeLevel', 'classId', 'assignmentId', 'rubricVersion'],
  minimumCohortSize: 10,
  recommendedCohortSize: 30,
  tiePolicy: 'midrank',
  incompletePolicy: 'pending-or-below-range',
  minimumRawForRange: 40,
  minimumConfidence: 0.6,
  highScoreThreshold: 90,
}

/**
 * Validate a grading policy file, filling defaults for omitted fields.
 * @param input Parsed JSON (may be partial).
 * @returns The complete policy.
 */
export const parseGradingPolicy = (input: unknown): GradingPolicy => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('policy-invalid')
  const policy = { ...DEFAULT_GRADING_POLICY, ...(input as Partial<GradingPolicy>) }
  const { min, max } = policy.scoreRange as Partial<GradingPolicy['scoreRange']>
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  if (
    !['cohort-calibrated', 'absolute'].includes(policy.mode) ||
    !finite(min) ||
    !finite(max) ||
    min < 0 ||
    max > 100 ||
    min >= max ||
    !finite(policy.targetMode) ||
    policy.targetMode <= min ||
    policy.targetMode >= max ||
    !finite(policy.relativeWeight) ||
    policy.relativeWeight < 0 ||
    policy.relativeWeight > 1 ||
    !Number.isInteger(policy.minimumCohortSize) ||
    policy.minimumCohortSize < 2 ||
    !finite(policy.minimumRawForRange) ||
    !finite(policy.minimumConfidence) ||
    !finite(policy.highScoreThreshold) ||
    !Array.isArray(policy.cohortKey)
  )
    throw new Error('policy-invalid')
  return policy
}

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9).
 * @param p Probability in (0, 1).
 * @returns z such that Φ(z) = p.
 */
export const inverseNormal = (p: number): number => {
  if (p <= 0 || p >= 1) throw new Error('inverseNormal needs 0 < p < 1')
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    )
  }
  if (p > 1 - low) return -inverseNormal(1 - p)
  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

const midranks = (values: readonly number[]): number[] => {
  const order = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value)
  const ranks = new Array<number>(values.length)
  for (let start = 0; start < order.length;) {
    let end = start
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end += 1
    const rank = (start + end) / 2 + 1
    for (let position = start; position <= end; position += 1) ranks[order[position].index] = rank
    start = end + 1
  }
  return ranks
}

/**
 * Spearman rank correlation.
 * @param left First series.
 * @param right Second series of the same length.
 * @returns Correlation in [-1, 1], or null when undefined.
 */
export const spearman = (left: readonly number[], right: readonly number[]): number | null => {
  if (left.length !== right.length || left.length < 3) return null
  const a = midranks(left)
  const b = midranks(right)
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const meanA = mean(a)
  const meanB = mean(b)
  let numerator = 0
  let varianceA = 0
  let varianceB = 0
  for (let index = 0; index < a.length; index += 1) {
    numerator += (a[index] - meanA) * (b[index] - meanB)
    varianceA += (a[index] - meanA) ** 2
    varianceB += (b[index] - meanB) ** 2
  }
  return varianceA === 0 || varianceB === 0 ? null : numerator / Math.sqrt(varianceA * varianceB)
}

export interface CohortMember {
  readonly studentId: string
  readonly gradeLevel: string
  readonly classId: string
  readonly assignmentId: string
  readonly grade: FormalGrade
}

export interface CalibratedGrade {
  readonly studentId: string
  readonly cohort: string
  /** `scored`: in range; `below-range`: graded but incomplete/too weak; `pending`: needs evidence or review first. */
  readonly band: 'scored' | 'below-range' | 'pending'
  readonly rawScore: number | null
  readonly cohortScore: number | null
  readonly finalScore: number | null
  readonly rank: number | null
  readonly percentile: number | null
  readonly warnings: readonly string[]
}

export interface CohortSummary {
  readonly cohort: string
  readonly size: number
  readonly scored: number
  readonly belowRange: number
  readonly pending: number
  readonly mode: number | null
  readonly median: number | null
  readonly iqr: readonly [number, number] | null
  readonly at80: number
  readonly at90: number
  readonly at100: number
  readonly distribution: Readonly<Record<string, number>>
  readonly calibrationWarnings: readonly string[]
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const quantile = (sorted: readonly number[], q: number): number => {
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

const modeOf = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || Math.abs(left[0] - 90) - Math.abs(right[0] - 90),
  )[0][0]
}

const cohortName = (member: CohortMember, policy: GradingPolicy): string =>
  policy.cohortKey
    .map((key) => (key === 'rubricVersion' ? member.grade.rubric.hash.slice(0, 12) : member[key]))
    .join('/')

/**
 * Calibrate formal grades within each cohort (same grade level, class, assignment and rubric). Raw scores are never
 * rewritten; ranking only places eligible works inside the policy's score range, and incomplete, low-confidence or
 * runtime-less works are kept out of the range instead of being lifted by rank.
 * @param members Formal grades with their cohort fields.
 * @param policy Grading policy.
 * @returns Per-student calibrated grades and per-cohort distribution checks.
 */
export const calibrateCohorts = (
  members: readonly CohortMember[],
  policy: GradingPolicy = DEFAULT_GRADING_POLICY,
): { readonly grades: readonly CalibratedGrade[]; readonly cohorts: readonly CohortSummary[] } => {
  const { min, max } = policy.scoreRange
  const groups = new Map<string, CohortMember[]>()
  for (const member of members) {
    const key = cohortName(member, policy)
    groups.set(key, [...(groups.get(key) ?? []), member])
  }
  const grades: CalibratedGrade[] = []
  const cohorts: CohortSummary[] = []
  for (const [cohort, group] of groups) {
    const eligible = group.filter(
      ({ grade }) =>
        grade.status === 'graded' &&
        grade.rawScore !== null &&
        grade.runtimeStatus === 'passed' &&
        grade.confidence >= policy.minimumConfidence &&
        grade.rawScore >= policy.minimumRawForRange,
    )
    const calibrationWarnings: string[] = []
    const useCohort = policy.mode === 'cohort-calibrated' && eligible.length >= policy.minimumCohortSize
    if (policy.mode === 'cohort-calibrated' && !useCohort)
      calibrationWarnings.push(
        `可排名作品只有 ${eligible.length} 件，少於 ${policy.minimumCohortSize} 件，不做班內相對校準，只用絕對分映射。`,
      )
    const weight = useCohort ? policy.relativeWeight : 0
    const n = eligible.length
    const ranks = midranks(eligible.map(({ grade }) => grade.rawScore ?? 0))
    const edge = n >= 2 ? inverseNormal((n - 0.5) / n) : 1
    const spread = Math.min(policy.targetMode - min, max - policy.targetMode) / edge
    const byStudent = new Map<string, CalibratedGrade>()
    eligible.forEach((member, index) => {
      const raw = member.grade.rawScore ?? 0
      const midrank = ranks[index]
      const percentile = (midrank - 0.5) / n
      const absoluteBand = min + (raw / 100) * (max - min)
      const cohortBand = useCohort ? clamp(policy.targetMode + spread * inverseNormal(percentile), min, max) : null
      let finalScore = Math.round((1 - weight) * absoluteBand + weight * (cohortBand ?? absoluteBand))
      const warnings: string[] = []
      if (finalScore >= policy.highScoreThreshold && !member.grade.highScoreEvidence) {
        finalScore = policy.highScoreThreshold - 1
        warnings.push(`缺少高分所需的完整執行證據，分數上限為 ${policy.highScoreThreshold - 1}。`)
      }
      byStudent.set(member.studentId, {
        studentId: member.studentId,
        cohort,
        band: 'scored',
        rawScore: raw,
        cohortScore: cohortBand === null ? null : Math.round(cohortBand * 10) / 10,
        finalScore: clamp(finalScore, min, max),
        rank: n - Math.floor(midrank) + 1,
        percentile: Math.round(percentile * 1000) / 10,
        warnings,
      })
    })
    for (const member of group) {
      const scored = byStudent.get(member.studentId)
      if (scored) {
        grades.push(scored)
        continue
      }
      const { grade } = member
      const warnings: string[] = []
      let band: CalibratedGrade['band'] = 'pending'
      let finalScore: number | null = null
      if (grade.status !== 'graded' || grade.rawScore === null) warnings.push('評量尚未完成，暫不給分。')
      else if (grade.runtimeStatus !== 'passed' && grade.runtimeStatus !== 'failed') warnings.push('尚未實際執行。')
      else if (grade.confidence < policy.minimumConfidence)
        warnings.push(`信心 ${grade.confidence} 低於 ${policy.minimumConfidence}，需教師複核。`)
      else {
        band = 'below-range'
        finalScore = Math.min(min - 1, Math.round((grade.rawScore / 100) * min))
        warnings.push(
          grade.runtimeStatus === 'failed'
            ? '作品無法順利執行，不進入班內排名範圍。'
            : `原始分 ${grade.rawScore} 低於進入範圍的門檻 ${policy.minimumRawForRange}。`,
        )
      }
      grades.push({
        studentId: member.studentId,
        cohort,
        band,
        rawScore: grade.rawScore,
        cohortScore: null,
        finalScore,
        rank: null,
        percentile: null,
        warnings,
      })
    }

    const cohortGrades = grades.filter((grade) => grade.cohort === cohort)
    const finals = cohortGrades
      .filter(({ band }) => band === 'scored')
      .map(({ finalScore }) => finalScore ?? 0)
      .sort((left, right) => left - right)
    const mode = modeOf(finals)
    const distribution: Record<string, number> = {}
    for (const score of finals) distribution[String(score)] = (distribution[String(score)] ?? 0) + 1
    if (finals.length >= 3 && new Set(finals).size === 1)
      calibrationWarnings.push(`所有可排名作品都是 ${finals[0]} 分，分數沒有鑑別度。`)
    if (finals.length >= policy.minimumCohortSize && mode !== null && Math.abs(mode - policy.targetMode) > 3)
      calibrationWarnings.push(`眾數 ${mode} 偏離目標 ${policy.targetMode} 超過 3 分。`)
    if (finals.length >= 3 && finals.filter((score) => score === max).length / finals.length > 0.3)
      calibrationWarnings.push(`超過三成作品是 ${max} 分，請檢查高分門檻。`)
    const paired = group.flatMap((member) => {
      const calibrated = cohortGrades.find(({ studentId }) => studentId === member.studentId)
      return calibrated?.band === 'scored' && calibrated.finalScore !== null
        ? [[member.grade.evidenceCoverage, calibrated.finalScore] as const]
        : []
    })
    const correlation = spearman(
      paired.map(([coverage]) => coverage),
      paired.map(([, score]) => score),
    )
    if (correlation !== null && correlation < -0.3)
      calibrationWarnings.push(`證據覆蓋率越低分數反而越高（Spearman ${correlation.toFixed(2)}），請檢查評分。`)
    cohorts.push({
      cohort,
      size: group.length,
      scored: finals.length,
      belowRange: cohortGrades.filter(({ band }) => band === 'below-range').length,
      pending: cohortGrades.filter(({ band }) => band === 'pending').length,
      mode,
      median: finals.length ? quantile(finals, 0.5) : null,
      iqr: finals.length ? [quantile(finals, 0.25), quantile(finals, 0.75)] : null,
      at80: finals.filter((score) => score === 80).length,
      at90: finals.filter((score) => score === 90).length,
      at100: finals.filter((score) => score === 100).length,
      distribution,
      calibrationWarnings,
    })
  }
  return { grades, cohorts }
}
