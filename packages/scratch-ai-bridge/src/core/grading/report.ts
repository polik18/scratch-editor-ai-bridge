import type { CalibratedGrade, CohortSummary } from './calibrate'
import type { FormalGrade } from './evaluate'

export interface GradeRow {
  readonly studentId: string
  readonly gradeLevel: string
  readonly classId: string
  readonly assignmentId: string
  /** `failed`: the SB3 could not be read at all. */
  readonly status: 'graded' | 'pending' | 'trial' | 'failed'
  readonly grade?: FormalGrade
  readonly calibrated?: CalibratedGrade
  readonly teacherScore?: number
  readonly teacherReason?: string
  readonly error?: string
}

/** A teacher override: the original automatic score and evidence stay in the report. */
export interface TeacherOverride {
  readonly studentId: string
  readonly score: number
  readonly reason: string
  readonly reviewer: string
  readonly at?: string
}

const csvCell = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  // Prevent spreadsheet formula injection from text cells.
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === 'string' ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

const toCsv = (rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string =>
  `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`

/**
 * The teacher's grade sheet. `exportScore` is the teacher score when set, otherwise the calibrated final score;
 * raw, cohort, diagnostic and automatic scores stay visible beside it.
 * @param rows Graded rows.
 * @returns CSV text (UTF-8 with BOM so spreadsheet apps read Chinese correctly).
 */
export const gradesToCsv = (rows: readonly GradeRow[]): string => {
  const criterionIds = [...new Set(rows.flatMap(({ grade }) => grade?.criteria.map(({ id }) => id) ?? []))]
  const header = [
    'studentId',
    'gradeLevel',
    'classId',
    'assignmentId',
    'status',
    'band',
    'exportScore',
    'finalScore',
    'autoScore',
    'teacherScore',
    'rawScore',
    'cohortScore',
    'diagnosticScore',
    'rank',
    'percentile',
    'confidence',
    'evidenceCoverage',
    'runtimeStatus',
    'reviewRequired',
    'rubricId',
    'rubricVersion',
    ...criterionIds.map((id) => `c:${id}`),
    'notes',
  ]
  return toCsv([
    header,
    ...rows.map((row) => {
      const finalScore = row.calibrated?.finalScore ?? null
      return [
        row.studentId,
        row.gradeLevel,
        row.classId,
        row.assignmentId,
        row.status,
        row.calibrated?.band ?? (row.status === 'failed' ? 'pending' : ''),
        row.teacherScore ?? finalScore,
        finalScore,
        finalScore,
        row.teacherScore,
        row.grade?.rawScore,
        row.calibrated?.cohortScore,
        row.grade?.diagnostic.score,
        row.calibrated?.rank,
        row.calibrated?.percentile,
        row.grade?.confidence,
        row.grade?.evidenceCoverage,
        row.grade?.runtimeStatus ?? 'not-run',
        row.status === 'failed' || row.grade?.reviewRequired === true || (row.calibrated?.warnings.length ?? 0) > 0,
        row.grade?.rubric.id,
        row.grade?.rubric.hash.slice(0, 12),
        ...criterionIds.map((id) => row.grade?.criteria.find((criterion) => criterion.id === id)?.earnedPoints),
        [row.error, row.teacherReason, ...(row.calibrated?.warnings ?? [])].filter(Boolean).join('；'),
      ]
    }),
  ])
}

/**
 * Rows the teacher must look at before exporting grades, with every reason.
 * @param rows Graded rows.
 * @returns CSV text.
 */
export const reviewQueueToCsv = (rows: readonly GradeRow[]): string =>
  toCsv([
    [
      'studentId',
      'status',
      'band',
      'rawScore',
      'provisionalPoints',
      'maxPoints',
      'confidence',
      'runtimeStatus',
      'reasons',
    ],
    ...rows
      .filter(
        (row) =>
          row.status === 'failed' ||
          row.grade?.reviewRequired === true ||
          row.calibrated?.band === 'pending' ||
          (row.calibrated?.warnings.length ?? 0) > 0,
      )
      .map((row) => [
        row.studentId,
        row.status,
        row.calibrated?.band ?? 'pending',
        row.grade?.rawScore,
        row.grade?.provisionalPoints,
        row.grade?.maxPoints,
        row.grade?.confidence,
        row.grade?.runtimeStatus ?? 'not-run',
        [
          ...(row.error ? [row.error] : []),
          ...(row.grade?.reviewReasons ?? []),
          ...(row.grade?.criteria
            .filter(({ status }) => status === 'pending')
            .map(({ title }) => `待判定：${title}`) ?? []),
          ...(row.calibrated?.warnings ?? []),
        ].join('；'),
      ]),
  ])

/**
 * Human-readable report for one work.
 * @param row Graded row.
 * @returns Markdown with per-criterion points, evidence, review reasons and limitations.
 */
export const gradeToMarkdown = (row: GradeRow): string => {
  if (!row.grade) return `# ${row.studentId} 評量報告\n\n無法評量：${row.error ?? '無法讀取作品。'}\n`
  const { grade, calibrated } = row
  const lines = [
    `# ${row.studentId} 評量報告`,
    '',
    `- 評量表：${grade.rubric.title}（${grade.rubric.projectType}，版本 ${grade.rubric.hash.slice(0, 12)}${grade.rubric.approved ? '' : '，**未核准，僅供試行**'}）`,
    `- 狀態：${grade.status}；實際執行：${grade.runtimeStatus}`,
    `- 原始分：${grade.rawScore ?? `待定（已判定 ${grade.provisionalPoints}／${grade.maxPoints}）`}`,
    ...(calibrated
      ? [
          `- 班內校準後：${calibrated.finalScore ?? '待定'}（${calibrated.band}${calibrated.rank ? `，第 ${calibrated.rank} 名` : ''}）`,
        ]
      : []),
    ...(row.teacherScore !== undefined ? [`- 教師調整：${row.teacherScore}（${row.teacherReason ?? ''}）`] : []),
    `- 信心 ${grade.confidence}；證據覆蓋 ${Math.round(grade.evidenceCoverage * 100)}%`,
    `- 靜態結構診斷分（不是成績）：${grade.diagnostic.score ?? '無法計算'}`,
    '',
    '## 各評量項目',
    '',
    ...grade.criteria.flatMap((criterion) => [
      `### ${criterion.title}：${criterion.earnedPoints ?? '待定'}／${criterion.maxPoints}`,
      '',
      `來源：${{ auto: '自動檢查', ai: 'AI 評量', teacher: '教師', none: '尚無' }[criterion.source]}；信心 ${criterion.confidence}`,
      '',
      ...criterion.evidence.map((line) => `- ${line}`),
      ...criterion.reviewReasons.map((reason) => `- ⚠️ ${reason}`),
      '',
    ]),
    ...(grade.reviewReasons.length
      ? ['## 需要教師複核', '', ...grade.reviewReasons.map((reason) => `- ${reason}`), '']
      : []),
    ...(calibrated?.warnings.length
      ? ['## 校準提醒', '', ...calibrated.warnings.map((warning) => `- ${warning}`), '']
      : []),
    '## 限制',
    '',
    ...grade.limitations.map((limit) => `- ${limit}`),
    '',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Class summary JSON: counts, cohort distributions and calibration warnings, with no names.
 * @param rows Graded rows.
 * @param cohorts Cohort distribution checks.
 * @param meta Rubric and policy identifiers.
 * @param meta.rubricId Rubric identifier.
 * @param meta.rubricHash Content hash every work was graded with.
 * @param meta.approved Whether the rubric was teacher-approved (official grades) or trial.
 * @param meta.policy Grading policy used for cohort calibration.
 * @returns Summary object.
 */
export const createGradeSummary = (
  rows: readonly GradeRow[],
  cohorts: readonly CohortSummary[],
  meta: {
    readonly rubricId: string
    readonly rubricHash: string
    readonly approved: boolean
    readonly policy: unknown
  },
) => ({
  format: 'scratch-ai-bridge/grade-summary' as const,
  version: 1 as const,
  layer: 'formal-grade' as const,
  officialGrades: meta.approved,
  rubricId: meta.rubricId,
  rubricHash: meta.rubricHash,
  policy: meta.policy,
  total: rows.length,
  graded: rows.filter(({ status }) => status === 'graded').length,
  pending: rows.filter(({ status }) => status === 'pending').length,
  trial: rows.filter(({ status }) => status === 'trial').length,
  failed: rows.filter(({ status }) => status === 'failed').length,
  reviewRequired: rows.filter((row) => row.status === 'failed' || row.grade?.reviewRequired === true).length,
  cohorts,
  limitations: [
    '正式分數只來自核准的 rubric、實際執行證據與 AI／教師判定；靜態結構診斷分不是成績。',
    '班內相對校準只作用在同一年級／班級／作業／rubric；不同年級請比較 rawScore 與各項目，不要比較 finalScore。',
    ...(meta.approved ? [] : ['rubric 尚未核准：本批結果只能當試行評量，不能當正式成績。']),
  ],
})
