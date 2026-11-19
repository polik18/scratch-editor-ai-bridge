import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { compileCanonicalProjectToSb3 } from '../core/compiler'
import {
  runCreativePipeline,
  type AskModel,
  type CreativeMode,
  type CreativeResult,
  type VerifyProject,
} from '../core/creative'
import { NOT_RUN } from '../core/grading'
import type { CanonicalProject } from '../core/ir/types'
import { resolveLibraryAssets, type LibraryAssetFetcher, type LibraryResolutionReport } from '../core/visuals/library'
import { createCachedAssetFetcher } from './asset-fetcher'
import { extractStaticEvidence, planGradingPlaytest, toRuntimeEvidence } from './grade'
import { chat, modelConfigFromEnvironment, resolveModel, type ModelConfig } from './make-command'
import { gamesRoot, gameTarget, safeName, writeProcessFile } from './output-layout'
import type { PlaytestRunner } from './playtest'

/** What the last build used from the official library, and what had to be substituted. */
export interface AssetSummary {
  readonly libraryCostumes: number
  readonly librarySounds: number
  readonly placeholderCostumes: readonly string[]
  readonly silentSounds: readonly string[]
  readonly alternatives: readonly string[]
}

const assetSummary = (report: LibraryResolutionReport): AssetSummary => ({
  libraryCostumes: report.libraryCostumes,
  librarySounds: report.librarySounds,
  placeholderCostumes: report.placeholderCostumes,
  silentSounds: report.silentSounds,
  alternatives: [
    ...report.placeholderCostumes.map(
      (name) =>
        `找不到「${name}」的官方造型：改用官方素材英文名（例如 Cat、Fish、Shark 2），或描述成更常見的動物／物品。`,
    ),
    ...report.silentSounds.map((name) => `找不到「${name}」的官方音效：改用 Pop、Chomp、Cheer、Boing 等官方音效名。`),
  ],
})

/**
 * Build-and-run hook for the creative pipeline: official library assets, SB3 compile, then a real playtest in the
 * Scratch preview driven by the keys and clicks the project listens to.
 * @param runner Playtest runner; without it the project is built but reported as not run.
 * @param fetcher Official asset fetcher.
 * @returns The hook plus accessors for the last SB3 and asset summary.
 */
export const createProjectVerifier = (runner: PlaytestRunner | undefined, fetcher: LibraryAssetFetcher) => {
  let lastSb3: Uint8Array | undefined
  let lastAssets: AssetSummary | undefined
  const verify: VerifyProject = async (project: CanonicalProject) => {
    try {
      const resolved = await resolveLibraryAssets(project, fetcher, { replaceModelSvg: true })
      lastAssets = assetSummary(resolved.report)
      const bytes = new Uint8Array(await (await compileCanonicalProjectToSb3(resolved.project)).arrayBuffer())
      lastSb3 = bytes
      const staticEvidence = await extractStaticEvidence(bytes)
      if (!runner) return { built: true, staticEvidence, runtime: NOT_RUN }
      const { plan, scenario, movementKeys } = planGradingPlaytest(staticEvidence)
      return {
        built: true,
        staticEvidence,
        runtime: toRuntimeEvidence(await runner.run(bytes, plan), scenario, movementKeys),
      }
    } catch (error) {
      return {
        built: false,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        runtime: NOT_RUN,
      }
    }
  }
  return { verify, sb3: () => lastSb3, assets: () => lastAssets }
}

/**
 * Replies read from a folder instead of a live model, for offline runs, hand-pasted chat replies or benchmarks:
 * `A.txt`, then `B.txt` or `C1.txt`, `C2.txt`…, and `repair1.txt`, `repair2.txt`… consumed in order per stage.
 * @param directory Folder with reply files.
 * @returns A model function that throws when a needed reply is missing.
 */
export const repliesFromDirectory = async (directory: string): Promise<AskModel> => {
  const files = (await readdir(directory)).filter((file) => /^(A|B|C\d+|repair\d+)\.txt$/.test(file))
  const order = (file: string) => Number(/\d+/.exec(file)?.[0] ?? 0)
  const queues = new Map<string, string[]>([
    ['A', []],
    ['B', []],
    ['C', []],
    ['repair', []],
  ])
  for (const file of files.sort((left, right) => order(left) - order(right))) {
    const stage = file.startsWith('repair') ? 'repair' : file.charAt(0)
    queues.get(stage)?.push(await readFile(path.join(directory, file), 'utf8'))
  }
  return (_prompt, stage) => {
    const reply = queues.get(stage)?.shift()
    if (reply === undefined) throw new Error(`${directory} 沒有 ${stage} 階段的下一個回覆檔。`)
    return Promise.resolve(reply)
  }
}

/**
 * Model function over an OpenAI-compatible endpoint.
 * @param config Endpoint config.
 * @returns A model function.
 */
export const modelAsker = (config: ModelConfig): AskModel => {
  let model: Promise<string> | undefined
  return async (prompt) => {
    model ??= resolveModel(config)
    return chat(config, await model, prompt)
  }
}

export interface CreateOptions {
  readonly request: string
  readonly mode: CreativeMode
  readonly playtest: boolean
  readonly ask: AskModel
  readonly name?: string
  readonly gamesDir?: string
  readonly offline?: boolean
}

/**
 * `create`: run the two-stage pipeline and save the work to output/games/<name>/ with the full run report in `_過程`.
 * @param options Request, mode, model and playtest switch.
 * @returns The run report plus the saved paths and asset summary.
 */
export const createProject = async (
  options: CreateOptions,
): Promise<
  CreativeResult & { readonly output?: string; readonly report: string; readonly assets?: AssetSummary }
> => {
  let runner: PlaytestRunner | undefined
  if (options.playtest) {
    const { PlaytestRunner } = await import('./playtest')
    runner = await PlaytestRunner.create()
  }
  try {
    const fetcher: LibraryAssetFetcher = options.offline
      ? () => Promise.reject(new Error('offline'))
      : createCachedAssetFetcher()
    const verifier = createProjectVerifier(runner, fetcher)
    const result = await runCreativePipeline({
      request: options.request,
      mode: options.mode,
      ask: options.ask,
      verify: verifier.verify,
      name: options.name ?? options.request.slice(0, 40),
    })
    const files = await gameTarget(
      options.gamesDir ?? gamesRoot(),
      safeName(options.name ?? options.request.slice(0, 20), 'project'),
      true,
    )
    const sb3 = verifier.sb3()
    if (sb3) {
      await mkdir(files.directory, { recursive: true })
      await writeFile(files.sb3, sb3)
    }
    const assets = verifier.assets()
    const report = await writeProcessFile(
      files,
      'creative-run.json',
      `${JSON.stringify({ ...result, assets }, null, 2)}\n`,
    )
    return { ...result, ...(sb3 ? { output: files.sb3 } : {}), report, ...(assets ? { assets } : {}) }
  } finally {
    await runner?.close()
  }
}

/**
 * Parse `create` arguments and run it.
 * @param args Arguments after the command name.
 * @returns JSON output and exit code.
 */
export const runCreate = async (
  args: readonly string[],
): Promise<{ readonly output: unknown; readonly exitCode: number }> => {
  const positionals: string[] = []
  let mode: CreativeMode = 'a-b-c'
  let playtest = false
  let offline = false
  let replies: string | undefined
  let name: string | undefined
  let model: string | undefined
  let baseUrl: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const value = args[index + 1]
    if (['--mode', '--replies', '--name', '--model', '--base-url'].includes(argument)) {
      if (!value) return { output: { status: 'failed', error: `${argument} 需要一個值。` }, exitCode: 2 }
      if (argument === '--mode') {
        if (value !== 'a-b' && value !== 'a-b-c')
          return { output: { status: 'failed', error: '--mode 只能是 a-b 或 a-b-c。' }, exitCode: 2 }
        mode = value
      } else if (argument === '--replies') replies = value
      else if (argument === '--name') name = value
      else if (argument === '--model') model = value
      else baseUrl = value
      index += 1
    } else if (argument === '--playtest') playtest = true
    else if (argument === '--offline') offline = true
    else if (argument.startsWith('-'))
      return { output: { status: 'failed', error: `不認得的參數 ${argument}` }, exitCode: 2 }
    else positionals.push(argument)
  }
  if (positionals.length !== 1)
    return { output: { status: 'failed', error: '用法：create "<需求>" [--mode a-b|a-b-c] --playtest' }, exitCode: 2 }
  const config = modelConfigFromEnvironment(process.env)
  const ask = replies
    ? await repliesFromDirectory(replies)
    : modelAsker({ ...config, ...(model ? { model } : {}), ...(baseUrl ? { baseUrl } : {}) })
  try {
    const result = await createProject({
      request: positionals[0] ?? '',
      mode,
      playtest,
      ask,
      offline,
      ...(name ? { name } : {}),
    })
    return { output: result, exitCode: result.done ? 0 : 1 }
  } catch (error) {
    return {
      output: { status: 'failed', error: error instanceof Error ? error.message : String(error) },
      exitCode: 3,
    }
  }
}
