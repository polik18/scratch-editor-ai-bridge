export interface ReviewedFeedbackItem {
  readonly feedbackId: string
  readonly type: 'definite-error' | 'other'
  readonly judgedCorrect: boolean
  readonly evidenceResolvable: boolean
  readonly usefulness: 1 | 2 | 3 | 4 | 5
  readonly highImpactError: boolean
  readonly unsupportedCertaintyClaim: boolean
}

export interface TeacherReviewRecord {
  readonly caseId: string
  readonly reviewerCode: string
  readonly items: readonly ReviewedFeedbackItem[]
}

export interface TeacherReviewGateResult {
  readonly status: 'ready-for-human-review' | 'passed' | 'not-ready'
  readonly metrics: {
    readonly caseCount: number
    readonly doubleReviewedCaseCount: number
    readonly definiteErrorPrecision: number | null
    readonly evidenceLocalization: number | null
    readonly usefulnessAverage: number | null
    readonly highImpactErrorCount: number
    readonly unsupportedCertaintyClaimCount: number
  }
  readonly blockers: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Validate a teacher review JSON payload before calculating quality metrics.
 * @param value - Untrusted JSON input from the review worksheet.
 * @returns Validated, de-identified review records.
 */
export const parseTeacherReviewRecords = (value: unknown): readonly TeacherReviewRecord[] => {
  if (!Array.isArray(value)) throw new Error('review records must be a JSON array')
  const reviewerKeys = new Set<string>()
  const records = value.map((record, recordIndex) => {
    if (
      !isRecord(record) ||
      typeof record.caseId !== 'string' ||
      !record.caseId.trim() ||
      typeof record.reviewerCode !== 'string' ||
      !record.reviewerCode.trim() ||
      !Array.isArray(record.items) ||
      Object.keys(record).some((key) => !['caseId', 'reviewerCode', 'items'].includes(key))
    ) {
      throw new Error(`records[${recordIndex}] must contain only caseId, reviewerCode, and items`)
    }
    const reviewerKey = `${record.caseId}\u0000${record.reviewerCode}`
    if (reviewerKeys.has(reviewerKey)) throw new Error(`duplicate reviewer record for case ${record.caseId}`)
    reviewerKeys.add(reviewerKey)
    const items = record.items.map((item, itemIndex): ReviewedFeedbackItem => {
      if (
        !isRecord(item) ||
        typeof item.feedbackId !== 'string' ||
        !item.feedbackId.trim() ||
        !['definite-error', 'other'].includes(String(item.type)) ||
        typeof item.judgedCorrect !== 'boolean' ||
        typeof item.evidenceResolvable !== 'boolean' ||
        ![1, 2, 3, 4, 5].includes(Number(item.usefulness)) ||
        typeof item.highImpactError !== 'boolean' ||
        typeof item.unsupportedCertaintyClaim !== 'boolean' ||
        Object.keys(item).some(
          (key) =>
            ![
              'feedbackId',
              'type',
              'judgedCorrect',
              'evidenceResolvable',
              'usefulness',
              'highImpactError',
              'unsupportedCertaintyClaim',
            ].includes(key),
        )
      ) {
        throw new Error(`records[${recordIndex}].items[${itemIndex}] has invalid or extra fields`)
      }
      return {
        feedbackId: item.feedbackId,
        type: item.type as ReviewedFeedbackItem['type'],
        judgedCorrect: item.judgedCorrect,
        evidenceResolvable: item.evidenceResolvable,
        usefulness: Number(item.usefulness) as ReviewedFeedbackItem['usefulness'],
        highImpactError: item.highImpactError,
        unsupportedCertaintyClaim: item.unsupportedCertaintyClaim,
      }
    })
    return { caseId: record.caseId, reviewerCode: record.reviewerCode, items }
  })
  return records
}

const ratio = (success: number, total: number): number | null => (total === 0 ? null : success / total)

/**
 * Evaluate human review data without storing student projects or reviewer identities.
 * @param records - De-identified teacher ratings for generated feedback.
 * @param expectedCaseIds - Optional allowlist from the published corpus manifest.
 * @returns Aggregate gate status and the reasons it is still closed.
 */
export const evaluateTeacherReviewGate = (
  records: readonly TeacherReviewRecord[],
  expectedCaseIds?: readonly string[],
): TeacherReviewGateResult => {
  const caseReviewers = new Map<string, Set<string>>()
  const items = records.flatMap((record) => {
    const reviewers = caseReviewers.get(record.caseId) ?? new Set<string>()
    reviewers.add(record.reviewerCode)
    caseReviewers.set(record.caseId, reviewers)
    return record.items
  })
  const definite = items.filter(({ type }) => type === 'definite-error')
  const meanUsefulness =
    items.length === 0 ? null : items.reduce((sum, { usefulness }) => sum + usefulness, 0) / items.length
  const allowedCaseIds = new Set(expectedCaseIds ?? caseReviewers.keys())
  const validCaseReviewers = [...caseReviewers.entries()].filter(([caseId]) => allowedCaseIds.has(caseId))
  const unexpectedCaseIds = [...caseReviewers.keys()].filter((caseId) => !allowedCaseIds.has(caseId))
  const metrics = {
    caseCount: validCaseReviewers.length,
    doubleReviewedCaseCount: validCaseReviewers.filter(([, reviewers]) => reviewers.size >= 2).length,
    definiteErrorPrecision: ratio(definite.filter(({ judgedCorrect }) => judgedCorrect).length, definite.length),
    evidenceLocalization: ratio(items.filter(({ evidenceResolvable }) => evidenceResolvable).length, items.length),
    usefulnessAverage: meanUsefulness,
    highImpactErrorCount: items.filter(({ highImpactError }) => highImpactError).length,
    unsupportedCertaintyClaimCount: items.filter(({ unsupportedCertaintyClaim }) => unsupportedCertaintyClaim).length,
  }
  const blockers: string[] = []
  if (unexpectedCaseIds.length > 0) blockers.push(`包含不在 corpus 的案例 ID：${unexpectedCaseIds.join(', ')}`)
  if (metrics.caseCount < 20) blockers.push(`至少需要 20 個不同案例，目前 ${metrics.caseCount}`)
  if (metrics.doubleReviewedCaseCount < 5)
    blockers.push(`至少 5 案需要雙人評閱，目前 ${metrics.doubleReviewedCaseCount}`)
  if (metrics.definiteErrorPrecision === null || metrics.definiteErrorPrecision < 0.95) {
    blockers.push('確定型錯誤回饋 precision 尚未達 95% 或尚無評分資料')
  }
  if (metrics.evidenceLocalization !== 1) blockers.push('證據定位尚未達 100% 或尚無評分資料')
  if (metrics.usefulnessAverage === null || metrics.usefulnessAverage < 4)
    blockers.push('有根據且可採取的有用度平均尚未達 4/5 或尚無評分資料')
  if (metrics.highImpactErrorCount > 0) blockers.push(`仍有 ${metrics.highImpactErrorCount} 項高影響錯誤`)
  if (metrics.unsupportedCertaintyClaimCount > 0)
    blockers.push(`仍有 ${metrics.unsupportedCertaintyClaimCount} 項無依據的確定陳述`)
  return {
    status: records.length === 0 ? 'ready-for-human-review' : blockers.length === 0 ? 'passed' : 'not-ready',
    metrics,
    blockers,
  }
}
