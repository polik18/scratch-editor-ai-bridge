import { constants } from 'node:fs'
import { access, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createGameSpecInstruction, createGameSpecRepairInstruction } from '../spec/prompt'
import { buildSpecText, type SpecBuildReport } from './spec-command'

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
  readonly outputFile: string
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
  readonly title?: string
  readonly unsupported: readonly string[]
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
const rank = (report: SpecBuildReport): number =>
  report.status !== 'success' ? 0 : report.playtestStatus === 'pass' ? 3 : report.playtestStatus === 'not-run' ? 2 : 1

const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  )

/**
 * One sentence → Game Spec from a model → build (and optional playtest) → feedback to the model for repair rounds.
 * Keeps the best attempt; writes the SB3 and its spec only when at least one attempt built.
 * @param options - Request, output paths, model settings and how many repair rounds to allow.
 * @returns Report of every attempt and the kept result.
 */
export const makeGame = async (options: MakeOptions): Promise<MakeReport> => {
  const outputFile = path.resolve(options.outputFile)
  const specFile = path.resolve(options.specOut ?? outputFile.replace(/\.sb3$/i, '') + '.spec.json')
  const base = { format: 'scratch-ai-bridge/make', version: 1 } as const
  if (!options.force)
    for (const file of [outputFile, specFile])
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
    let best: { report: SpecBuildReport; text: string; sb3: string } | undefined
    let text = ''
    let feedback = ''
    for (let round = 0; round <= options.repairRounds; round += 1) {
      const prompt =
        round === 0 ? createGameSpecInstruction(options.request) : createGameSpecRepairInstruction(text, feedback)
      progress(round === 0 ? `請模型 ${model ?? ''} 寫作品描述…` : `第 ${round} 輪修正：把問題回饋給模型…`)
      const started = Date.now()
      text = await complete(prompt)
      const sb3 = path.join(workDirectory, `attempt-${round}.sb3`)
      progress(options.playtest ? '建置並自動試玩…' : '建置…')
      const report = await buildSpecText(text, { outputFile: sb3, playtest: options.playtest, force: true })
      feedback = report.feedback
      attempts.push({
        round,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        status: report.status,
        playtestStatus: report.playtestStatus,
        feedback,
      })
      progress(
        `第 ${round} 次：${report.status === 'success' ? '建置成功' : '建置失敗'}` +
          (report.playtestStatus === 'not-run'
            ? ''
            : `，試玩 ${report.playtestStatus === 'pass' ? '通過' : '未通過'}`),
      )
      if (!best || rank(report) > rank(best.report)) best = { report, text, sb3 }
      if (rank(report) >= 2) break
    }

    if (best?.report.status !== 'success') {
      // Keep what the model actually said so a failed run can be diagnosed.
      const replyFile = outputFile.replace(/\.sb3$/i, '') + '.failed-reply.txt'
      await writeFile(replyFile, text, { flag: options.force ? 'w' : 'wx' }).catch(() => undefined)
      return {
        ...base,
        status: 'failed',
        playtestStatus: 'not-run',
        ...(model ? { model } : {}),
        unsupported: [],
        attempts,
        feedback: `${feedback}\n模型最後一次的原始回覆存在 ${replyFile}。`,
      }
    }
    await copyFile(best.sb3, outputFile, options.force ? 0 : constants.COPYFILE_EXCL)
    await writeFile(specFile, `${best.text.trim()}\n`, { flag: options.force ? 'w' : 'wx' })
    return {
      ...base,
      status: 'success',
      playtestStatus: best.report.playtestStatus,
      ...(model ? { model } : {}),
      output: outputFile,
      specFile,
      ...(best.report.title ? { title: best.report.title } : {}),
      unsupported: best.report.unsupported ?? [],
      attempts,
      feedback: best.report.feedback,
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}
