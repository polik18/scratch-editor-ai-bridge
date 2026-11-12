import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { runBatch } from './batch'
import { inspectSb3Bytes, inspectSb3ForAiReader, inspectionToMarkdown, inspectionToStudentMarkdown } from './inspect'

const VERSION = '0.1.0'
const USAGE = `Scratch AI Bridge CLI ${VERSION}

AI agents: run "start" first — it lists every command, the rules and what counts as done, generated from this version.

Which command?
  Make a new game from one sentence (a local model writes the spec):
    scratch-ai-bridge make "做一個接蘋果遊戲，左右鍵移動，接到加分" --playtest
  You are the AI and will write the Game Spec yourself:
    scratch-ai-bridge guide                       print the Game Spec format
    save it as output/games/<name>/<name>.spec.json, then:
    scratch-ai-bridge spec output/games/<name>/<name>.spec.json --playtest
    Read "feedback" in the JSON report, fix the spec, run spec again with --force.
  Make an animation (60–180 s, scenes and backdrops):
    scratch-ai-bridge guide story                 print the Story Spec format
    scratch-ai-bridge story output/games/<name>/<name>.spec.json --playtest
  Analyse existing .sb3 files:
    scratch-ai-bridge inspect work.sb3 --format student-markdown
    scratch-ai-bridge batch ./class
  Never hand-write project.json or .sb3 files.

Where things go (the output/ folder at the top of the repository, never committed; from there run
"npm run --silent bridge -- <command>" so these paths work as written):
  output/games/<name>/<name>.sb3        the game          output/reports/<name>/   batch results
  output/games/<name>/<name>.spec.json  its Game Spec     output/bench/<run>/      benchmark runs
  output/games/<name>/_過程/            reports and model replies; "clean" removes these and output/tmp/

Usage:
  scratch-ai-bridge make <request> [--story] [--out <new-file.sb3>] [--spec-out <spec.json>] [--rounds <0-3>] [--playtest] [--force]
                         [--model <id>] [--base-url <url>] [--thinking]
  scratch-ai-bridge guide [game|story]
  scratch-ai-bridge story <story.json> [--out <file.sb3>] [--request <file-or-text>] [--playtest] [--force] [--offline]
  scratch-ai-bridge spec <game-spec.json> [--out <file.sb3>] [--ir <canonical-ir.json>] [--report <report.json>] [--request <file-or-text>] [--playtest] [--force] [--offline]
  scratch-ai-bridge inspect <file.sb3> [--format json|markdown|student-markdown|ai-reader]
  scratch-ai-bridge fetch <Scratch URL or project ID> [--out <directory>]
  scratch-ai-bridge batch <directory> [--out <new-directory>] [--recursive] [--manifest <file.csv|json>] [--jobs 1|2]
  scratch-ai-bridge generate <design.json> --out <new-file.sb3> [--report <report.json>] [--preview <stage.png>] [--force]
  scratch-ai-bridge clean [--all]               remove _過程 folders and output/tmp/; --all removes output/ entirely
  scratch-ai-bridge --help
  scratch-ai-bridge --version

"make" reads SCRATCH_BRIDGE_MODEL_URL (default http://127.0.0.1:8000/v1), SCRATCH_BRIDGE_MODEL (default: first listed
model) and SCRATCH_BRIDGE_API_KEY (OMLX_ENDPOINT / OMLX_API_KEY also work). It repairs once by default (--rounds 1).
"spec" builds from a Game Spec (entities + behaviors + rules + text map; see docs/guide/game-spec.md) and, with --playtest,
runs scenarios generated from the spec in the real Scratch preview (needs a built dist/).
"generate" accepts Canonical IR JSON or the documented GameDesign JSON shape. Pass --preview <stage.png> to run the
browser renderer; gameplay behavior requires a separate deterministic smoke test.`

/**
 * @param value - The `--request` value: a file with the task, or the task itself.
 * @returns The task text.
 */
const readRequest = async (value: string): Promise<string> => {
  const { requestText } = await import('./requirements')
  return requestText(value, (file) => readFile(file, 'utf8'))
}

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/** Set SCRATCH_BRIDGE_VERBOSE=1 to see the Scratch VM's own log lines while building. */
const verbose = process.env.SCRATCH_BRIDGE_VERBOSE === '1'

/**
 * The Scratch VM logs dozens of warnings to stdout while loading a project. They are hidden, so stdout carries only
 * the JSON report and stderr only the build's own progress lines, unless SCRATCH_BRIDGE_VERBOSE=1.
 * @param task - Work that may load the VM.
 * @returns The task's result.
 */
const withStdoutOnStderr = async <T>(task: () => Promise<T>): Promise<T> => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalConsoleLog = console.log
  const originalConsoleWarn = console.warn
  const toStderr = (...items: unknown[]): void => {
    if (verbose) process.stderr.write(`${items.map(String).join(' ')}\n`)
  }
  console.log = toStderr
  console.warn = toStderr
  const redirectStdout: typeof process.stdout.write = (chunk: string | Uint8Array, ...rest: unknown[]) =>
    verbose ? (process.stderr.write as (...params: unknown[]) => boolean)(chunk, ...rest) : true
  process.stdout.write = redirectStdout
  try {
    return await task()
  } finally {
    process.stdout.write = originalStdoutWrite
    console.log = originalConsoleLog
    console.warn = originalConsoleWarn
  }
}

/**
 * `output/reports/<input folder name>`, adding `-2`, `-3`… because batch never writes into an existing folder.
 * @param inputDirectory - The folder of SB3 files being analysed.
 * @returns A report folder that does not exist yet.
 */
const defaultReportDirectory = async (inputDirectory: string): Promise<string> => {
  const { exists, outputRoot, safeName } = await import('./output-layout')
  const parent = path.join(outputRoot(), 'reports')
  const name = safeName(path.basename(path.resolve(inputDirectory)), 'reports')
  let candidate = path.join(parent, name)
  for (let index = 2; (await exists(candidate)) && index < 1000; index += 1)
    candidate = path.join(parent, `${name}-${index}`)
  await mkdir(parent, { recursive: true })
  return candidate
}

const command = process.argv[2] ?? ''
const args = process.argv.slice(3)

if (command === '--help' || command === '-h' || command === '') {
  process.stdout.write(`${USAGE}\n`)
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${VERSION}\n`)
} else if (command === 'start') {
  const { createAgentStartPage } = await import('./agent-guide')
  process.stdout.write(createAgentStartPage())
} else if (command === 'guide' && args[0] === 'story') {
  const { createStoryGuide } = await import('../story/prompt')
  process.stdout.write(
    `把下面格式的 JSON 存成 output/games/<名稱>/<名稱>.spec.json（新動畫要用還不存在的資料夾名稱），再執行：
  scratch-ai-bridge story output/games/<名稱>/<名稱>.spec.json --playtest
.sb3 會產生在同一個資料夾；報告存在旁邊的 _過程/。
報告中的 feedback 每一行「→」後面就是修改建議；照著改完，加 --force 再執行一次。

${createStoryGuide()}
`,
  )
} else if (command === 'guide' && (args.length === 0 || args[0] === 'game')) {
  const { createGameSpecGuide } = await import('../spec/prompt')
  process.stdout.write(
    `把下面格式的 JSON 存成 output/games/<名稱>/<名稱>.spec.json（新遊戲要用還不存在的資料夾名稱），再執行：
  scratch-ai-bridge spec output/games/<名稱>/<名稱>.spec.json --playtest
.sb3 會產生在同一個資料夾；報告存在旁邊的 _過程/。
報告中的 feedback 每一行「→」後面就是修改建議；照著改完，加 --force 再執行一次。

${createGameSpecGuide()}
`,
  )
} else if (command === 'make') {
  const positionals: string[] = []
  const values: Record<string, string> = {}
  let playtest = false
  let force = false
  let thinking = false
  let story = false
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (['--out', '--spec-out', '--rounds', '--model', '--base-url'].includes(argument)) {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        argumentError = true
        break
      }
      values[argument] = value
      index += 1
    } else if (argument === '--playtest') playtest = true
    else if (argument === '--force') force = true
    else if (argument === '--thinking') thinking = true
    else if (argument === '--story') story = true
    else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }
  const rounds = Number(values['--rounds'] ?? '1')
  const request = positionals.join(' ').trim()
  if (argumentError || !request || !Number.isInteger(rounds) || rounds < 0 || rounds > 3) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    const { makeGame, modelConfigFromEnvironment } = await import('./make-command')
    const fromEnvironment = modelConfigFromEnvironment(process.env)
    const outputFile = values['--out']
    const model = values['--model']
    const report = await withStdoutOnStderr(() =>
      makeGame({
        request,
        kind: story ? 'story' : 'game',
        ...(outputFile ? { outputFile } : {}),
        ...(values['--spec-out'] ? { specOut: values['--spec-out'] } : {}),
        repairRounds: rounds,
        playtest,
        force,
        model: {
          ...fromEnvironment,
          ...(values['--base-url'] ? { baseUrl: values['--base-url'] } : {}),
          ...(model ? { model } : {}),
          noThinking: !thinking,
        },
        onProgress: (line) => process.stderr.write(`${line}\n`),
      }).catch((error: unknown) => ({
        format: 'scratch-ai-bridge/make' as const,
        version: 1 as const,
        status: 'failed' as const,
        playtestStatus: 'not-run' as const,
        unsupported: [],
        attempts: [],
        feedback: `[錯誤] ${error instanceof Error ? error.message : String(error)}`,
      })),
    )
    writeJson(report)
    if (report.status !== 'success' || report.playtestStatus === 'fail') process.exitCode = 1
  }
} else if (command === 'inspect') {
  const positionals: string[] = []
  let format = 'json'
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--format') {
      const value = args[index + 1]
      if (value !== 'json' && value !== 'markdown' && value !== 'student-markdown' && value !== 'ai-reader') {
        argumentError = true
        break
      }
      format = value
      index += 1
    } else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else {
      positionals.push(argument)
    }
  }

  if (argumentError || positionals.length !== 1) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    try {
      const bytes = await readFile(positionals[0] ?? '')
      if (format === 'ai-reader') {
        writeJson(await inspectSb3ForAiReader(bytes))
      } else {
        const result = await inspectSb3Bytes(bytes)
        if (format === 'markdown') process.stdout.write(`${inspectionToMarkdown(result)}\n`)
        else if (format === 'student-markdown') process.stdout.write(`${inspectionToStudentMarkdown(result)}\n`)
        else writeJson(result)
      }
    } catch {
      writeJson({
        format: 'scratch-ai-bridge/inspection-error',
        version: 1,
        status: 'failed',
        error: {
          code: 'inspect-failed',
          message: '無法讀取或解析這份 Scratch 專案；請確認檔案是有效的 .sb3。',
        },
      })
      process.exitCode = 1
    }
  }
} else if (command === 'fetch') {
  const positionals: string[] = []
  let outputDirectory: string | undefined
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out') {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        argumentError = true
        break
      }
      outputDirectory = value
      index += 1
    } else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }
  const source = positionals[0]
  const projectId = /(?:scratch\.mit\.edu\/projects\/)?(\d+)/.exec(source)?.[1]
  if (argumentError || positionals.length !== 1 || !projectId) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    try {
      const defaultDirectory = path.resolve('output', 'scratch', projectId)
      const directory = path.resolve(outputDirectory ?? defaultDirectory)
      const scriptCandidates = [
        path.resolve(process.cwd(), 'packages/scratch-ai-bridge/scripts/tools/fetch-scratch.mjs'),
        path.resolve(process.cwd(), 'scripts/tools/fetch-scratch.mjs'),
      ]
      const script = scriptCandidates.find((candidate) => existsSync(candidate))
      if (!script) throw new Error('找不到 Scratch 下載腳本。')
      execFileSync(process.execPath, [script, directory, projectId], { stdio: 'inherit' })
      const file = readdirSync(directory)
        .filter((name) => name.endsWith('.sb3'))
        .sort()
        .at(-1)
      if (!file) throw new Error('Scratch 沒有回傳可讀的 SB3 作品。')
      const bytes = readFileSync(path.join(directory, file))
      let metadata: { title?: unknown; instructions?: unknown; notes?: unknown } = {}
      try {
        const metadataPath = path.join(directory, file.replace(/\.sb3$/, '.json'))
        const parsed: unknown = JSON.parse(readFileSync(metadataPath, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) metadata = parsed
      } catch {
        // The SB3 remains useful when metadata was not written by the public fetcher.
      }
      writeJson({
        format: 'scratch-ai-bridge/fetch',
        version: 1,
        projectId,
        file: path.join(directory, file),
        reader: await inspectSb3ForAiReader(bytes, {
          ...(typeof metadata.title === 'string' ? { title: metadata.title } : {}),
          ...(typeof metadata.instructions === 'string' ? { authorInstructions: metadata.instructions } : {}),
          ...(typeof metadata.notes === 'string' ? { notesAndCredits: metadata.notes } : {}),
        }),
      })
    } catch (error) {
      writeJson({
        format: 'scratch-ai-bridge/fetch-error',
        version: 1,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      process.exitCode = 1
    }
  }
} else if (command === 'batch') {
  const positionals: string[] = []
  let outputDirectory: string | undefined
  let manifestPath: string | undefined
  let recursive = false
  let jobs = 1
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out' || argument === '--manifest' || argument === '--jobs') {
      const value = args[index + 1]
      if (!value) {
        argumentError = true
        break
      }
      if (argument === '--out') outputDirectory = value
      else if (argument === '--manifest') manifestPath = value
      else {
        jobs = Number(value)
        if (!Number.isInteger(jobs) || jobs < 1 || jobs > 2) argumentError = true
      }
      index += 1
    } else if (argument === '--recursive') recursive = true
    else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }

  if (argumentError || positionals.length !== 1) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    try {
      const inputDirectory = positionals[0] ?? ''
      const summary = await runBatch({
        inputDirectory,
        outputDirectory: outputDirectory ?? (await defaultReportDirectory(inputDirectory)),
        recursive,
        jobs,
        ...(manifestPath ? { manifestPath } : {}),
      })
      writeJson(summary)
      if (summary.partial > 0 || summary.failed > 0) process.exitCode = 1
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      const knownMessages: Record<string, string> = {
        'arguments-invalid': '批次參數無效。',
        'input-invalid': '輸入路徑必須是資料夾。',
        'output-path-invalid': '輸出資料夾不能位於輸入資料夾內。',
        'output-exists': '輸出資料夾已存在；請指定一個新的路徑。',
        'input-count-invalid': '找不到 SB3 檔，或檔案數超過 500 份上限。',
        'manifest-invalid': 'Manifest 格式、學生代碼或檔案路徑無效。',
      }
      writeJson({
        format: 'scratch-ai-bridge/batch-error',
        version: 1,
        status: 'failed',
        error: {
          code: knownMessages[code] ? code : 'batch-failed',
          message: knownMessages[code] ?? '無法完成批次分析；請確認路徑、權限和輸入資料。',
        },
      })
      process.exitCode =
        code === 'arguments-invalid' ||
        code === 'manifest-invalid' ||
        code === 'output-path-invalid' ||
        code === 'output-exists' ||
        code === 'input-count-invalid' ||
        code === 'input-invalid'
          ? 2
          : 3
    }
  }
} else if (command === 'spec') {
  const positionals: string[] = []
  const values: Record<string, string> = {}
  let playtest = false
  let force = false
  let offline = false
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out' || argument === '--ir' || argument === '--report' || argument === '--request') {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        argumentError = true
        break
      }
      values[argument] = value
      index += 1
    } else if (argument === '--playtest') playtest = true
    else if (argument === '--force') force = true
    else if (argument === '--offline') offline = true
    else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }
  if (argumentError || positionals.length !== 1) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    const { runSpecBuild } = await import('./spec-command')
    const outputFile = values['--out']
    const request = values['--request'] ? await readRequest(values['--request']) : undefined
    const report = await withStdoutOnStderr(() =>
      runSpecBuild({
        specPath: positionals[0] ?? '',
        ...(outputFile ? { outputFile } : {}),
        ...(values['--ir'] ? { irPath: values['--ir'] } : {}),
        ...(values['--report'] ? { reportPath: values['--report'] } : {}),
        ...(request ? { request } : {}),
        playtest,
        force,
        offline,
      }),
    )
    writeJson(report)
    if (report.status !== 'success' || report.playtestStatus === 'fail') process.exitCode = 1
  }
} else if (command === 'generate') {
  const positionals: string[] = []
  let outputFile: string | undefined
  let reportPath: string | undefined
  let previewPath: string | undefined
  let force = false
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out' || argument === '--report' || argument === '--preview') {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        argumentError = true
        break
      }
      if (argument === '--out') outputFile = value
      else if (argument === '--report') reportPath = value
      else previewPath = value
      index += 1
    } else if (argument === '--force') force = true
    else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }

  if (argumentError || positionals.length !== 1 || !outputFile) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    const { generateGame } = await import('./generator')
    const originalConsoleLog = console.log
    const originalConsoleWarn = console.warn
    const originalStdoutWrite = process.stdout.write.bind(process.stdout)
    console.log = (...values: unknown[]) => process.stderr.write(`${values.map(String).join(' ')}\n`)
    console.warn = (...values: unknown[]) => process.stderr.write(`${values.map(String).join(' ')}\n`)
    const redirectStdout: typeof process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]) =>
      (process.stderr.write as (...params: unknown[]) => boolean)(chunk, ...args)
    process.stdout.write = redirectStdout
    const inputPath = positionals[0] ?? ''
    let result
    try {
      result = await generateGame(inputPath, {
        outputFile,
        ...(reportPath ? { reportPath } : {}),
        ...(previewPath ? { previewPath } : {}),
        force,
      })
    } finally {
      console.log = originalConsoleLog
      console.warn = originalConsoleWarn
      process.stdout.write = originalStdoutWrite
    }
    writeJson(result)
    if (!result.success) process.exitCode = 1
  }
} else if (command === 'story') {
  const positionals: string[] = []
  let outputFile: string | undefined
  let request: string | undefined
  let playtest = false
  let force = false
  let offline = false
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out') {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        argumentError = true
        break
      }
      outputFile = value
      index += 1
    } else if (argument === '--request') {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        argumentError = true
        break
      }
      request = value
      index += 1
    } else if (argument === '--playtest') playtest = true
    else if (argument === '--force') force = true
    else if (argument === '--offline') offline = true
    else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }
  if (argumentError || positionals.length !== 1) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    const { runStoryBuild } = await import('./story-command')
    const requestValue = request ? await readRequest(request) : undefined
    const report = await withStdoutOnStderr(() =>
      runStoryBuild({
        specPath: positionals[0] ?? '',
        ...(outputFile ? { outputFile } : {}),
        ...(requestValue ? { request: requestValue } : {}),
        playtest,
        force,
        offline,
      }),
    )
    writeJson(report)
    if (report.status !== 'success' || report.playtestStatus === 'fail') process.exitCode = 1
  }
} else if (command === 'clean' && args.every((argument) => argument === '--all')) {
  const { cleanOutput, outputRoot } = await import('./output-layout')
  const removed = await cleanOutput(outputRoot(), args.includes('--all'))
  writeJson({ format: 'scratch-ai-bridge/clean', version: 1, status: 'success', removed })
} else {
  process.stderr.write(`${USAGE}\n`)
  process.exitCode = 2
}
