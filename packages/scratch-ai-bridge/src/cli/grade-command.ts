import { lstat, readFile, writeFile } from 'node:fs/promises'
import { approveRubric, draftRubricFromText, parseRubric, validateRubric } from '../core/grading'
import { gradeSb3Bytes, loadRubric, parseProjectType, runGradeBatch } from './grade'

interface CommandResult {
  readonly output: unknown
  readonly exitCode: number
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'arguments-invalid': '參數無效；請看 --help。',
  'input-invalid': '輸入必須是 .sb3 檔或資料夾。',
  'output-path-invalid': '輸出資料夾不能位於輸入資料夾內。',
  'output-exists': '輸出資料夾已存在；請指定一個新的路徑。',
  'input-count-invalid': '找不到 SB3 檔，或檔案數超過 500 份上限。',
  'manifest-invalid': 'Manifest 格式、學生代碼或檔案路徑無效。',
  'rubric-invalid': 'rubric 格式錯誤；先執行 rubric validate 查看原因。',
  'rubric-not-approved': 'rubric 尚未核准（或核准後被修改）。請老師執行 rubric approve；只想試跑時加 --trial。',
  'policy-invalid': 'grading policy 格式錯誤。',
  'judgments-invalid': '判定檔格式錯誤：需要 [{studentId, criterionId, source: "ai"|"teacher", ...}]。',
  'overrides-invalid': '教師調整檔需要 studentId、score（0～100）和 reason。',
}

const failure = (code: string, extra: Record<string, unknown> = {}): CommandResult => ({
  output: {
    format: 'scratch-ai-bridge/grade-error',
    version: 1,
    status: 'failed',
    error: {
      code: ERROR_MESSAGES[code] ? code : 'grade-failed',
      message: ERROR_MESSAGES[code] ?? '無法完成評量。',
      ...extra,
    },
  },
  exitCode: ERROR_MESSAGES[code] ? 2 : 3,
})

const VALUE_FLAGS = new Set([
  '--rubric',
  '--project-type',
  '--out',
  '--manifest',
  '--policy',
  '--judgments',
  '--overrides',
  '--grade-level',
  '--class',
  '--assignment',
  '--id',
  '--title',
  '--by',
  '--teachers',
])

const parseFlags = (
  args: readonly string[],
  booleans: readonly string[],
): { positionals: string[]; values: Map<string, string>; flags: Set<string> } | null => {
  const positionals: string[] = []
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (VALUE_FLAGS.has(argument)) {
      const value = args[index + 1]
      if (!value || values.has(argument)) return null
      values.set(argument, value)
      index += 1
    } else if (booleans.includes(argument)) flags.add(argument)
    else if (argument.startsWith('-')) return null
    else positionals.push(argument)
  }
  return { positionals, values, flags }
}

/**
 * `grade <directory|file.sb3>`: formal grading with the teacher's rubric.
 * @param args Arguments after the command name.
 * @param defaultReportDirectory Picks a new folder under output/reports for batch runs.
 * @returns JSON output and exit code.
 */
export const runGrade = async (
  args: readonly string[],
  defaultReportDirectory: (input: string) => Promise<string>,
): Promise<CommandResult> => {
  const parsed = parseFlags(args, ['--playtest', '--trial'])
  if (parsed?.positionals.length !== 1) return failure('arguments-invalid')
  const { positionals, values, flags } = parsed
  const projectTypeValue = values.get('--project-type')
  const projectType = projectTypeValue ? parseProjectType(projectTypeValue) : undefined
  if (projectTypeValue && !projectType) return failure('arguments-invalid')
  const input = positionals[0]
  try {
    const stat = await lstat(input)
    if (stat.isFile()) {
      if (!input.toLowerCase().endsWith('.sb3')) return failure('input-invalid')
      const rubric = await loadRubric(values.get('--rubric'), projectType, flags.has('--trial'))
      let runner: import('./playtest').PlaytestRunner | undefined
      if (flags.has('--playtest')) {
        const { PlaytestRunner } = await import('./playtest')
        runner = await PlaytestRunner.create()
      }
      try {
        const { grade, runtime } = await gradeSb3Bytes(new Uint8Array(await readFile(input)), {
          rubric,
          ...(runner ? { runner } : {}),
        })
        return {
          output: { ...grade, runtimeScenario: runtime.scenario },
          exitCode: grade.status === 'graded' ? 0 : 1,
        }
      } finally {
        await runner?.close()
      }
    }
    if (!stat.isDirectory()) return failure('input-invalid')
    const rubricPath = values.get('--rubric')
    const manifestPath = values.get('--manifest')
    const policyPath = values.get('--policy')
    const judgmentsPath = values.get('--judgments')
    const overridesPath = values.get('--overrides')
    const gradeLevel = values.get('--grade-level')
    const classId = values.get('--class')
    const assignmentId = values.get('--assignment')
    const summary = await runGradeBatch({
      inputDirectory: input,
      outputDirectory: values.get('--out') ?? (await defaultReportDirectory(input)),
      playtest: flags.has('--playtest'),
      allowTrial: flags.has('--trial'),
      ...(rubricPath ? { rubricPath } : {}),
      ...(projectType ? { projectType } : {}),
      ...(manifestPath ? { manifestPath } : {}),
      ...(policyPath ? { policyPath } : {}),
      ...(judgmentsPath ? { judgmentsPath } : {}),
      ...(overridesPath ? { overridesPath } : {}),
      ...(gradeLevel ? { gradeLevel } : {}),
      ...(classId ? { classId } : {}),
      ...(assignmentId ? { assignmentId } : {}),
    })
    return { output: summary, exitCode: summary.pending > 0 || summary.failed > 0 || summary.trial > 0 ? 1 : 0 }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const issues =
      error instanceof Error && 'issues' in error ? { issues: (error as { issues: unknown }).issues } : {}
    return failure(code, issues)
  }
}

/**
 * `rubric validate|draft|approve`.
 * @param args Arguments after the command name.
 * @returns JSON output and exit code.
 */
export const runRubric = async (args: readonly string[]): Promise<CommandResult> => {
  const [action, ...rest] = args
  const parsed = parseFlags(rest, [])
  if (parsed?.positionals.length !== 1) return failure('arguments-invalid')
  const { positionals, values } = parsed
  const file = positionals[0]
  try {
    if (action === 'validate') {
      const { validation } = parseRubric(await readFile(file, 'utf8'))
      return {
        output: { format: 'scratch-ai-bridge/rubric-validation', version: 1, ...validation },
        exitCode: validation.ok ? 0 : 1,
      }
    }
    if (action === 'draft') {
      const id = values.get('--id')
      const title = values.get('--title')
      const projectType = parseProjectType(values.get('--project-type') ?? '')
      if (!id || !title || !projectType) return failure('arguments-invalid')
      const { rubric, unread } = draftRubricFromText(await readFile(file, 'utf8'), { id, title, projectType })
      const validation = validateRubric(rubric)
      const out = values.get('--out')
      if (out) await writeFile(out, `${JSON.stringify(rubric, null, 2)}\n`, { flag: 'wx' })
      return {
        output: {
          format: 'scratch-ai-bridge/rubric-draft',
          version: 1,
          ...(out ? { output: out } : { rubric }),
          unread,
          validation,
          next: '請老師檢查每一項的配分、級距與自動檢查，修改後執行 rubric approve；核准前不會產生正式成績。',
        },
        exitCode: validation.ok ? 0 : 1,
      }
    }
    if (action === 'approve') {
      const by = values.get('--by')
      if (!by) return failure('arguments-invalid')
      const { rubric, validation } = parseRubric(await readFile(file, 'utf8'))
      if (!rubric) return failure('rubric-invalid', { issues: validation.errors })
      const { approval: _previous, ...content } = rubric
      const approved = approveRubric(
        { ...content, origin: rubric.origin === 'fallback' ? 'fallback' : 'teacher' },
        by,
      )
      const out = values.get('--out') ?? file
      await writeFile(out, `${JSON.stringify(approved, null, 2)}\n`)
      return {
        output: { format: 'scratch-ai-bridge/rubric-approval', version: 1, output: out, approval: approved.approval },
        exitCode: 0,
      }
    }
    return failure('arguments-invalid')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return failure('output-exists')
    return failure(error instanceof Error ? error.message : '')
  }
}

/**
 * `calibrate <report-dir> --teachers <scores.csv>`: V2-12 comparison of automatic grades with blind teacher scores.
 * The CSV has `studentId,teacher,score` and optional `c:<criterionId>` columns.
 * @param args Arguments after the command name.
 * @returns Calibration report and exit code (0 only when official-ready).
 */
export const runCalibrate = async (args: readonly string[]): Promise<CommandResult> => {
  if (args[0] === 'prepare') return prepareCalibration(args.slice(1))
  const parsed = parseFlags(args, [])
  const teachersPath = parsed?.values.get('--teachers')
  if (parsed?.positionals.length !== 1 || !teachersPath) return failure('arguments-invalid')
  const { compareWithTeachers } = await import('../core/grading')
  const { parseCsvTable } = await import('./batch')
  const { readdir } = await import('node:fs/promises')
  const path = await import('node:path')
  try {
    const directory = parsed.positionals[0]
    const autos = []
    for (const file of (await readdir(directory)).filter(
      (name) => /^[A-Za-z0-9_-]+\.json$/.test(name) && name !== 'class-summary.json' && name !== 'rubric.json',
    )) {
      const row = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as import('../core/grading').GradeRow
      if (!row.grade) continue
      autos.push({
        studentId: row.studentId,
        rawScore: row.grade.rawScore,
        criteria: Object.fromEntries(row.grade.criteria.map(({ id, earnedPoints }) => [id, earnedPoints])),
        reviewRequired: row.grade.reviewRequired,
        evidenceCoverage: row.grade.evidenceCoverage,
        ...(row.grade.rawScore === null
          ? {
              scope: {
                criteria: row.grade.criteria.filter(({ earnedPoints }) => earnedPoints !== null).map(({ id }) => id),
                maxPoints: row.grade.criteria
                  .filter(({ earnedPoints }) => earnedPoints !== null)
                  .reduce((sum, { maxPoints }) => sum + maxPoints, 0),
                earned: row.grade.provisionalPoints,
              },
            }
          : {}),
      })
    }
    let totalPoints = 100
    try {
      const rubric = JSON.parse(await readFile(path.join(directory, 'rubric.json'), 'utf8')) as {
        totalPoints?: number
      }
      if (typeof rubric.totalPoints === 'number' && rubric.totalPoints > 0) totalPoints = rubric.totalPoints
    } catch {
      // Reports without rubric.json use raw 0–100 scores.
    }
    const teachers = []
    // Several sheets (one per teacher) may be given separated by commas; unscored rows are skipped.
    for (const sheet of teachersPath
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      const [header = [], ...rows] = parseCsvTable((await readFile(sheet, 'utf8')).replace(/^\uFEFF/, ''))
      const names = header.map((name) => name.trim())
      for (const cells of rows) {
        const entry = Object.fromEntries(names.map((name, index) => [name, (cells[index] ?? '').trim()]))
        if (!entry.studentId || !entry.teacher) throw new Error('teachers-invalid')
        const criteria = Object.fromEntries(
          names
            .filter((name) => name.startsWith('c:') && entry[name] !== '')
            .map((name) => [name.slice(2), Number(entry[name])]),
        )
        const criterionValues = Object.values(criteria)
        if (criterionValues.some((value) => !Number.isFinite(value))) throw new Error('teachers-invalid')
        // A sheet may give only per-criterion points; the overall score is then their sum on the 0–100 scale.
        const score =
          entry.score !== ''
            ? Number(entry.score)
            : criterionValues.length
              ? (criterionValues.reduce((sum, value) => sum + value, 0) / totalPoints) * 100
              : Number.NaN
        if (entry.score === '' && criterionValues.length === 0) continue
        if (!Number.isFinite(score)) throw new Error('teachers-invalid')
        teachers.push({ studentId: entry.studentId, teacher: entry.teacher, score, criteria })
      }
    }
    const report = compareWithTeachers(autos, teachers)
    return { output: report, exitCode: report.officialReady ? 0 : 1 }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return code === 'teachers-invalid'
      ? { output: { status: 'failed', error: '教師評分檔需要 studentId、teacher、score 欄位。' }, exitCode: 2 }
      : failure(code)
  }
}

/**
 * `calibrate prepare <sb3-folder> --rubric <rubric.json> --out <new folder> [--teachers T1,T2] [--playtest]`:
 * build a blind-review kit. Teachers get anonymised copies, one empty score sheet each and the rubric in plain
 * language — never the automatic scores, which go to a separate folder for `calibrate` afterwards.
 * @param args Arguments after `prepare`.
 * @returns Paths of the kit and the next commands.
 */
const prepareCalibration = async (args: readonly string[]): Promise<CommandResult> => {
  const parsed = parseFlags(args, ['--playtest'])
  const rubricPath = parsed?.values.get('--rubric')
  const outPath = parsed?.values.get('--out')
  if (parsed?.positionals.length !== 1 || !rubricPath || !outPath) return failure('arguments-invalid')
  const { copyFile, mkdir, readdir, realpath, stat } = await import('node:fs/promises')
  const path = await import('node:path')
  const teacherNames = (parsed.values.get('--teachers') ?? 'T1,T2')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z0-9_-]{1,32}$/.test(name))
  if (teacherNames.length < 2) return failure('arguments-invalid')
  try {
    const input = await realpath(parsed.positionals[0])
    const out = path.resolve(outPath)
    try {
      await stat(out)
      return failure('output-exists')
    } catch {
      // A new folder is required.
    }
    if (out === input || out.startsWith(`${input}${path.sep}`)) return failure('output-path-invalid')
    const files = (await readdir(input, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sb3'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en'))
    if (files.length === 0 || files.length > 500) return failure('input-count-invalid')
    const rubric = await loadRubric(rubricPath, undefined, true)
    const kit = path.join(out, 'teacher-kit')
    const works = path.join(kit, 'works')
    await mkdir(works, { recursive: true, mode: 0o700 })
    const ids = files.map((_, index) => `S${String(index + 1).padStart(4, '0')}`)
    for (const [index, file] of files.entries())
      await copyFile(path.join(input, file), path.join(works, `${ids[index]}.sb3`))
    const cell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
    await writeFile(
      path.join(out, 'PRIVATE-source-map.csv'),
      `${['studentId,file', ...files.map((file, index) => `${ids[index]},${cell(file)}`)].join('\n')}\n`,
      { mode: 0o600 },
    )
    const criterionColumns = rubric.criteria.map(({ id }) => `c:${id}`)
    for (const teacher of teacherNames)
      await writeFile(
        path.join(kit, `scores-${teacher}.csv`),
        `\uFEFF${[['studentId', 'teacher', 'score', ...criterionColumns].join(','), ...ids.map((id) => [id, teacher, '', ...criterionColumns.map(() => '')].join(','))].join('\n')}\n`,
      )
    const describe = rubric.criteria
      .map((criterion) => {
        const parts =
          criterion.mode === 'components'
            ? (criterion.components ?? []).map(({ description, points }) => `  - ${description}：${points} 分`)
            : criterion.mode === 'partial'
              ? (criterion.levels ?? []).map(
                  ({ ratio, description }) =>
                    `  - ${Math.round(ratio * criterion.points * 100) / 100} 分：${description}`,
                )
              : [`  - 做到給 ${criterion.points} 分，沒做到給 0 分`]
        return [`- **c:${criterion.id} ${criterion.title}**（${criterion.points} 分）`, ...parts].join('\n')
      })
      .join('\n')
    await writeFile(
      path.join(kit, '評分說明.md'),
      `# 盲評說明：${rubric.title}

請每位老師**各自獨立**評分，不要討論、不要看系統的自動分數（系統分數不在這個資料夾裡）。

1. 在 Scratch 打開 \`works/\` 裡的作品（檔名只有匿名代碼），實際操作或播放。
2. 在自己的 \`scores-<代碼>.csv\` 中，每一列填各評量項目的得分（\`c:\` 開頭的欄位）；\`score\` 可以留空，系統會用各項加總換算成 100 分制。
3. 依下面的規準給分，不要因為作品大小、角色數量或積木數量加減分。

## 評量項目（總分 ${rubric.totalPoints}）

${describe}

評完把 CSV 交回，執行：

\`\`\`sh
npm run --silent bridge -- calibrate <自動評分報告資料夾> --teachers ${teacherNames.map((name) => `scores-${name}.csv`).join(',')}
\`\`\`
`,
    )
    const autoReport = path.join(out, 'auto-report')
    const summary = await runGradeBatch({
      inputDirectory: works,
      outputDirectory: autoReport,
      rubric,
      playtest: parsed.flags.has('--playtest'),
      allowTrial: true,
    })
    return {
      output: {
        format: 'scratch-ai-bridge/calibration-kit',
        version: 1,
        works: files.length,
        teacherKit: kit,
        teacherSheets: teacherNames.map((name) => path.join(kit, `scores-${name}.csv`)),
        autoReport,
        autoSummary: { graded: summary.graded, pending: summary.pending, failed: summary.failed },
        privateSourceMap: path.join(out, 'PRIVATE-source-map.csv'),
        next: `把 teacher-kit 資料夾交給老師（不要給 auto-report）；收回評分後執行 calibrate ${autoReport} --teachers <各老師的 CSV，以逗號分隔>`,
        warnings: [
          ...(files.length < 30 ? [`只有 ${files.length} 件作品；正式校準至少需要 30 件。`] : []),
          ...(parsed.flags.has('--playtest')
            ? []
            : ['沒有加 --playtest：自動分會是 pending，校準時無法比較；正式校準請加 --playtest。']),
        ],
      },
      exitCode: 0,
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : '')
  }
}
