import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { importLosslessSb3 } from '../core/archive'
import {
  calibrateCohorts,
  createFallbackRubric,
  createGradeSummary,
  DEFAULT_GRADING_POLICY,
  evaluateProject,
  gradeToMarkdown,
  gradesToCsv,
  NOT_RUN,
  parseGradingPolicy,
  parseRubric,
  PROJECT_TYPES,
  reviewQueueToCsv,
  type CriterionJudgment,
  type FormalGrade,
  type GradeRow,
  type GradingPolicy,
  type ProjectType,
  type Rubric,
  type RubricRuntimeSettings,
  type RuntimeEvidence,
  type StaticEvidence,
  type TeacherOverride,
} from '../core/grading'
import { parseCsvTable } from './batch'
import { inspectSb3Bytes } from './inspect'
import type { PlaytestPlan, PlaytestResult, PlaytestRunner } from './playtest'

const MAX_GRADE_FILES = 500
const isWithin = (parent: string, child: string): boolean => child === parent || child.startsWith(`${parent}${sep}`)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const SCRATCH_KEYS: Readonly<Record<string, string>> = {
  'left arrow': 'ArrowLeft',
  'right arrow': 'ArrowRight',
  'up arrow': 'ArrowUp',
  'down arrow': 'ArrowDown',
  space: ' ',
  enter: 'Enter',
}

const fieldValue = (block: Record<string, unknown>, name: string): string | undefined => {
  const fields = block.fields
  if (!isRecord(fields)) return undefined
  const field = fields[name]
  return Array.isArray(field) && typeof field[0] === 'string' ? field[0] : undefined
}

/**
 * Read what an SB3 contains without running it: every opcode, sprite and hat-started script, the keys it listens to,
 * and the `sb3-static-v3` diagnostic.
 * @param bytes SB3 archive bytes.
 * @returns Static evidence for grading.
 */
export const extractStaticEvidence = async (bytes: Uint8Array): Promise<StaticEvidence> => {
  const [archive, inspection] = await Promise.all([importLosslessSb3(bytes), inspectSb3Bytes(bytes)])
  const targets = Array.isArray(archive.projectJson.targets) ? archive.projectJson.targets.filter(isRecord) : []
  const opcodes: Record<string, number> = {}
  const keys = new Set<string>()
  let scripts = 0
  let clickable = false
  for (const target of targets) {
    const blocks = isRecord(target.blocks) ? Object.values(target.blocks).filter(isRecord) : []
    for (const block of blocks) {
      if (typeof block.opcode !== 'string') continue
      opcodes[block.opcode] = (opcodes[block.opcode] ?? 0) + 1
      if (block.topLevel === true && /^(event_when|control_start_as_clone|procedures_definition)/.test(block.opcode))
        scripts += 1
      if (block.opcode === 'event_whenkeypressed' || block.opcode === 'sensing_keyoptions') {
        const key = fieldValue(block, 'KEY_OPTION')
        if (key) keys.add(key)
      }
      if (block.opcode === 'event_whenthisspriteclicked' || block.opcode === 'event_whenstageclicked')
        clickable = true
    }
  }
  return {
    opcodes,
    sprites: targets.filter((target) => target.isStage !== true).length,
    scripts,
    diagnosticScore: inspection.score.total,
    coverage: Math.round(inspection.score.coverage) / 100,
    keys: [...keys].sort(),
    clickable,
  }
}

/**
 * Derive the automatic playtest from what the project listens to. Larger projects play longer so later scenes and
 * levels get a chance to run.
 * @param evidence Static evidence.
 * @param settings Optional runtime overrides from the rubric.
 * @returns The playtest plan and a readable scenario description.
 */
export const planGradingPlaytest = (
  evidence: StaticEvidence,
  settings: RubricRuntimeSettings = {},
): {
  readonly plan: PlaytestPlan
  readonly scenario: readonly string[]
  readonly movementKeys: ReadonlySet<string>
} => {
  const scratchKeys = settings.keys ?? evidence.keys
  const blocks = Object.values(evidence.opcodes).reduce((sum, value) => sum + value, 0)
  const playMs = settings.playMs ?? Math.min(30_000, Math.max(8000, 8000 + blocks * 20))
  const controls = scratchKeys.flatMap((scratchKey) => {
    if (scratchKey === 'any') return []
    const key = SCRATCH_KEYS[scratchKey] ?? (scratchKey.length === 1 ? scratchKey : undefined)
    if (!key) return []
    const arrow = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', 1], ArrowDown: ['y', -1] } as const
    const movement = arrow[key as keyof typeof arrow] as readonly ['x' | 'y', 1 | -1] | undefined
    return [
      movement
        ? { key, axis: movement[0], sign: movement[1], label: scratchKey, expectsMovement: true }
        : { key, axis: 'x' as const, sign: 1 as const, label: scratchKey, expectsMovement: false },
    ]
  })
  const clicks = settings.clicks ?? evidence.clickable
  return {
    plan: { controls, clicks, playMs },
    movementKeys: new Set(controls.filter(({ expectsMovement }) => expectsMovement).map(({ key }) => key)),
    scenario: [
      '按下綠旗啟動作品，先不操作觀察 1.5 秒',
      ...(controls.length ? [`依作品偵測到的按鍵逐一測試：${controls.map(({ label }) => label).join('、')}`] : []),
      `自由試玩 ${Math.round(playMs / 1000)} 秒${clicks ? '，輪流點擊可見角色' : ''}${controls.length ? '，輪流按鍵' : ''}`,
      '記錄角色、變數、分身與實際執行的聲音／造型／背景／對白／碰觸積木',
    ],
  }
}

/**
 * Convert a playtest result into grading evidence.
 * @param result Playtest result.
 * @param scenario What the tester did.
 * @param movementKeys Keys expected to move a sprite.
 * @returns Evidence in the shape the formal-grade core and the creative pipeline check against.
 */
export const toRuntimeEvidence = (
  result: PlaytestResult,
  scenario: readonly string[],
  movementKeys: ReadonlySet<string>,
): RuntimeEvidence => ({
  status: result.ready ? 'passed' : 'failed',
  ready: result.ready,
  ...(result.error ? { error: result.error } : {}),
  pageErrors: result.pageErrors,
  autonomousMotion: result.autonomousMotion,
  controls: result.controls
    .filter(({ key }) => movementKeys.has(key))
    .map(({ key, moved, sprite }) => ({ key, moved, ...(sprite ? { sprite } : {}) })),
  changedVariables: result.changedVariables,
  executedOpcodes: result.executedOpcodes ?? {},
  maxClones: result.maxClones ?? 0,
  changedSprites: result.changedSprites ?? [],
  durationMs: result.durationMs ?? 0,
  scenario,
})

/**
 * Grade one SB3 with the formal-grade core.
 * @param bytes SB3 archive bytes.
 * @param options Rubric, optional playtest runner and judgments.
 * @param options.rubric Approved teacher rubric or fallback.
 * @param options.runner Playtest runner; without it the grade stays pending.
 * @param options.judgments AI/teacher judgments for this work.
 * @returns Formal grade with its evidence.
 */
export const gradeSb3Bytes = async (
  bytes: Uint8Array,
  options: {
    readonly rubric: Rubric
    readonly runner?: PlaytestRunner
    readonly judgments?: readonly CriterionJudgment[]
  },
): Promise<{
  readonly grade: FormalGrade
  readonly staticEvidence: StaticEvidence
  readonly runtime: RuntimeEvidence
}> => {
  const staticEvidence = await extractStaticEvidence(bytes)
  let runtime = NOT_RUN
  if (options.runner) {
    const { plan, scenario, movementKeys } = planGradingPlaytest(staticEvidence, options.rubric.runtime)
    runtime = toRuntimeEvidence(await options.runner.run(bytes, plan), scenario, movementKeys)
  }
  return {
    grade: evaluateProject({
      rubric: options.rubric,
      staticEvidence,
      runtime,
      ...(options.judgments ? { judgments: options.judgments } : {}),
    }),
    staticEvidence,
    runtime,
  }
}

/**
 * Load a rubric file, or the built-in fallback for a project type when none is given.
 * @param rubricPath Rubric JSON path.
 * @param projectType Project type for the fallback.
 * @param allowTrial Accept an unapproved rubric (results are marked trial).
 * @returns The approved rubric (or the built-in fallback profile).
 */
export const loadRubric = async (
  rubricPath: string | undefined,
  projectType: ProjectType | undefined,
  allowTrial: boolean,
): Promise<Rubric> => {
  if (!rubricPath) return createFallbackRubric(projectType ?? 'mixed')
  const { rubric, validation } = parseRubric(await readFile(rubricPath, 'utf8'))
  if (!rubric) {
    const error = new Error('rubric-invalid')
    Object.assign(error, { issues: validation.errors })
    throw error
  }
  if (!validation.approved && !allowTrial) throw new Error('rubric-not-approved')
  return rubric
}

interface GradeManifestRow {
  readonly studentId: string
  readonly file: string
  readonly gradeLevel?: string
  readonly classId?: string
  readonly assignmentId?: string
}

const STUDENT_ID = /^[A-Za-z0-9_-]{1,64}$/

const readGradeManifest = async (manifestPath: string): Promise<GradeManifestRow[]> => {
  const source = (await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, '')
  let entries: unknown[]
  try {
    if (extname(manifestPath).toLowerCase() === '.csv') {
      const [header = [], ...rows] = parseCsvTable(source)
      const names = header.map((name) => name.trim())
      entries = rows.map((row) => Object.fromEntries(names.map((name, index) => [name, (row[index] ?? '').trim()])))
    } else {
      const parsed: unknown = JSON.parse(source)
      entries = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.files) ? parsed.files : []
    }
  } catch {
    throw new Error('manifest-invalid')
  }
  return entries.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.studentId !== 'string' ||
      !STUDENT_ID.test(entry.studentId) ||
      typeof entry.file !== 'string' ||
      !entry.file
    )
      throw new Error('manifest-invalid')
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' && value ? value.slice(0, 64) : undefined
    const gradeLevel = text(entry.gradeLevel)
    const classId = text(entry.classId)
    const assignmentId = text(entry.assignmentId)
    return {
      studentId: entry.studentId,
      file: entry.file,
      ...(gradeLevel ? { gradeLevel } : {}),
      ...(classId ? { classId } : {}),
      ...(assignmentId ? { assignmentId } : {}),
    }
  })
}

const readJudgments = async (path: string): Promise<Map<string, CriterionJudgment[]>> => {
  const parsed: unknown = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
  if (!Array.isArray(parsed)) throw new Error('judgments-invalid')
  const byStudent = new Map<string, CriterionJudgment[]>()
  for (const entry of parsed) {
    if (
      !isRecord(entry) ||
      typeof entry.studentId !== 'string' ||
      typeof entry.criterionId !== 'string' ||
      (entry.source !== 'ai' && entry.source !== 'teacher')
    )
      throw new Error('judgments-invalid')
    const { studentId, ...judgment } = entry
    byStudent.set(studentId, [...(byStudent.get(studentId) ?? []), judgment as unknown as CriterionJudgment])
  }
  return byStudent
}

const readOverrides = async (path: string): Promise<Map<string, TeacherOverride>> => {
  const source = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  let entries: unknown[]
  if (extname(path).toLowerCase() === '.csv') {
    const [header = [], ...rows] = parseCsvTable(source)
    const names = header.map((name) => name.trim())
    entries = rows.map((row) => Object.fromEntries(names.map((name, index) => [name, (row[index] ?? '').trim()])))
  } else {
    const parsed: unknown = JSON.parse(source)
    entries = Array.isArray(parsed) ? parsed : []
  }
  const overrides = new Map<string, TeacherOverride>()
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.studentId !== 'string') throw new Error('overrides-invalid')
    const score = Number(entry.score)
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100 ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    )
      throw new Error('overrides-invalid')
    overrides.set(entry.studentId, {
      studentId: entry.studentId,
      score,
      reason: entry.reason,
      reviewer: typeof entry.reviewer === 'string' ? entry.reviewer : '',
      ...(typeof entry.at === 'string' ? { at: entry.at } : {}),
    })
  }
  return overrides
}

export interface GradeBatchOptions {
  readonly inputDirectory: string
  readonly outputDirectory: string
  readonly manifestPath?: string
  readonly rubricPath?: string
  /** An already parsed rubric; takes precedence over `rubricPath`. */
  readonly rubric?: Rubric
  readonly projectType?: ProjectType
  readonly policyPath?: string
  readonly judgmentsPath?: string
  readonly overridesPath?: string
  readonly playtest: boolean
  readonly allowTrial?: boolean
  readonly gradeLevel?: string
  readonly classId?: string
  readonly assignmentId?: string
  /** Injected for tests; created from the built preview when `playtest` is set. */
  readonly runner?: PlaytestRunner
}

/**
 * Grade a folder of SB3 files with one rubric and publish the teacher's reports atomically: grades.csv,
 * review-queue.csv, class-summary.json, per-work JSON/Markdown and the private source map.
 * @param options Paths, rubric, policy and playtest switch.
 * @returns The anonymised class summary.
 */
export const runGradeBatch = async (options: GradeBatchOptions) => {
  const inputDirectory = await realpath(options.inputDirectory)
  if (!(await lstat(inputDirectory)).isDirectory()) throw new Error('input-invalid')
  const outputParent = await realpath(dirname(resolve(options.outputDirectory)))
  const outputDirectory = join(outputParent, basename(resolve(options.outputDirectory)))
  if (isWithin(inputDirectory, outputDirectory)) throw new Error('output-path-invalid')
  try {
    await lstat(outputDirectory)
    throw new Error('output-exists')
  } catch (error) {
    if (error instanceof Error && error.message === 'output-exists') throw error
  }

  const rubric =
    options.rubric ?? (await loadRubric(options.rubricPath, options.projectType, options.allowTrial === true))
  if (options.rubric) {
    const validation = parseRubric(JSON.stringify(options.rubric)).validation
    if (!validation.ok) throw new Error('rubric-invalid')
    if (!validation.approved && options.allowTrial !== true) throw new Error('rubric-not-approved')
  }
  const policy: GradingPolicy = options.policyPath
    ? parseGradingPolicy(JSON.parse(await readFile(options.policyPath, 'utf8')))
    : DEFAULT_GRADING_POLICY
  const judgments = options.judgmentsPath
    ? await readJudgments(options.judgmentsPath)
    : new Map<string, CriterionJudgment[]>()
  const overrides = options.overridesPath
    ? await readOverrides(options.overridesPath)
    : new Map<string, TeacherOverride>()

  const files = (await readdir(inputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.sb3')
    .map((entry) => join(inputDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en'))
  if (files.length === 0 || files.length > MAX_GRADE_FILES) throw new Error('input-count-invalid')

  let rows: GradeManifestRow[]
  if (options.manifestPath) {
    rows = await readGradeManifest(options.manifestPath)
    const ids = new Set<string>()
    const targets = new Set<string>()
    for (const row of rows) {
      const normalized = row.file.replaceAll('\\', '/')
      const target = resolve(inputDirectory, normalized)
      if (
        isAbsolute(normalized) ||
        normalized.split('/').includes('..') ||
        !files.includes(target) ||
        ids.has(row.studentId) ||
        targets.has(target)
      )
        throw new Error('manifest-invalid')
      ids.add(row.studentId)
      targets.add(target)
    }
    if (targets.size !== files.length) throw new Error('manifest-invalid')
  } else {
    rows = files.map((file, index) => ({
      studentId: `S${String(index + 1).padStart(4, '0')}`,
      file: relative(inputDirectory, file),
    }))
  }

  let runner = options.runner
  let ownRunner = false
  if (options.playtest && !runner) {
    const { PlaytestRunner } = await import('./playtest')
    runner = await PlaytestRunner.create()
    ownRunner = true
  }
  const temporaryDirectory = `${outputDirectory}.tmp-${process.pid}`
  await mkdir(temporaryDirectory, { mode: 0o700 })
  try {
    const graded: GradeRow[] = []
    for (const row of rows) {
      const cohort = {
        studentId: row.studentId,
        gradeLevel: row.gradeLevel ?? options.gradeLevel ?? 'unspecified',
        classId: row.classId ?? options.classId ?? 'unspecified',
        assignmentId: row.assignmentId ?? options.assignmentId ?? rubric.id,
      }
      try {
        const bytes = await readFile(resolve(inputDirectory, row.file))
        const { grade } = await gradeSb3Bytes(bytes, {
          rubric,
          ...(runner ? { runner } : {}),
          ...(judgments.has(row.studentId) ? { judgments: judgments.get(row.studentId) } : {}),
        })
        graded.push({ ...cohort, status: grade.status, grade })
      } catch {
        graded.push({ ...cohort, status: 'failed', error: '無法讀取或解析這份 Scratch 專案。' })
      }
    }
    const members = graded.flatMap((row) => (row.grade ? [{ ...row, grade: row.grade }] : []))
    const { grades: calibrated, cohorts } = calibrateCohorts(members, policy)
    const finalRows: GradeRow[] = graded.map((row) => {
      const override = overrides.get(row.studentId)
      const calibratedGrade = calibrated.find(({ studentId }) => studentId === row.studentId)
      return {
        ...row,
        ...(calibratedGrade ? { calibrated: calibratedGrade } : {}),
        ...(override
          ? {
              teacherScore: override.score,
              teacherReason: `${override.reason}${override.reviewer ? `（${override.reviewer}）` : ''}`,
            }
          : {}),
      }
    })
    const write = (name: string, content: string) =>
      writeFile(join(temporaryDirectory, name), content, { encoding: 'utf8', mode: 0o600 })
    await write('grades.csv', gradesToCsv(finalRows))
    await write('review-queue.csv', reviewQueueToCsv(finalRows))
    const validation = parseRubric(JSON.stringify(rubric)).validation
    const summary = createGradeSummary(finalRows, cohorts, {
      rubricId: rubric.id,
      rubricHash: validation.rubricHash ?? '',
      approved: validation.approved,
      policy,
    })
    await write('class-summary.json', `${JSON.stringify(summary, null, 2)}\n`)
    await write('rubric.json', `${JSON.stringify(rubric, null, 2)}\n`)
    for (const row of finalRows) {
      await write(`${row.studentId}.json`, `${JSON.stringify(row, null, 2)}\n`)
      await write(`${row.studentId}.md`, gradeToMarkdown(row))
    }
    await write(
      'PRIVATE-teacher-source-map.csv',
      `${[['studentId', 'relativeFile'], ...rows.map((row) => [row.studentId, row.file])].map((cells) => cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',')).join('\n')}\n`,
    )
    await rename(temporaryDirectory, outputDirectory)
    return summary
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  } finally {
    if (ownRunner) await runner?.close()
  }
}

/**
 * Parse a `--project-type` value.
 * @param value Raw value.
 * @returns The project type, or undefined when invalid.
 */
export const parseProjectType = (value: string): ProjectType | undefined =>
  (PROJECT_TYPES as readonly string[]).includes(value) ? (value as ProjectType) : undefined
