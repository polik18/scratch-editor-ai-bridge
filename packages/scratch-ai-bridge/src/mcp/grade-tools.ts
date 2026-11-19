import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { gradeSb3Bytes, parseProjectType, runGradeBatch } from '../cli/grade'
import { outputRoot } from '../cli/output-layout'
import {
  createFallbackRubric,
  draftRubricFromText,
  validateRubric,
  type CriterionJudgment,
  type ProjectType,
  type Rubric,
} from '../core/grading'

/**
 * Resolve a path the MCP client gave and require it to stay inside the Bridge output folder, so a client can only
 * grade class folders the teacher placed there (for example output/classes/601) and never read arbitrary files.
 * @param candidate Absolute path, or a path relative to the output folder.
 * @param root Allowed root; defaults to the Bridge output folder.
 * @returns The real path.
 */
export const resolveGradingPath = async (candidate: string, root: string = outputRoot()): Promise<string> => {
  const realRoot = await realpath(root)
  const resolved = await realpath(path.resolve(realRoot, candidate))
  if (resolved !== realRoot && !resolved.startsWith(`${realRoot}${path.sep}`))
    throw new Error(`評量檔案必須放在 ${realRoot} 底下（例如 output/classes/<班級>/）。`)
  return resolved
}

const parseRubricInput = (input: unknown): Rubric => {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
  const validation = validateRubric(value)
  if (!validation.ok)
    throw new Error(
      `rubric 格式錯誤：${validation.errors.map(({ path: where, message }) => `${where} ${message}`).join('；')}`,
    )
  return value as Rubric
}

const pickRubric = (rubric: unknown, projectType: string | undefined): Rubric => {
  if (rubric !== undefined) return parseRubricInput(rubric)
  const type = projectType ? parseProjectType(projectType) : undefined
  if (projectType && !type) throw new Error('projectType 無效。')
  return createFallbackRubric(type ?? 'mixed')
}

/**
 * MCP `validate_rubric`.
 * @param rubric Rubric object or JSON text.
 * @returns Validation with hash and approval state.
 */
export const validateRubricTool = (rubric: unknown) => {
  const value: unknown = typeof rubric === 'string' ? JSON.parse(rubric) : rubric
  return { format: 'scratch-ai-bridge/rubric-validation', version: 1, ...validateRubric(value) }
}

/**
 * MCP `draft_rubric`: teacher text to an unapproved draft.
 * @param input Text and rubric identity.
 * @param input.text Teacher criteria, one per line ending with "N 分".
 * @param input.id Stable rubric identifier.
 * @param input.title Title shown to teachers.
 * @param input.projectType Which project-type profile the assignment uses.
 * @returns Draft, unread lines and validation.
 */
export const draftRubricTool = (input: { text: string; id: string; title: string; projectType: string }) => {
  const projectType = parseProjectType(input.projectType)
  if (!projectType) throw new Error('projectType 無效。')
  const { rubric, unread } = draftRubricFromText(input.text, { id: input.id, title: input.title, projectType })
  return {
    format: 'scratch-ai-bridge/rubric-draft',
    version: 1,
    rubric,
    unread,
    validation: validateRubric(rubric),
    next: '草案需要老師檢查並核准（CLI：rubric approve）後才會產生正式成績；AI 不得自行核准或修改配分。',
  }
}

/**
 * MCP `grade_sb3`: one work.
 * @param input File, rubric and playtest switch.
 * @param input.file SB3 path inside the output folder.
 * @param input.rubric Approved rubric (object or JSON); omit for the built-in fallback.
 * @param input.projectType Project type for the fallback.
 * @param input.playtest Run the work in the real Scratch preview (required for a formal score).
 * @param input.judgments AI/teacher judgments.
 * @param input.trial Accept an unapproved rubric; results are marked trial.
 * @param root Allowed root for tests.
 * @returns Formal grade.
 */
export const gradeSb3Tool = async (
  input: {
    file: string
    rubric?: unknown
    projectType?: string
    playtest?: boolean
    judgments?: readonly CriterionJudgment[]
    trial?: boolean
  },
  root?: string,
) => {
  const file = await resolveGradingPath(input.file, root)
  const rubric = pickRubric(input.rubric, input.projectType)
  if (!validateRubric(rubric).approved && input.trial !== true)
    throw new Error('rubric 尚未核准；請老師先核准，或加 trial: true 只做試行評量。')
  let runner: import('../cli/playtest').PlaytestRunner | undefined
  if (input.playtest) {
    const { PlaytestRunner } = await import('../cli/playtest')
    runner = await PlaytestRunner.create()
  }
  try {
    const { grade, runtime } = await gradeSb3Bytes(new Uint8Array(await readFile(file)), {
      rubric,
      ...(runner ? { runner } : {}),
      ...(input.judgments ? { judgments: input.judgments } : {}),
    })
    return { ...grade, runtimeScenario: runtime.scenario }
  } finally {
    await runner?.close()
  }
}

/**
 * MCP `grade_sb3_batch`: a class folder; reports go to output/reports/<name>.
 * @param input Folder, rubric, manifest, policy and cohort fields.
 * @param input.directory Class folder inside the output folder.
 * @param input.rubric Approved rubric (object or JSON); omit for the built-in fallback.
 * @param input.projectType Project type for the fallback rubric.
 * @param input.manifest studentId/file manifest path inside the output folder.
 * @param input.policy grading-policy.json path.
 * @param input.judgments AI/teacher judgments JSON path.
 * @param input.overrides Teacher override CSV/JSON path.
 * @param input.playtest Run every work in the real Scratch preview (needed for formal scores).
 * @param input.trial Accept an unapproved rubric; results are marked trial.
 * @param input.gradeLevel Default grade level for the cohort.
 * @param input.classId Default class for the cohort.
 * @param input.assignmentId Default assignment for the cohort.
 * @param input.reportName Report folder name under output/reports.
 * @param root Allowed root for tests.
 * @returns Summary and the report folder.
 */
export const gradeBatchTool = async (
  input: {
    directory: string
    rubric?: unknown
    projectType?: string
    manifest?: string
    policy?: string
    judgments?: string
    overrides?: string
    playtest?: boolean
    trial?: boolean
    gradeLevel?: string
    classId?: string
    assignmentId?: string
    reportName?: string
  },
  root?: string,
) => {
  const base = root ?? outputRoot()
  const directory = await resolveGradingPath(input.directory, base)
  const rubric = pickRubric(input.rubric, input.projectType)
  const optionalPath = async (value: string | undefined) => (value ? resolveGradingPath(value, base) : undefined)
  const [manifestPath, policyPath, judgmentsPath, overridesPath] = await Promise.all([
    optionalPath(input.manifest),
    optionalPath(input.policy),
    optionalPath(input.judgments),
    optionalPath(input.overrides),
  ])
  const name = (
    input.reportName ?? `grade-${path.basename(directory)}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  ).replace(/[^\p{L}\p{N}_-]+/gu, '-')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path.join(base, 'reports'), { recursive: true })
  const outputDirectory = path.join(base, 'reports', name)
  const summary = await runGradeBatch({
    inputDirectory: directory,
    outputDirectory,
    rubric,
    playtest: input.playtest === true,
    allowTrial: input.trial === true,
    ...(manifestPath ? { manifestPath } : {}),
    ...(policyPath ? { policyPath } : {}),
    ...(judgmentsPath ? { judgmentsPath } : {}),
    ...(overridesPath ? { overridesPath } : {}),
    ...(input.gradeLevel ? { gradeLevel: input.gradeLevel } : {}),
    ...(input.classId ? { classId: input.classId } : {}),
    ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
  })
  return { reportDirectory: outputDirectory, summary }
}

/**
 * MCP `get_grade_report`: read one file of a grade report (never the private source map).
 * @param input Report folder and which part to read.
 * @param input.reportDirectory Folder returned by grade_sb3_batch.
 * @param input.part `summary`, `grades.csv`, `review-queue.csv` or a student ID.
 * @param root Allowed root for tests.
 * @returns File content.
 */
export const getGradeReportTool = async (input: { reportDirectory: string; part: string }, root?: string) => {
  const directory = await resolveGradingPath(input.reportDirectory, root)
  const files: Record<string, string> = {
    summary: 'class-summary.json',
    'grades.csv': 'grades.csv',
    'review-queue.csv': 'review-queue.csv',
  }
  const name = files[input.part] ?? (/^[A-Za-z0-9_-]{1,64}$/.test(input.part) ? `${input.part}.json` : undefined)
  if (!name) throw new Error('part 必須是 summary、grades.csv、review-queue.csv 或學生代碼。')
  const text = await readFile(path.join(directory, name), 'utf8')
  return name.endsWith('.json') ? (JSON.parse(text) as unknown) : { file: name, csv: text.replace(/^\uFEFF/, '') }
}

export type { ProjectType }
