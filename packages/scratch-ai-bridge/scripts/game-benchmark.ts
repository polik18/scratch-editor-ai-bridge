// Game-quality benchmark: measures what a student actually gets from one idea sentence.
//
//   npm run benchmark:games -- prompts  --run benchmarks/game-quality/runs/<name>
//   npm run benchmark:games -- generate --run <dir>   (needs BENCH_BASE_URL, BENCH_MODEL, optional BENCH_API_KEY;
//                                                       BENCH_NO_THINKING=1 turns off Qwen-style thinking)
//   npm run benchmark:games -- score    --run <dir>   (needs `npm run build` for the renderer preview)
//
// `--format spec` runs the same cases through the Game Spec path (short behavior-card prompt, spec compiler,
// scenarios generated from the spec) instead of the Canonical IR student prompt. Use one run directory per format.
//
// `prompts` writes <id>.prompt.txt. Responses are read from <id>.response.txt, written by `generate` from any
// OpenAI-compatible endpoint or pasted by hand from a chat UI. `score` writes report.json, report.md and
// <id>.png screenshots.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { PlaytestRunner, type PlaytestControl, type PlaytestResult } from '../src/cli/playtest'
import { runSpecScenario, type ScenarioResult } from '../src/cli/scenario-runner'
import { createStudentProjectInstruction, estimatePromptSize } from '../src/core/capabilities/registry'
import { compileCanonicalProjectToSb3 } from '../src/core/compiler'
import type { CanonicalBlock, CanonicalInput, CanonicalProject } from '../src/core/ir/types'
import {
  addExtractionRepair,
  normalizeAiDraft,
  parseAiProjectResponse,
  parseAiResponse,
} from '../src/core/normalizer'
import { validateCanonicalProject, validateCanonicalSemantics } from '../src/core/validator'
import {
  createScratchAssetFetcher,
  resolveLibraryAssets,
  type LibraryAssetFetcher,
  type LibraryResolutionReport,
} from '../src/core/visuals/library'
import { buildFromSpecText, createSpecScenarios, formatSpecDiagnostics } from '../src/spec'
import { createGameSpecInstruction } from '../src/spec/prompt'

interface BenchmarkCase {
  readonly id: string
  readonly request: string
  readonly controls: readonly PlaytestControl[]
  readonly clicks?: boolean
  readonly expectAutonomousMotion: boolean
  readonly expectProgress: boolean
}

interface Check {
  readonly name: string
  readonly pass: boolean
  readonly detail?: string
}

interface CaseResult {
  readonly id: string
  readonly status: 'scored' | 'no-response' | 'pipeline-failed'
  readonly failedStage?: string
  readonly failure?: string
  readonly promptCharacters: number
  readonly responseCharacters?: number
  readonly checks: readonly Check[]
  readonly score: number
  readonly assets?: LibraryResolutionReport & { readonly animatedSprites: number; readonly soundBlocks: number }
  readonly playtest?: PlaytestResult
  readonly scenarios?: readonly ScenarioResult[]
  /** Spec path only: plain-language feedback that would be sent back to the model for a repair round. */
  readonly feedback?: string
}

type Format = 'canonical' | 'spec'

const promptFor = (format: Format, request: string): string =>
  format === 'spec' ? createGameSpecInstruction(request) : createStudentProjectInstruction(request)

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const casesPath = path.join(packageRoot, 'benchmarks/game-quality/cases.json')
const assetCacheDir = path.join(packageRoot, 'benchmarks/game-quality/.asset-cache')

const loadCases = async (only?: string): Promise<BenchmarkCase[]> => {
  const { cases } = JSON.parse(await readFile(casesPath, 'utf8')) as { cases: BenchmarkCase[] }
  return only ? cases.filter(({ id }) => only.split(',').includes(id)) : cases
}

const readOptional = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Library fetcher with an on-disk cache so repeated benchmark runs do not re-download assets.
 * @returns Fetcher that reads the cache first and stores verified downloads.
 */
const cachedFetcher = (): LibraryAssetFetcher => {
  const network = createScratchAssetFetcher()
  return async (md5ext) => {
    const cached = path.join(assetCacheDir, md5ext)
    try {
      const bytes = new Uint8Array(await readFile(cached))
      if (createHash('md5').update(bytes).digest('hex') === md5ext.slice(0, 32)) return bytes
    } catch {
      // Not cached yet.
    }
    const bytes = await network(md5ext)
    await mkdir(assetCacheDir, { recursive: true })
    await writeFile(cached, bytes)
    return bytes
  }
}

const walkBlocks = (blocks: readonly CanonicalBlock[], visit: (block: CanonicalBlock) => void): void => {
  const walkInput = (input: CanonicalInput): void => {
    if (input.type === 'block') walkBlocks([input.block], visit)
    else if (input.type === 'stack') walkBlocks(input.blocks, visit)
  }
  for (const block of blocks) {
    visit(block)
    for (const input of Object.values(block.inputs ?? {})) walkInput(input)
  }
}

const countOpcodes = (target: CanonicalProject['sprites'][number] | CanonicalProject['stage'], opcodes: string[]) => {
  let count = 0
  for (const script of target.scripts) walkBlocks(script.blocks, (block) => opcodes.includes(block.opcode) && count++)
  return count
}

const commandPrompts = async (runDir: string, cases: BenchmarkCase[], format: Format): Promise<void> => {
  await mkdir(runDir, { recursive: true })
  for (const testCase of cases) {
    const prompt = promptFor(format, testCase.request)
    await writeFile(path.join(runDir, `${testCase.id}.prompt.txt`), prompt)
    console.log(`${testCase.id}: ${estimatePromptSize(prompt).characters} characters`)
  }
}

const commandGenerate = async (
  runDir: string,
  cases: BenchmarkCase[],
  force: boolean,
  format: Format,
): Promise<void> => {
  const baseUrl = process.env.BENCH_BASE_URL
  const model = process.env.BENCH_MODEL
  if (!baseUrl || !model) throw new Error('Set BENCH_BASE_URL (e.g. http://127.0.0.1:8000/v1) and BENCH_MODEL')
  const noThinking = process.env.BENCH_NO_THINKING === '1'
  await mkdir(runDir, { recursive: true })
  const meta: Record<string, unknown>[] = []
  for (const testCase of cases) {
    const responsePath = path.join(runDir, `${testCase.id}.response.txt`)
    if (!force && (await readOptional(responsePath)) !== undefined) {
      console.log(`${testCase.id}: response exists, skipping`)
      continue
    }
    const prompt = promptFor(format, testCase.request)
    const started = Date.now()
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.BENCH_API_KEY ? { authorization: `Bearer ${process.env.BENCH_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        // Qwen-style chat templates honour this; servers without the option ignore it.
        ...(noThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
      signal: AbortSignal.timeout(15 * 60_000),
    })
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[]; error?: unknown }
    const content = body.choices?.[0]?.message?.content
    if (!response.ok || typeof content !== 'string') {
      console.error(`${testCase.id}: HTTP ${response.status} ${JSON.stringify(body.error ?? body).slice(0, 300)}`)
      continue
    }
    await writeFile(responsePath, content)
    const seconds = (Date.now() - started) / 1000
    meta.push({ id: testCase.id, model, seconds, characters: content.length })
    console.log(`${testCase.id}: ${content.length} characters in ${seconds.toFixed(1)} s`)
  }
  await writeFile(
    path.join(runDir, 'generate-meta.json'),
    `${JSON.stringify({ model, baseUrl, format, noThinking, meta }, null, 2)}\n`,
  )
}

const runPipeline = async (
  response: string,
  fetcher: LibraryAssetFetcher,
): Promise<
  | { ok: true; project: CanonicalProject; sb3: Uint8Array; assets: LibraryResolutionReport }
  | { ok: false; stage: string; error: string }
> => {
  let stage = 'parse'
  try {
    const parsed = parseAiResponse(response)
    stage = 'normalize'
    const envelope = parseAiProjectResponse(parsed.data)
    const normalized = addExtractionRepair(normalizeAiDraft(envelope.project), parsed)
    stage = 'schema'
    const validation = validateCanonicalProject(normalized.data)
    if (!validation.valid) {
      return { ok: false, stage, error: JSON.stringify(validation.errors).slice(0, 600) }
    }
    stage = 'semantic'
    const errors = validateCanonicalSemantics(validation.data).filter(({ severity }) => severity === 'error')
    if (errors.length > 0) return { ok: false, stage, error: JSON.stringify(errors.slice(0, 5)).slice(0, 600) }
    stage = 'assets'
    const resolved = await resolveLibraryAssets(validation.data, fetcher, { replaceModelSvg: true })
    stage = 'compile'
    const sb3 = new Uint8Array(await (await compileCanonicalProjectToSb3(resolved.project)).arrayBuffer())
    return { ok: true, project: resolved.project, sb3, assets: resolved.report }
  } catch (error) {
    return { ok: false, stage, error: (error instanceof Error ? error.message : String(error)).slice(0, 600) }
  }
}

const scoreCase = async (
  runDir: string,
  testCase: BenchmarkCase,
  fetcher: LibraryAssetFetcher,
  runner: PlaytestRunner,
): Promise<CaseResult> => {
  const promptCharacters = estimatePromptSize(createStudentProjectInstruction(testCase.request)).characters
  const response = await readOptional(path.join(runDir, `${testCase.id}.response.txt`))
  if (response === undefined)
    return { id: testCase.id, status: 'no-response', promptCharacters, checks: [], score: 0 }

  const pipeline = await runPipeline(response, fetcher)
  if (!pipeline.ok) {
    return {
      id: testCase.id,
      status: 'pipeline-failed',
      failedStage: pipeline.stage,
      failure: pipeline.error,
      promptCharacters,
      responseCharacters: response.length,
      checks: [{ name: 'builds', pass: false, detail: `${pipeline.stage}: ${pipeline.error.slice(0, 160)}` }],
      score: 0,
    }
  }
  await writeFile(path.join(runDir, `${testCase.id}.sb3`), pipeline.sb3)

  const { project, assets } = pipeline
  const animatedSprites = project.sprites.filter(
    (sprite) =>
      sprite.costumes.length >= 2 && countOpcodes(sprite, ['looks_nextcostume', 'looks_switchcostumeto']) > 0,
  ).length
  const soundBlocks = [project.stage, ...project.sprites].reduce(
    (sum, target) => sum + countOpcodes(target, ['sound_play', 'sound_playuntildone']),
    0,
  )

  const playtest = await runner.run(
    pipeline.sb3,
    { controls: testCase.controls, clicks: testCase.clicks ?? false },
    path.join(runDir, `${testCase.id}.png`),
  )

  const checks: Check[] = [
    { name: 'builds', pass: true },
    {
      name: 'runs',
      pass: playtest.ready && playtest.pageErrors.length === 0,
      ...(playtest.error || playtest.pageErrors.length
        ? { detail: (playtest.error ?? playtest.pageErrors.join(' | ')).slice(0, 160) }
        : {}),
    },
  ]
  if (testCase.expectAutonomousMotion) checks.push({ name: 'moves-on-its-own', pass: playtest.autonomousMotion })
  for (const control of playtest.controls) {
    checks.push({
      name: `key ${control.key === ' ' ? 'space' : control.key} ${control.expected}`,
      pass: control.moved,
      detail: `${control.sprite ?? '-'} Δ${control.delta}`,
    })
  }
  if (testCase.expectProgress)
    checks.push({
      name: 'state-changes-in-play',
      pass: playtest.changedVariables.length > 0,
      detail: playtest.changedVariables.join(', ') || 'no variable changed',
    })
  checks.push(
    {
      name: 'library-art',
      pass: assets.placeholderCostumes.length === 0,
      detail: `${assets.libraryCostumes} library, ${assets.placeholderCostumes.length} placeholder, ${assets.replacedModelSvg} model SVG replaced`,
    },
    {
      name: 'plays-sound',
      pass: soundBlocks > 0 && assets.silentSounds.length === 0,
      detail: `${soundBlocks} sound blocks, ${assets.silentSounds.length} silent`,
    },
    { name: 'animated-sprite', pass: animatedSprites > 0, detail: `${animatedSprites} animated` },
  )

  return {
    id: testCase.id,
    status: 'scored',
    promptCharacters,
    responseCharacters: response.length,
    checks,
    score: checks.filter(({ pass }) => pass).length / checks.length,
    assets: { ...assets, animatedSprites, soundBlocks },
    playtest,
  }
}

/**
 * Spec path: the same build and generic playtest checks as the Canonical path (so results compare directly), plus
 * the scenarios generated from the spec. Art, sound and animation checks are left out because spec v0 draws its own
 * cell-sized costumes and has no sound behavior yet.
 * @param runDir - Run directory holding `<id>.response.txt`.
 * @param testCase - Benchmark case being scored.
 * @param runner - Shared playtest runner.
 * @returns Scored case result, including spec feedback for a repair round.
 */
const scoreSpecCase = async (
  runDir: string,
  testCase: BenchmarkCase,
  runner: PlaytestRunner,
): Promise<CaseResult> => {
  const promptCharacters = estimatePromptSize(createGameSpecInstruction(testCase.request)).characters
  const response = await readOptional(path.join(runDir, `${testCase.id}.response.txt`))
  if (response === undefined)
    return { id: testCase.id, status: 'no-response', promptCharacters, checks: [], score: 0 }
  const built = buildFromSpecText(response)
  const feedback = formatSpecDiagnostics(built.diagnostics.filter((item) => item.severity !== 'fixed'))
  if (!built.project || !built.spec) {
    return {
      id: testCase.id,
      status: 'pipeline-failed',
      failedStage: 'spec',
      failure: feedback,
      promptCharacters,
      responseCharacters: response.length,
      checks: [{ name: 'builds', pass: false, detail: feedback.split('\n')[0]?.slice(0, 160) }],
      score: 0,
      feedback,
    }
  }
  let sb3: Uint8Array
  try {
    sb3 = new Uint8Array(await (await compileCanonicalProjectToSb3(built.project)).arrayBuffer())
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 600)
    return {
      id: testCase.id,
      status: 'pipeline-failed',
      failedStage: 'compile',
      failure: message,
      promptCharacters,
      responseCharacters: response.length,
      checks: [{ name: 'builds', pass: false, detail: message.slice(0, 160) }],
      score: 0,
    }
  }
  await writeFile(path.join(runDir, `${testCase.id}.sb3`), sb3)
  const playtest = await runner.run(
    sb3,
    { controls: testCase.controls, clicks: testCase.clicks ?? false },
    path.join(runDir, `${testCase.id}.png`),
  )
  const scenarios: ScenarioResult[] = []
  for (const scenario of createSpecScenarios(built.spec)) scenarios.push(await runSpecScenario(runner, sb3, scenario))
  const checks: Check[] = [
    { name: 'builds', pass: true },
    {
      name: 'runs',
      pass: playtest.ready && playtest.pageErrors.length === 0,
      ...(playtest.error || playtest.pageErrors.length
        ? { detail: (playtest.error ?? playtest.pageErrors.join(' | ')).slice(0, 160) }
        : {}),
    },
  ]
  if (testCase.expectAutonomousMotion) checks.push({ name: 'moves-on-its-own', pass: playtest.autonomousMotion })
  for (const control of playtest.controls)
    checks.push({
      name: `key ${control.key === ' ' ? 'space' : control.key} ${control.expected}`,
      pass: control.moved,
      detail: `${control.sprite ?? '-'} Δ${control.delta}`,
    })
  if (testCase.expectProgress)
    checks.push({
      name: 'state-changes-in-play',
      pass: playtest.changedVariables.length > 0,
      detail: playtest.changedVariables.join(', ') || 'no variable changed',
    })
  for (const scenario of scenarios)
    for (const expectation of scenario.expectations)
      checks.push({
        name: `scenario ${scenario.name}/${expectation.label}`,
        pass: expectation.pass,
        detail: `actual ${String(expectation.actual)}, expected ${expectation.expected}`,
      })
  const scenarioFeedback = scenarios
    .flatMap((scenario) =>
      scenario.expectations
        .filter((item) => !item.pass)
        .map((item) => `[試玩未通過] ${scenario.name}／${item.label} → ${item.hint ?? ''}`),
    )
    .join('\n')
  return {
    id: testCase.id,
    status: 'scored',
    promptCharacters,
    responseCharacters: response.length,
    checks,
    score: checks.filter(({ pass }) => pass).length / checks.length,
    playtest,
    scenarios,
    feedback: [feedback, scenarioFeedback].filter(Boolean).join('\n'),
  }
}

const markdownReport = (runDir: string, results: CaseResult[]): string => {
  const scored = results.filter(({ status }) => status !== 'no-response')
  const mean = scored.length ? scored.reduce((sum, { score }) => sum + score, 0) / scored.length : 0
  const rate = (name: string): string => {
    const relevant = scored.flatMap(({ checks }) => checks.filter((check) => check.name.startsWith(name)))
    return relevant.length ? `${relevant.filter(({ pass }) => pass).length}/${relevant.length}` : '-'
  }
  const lines = [
    `# Game-quality benchmark: ${path.basename(runDir)}`,
    '',
    `Scored ${scored.length}/${results.length} cases; mean check pass rate ${(mean * 100).toFixed(0)}%.`,
    '',
    '| check | passed |',
    '| - | - |',
    ...[
      'builds',
      'runs',
      'moves-on-its-own',
      'key ',
      'state-changes-in-play',
      'library-art',
      'plays-sound',
      'animated-sprite',
      'scenario ',
    ].map((name) => `| ${name.trim()} | ${rate(name)} |`),
    '',
    '| case | score | failed checks |',
    '| - | - | - |',
    ...results.map((result) => {
      if (result.status === 'no-response') return `| ${result.id} | - | no response |`
      const failed = result.checks
        .filter(({ pass }) => !pass)
        .map(({ name, detail }) => (detail ? `${name} (${detail})` : name))
      return `| ${result.id} | ${(result.score * 100).toFixed(0)}% | ${failed.join('; ').replaceAll('|', '/') || '-'} |`
    }),
    '',
    'Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses',
    'real art and sound. They do not measure fun or whether every requested rule is implemented.',
    '',
  ]
  return lines.join('\n')
}

const commandScore = async (runDir: string, cases: BenchmarkCase[], format: Format): Promise<void> => {
  const fetcher = cachedFetcher()
  const runner = await PlaytestRunner.create()
  const results: CaseResult[] = []
  try {
    for (const testCase of cases) {
      const result =
        format === 'spec'
          ? await scoreSpecCase(runDir, testCase, runner)
          : await scoreCase(runDir, testCase, fetcher, runner)
      results.push(result)
      console.log(`${testCase.id}: ${result.status} ${(result.score * 100).toFixed(0)}%`)
    }
  } finally {
    await runner.close()
  }
  await writeFile(path.join(runDir, 'report.json'), `${JSON.stringify({ results }, null, 2)}\n`)
  const markdown = markdownReport(runDir, results)
  await writeFile(path.join(runDir, 'report.md'), markdown)
  console.log(`\n${markdown}`)
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: 'string' },
    cases: { type: 'string' },
    force: { type: 'boolean', default: false },
    format: { type: 'string', default: 'canonical' },
  },
})
const command = positionals[0]
const format = values.format as Format
if (!values.run || !['prompts', 'generate', 'score'].includes(command) || !['canonical', 'spec'].includes(format)) {
  console.error(
    'Usage: game-benchmark <prompts|generate|score> --run <dir> [--format canonical|spec] [--cases id1,id2] [--force]',
  )
  process.exit(2)
}
const runDir = path.resolve(values.run)
const cases = await loadCases(values.cases)
if (command === 'prompts') await commandPrompts(runDir, cases, format)
else if (command === 'generate') await commandGenerate(runDir, cases, values.force, format)
else await commandScore(runDir, cases, format)
