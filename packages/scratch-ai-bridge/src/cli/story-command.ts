import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describeLibraryResolution, resolveLibraryAssets } from '../core/visuals/library'
import { formatSpecDiagnostics } from '../spec'
import type { SpecDiagnostic } from '../spec/types'
import { buildStoryFromText, createStoryScenario, storySeconds } from '../story'
import { createCachedAssetFetcher } from './asset-fetcher'
import { generateGame, type GeneratorResult } from './generator'
import {
  backupGame,
  BUILT_SPEC_SUFFIX,
  gameFiles,
  gamesRoot,
  gameTarget,
  safeName,
  specTitle,
  writeProcessFile,
  type GameFiles,
} from './output-layout'
import type { ScenarioResult } from './scenario-runner'

export interface StoryBuildOptions {
  readonly specPath: string
  /** Defaults to `output/games/<name>/<name>.sb3`, like `spec`. */
  readonly outputFile?: string
  /** Replaces `output/games` (tests). */
  readonly gamesDirectory?: string
  readonly playtest: boolean
  readonly force: boolean
  /** Skip downloading official library artwork (tests, offline); library characters get a placeholder. */
  readonly offline?: boolean
}

export interface StoryBuildReport {
  readonly format: 'scratch-ai-bridge/story-build'
  readonly version: 1
  readonly status: 'success' | 'failed'
  readonly playtestStatus: 'pass' | 'fail' | 'not-run'
  /** Everything left to fix, one line each with a suggestion after 「→」. */
  readonly feedback: string
  readonly output?: string
  readonly specFile?: string
  readonly processDirectory?: string
  readonly previousVersion?: string
  readonly title?: string
  /** Running time in seconds, title and ending cards included. */
  readonly seconds?: number
  readonly scenes?: number
  /** Which official artwork and sounds were used. */
  readonly assets?: string
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
  return gameTarget(gamesDirectory, safeName(specTitle(text), 'animation'), false)
}

/**
 * Story Spec file → checks (main character, scene change, 60–180 s) → Canonical IR with official library artwork →
 * generation gates → optional playtest that watches the whole animation at ten times speed.
 * @param options - Input, output and whether to playtest.
 * @returns The build report; it is also saved in the animation's `_過程` folder.
 */
export const runStoryBuild = async (options: StoryBuildOptions): Promise<StoryBuildReport> => {
  const specPath = path.resolve(options.specPath)
  const text = await readFile(specPath, 'utf-8')
  const automatic = !options.outputFile
  const files = options.outputFile
    ? gameFiles(options.outputFile)
    : await defaultTarget(specPath, text, options.gamesDirectory ?? gamesRoot())
  const base = { format: 'scratch-ai-bridge/story-build', version: 1 } as const
  const built = buildStoryFromText(text)
  const fixable = built.diagnostics.filter((item) => item.severity !== 'fixed')
  let report: StoryBuildReport
  if (!built.story || !built.project) {
    report = {
      ...base,
      status: 'failed',
      playtestStatus: 'not-run',
      feedback: formatSpecDiagnostics(fixable),
      diagnostics: built.diagnostics,
      ...(built.story ? { seconds: Math.round(storySeconds(built.story)), scenes: built.story.scenes.length } : {}),
    }
  } else {
    await mkdir(files.directory, { recursive: true })
    const previousVersion = options.force ? await backupGame(files) : undefined
    const lines = [formatSpecDiagnostics(fixable)]
    let project = built.project
    let assets: string | undefined
    if (!options.offline) {
      const resolved = await resolveLibraryAssets(project, createCachedAssetFetcher())
      project = resolved.project
      assets = describeLibraryResolution(resolved.report)
      if (resolved.report.placeholderCostumes.length > 0)
        lines.push(
          `[注意] 素材：${resolved.report.placeholderCostumes.join('、')} 找不到 Scratch 官方素材或無法下載，先用簡單圖形代替 → 檢查「外觀」或「背景」的英文名稱，或在 Scratch 裡換掉。`,
        )
    }
    const workDirectory = await mkdtemp(path.join(tmpdir(), 'scratch-story-'))
    try {
      const irPath = path.join(workDirectory, 'project.ir.json')
      await writeFile(irPath, `${JSON.stringify(project, null, 1)}\n`)
      const generation = await generateGame(irPath, { outputFile: files.sb3, force: options.force })
      const summary = { status: generation.status, gates: generation.gates, diagnostics: generation.diagnostics }
      if (!generation.success) {
        lines.push(
          ...generation.diagnostics.map((item) =>
            item.message.startsWith('Output already exists:')
              ? `[錯誤] ${files.sb3} 已經存在 → 如果這是你正在修改的同一部動畫，加 --force 重建；如果是新動畫，把描述放到另一個新的 output/games/<新名稱>/ 資料夾再建置。`
              : `[錯誤] 產生 SB3：${item.message}`,
          ),
        )
        report = {
          ...base,
          status: 'failed',
          playtestStatus: 'not-run',
          feedback: lines.filter(Boolean).join('\n'),
          diagnostics: built.diagnostics,
          generation: summary,
        }
      } else {
        let playtest: ScenarioResult[] | undefined
        if (options.playtest) {
          const { PlaytestRunner } = await import('./playtest')
          const { runSpecScenario } = await import('./scenario-runner')
          const runner = await PlaytestRunner.create()
          try {
            playtest = [
              await runSpecScenario(
                runner,
                new Uint8Array(await readFile(files.sb3)),
                createStoryScenario(built.story),
              ),
            ]
          } finally {
            await runner.close()
          }
          for (const result of playtest) {
            if (!result.ready) lines.push(`[錯誤] 試玩「${result.name}」無法執行：${result.error ?? '未知原因'}`)
            for (const item of result.expectations)
              if (!item.pass)
                lines.push(
                  `[試玩未通過] ${item.label}（實際 ${String(item.actual)}，預期 ${item.expected}）→ ${item.hint ?? ''}`,
                )
            for (const message of result.pageErrors) lines.push(`[錯誤] 試玩時頁面錯誤：${message}`)
          }
        }
        const passed = playtest?.every(
          (result) =>
            result.ready && result.pageErrors.length === 0 && result.expectations.every((item) => item.pass),
        )
        await writeProcessFile(files, BUILT_SPEC_SUFFIX, text)
        if (automatic && files.spec !== specPath) await copyFile(specPath, files.spec)
        report = {
          ...base,
          status: 'success',
          playtestStatus: playtest === undefined ? 'not-run' : passed ? 'pass' : 'fail',
          feedback: lines.filter(Boolean).join('\n'),
          output: files.sb3,
          ...(automatic ? { specFile: files.spec } : {}),
          title: built.story.title,
          seconds: Math.round(storySeconds(built.story)),
          scenes: built.story.scenes.length,
          ...(assets ? { assets } : {}),
          ...(previousVersion ? { previousVersion } : {}),
          diagnostics: built.diagnostics,
          generation: summary,
          ...(playtest ? { playtest } : {}),
        }
      }
    } finally {
      await rm(workDirectory, { recursive: true, force: true })
    }
  }
  report = { ...report, processDirectory: files.processDirectory }
  await writeProcessFile(files, 'report.json', `${JSON.stringify(report, null, 2)}\n`)
  return report
}
