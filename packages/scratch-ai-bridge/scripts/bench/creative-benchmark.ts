// Two-stage generation benchmark (V2-0, V2-7): the same model and the same cross-type requests through
//   spec  — the single-stage Game Spec prompt (baseline),
//   a-b   — free creation, then one translation with on-demand capability cards,
//   a-b-c — free creation, then slice-by-slice implementation with build and playtest between slices.
//
//   npm run benchmark:creative -- run    --run ../../output/bench/<name> [--conditions spec,a-b,a-b-c] [--only id,id] [--playtest]
//   npm run benchmark:creative -- report --run <dir> [--baseline <older report.json>]
//
// Model: BENCH_BASE_URL / BENCH_MODEL / BENCH_API_KEY (or the SCRATCH_BRIDGE_* variables `make` uses). Replies are saved
// under <run>/<condition>/<case>/ (spec.txt, A.txt, B.txt, C1.txt…, repair1.txt…) and reused on the next run, so a run
// can also be filled by hand from a chat UI. Human ratings go in <run>/ratings.csv (case,condition,score,notes; score
// 1–5) and are merged by `report`. Compile success alone is never reported as a quality gain.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createCachedAssetFetcher } from '../../src/cli/asset-fetcher'
import { parseCsvTable } from '../../src/cli/batch'
import { createProjectVerifier, modelAsker, repliesFromDirectory } from '../../src/cli/creative-command'
import { extractStaticEvidence, planGradingPlaytest, toRuntimeEvidence } from '../../src/cli/grade'
import { modelConfigFromEnvironment, resolveModel } from '../../src/cli/make-command'
import { PlaytestRunner } from '../../src/cli/playtest'
import { buildSpecText } from '../../src/cli/spec-command'
import { extractIntentAnchors, featureChecks, runCreativePipeline, type AskModel } from '../../src/core/creative'
import {
  evaluateCheck,
  FEEDBACK_FAMILIES,
  NOT_RUN,
  type RuntimeEvidence,
  type StaticEvidence,
} from '../../src/core/grading'
import { createGameSpecInstruction } from '../../src/spec/prompt'

type Condition = 'spec' | 'a-b' | 'a-b-c'
const CONDITIONS: readonly Condition[] = ['spec', 'a-b', 'a-b-c']

interface BenchCase {
  readonly id: string
  readonly projectType: string
  readonly request: string
}

interface CaseResult {
  readonly id: string
  readonly condition: Condition
  readonly projectType: string
  readonly status: 'scored' | 'no-reply' | 'failed'
  readonly failureType?: 'no-reply' | 'parse' | 'build' | 'runtime' | 'feature-missing' | 'error'
  readonly failure?: string
  readonly modelCalls: number
  readonly promptCharacters: { readonly total: number; readonly max: number }
  readonly replyCharacters: number
  readonly built: boolean
  readonly runtimeStatus: RuntimeEvidence['status']
  /** Features the request alone implies that the real playtest observed — the same yardstick for every condition. */
  readonly requestIntent: { readonly checked: number; readonly passed: number; readonly missing: readonly string[] }
  /** Features the request/brief implies that the real playtest observed. */
  readonly intent: { readonly checked: number; readonly passed: number; readonly missing: readonly string[] }
  /** Kinds of audience feedback (sound, costume, backdrop, speech, visibility, clones, questions) seen at runtime. */
  readonly mediaKinds: number
  /** Unsupported ideas that got an explicit approximate/substitute/defer decision. */
  readonly decisions: number
  readonly done: boolean
  readonly humanScore?: number
  readonly humanNotes?: string
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const casesPath = path.join(packageRoot, 'research/project-quality-benchmark/cases.json')

const readOptional = (file: string): Promise<string | undefined> => readFile(file, 'utf8').catch(() => undefined)

const mediaKinds = (runtime: RuntimeEvidence): number =>
  Object.values(FEEDBACK_FAMILIES).filter((opcodes) =>
    opcodes.some((opcode) => (runtime.executedOpcodes[opcode] ?? 0) > 0),
  ).length

const intentScore = (request: string, brief: string, staticEvidence: StaticEvidence, runtime: RuntimeEvidence) => {
  const anchors = extractIntentAnchors(request, brief)
  const checks = featureChecks(anchors).map(({ feature, check }) => ({
    feature,
    outcome: evaluateCheck(check, staticEvidence, runtime),
  }))
  return {
    checked: checks.length,
    passed: checks.filter(({ outcome }) => outcome.result === 'pass').length,
    missing: checks.filter(({ outcome }) => outcome.result !== 'pass').map(({ feature }) => feature),
  }
}

/**
 * Model function that saves every reply under the case folder, reusing saved replies first.
 * @param directory Case folder.
 * @param live Live model, or undefined for offline runs.
 * @returns Model function and a call counter.
 */
const recordingAsker = async (
  directory: string,
  live: AskModel | undefined,
): Promise<{ ask: AskModel; calls: () => number }> => {
  await mkdir(directory, { recursive: true })
  const saved = await repliesFromDirectory(directory)
  const counters: Record<string, number> = {}
  let calls = 0
  return {
    calls: () => calls,
    ask: async (prompt, stage) => {
      calls += 1
      counters[stage] = (counters[stage] ?? 0) + 1
      const file = stage === 'A' || stage === 'B' ? `${stage}.txt` : `${stage}${counters[stage]}.txt`
      await writeFile(path.join(directory, file.replace(/\.txt$/, '.prompt.txt')), prompt)
      try {
        return await saved(prompt, stage)
      } catch (error) {
        if (!live) throw error
        const reply = await live(prompt, stage)
        await writeFile(path.join(directory, file), reply)
        return reply
      }
    },
  }
}

const runSpecCase = async (
  testCase: BenchCase,
  directory: string,
  live: AskModel | undefined,
  runner: PlaytestRunner | undefined,
): Promise<CaseResult> => {
  await mkdir(directory, { recursive: true })
  const prompt = createGameSpecInstruction(testCase.request)
  await writeFile(path.join(directory, 'spec.prompt.txt'), prompt)
  let reply = await readOptional(path.join(directory, 'spec.txt'))
  const base = {
    id: testCase.id,
    condition: 'spec' as const,
    projectType: testCase.projectType,
    promptCharacters: { total: prompt.length, max: prompt.length },
  }
  if (reply === undefined && live) {
    reply = await live(prompt, 'B')
    await writeFile(path.join(directory, 'spec.txt'), reply)
  }
  if (reply === undefined)
    return {
      ...base,
      status: 'no-reply',
      failureType: 'no-reply',
      modelCalls: 0,
      replyCharacters: 0,
      built: false,
      runtimeStatus: 'not-run',
      requestIntent: { checked: 0, passed: 0, missing: [] },
      intent: { checked: 0, passed: 0, missing: [] },
      mediaKinds: 0,
      decisions: 0,
      done: false,
    }
  const text = reply
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-z]*\n?/gi, '')
    .trim()
  const outputFile = path.join(directory, 'spec.sb3')
  const report = await buildSpecText(text, { outputFile, playtest: false, force: true, request: testCase.request })
  let staticEvidence: StaticEvidence = {
    opcodes: {},
    sprites: 0,
    scripts: 0,
    diagnosticScore: null,
    coverage: 1,
    keys: [],
    clickable: false,
  }
  let runtime: RuntimeEvidence = NOT_RUN
  if (report.status === 'success') {
    const bytes = new Uint8Array(await readFile(outputFile))
    staticEvidence = await extractStaticEvidence(bytes)
    if (runner) {
      const { plan, scenario, movementKeys } = planGradingPlaytest(staticEvidence)
      runtime = toRuntimeEvidence(await runner.run(bytes, plan), scenario, movementKeys)
    }
  }
  const intent = intentScore(testCase.request, '', staticEvidence, runtime)
  const requestIntent = intent
  const unsupported = report.unsupported?.length ?? 0
  const failureType =
    report.status !== 'success'
      ? 'build'
      : runtime.status === 'failed'
        ? 'runtime'
        : intent.missing.length
          ? 'feature-missing'
          : undefined
  return {
    ...base,
    status: report.status === 'success' ? 'scored' : 'failed',
    ...(failureType ? { failureType } : {}),
    ...(report.status !== 'success' ? { failure: report.feedback.slice(0, 300) } : {}),
    modelCalls: 1,
    replyCharacters: reply.length,
    built: report.status === 'success',
    runtimeStatus: runtime.status,
    requestIntent,
    intent,
    mediaKinds: mediaKinds(runtime),
    decisions: unsupported,
    done: report.status === 'success' && runtime.status === 'passed' && intent.missing.length === 0,
  }
}

const runCreativeCase = async (
  testCase: BenchCase,
  condition: 'a-b' | 'a-b-c',
  directory: string,
  live: AskModel | undefined,
  runner: PlaytestRunner | undefined,
): Promise<CaseResult> => {
  const { ask, calls } = await recordingAsker(directory, live)
  const verifier = createProjectVerifier(runner, createCachedAssetFetcher())
  const base = { id: testCase.id, condition, projectType: testCase.projectType }
  try {
    const result = await runCreativePipeline({
      request: testCase.request,
      mode: condition,
      ask,
      verify: verifier.verify,
      name: testCase.id,
    })
    await writeFile(
      path.join(directory, 'creative-run.json'),
      `${JSON.stringify({ ...result, assets: verifier.assets() }, null, 2)}\n`,
    )
    const sb3 = verifier.sb3()
    if (sb3) await writeFile(path.join(directory, `${condition}.sb3`), sb3)
    const lastVerified = [...result.steps].reverse().find((step) => step.verification)
    const built = lastVerified?.verification?.built ?? false
    const runtime = result.runtimeStatus
    const intent = {
      checked: result.checks.length,
      passed: result.checks.filter(({ result: outcome }) => outcome === 'pass').length,
      missing: result.checks.filter(({ result: outcome }) => outcome !== 'pass').map(({ feature }) => feature),
    }
    const noReply = result.notDone.some((line) => line.includes('模型沒有回覆'))
    const parseFailed = result.steps.some((step) => (step.validationErrors?.length ?? 0) > 0) && !built
    const failureType = noReply
      ? 'no-reply'
      : parseFailed
        ? 'parse'
        : !built
          ? 'build'
          : runtime === 'failed'
            ? 'runtime'
            : intent.missing.length
              ? 'feature-missing'
              : undefined
    const empty = { checked: 0, passed: 0, missing: [] as string[] }
    const measured =
      sb3 && runner
        ? await (async () => {
            const staticEvidence = await extractStaticEvidence(sb3)
            const { plan, scenario, movementKeys } = planGradingPlaytest(staticEvidence)
            const runtime = toRuntimeEvidence(await runner.run(sb3, plan), scenario, movementKeys)
            return {
              media: mediaKinds(runtime),
              requestIntent: intentScore(testCase.request, '', staticEvidence, runtime),
            }
          })()
        : {
            media: 0,
            requestIntent: { ...empty, checked: featureChecks(extractIntentAnchors(testCase.request, '')).length },
          }
    return {
      ...base,
      status: noReply && !result.project ? 'no-reply' : built ? 'scored' : 'failed',
      ...(failureType ? { failureType } : {}),
      ...(result.notDone.length ? { failure: result.notDone.join('；').slice(0, 300) } : {}),
      modelCalls: calls(),
      promptCharacters: result.promptCharacters,
      replyCharacters: result.steps.reduce((sum, step) => sum + step.replyCharacters, 0),
      built,
      runtimeStatus: runtime,
      intent,
      mediaKinds: measured.media,
      requestIntent: measured.requestIntent,
      decisions: result.decisions.filter(({ status }) => ['approximated', 'substituted', 'deferred'].includes(status))
        .length,
      done: result.done,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const noReply = message.includes('沒有 A 階段')
    return {
      ...base,
      status: noReply ? 'no-reply' : 'failed',
      failureType: noReply ? 'no-reply' : 'error',
      failure: message.slice(0, 300),
      modelCalls: calls(),
      promptCharacters: { total: 0, max: 0 },
      replyCharacters: 0,
      built: false,
      runtimeStatus: 'not-run',
      requestIntent: { checked: 0, passed: 0, missing: [] },
      intent: { checked: 0, passed: 0, missing: [] },
      mediaKinds: 0,
      decisions: 0,
      done: false,
    }
  }
}

const mean = (values: readonly number[]): number | null =>
  values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null

const summarize = (results: readonly CaseResult[]) =>
  CONDITIONS.map((condition) => {
    const rows = results.filter((row) => row.condition === condition)
    const answered = rows.filter((row) => row.status !== 'no-reply')
    const rated = rows.flatMap((row) => (row.humanScore === undefined ? [] : [row.humanScore]))
    return {
      condition,
      cases: rows.length,
      answered: answered.length,
      built: answered.filter((row) => row.built).length,
      runtimePassed: answered.filter((row) => row.runtimeStatus === 'passed').length,
      done: answered.filter((row) => row.done).length,
      meanPromptMax: mean(answered.map((row) => row.promptCharacters.max)),
      meanPromptTotal: mean(answered.map((row) => row.promptCharacters.total)),
      meanModelCalls: mean(answered.map((row) => row.modelCalls)),
      requestIntentPreservation: mean(
        answered
          .filter((row) => row.requestIntent.checked > 0)
          .map((row) => row.requestIntent.passed / row.requestIntent.checked),
      ),
      intentPreservation: mean(
        answered.filter((row) => row.intent.checked > 0).map((row) => row.intent.passed / row.intent.checked),
      ),
      meanMediaKinds: mean(answered.map((row) => row.mediaKinds)),
      decisions: answered.reduce((sum, row) => sum + row.decisions, 0),
      humanRated: rated.length,
      meanHumanScore: mean(rated),
      failureTypes: Object.fromEntries(
        [...new Set(answered.flatMap((row) => (row.failureType ? [row.failureType] : [])))].map((type) => [
          type,
          answered.filter((row) => row.failureType === type).length,
        ]),
      ),
    }
  })

const toMarkdown = (
  meta: Record<string, unknown>,
  summary: ReturnType<typeof summarize>,
  results: readonly CaseResult[],
  regression?: string[],
): string =>
  [
    '# 兩階段生成 benchmark',
    '',
    `- 模型：${typeof meta.model === 'string' ? meta.model : '（離線回覆）'}；端點：${typeof meta.baseUrl === 'string' ? meta.baseUrl : '—'}；日期：${String(meta.date)}`,
    '- 品質判斷看「意圖保留」「實際執行」「媒體／回饋種類」與人工評分；只看建置成功率不能宣稱品質提升。「意圖（需求）」三組都只用原始需求抽出的意圖計分，是唯一可直接比較的欄位；「意圖（構想）」依各自的構想文字，分母不同。',
    '',
    '| 條件 | 有回覆 | 建置 | 實際執行通過 | done | 平均最長提示 | 平均總提示 | 平均呼叫數 | 意圖（需求） | 意圖（構想） | 媒體種類 | 近似決策 | 人工評分 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.map(
      (row) =>
        `| ${row.condition} | ${row.answered}/${row.cases} | ${row.built} | ${row.runtimePassed} | ${row.done} | ${row.meanPromptMax ?? '—'} | ${row.meanPromptTotal ?? '—'} | ${row.meanModelCalls ?? '—'} | ${row.requestIntentPreservation ?? '—'} | ${row.intentPreservation ?? '—'} | ${row.meanMediaKinds ?? '—'} | ${row.decisions} | ${row.meanHumanScore ?? `未評（${row.humanRated}）`} |`,
    ),
    '',
    ...(regression?.length ? ['## 與基準比較', '', ...regression.map((line) => `- ${line}`), ''] : []),
    '## 逐題',
    '',
    '| 題目 | 類型 | 條件 | 狀態 | 失敗類型 | 意圖（需求） | 缺少（需求） | 媒體 | done |',
    '| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |',
    ...results.map(
      (row) =>
        `| ${row.id} | ${row.projectType} | ${row.condition} | ${row.status} | ${row.failureType ?? ''} | ${row.requestIntent.passed}/${row.requestIntent.checked} | ${row.requestIntent.missing.join('、')} | ${row.mediaKinds} | ${row.done ? '✅' : ''} |`,
    ),
    '',
  ].join('\n')

const mergeRatings = async (runDir: string, results: CaseResult[]): Promise<CaseResult[]> => {
  const text = await readOptional(path.join(runDir, 'ratings.csv'))
  if (!text) return results
  const [header = [], ...rows] = parseCsvTable(text.replace(/^\uFEFF/, ''))
  const names = header.map((name) => name.trim())
  const ratings = rows.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index] ?? ''])))
  return results.map((row) => {
    const rating = ratings.find((entry) => entry.case === row.id && entry.condition === row.condition)
    const score = Number(rating?.score)
    return rating && score >= 1 && score <= 5
      ? { ...row, humanScore: score, ...(rating.notes ? { humanNotes: rating.notes } : {}) }
      : row
  })
}

const writeReport = async (
  runDir: string,
  meta: Record<string, unknown>,
  results: CaseResult[],
  baselinePath?: string,
) => {
  const rated = await mergeRatings(runDir, results)
  const summary = summarize(rated)
  let regression: string[] | undefined
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as {
      summary: ReturnType<typeof summarize>
      meta: Record<string, unknown>
    }
    if (baseline.meta.model !== meta.model)
      regression = [`注意：基準模型 ${String(baseline.meta.model)} 與本輪 ${String(meta.model)} 不同，不能直接比較。`]
    regression = [
      ...(regression ?? []),
      ...summary.flatMap((row) => {
        const old = baseline.summary.find((entry) => entry.condition === row.condition)
        if (!old) return []
        return [
          `${row.condition}：意圖（需求） ${old.requestIntentPreservation ?? '—'} → ${row.requestIntentPreservation ?? '—'}；意圖（構想） ${old.intentPreservation ?? '—'} → ${row.intentPreservation ?? '—'}；建置 ${old.built} → ${row.built}；done ${old.done} → ${row.done}；人工 ${old.meanHumanScore ?? '—'} → ${row.meanHumanScore ?? '—'}`,
        ]
      }),
    ]
  }
  await writeFile(path.join(runDir, 'report.json'), `${JSON.stringify({ meta, summary, results: rated }, null, 2)}\n`)
  await writeFile(path.join(runDir, 'report.md'), toMarkdown(meta, summary, rated, regression))
  if (!(await readOptional(path.join(runDir, 'ratings.csv'))))
    await writeFile(
      path.join(runDir, 'ratings.csv'),
      `case,condition,score,notes\n${rated.map((row) => `${row.id},${row.condition},,`).join('\n')}\n`,
    )
  return summary
}

const main = async (): Promise<void> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      run: { type: 'string' },
      conditions: { type: 'string' },
      only: { type: 'string' },
      playtest: { type: 'boolean' },
      baseline: { type: 'string' },
      offline: { type: 'boolean' },
    },
  })
  const command = positionals[0]
  if (!values.run || (command !== 'run' && command !== 'report'))
    throw new Error(
      'Usage: benchmark:creative run|report --run <dir> [--conditions spec,a-b,a-b-c] [--only ids] [--playtest] [--baseline report.json] [--offline]',
    )
  const runDir = path.resolve(values.run)
  await mkdir(runDir, { recursive: true })
  if (command === 'report') {
    const previous = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8')) as {
      meta: Record<string, unknown>
      results: CaseResult[]
    }
    console.log(JSON.stringify(await writeReport(runDir, previous.meta, previous.results, values.baseline), null, 2))
    return
  }
  const { cases } = JSON.parse(await readFile(casesPath, 'utf8')) as { cases: BenchCase[] }
  const selected = values.only ? cases.filter(({ id }) => values.only?.split(',').includes(id)) : cases
  const conditions = (values.conditions?.split(',') ?? CONDITIONS).filter((value): value is Condition =>
    (CONDITIONS as readonly string[]).includes(value),
  )
  const environment = { ...process.env }
  if (process.env.BENCH_BASE_URL) environment.SCRATCH_BRIDGE_MODEL_URL = process.env.BENCH_BASE_URL
  if (process.env.BENCH_MODEL) environment.SCRATCH_BRIDGE_MODEL = process.env.BENCH_MODEL
  if (process.env.BENCH_API_KEY) environment.SCRATCH_BRIDGE_API_KEY = process.env.BENCH_API_KEY
  const baseConfig = modelConfigFromEnvironment(environment)
  // Resolve the model id up front so the report names exactly which model produced every reply.
  const config = values.offline ? baseConfig : { ...baseConfig, model: await resolveModel(baseConfig) }
  const live = values.offline ? undefined : modelAsker(config)
  const runner = values.playtest ? await PlaytestRunner.create() : undefined
  const results: CaseResult[] = []
  try {
    for (const testCase of selected)
      for (const condition of conditions) {
        const directory = path.join(runDir, condition, testCase.id)
        const started = Date.now()
        const result =
          condition === 'spec'
            ? await runSpecCase(testCase, directory, live, runner).catch((error: unknown): CaseResult => ({
                id: testCase.id,
                condition,
                projectType: testCase.projectType,
                status: 'failed',
                failureType: 'error',
                failure: error instanceof Error ? error.message.slice(0, 300) : String(error),
                modelCalls: 0,
                promptCharacters: { total: 0, max: 0 },
                replyCharacters: 0,
                built: false,
                runtimeStatus: 'not-run',
                requestIntent: { checked: 0, passed: 0, missing: [] },
                intent: { checked: 0, passed: 0, missing: [] },
                mediaKinds: 0,
                decisions: 0,
                done: false,
              }))
            : await runCreativeCase(testCase, condition, directory, live, runner)
        results.push(result)
        console.log(
          `${testCase.id} ${condition}: ${result.status}${result.failureType ? ` (${result.failureType})` : ''} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
        )
      }
  } finally {
    await runner?.close()
  }
  const meta = {
    model: values.offline ? undefined : config.model,
    baseUrl: values.offline ? undefined : config.baseUrl,
    date: new Date().toISOString(),
    playtest: values.playtest === true,
    conditions,
  }
  console.log(JSON.stringify(await writeReport(runDir, meta, results), null, 2))
}

await main()
