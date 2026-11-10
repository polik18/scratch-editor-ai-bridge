import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildFromSpecText, createSpecScenarios, formatSpecDiagnostics } from '../spec'
import type { SpecDiagnostic } from '../spec'
import { generateGame, type GeneratorResult } from './generator'
import type { ScenarioResult } from './scenario-runner'

export interface SpecBuildOptions {
  readonly specPath: string
  readonly outputFile: string
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
  readonly output?: string
  readonly diagnostics: readonly SpecDiagnostic[]
  readonly generation?: Pick<GeneratorResult, 'status' | 'gates' | 'diagnostics'>
  readonly playtest?: readonly ScenarioResult[]
  /** Everything the author (or the model) needs to fix next, as plain lines. Empty when nothing is left to fix. */
  readonly feedback: string
}

/**
 * Spec file → checks → Canonical IR → existing generation gates → optional generated playtest scenarios.
 * @param options - Input spec, output paths and whether to playtest.
 * @returns Build report with diagnostics, gates, playtest results and feedback lines.
 */
export const runSpecBuild = async (options: SpecBuildOptions): Promise<SpecBuildReport> => {
  const text = await readFile(path.resolve(options.specPath), 'utf-8')
  const built = buildFromSpecText(text)
  const base = { format: 'scratch-ai-bridge/spec-build', version: 1 } as const
  if (!built.project || !built.spec)
    return {
      ...base,
      status: 'failed',
      playtestStatus: 'not-run',
      diagnostics: built.diagnostics,
      feedback: formatSpecDiagnostics(built.diagnostics.filter((item) => item.severity !== 'fixed')),
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
      lines.push(...generation.diagnostics.map((item) => `[錯誤] 產生 SB3：${item.message}`))
      return {
        ...base,
        status: 'failed',
        playtestStatus: 'not-run',
        diagnostics: built.diagnostics,
        generation: generationSummary,
        feedback: lines.filter(Boolean).join('\n'),
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
      diagnostics: built.diagnostics,
      generation: generationSummary,
      ...(playtest ? { playtest } : {}),
      feedback: lines.filter(Boolean).join('\n'),
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}
