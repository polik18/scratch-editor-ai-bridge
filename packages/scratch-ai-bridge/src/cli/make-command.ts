import { constants } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { extractJson } from '../spec/normalize'
import { createGameSpecInstruction, createGameSpecRepairInstruction } from '../spec/prompt'
import { createStoryInstruction } from '../story/prompt'
import { exists, gameFiles, gamesRoot, gameTarget, safeName, writeProcessFile } from './output-layout'
import { checkRequirements, readRequirements, requirementFeedback, type RequirementCheck } from './requirements'
import { buildSpecText, type SpecBuildReport } from './spec-command'
import { runStoryBuild } from './story-command'

export interface ModelConfig {
  /** OpenAI-compatible base URL, e.g. `http://127.0.0.1:8000/v1`. */
  readonly baseUrl: string
  /** Model id; when absent the first model listed by `/models` is used. */
  readonly model?: string
  readonly apiKey?: string
  /** Sends `chat_template_kwargs.enable_thinking=false` (Qwen-style templates); other servers ignore it. */
  readonly noThinking: boolean
}

export interface MakeOptions {
  readonly request: string
  /** `story` asks the model for an animation (Story Spec) instead of a game. */
  readonly kind?: 'game' | 'story'
  /** Story only: skip downloading official library artwork (tests, offline). */
  readonly offline?: boolean
  /** Defaults to `output/games/<標題>/<標題>.sb3`, adding `-2`, `-3`… rather than reusing a folder. */
  readonly outputFile?: string
  /** Replaces `output/games` (tests). */
  readonly gamesDirectory?: string
  /** Where the final spec JSON is written; defaults to the output path with `.spec.json`. */
  readonly specOut?: string
  /** Extra attempts that send the build feedback back to the model. */
  readonly repairRounds: number
  readonly playtest: boolean
  readonly force: boolean
  readonly model: ModelConfig
  /** Replaces the HTTP model call (tests). */
  readonly complete?: (prompt: string) => Promise<string>
  readonly onProgress?: (line: string) => void
}

export interface MakeAttempt {
  readonly round: number
  /** Requirements read from the request that this attempt did not meet. */
  readonly unmet?: number
  readonly seconds: number
  readonly status: SpecBuildReport['status']
  readonly playtestStatus: SpecBuildReport['playtestStatus']
  readonly feedback: string
}

export interface MakeReport {
  readonly format: 'scratch-ai-bridge/make'
  readonly version: 1
  readonly status: 'success' | 'failed'
  readonly playtestStatus: SpecBuildReport['playtestStatus']
  readonly model?: string
  readonly output?: string
  readonly specFile?: string
  /** Every model reply and this report, kept for diagnosing or improving the game. */
  readonly processDirectory?: string
  readonly title?: string
  /** Animations only: running time in seconds. */
  readonly seconds?: number
  readonly unsupported: readonly string[]
  /** What the request asked for (levels, length, names) and whether the kept attempt meets it. */
  readonly requirements?: readonly RequirementCheck[]
  readonly attempts: readonly MakeAttempt[]
  /** What is still wrong with the kept attempt, as plain lines. */
  readonly feedback: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1'

/**
 * Model settings from the environment: `SCRATCH_BRIDGE_MODEL_URL`, `SCRATCH_BRIDGE_MODEL`, `SCRATCH_BRIDGE_API_KEY`,
 * with the oMLX names used elsewhere in this package (`OMLX_ENDPOINT`, `OMLX_API_KEY`) as fallbacks.
 * @param environment - Usually `process.env`.
 * @returns Model settings with thinking turned off.
 */
export const modelConfigFromEnvironment = (environment: NodeJS.ProcessEnv): ModelConfig => {
  const model = environment.SCRATCH_BRIDGE_MODEL
  const apiKey = environment.SCRATCH_BRIDGE_API_KEY ?? environment.OMLX_API_KEY
  return {
    baseUrl: environment.SCRATCH_BRIDGE_MODEL_URL ?? environment.OMLX_ENDPOINT ?? DEFAULT_BASE_URL,
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
    noThinking: true,
  }
}

const authorization = (config: ModelConfig): Record<string, string> =>
  config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}

const resolveModel = async (config: ModelConfig): Promise<string> => {
  if (config.model) return config.model
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, {
    headers: authorization(config),
    signal: AbortSignal.timeout(30_000),
  })
  const body = (await response.json()) as { data?: { id?: string }[] }
  const id = body.data?.find((item) => typeof item.id === 'string')?.id
  if (!response.ok || !id)
    throw new Error(
      `無法從 ${config.baseUrl}/models 取得模型（HTTP ${response.status}）。請設定 SCRATCH_BRIDGE_MODEL 或 --model，必要時設定 SCRATCH_BRIDGE_API_KEY。`,
    )
  return id
}

const chat = async (config: ModelConfig, model: string, prompt: string): Promise<string> => {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authorization(config) },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      // A spec is well under 2k tokens; the cap stops repetition loops from running for minutes.
      max_tokens: 4096,
      ...(config.noThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    }),
    signal: AbortSignal.timeout(15 * 60_000),
  })
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[]; error?: unknown }
  const content = body.choices?.[0]?.message?.content
  if (!response.ok || typeof content !== 'string')
    throw new Error(`模型呼叫失敗（HTTP ${response.status}）：${JSON.stringify(body.error ?? body).slice(0, 300)}`)
  return content
}

/**
 * Higher is better: a passing playtest beats an untested build, which beats a failing playtest, which beats nothing.
 * @param report - One attempt's build report.
 * @returns Rank from 0 (did not build) to 3 (playtest passed).
 */
/** The parts of a build report that `make` compares and passes on; game and story builds both have them. */
type AttemptReport = Pick<SpecBuildReport, 'status' | 'playtestStatus' | 'feedback' | 'title' | 'unsupported'> & {
  /** Animations only: running time in seconds. */
  readonly seconds?: number
}

/**
 * Builds one model reply as an animation into `outputFile`.
 * @param text - The model's reply.
 * @param outputFile - Where the SB3 goes.
 * @param playtest - Watch the animation at ten times speed.
 * @param offline - Skip downloading official library artwork.
 * @returns The story build report.
 */
const buildStoryText = async (
  text: string,
  outputFile: string,
  playtest: boolean,
  offline: boolean,
): Promise<AttemptReport> => {
  const specPath = outputFile.replace(/\.sb3$/i, '.story.json')
  await writeFile(specPath, text)
  return runStoryBuild({ specPath, outputFile, playtest, force: true, offline })
}

/**
 * Requests often name Scratch defaults with a description, such as 「Backdrop1（清代淡水港）」 or 「老渡船伯（Sprite1）」,
 * and models copy the default name into the spec. This maps each default to its description.
 * @param request - The request sent to the model.
 * @returns Default name → description.
 */
export const placeholderNames = (request: string): Map<string, string> => {
  const names = new Map<string, string>()
  for (const match of request.matchAll(/\b((?:Backdrop|Sprite|背景|角色)\s?\d+)\s*[（(]\s*([^）)]{1,30}?)\s*[）)]/gi))
    names.set(match[1], match[2])
  for (const match of request.matchAll(
    /([^\s、，,（(：:「」【】；;]{1,12})\s*[（(]\s*((?:Sprite|角色)\s?\d+)\s*[）)]/gi,
  ))
    names.set(match[2], match[1].replace(/^(主角|配角|角色)/, ''))
  return names
}

/**
 * Replaces quoted default names in a model reply with the descriptions from the request.
 * @param text - The model's reply.
 * @param names - From {@link placeholderNames}.
 * @returns The reply with every `"Backdrop1"` written as its description.
 */
export const resolvePlaceholders = (text: string, names: ReadonlyMap<string, string>): string => {
  let result = text
  for (const [name, description] of names)
    result = result.replace(new RegExp(`(["「])${name.replace(/\s/g, '\\s?')}(["」])`, 'g'), `$1${description}$2`)
  return result
}

/**
 * Writes the requested length into an animation reply that does not state one, so the build's length message aims
 * at the request instead of only at the 60-second minimum.
 * @param text - The model's reply.
 * @param seconds - Length the request asked for.
 * @returns The reply, with 目標秒數 added when it could be read and had none.
 */
const withTargetSeconds = (text: string, seconds: number | undefined): string => {
  if (seconds === undefined || /目標秒數|targetseconds/i.test(text)) return text
  try {
    const { value } = extractJson(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return text
    return JSON.stringify({ ...(value as Record<string, unknown>), 目標秒數: seconds }, null, 1)
  } catch {
    return text
  }
}

const rank = (report: AttemptReport): number =>
  report.status !== 'success' ? 0 : report.playtestStatus === 'pass' ? 3 : report.playtestStatus === 'not-run' ? 2 : 1

/**
 * One sentence → Game Spec from a model → build (and optional playtest) → feedback to the model for repair rounds.
 * Keeps the best attempt; writes the SB3 and its spec only when at least one attempt built.
 * Every model reply and the report go to the game's `_過程` folder, also when nothing built.
 * @param options - Request, output paths, model settings and how many repair rounds to allow.
 * @returns Report of every attempt and the kept result.
 */
export const makeGame = async (options: MakeOptions): Promise<MakeReport> => {
  const base = { format: 'scratch-ai-bridge/make', version: 1 } as const
  if (options.outputFile && !options.force)
    for (const file of [options.outputFile, options.specOut ?? gameFiles(options.outputFile).spec].map((item) =>
      path.resolve(item),
    ))
      if (await exists(file))
        return {
          ...base,
          status: 'failed',
          playtestStatus: 'not-run',
          unsupported: [],
          attempts: [],
          feedback: `[錯誤] ${file} 已存在。換一個檔名，或加 --force 覆蓋。`,
        }

  const model = options.complete ? options.model.model : await resolveModel(options.model)
  const complete = options.complete ?? ((prompt: string) => chat(options.model, model ?? '', prompt))
  const progress = options.onProgress ?? (() => undefined)
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'scratch-make-'))
  try {
    const attempts: MakeAttempt[] = []
    const replies: string[] = []
    let best: { report: AttemptReport; text: string; sb3: string; checks: RequirementCheck[] } | undefined
    const story = options.kind === 'story'
    const placeholders = placeholderNames(options.request)
    const requirements = readRequirements(options.request, story ? 'story' : 'game')
    // A built attempt that misses what the request asked for (two levels, two minutes) is not done yet.
    const score = (report: AttemptReport, checks: readonly RequirementCheck[]): number =>
      rank(report) * 10 - checks.filter((check) => !check.pass).length
    let text = ''
    let feedback = ''
    for (let round = 0; round <= options.repairRounds; round += 1) {
      const prompt =
        round === 0
          ? story
            ? createStoryInstruction(options.request)
            : createGameSpecInstruction(options.request)
          : createGameSpecRepairInstruction(text, feedback)
      progress(round === 0 ? `請模型 ${model ?? ''} 寫作品描述…` : `第 ${round} 輪修正：把問題回饋給模型…`)
      const started = Date.now()
      text = resolvePlaceholders(await complete(prompt), placeholders)
      if (story) text = withTargetSeconds(text, requirements.seconds)
      replies.push(text)
      const sb3 = path.join(workDirectory, `attempt-${round}.sb3`)
      progress(options.playtest ? '建置並自動試玩…' : '建置…')
      const report = story
        ? await buildStoryText(text, sb3, options.playtest, options.offline ?? false)
        : await buildSpecText(text, { outputFile: sb3, playtest: options.playtest, force: true })
      const checks = report.status === 'success' ? checkRequirements(text, requirements) : []
      const unmet = checks.filter((check) => !check.pass).length
      feedback = [report.feedback, requirementFeedback(checks)].filter(Boolean).join('\n')
      attempts.push({
        round,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        status: report.status,
        playtestStatus: report.playtestStatus,
        ...(unmet > 0 ? { unmet } : {}),
        feedback,
      })
      progress(
        `第 ${round} 次：${report.status === 'success' ? '建置成功' : '建置失敗'}` +
          (report.playtestStatus === 'not-run'
            ? ''
            : `，試玩 ${report.playtestStatus === 'pass' ? '通過' : '未通過'}`) +
          (unmet > 0 ? `，有 ${unmet} 項需求沒做到` : ''),
      )
      if (!best || score(report, checks) > score(best.report, best.checks)) best = { report, text, sb3, checks }
      if (rank(report) >= 2 && unmet === 0) break
    }

    const succeeded = best?.report.status === 'success'
    const files = options.outputFile
      ? gameFiles(options.outputFile)
      : await gameTarget(
          options.gamesDirectory ?? gamesRoot(),
          safeName(succeeded ? best?.report.title : undefined, safeName(options.request.slice(0, 20))),
          true,
        )
    const specFile = path.resolve(options.specOut ?? files.spec)
    for (const [round, reply] of replies.entries()) await writeProcessFile(files, `attempt-${round}.txt`, reply)
    const kept = { ...(model ? { model } : {}), attempts, processDirectory: files.processDirectory }
    let report: MakeReport
    if (!best || !succeeded) {
      report = {
        ...base,
        status: 'failed',
        playtestStatus: 'not-run',
        ...kept,
        unsupported: [],
        feedback: `${feedback}\n模型每一次的原始回覆都存在 ${files.processDirectory}。`,
      }
    } else {
      await mkdir(files.directory, { recursive: true })
      await copyFile(best.sb3, files.sb3, options.force ? 0 : constants.COPYFILE_EXCL)
      await writeFile(specFile, `${best.text.trim()}\n`, { flag: options.force ? 'w' : 'wx' })
      report = {
        ...base,
        status: 'success',
        playtestStatus: best.report.playtestStatus,
        ...kept,
        output: files.sb3,
        specFile,
        ...(best.report.title ? { title: best.report.title } : {}),
        ...(best.report.seconds === undefined ? {} : { seconds: best.report.seconds }),
        unsupported: best.report.unsupported ?? [],
        ...(best.checks.length > 0 ? { requirements: best.checks } : {}),
        feedback: [best.report.feedback, requirementFeedback(best.checks)].filter(Boolean).join('\n'),
      }
    }
    await writeProcessFile(files, 'report.json', `${JSON.stringify(report, null, 2)}\n`)
    return report
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}
