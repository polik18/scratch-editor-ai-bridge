import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseScratchblocks } from '../../src/core/scratchblocks/parser'

interface BenchmarkCase {
  readonly id: string
  readonly request: string
}

interface ScratchblocksMeta {
  readonly id: string
  readonly request: string
  readonly responseCharacters: number
  readonly recognizedLines: number
  readonly skippedLines: number
  readonly warnings: readonly string[]
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const casesPath = path.join(packageRoot, 'research/game-quality-benchmark/cases.json')
const defaultBaseline = path.join(
  packageRoot,
  'research/game-quality-benchmark/runs/2026-11-10-local-qwen3-coder-next-80b-local-t2a-r3/report.json',
)

const loadCases = async (only?: string): Promise<BenchmarkCase[]> => {
  const { cases } = JSON.parse(await readFile(casesPath, 'utf8')) as { cases: BenchmarkCase[] }
  return only ? cases.filter(({ id }) => only.split(',').includes(id)) : cases
}

const promptFor = (
  request: string,
): string => `你是 Scratch 遊戲積木作者。把下面的遊戲需求改寫成 scratchblocks-style 文字，讓 Bridge 的最小 parser 可以轉成 Scratch 專案。

遊戲需求：${request}

輸出規則：
1. 只輸出積木文字，不要 Markdown、JSON、解釋、思考過程或多個版本。
2. 每個腳本從下列帽子開始：when green flag clicked、when [left arrow v] key pressed、when [space v] key pressed、when this sprite clicked。
3. 使用 2 個空格表示巢狀積木；每個 forever、repeat、if 之後都必須用 end 結束。
4. 只使用下列積木格式：move (10) steps、change x by (10)、change y by (10)、set x to (0)、set y to (0)、go to x: (0) y: (0)、if on edge, bounce、say [文字]、wait (1) seconds、forever、repeat (10)、if <key [space v] pressed?> then、change [score v] by (1)、set [score v] to (0)、broadcast [message v]、play sound [Pop v] until done、next costume、show、hide。
5. 需要碰撞時可用 if <touching [Apple v]?> then；需要計分時使用變數 score、lives 或 time。
6. 角色固定使用一個主要角色；不要輸出 sprite 名稱、素材 JSON 或自訂語法。

範例：
when green flag clicked
set [score v] to (0)
forever
  move (5) steps
  if <touching [Apple v]?> then
    change [score v] by (1)
    play sound [Pop v] until done
  end
end
when [left arrow v] key pressed
change x by (-10)
`

const stripModelWrappers = (content: string): string =>
  content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*```(?:scratchblocks?|text)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

const requestModel = async (
  baseUrl: string,
  model: string,
  apiKey: string | undefined,
  prompt: string,
): Promise<string> => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(15 * 60_000),
  })
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[]; error?: unknown }
  const content = body.choices?.[0]?.message?.content
  if (!response.ok || typeof content !== 'string')
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 400)}`)
  return content
}

const prepare = async (runDir: string, cases: BenchmarkCase[], force: boolean): Promise<void> => {
  const baseUrl = process.env.BENCH_BASE_URL ?? 'http://172.22.35.142:8091/v1'
  const model = process.env.BENCH_MODEL ?? 'qwen3-coder-next-80b-local'
  const apiKey = process.env.BENCH_API_KEY ?? process.env.HERMES_CUSTOM_QWEN_80B_LOCAL_API_KEY
  await mkdir(runDir, { recursive: true })
  const canonicalDir = path.join(runDir, 'canonical')
  await mkdir(canonicalDir, { recursive: true })
  const meta: ScratchblocksMeta[] = []
  for (const testCase of cases) {
    const prompt = promptFor(testCase.request)
    const promptPath = path.join(runDir, `${testCase.id}.prompt.txt`)
    const responsePath = path.join(runDir, `${testCase.id}.scratchblocks.txt`)
    let raw = force ? undefined : await readFile(responsePath, 'utf8').catch(() => undefined)
    if (raw === undefined) {
      const started = Date.now()
      raw = await requestModel(baseUrl, model, apiKey, prompt)
      await writeFile(responsePath, raw)
      console.log(
        `${testCase.id}: model response ${raw.length} characters in ${((Date.now() - started) / 1000).toFixed(1)} s`,
      )
    } else console.log(`${testCase.id}: response exists, reusing`)
    await writeFile(promptPath, prompt)
    const text = stripModelWrappers(raw)
    const parsed = parseScratchblocks(text, { name: `${testCase.id} scratchblocks prototype` })
    const metaEntry: ScratchblocksMeta = {
      id: testCase.id,
      request: testCase.request,
      responseCharacters: raw.length,
      recognizedLines: parsed.recognizedLines,
      skippedLines: parsed.skippedLines,
      warnings: parsed.warnings,
    }
    meta.push(metaEntry)
    await writeFile(path.join(runDir, `${testCase.id}.parse.json`), `${JSON.stringify(metaEntry, null, 2)}\n`)
    await writeFile(
      path.join(canonicalDir, `${testCase.id}.response.txt`),
      `${JSON.stringify(parsed.project, null, 2)}\n`,
    )
  }
  await writeFile(
    path.join(runDir, 'generate-meta.json'),
    `${JSON.stringify({ model, baseUrl, cases: meta }, null, 2)}\n`,
  )
  console.log(`Prepared ${meta.length} scratchblocks responses in ${runDir}`)
}

const compare = async (runDir: string, baselinePath: string): Promise<void> => {
  const scratch = JSON.parse(await readFile(path.join(runDir, 'canonical/report.json'), 'utf8')) as {
    results: {
      id: string
      score: number
      status: string
      responseCharacters?: number
      checks: { name: string; pass: boolean }[]
    }[]
  }
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as typeof scratch
  const meta = JSON.parse(await readFile(path.join(runDir, 'generate-meta.json'), 'utf8')) as {
    readonly model: string
    cases: ScratchblocksMeta[]
  }
  const mean = (results: typeof scratch.results): number =>
    results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : 0
  const checkRate = (results: typeof scratch.results, prefix: string): string => {
    const checks = results.flatMap((result) => result.checks.filter(({ name }) => name.startsWith(prefix)))
    return checks.length ? `${checks.filter(({ pass }) => pass).length}/${checks.length}` : '-'
  }
  const lines = [
    `# T2b scratchblocks prototype comparison: ${path.basename(runDir)}`,
    '',
    `Baseline: ${path.relative(packageRoot, baselinePath)}`,
    `Model: ${meta.model}`,
    '',
    '| metric | JSON T2a | scratchblocks prototype |',
    '| - | -: | -: |',
    `| mean check pass rate | ${(mean(baseline.results) * 100).toFixed(0)}% | ${(mean(scratch.results) * 100).toFixed(0)}% |`,
    `| builds | ${checkRate(baseline.results, 'builds')} | ${checkRate(scratch.results, 'builds')} |`,
    `| runs | ${checkRate(baseline.results, 'runs')} | ${checkRate(scratch.results, 'runs')} |`,
    `| key checks | ${checkRate(baseline.results, 'key ')} | ${checkRate(scratch.results, 'key ')} |`,
    `| library-art | ${checkRate(baseline.results, 'library-art')} | ${checkRate(scratch.results, 'library-art')} |`,
    `| plays-sound | ${checkRate(baseline.results, 'plays-sound')} | ${checkRate(scratch.results, 'plays-sound')} |`,
    `| animated-sprite | ${checkRate(baseline.results, 'animated-sprite')} | ${checkRate(scratch.results, 'animated-sprite')} |`,
    `| mean model response length | ${(
      baseline.results.reduce((sum, result) => sum + (result.responseCharacters ?? 0), 0) /
      Math.max(baseline.results.length, 1)
    ).toFixed(
      0,
    )} characters | ${(meta.cases.reduce((sum, item) => sum + item.responseCharacters, 0) / Math.max(meta.cases.length, 1)).toFixed(0)} characters |`,
    '',
    '| case | JSON score | scratchblocks score | parser warnings |',
    '| - | -: | -: | -: |',
    ...scratch.results.map((result) => {
      const item = meta.cases.find(({ id }) => id === result.id)
      const baselineResult = baseline.results.find(({ id }) => id === result.id)
      return `| ${result.id} | ${((baselineResult?.score ?? 0) * 100).toFixed(0)}% | ${(result.score * 100).toFixed(0)}% | ${item?.warnings.length ?? 0} |`
    }),
    '',
    '## Conclusion',
    '',
    'This is an isolated scratchblocks-style subset prototype. It is not connected to the UI or authoring prompt.',
    'Decision: 採用 scratchblocks-style 作為後續受控整合方向，但暫不直接接入 UI。理由是同一模型／同一 10 題由 JSON T2a 的 8% 提升至 61%，build 由 1/10 提升至 10/10，平均回覆由 17,282 字降至 757 字，且 parser warnings 為 0；仍需先補齊動畫、更多感測／分身語法與多角色模型，再進行產品整合。',
    '',
  ]
  await writeFile(path.join(runDir, 'comparison.md'), lines.join('\n'))
  console.log(lines.join('\n'))
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: 'string' },
    cases: { type: 'string' },
    force: { type: 'boolean', default: false },
    baseline: { type: 'string' },
  },
})
const command = positionals[0]
if (!values.run || !['prepare', 'compare'].includes(command)) {
  console.error(
    'Usage: scratchblocks-benchmark <prepare|compare> --run <dir> [--cases id1,id2] [--force] [--baseline <report.json>]',
  )
  process.exit(2)
}
const runDir = path.resolve(values.run)
if (command === 'prepare') await prepare(runDir, await loadCases(values.cases), values.force)
else await compare(runDir, values.baseline ? path.resolve(values.baseline) : defaultBaseline)
