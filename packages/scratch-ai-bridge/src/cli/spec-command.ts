import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildFromSpecText, createSpecScenarios, formatSpecDiagnostics } from '../spec'
import type { SpecDiagnostic } from '../spec'
import { generateGame, type GeneratorResult } from './generator'
import {
  backupGame,
  BUILT_SPEC_SUFFIX,
  exists,
  gameFiles,
  gamesRoot,
  gameTarget,
  safeName,
  specTitle,
  writeProcessFile,
  type GameFiles,
} from './output-layout'
import type { ScenarioResult } from './scenario-runner'

export interface SpecBuildOptions {
  readonly specPath: string
  /**
   * Defaults to `output/games/<name>/<name>.sb3`: next to the spec when it already lives in a game folder there,
   * otherwise in a folder named after the spec's 標題.
   */
  readonly outputFile?: string
  /** Replaces `output/games` (tests). */
  readonly gamesDirectory?: string
  readonly irPath?: string
  readonly reportPath?: string
  readonly playtest: boolean
  readonly force: boolean
}

export interface SpecBuildReport {
  readonly format: 'scratch-ai-bridge/spec-build'
  readonly version: 1
  readonly status: 'success' | 'failed'
  /** `pass` only when every generated scenario expectation passed; `not-run` without `--playtest`. */
  readonly playtestStatus: 'pass' | 'fail' | 'not-run'
  /** Everything the author (or the model) needs to fix next, as plain lines. Empty when nothing is left to fix. */
  readonly feedback: string
  readonly output?: string
  /** The spec copy kept next to the game (only when the output folder was chosen automatically). */
  readonly specFile?: string
  /** This build's report and other files left over from making the game. */
  readonly processDirectory?: string
  /** Where the replaced SB3 and its spec were copied before a `--force` rebuild. */
  readonly previousVersion?: string
  readonly title?: string
  /** Requests the spec author listed under 做不到; the game was built without them. */
  readonly unsupported?: readonly string[]
  readonly diagnostics: readonly SpecDiagnostic[]
  readonly generation?: Pick<GeneratorResult, 'status' | 'gates' | 'diagnostics'>
  readonly playtest?: readonly ScenarioResult[]
}

const defaultTarget = async (specPath: string, text: string, gamesDirectory: string): Promise<GameFiles> => {
  const relative = path.relative(gamesDirectory, path.dirname(specPath))
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    const name = path.basename(specPath).replace(/(\.spec)?\.json$/i, '')
    return gameFiles(path.join(path.dirname(specPath), `${name}.sb3`))
  }
  return gameTarget(gamesDirectory, safeName(specTitle(text)), false)
}

/**
 * Spec file → checks → Canonical IR → existing generation gates → optional generated playtest scenarios.
 * Without `outputFile` the game goes to `output/games/<name>/` with a copy of the spec next to it.
 * The report is always also saved in the game's `_過程` folder.
 * @param options - Input spec, output paths and whether to playtest.
 * @returns Build report with diagnostics, gates, playtest results and feedback lines.
 */
export const runSpecBuild = async (options: SpecBuildOptions): Promise<SpecBuildReport> => {
  const specPath = path.resolve(options.specPath)
  const text = await readFile(specPath, 'utf-8')
  const automatic = !options.outputFile
  const files = options.outputFile
    ? gameFiles(options.outputFile)
    : await defaultTarget(specPath, text, options.gamesDirectory ?? gamesRoot())
  const created = !(await exists(files.directory))
  await mkdir(files.directory, { recursive: true })
  const previousVersion = options.force ? await backupGame(files) : undefined
  let built: SpecBuildReport
  try {
    built = await buildSpecText(text, { ...options, outputFile: files.sb3 })
  } catch (error) {
    // A build that crashes (for example an --ir path that cannot be written) must not leave an empty game folder.
    if (created) await rm(files.directory, { recursive: true, force: true })
    throw error
  }
  let report: SpecBuildReport = {
    ...built,
    processDirectory: files.processDirectory,
    ...(previousVersion ? { previousVersion } : {}),
  }
  if (built.status === 'success') {
    await writeProcessFile(files, BUILT_SPEC_SUFFIX, text)
    if (automatic) {
      if (files.spec !== specPath) await copyFile(specPath, files.spec)
      report = { ...report, specFile: files.spec }
    }
  }
  await writeProcessFile(files, 'report.json', `${JSON.stringify(report, null, 2)}\n`)
  return report
}

/**
 * Same as {@link runSpecBuild} for spec text that is already in memory (model replies, MCP tool arguments).
 * @param text - Spec JSON, optionally wrapped in prose or code fences.
 * @param options - Output paths and whether to playtest.
 * @returns Build report with diagnostics, gates, playtest results and feedback lines.
 */
export const buildSpecText = async (
  text: string,
  options: Omit<SpecBuildOptions, 'specPath' | 'outputFile' | 'gamesDirectory'> & { readonly outputFile: string },
): Promise<SpecBuildReport> => {
  const built = buildFromSpecText(text)
  const base = { format: 'scratch-ai-bridge/spec-build', version: 1 } as const
  if (!built.project || !built.spec)
    return {
      ...base,
      status: 'failed',
      playtestStatus: 'not-run',
      feedback: formatSpecDiagnostics(built.diagnostics.filter((item) => item.severity !== 'fixed')),
      diagnostics: built.diagnostics,
    }

  const workDirectory = await mkdtemp(path.join(tmpdir(), 'scratch-spec-'))
  try {
    const irPath = options.irPath ? path.resolve(options.irPath) : path.join(workDirectory, 'project.ir.json')
    await writeFile(irPath, `${JSON.stringify(built.project, null, 1)}\n`, {
      flag: options.force || !options.irPath ? 'w' : 'wx',
    })
    const generation = await generateGame(irPath, {
      outputFile: options.outputFile,
      ...(options.reportPath ? { reportPath: options.reportPath } : {}),
      force: options.force,
    })
    const generationSummary = {
      status: generation.status,
      gates: generation.gates,
      diagnostics: generation.diagnostics,
    }
    const lines = [formatSpecDiagnostics(built.diagnostics.filter((item) => item.severity === 'warning'))]
    if (!generation.success) {
      lines.push(
        ...generation.diagnostics.map((item) =>
          item.message.startsWith('Output already exists:')
            ? `[錯誤] ${path.resolve(options.outputFile)} 已經存在 → 如果這是你正在修改的同一個遊戲，加 --force 重建；如果是新遊戲，不要覆蓋別人的作品，把描述放到另一個新的 output/games/<新名稱>/ 資料夾再建置。`
            : `[錯誤] 產生 SB3：${item.message}`,
        ),
      )
      return {
        ...base,
        status: 'failed',
        playtestStatus: 'not-run',
        feedback: lines.filter(Boolean).join('\n'),
        diagnostics: built.diagnostics,
        generation: generationSummary,
      }
    }

    let playtest: ScenarioResult[] | undefined
    if (options.playtest) {
      const { PlaytestRunner } = await import('./playtest')
      const { runSpecScenario } = await import('./scenario-runner')
      const archive = new Uint8Array(await readFile(path.resolve(options.outputFile)))
      const runner = await PlaytestRunner.create()
      try {
        playtest = []
        for (const scenario of createSpecScenarios(built.spec))
          playtest.push(await runSpecScenario(runner, archive, scenario))
      } finally {
        await runner.close()
      }
      for (const result of playtest) {
        if (!result.ready) lines.push(`[錯誤] 試玩「${result.name}」無法執行：${result.error ?? '未知原因'}`)
        for (const item of result.expectations)
          if (!item.pass)
            lines.push(
              `[試玩未通過] ${result.name}／${item.label}（實際 ${String(item.actual)}，預期 ${item.expected}）→ ${item.hint ?? ''}`,
            )
        for (const message of result.pageErrors) lines.push(`[錯誤] 試玩時頁面錯誤：${message}`)
      }
    }
    const playtestPassed = playtest?.every(
      (result) => result.ready && result.pageErrors.length === 0 && result.expectations.every((item) => item.pass),
    )
    return {
      ...base,
      status: 'success',
      playtestStatus: playtest === undefined ? 'not-run' : playtestPassed ? 'pass' : 'fail',
      output: path.resolve(options.outputFile),
      title: built.spec.title,
      unsupported: built.spec.unsupported,
      feedback: lines.filter(Boolean).join('\n'),
      diagnostics: built.diagnostics,
      generation: generationSummary,
      ...(playtest ? { playtest } : {}),
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}
