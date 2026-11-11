import { readFile } from 'node:fs/promises'
import { runBatch } from './batch'
import { inspectSb3Bytes, inspectionToMarkdown, inspectionToStudentMarkdown } from './inspect'

const VERSION = '0.1.0'
const USAGE = `Scratch AI Bridge CLI ${VERSION}

Which command?
  Make a new game from one sentence (a local model writes the spec):
    scratch-ai-bridge make "做一個接蘋果遊戲，左右鍵移動，接到加分" --out game.sb3 [--playtest]
  You are the AI and will write the Game Spec yourself:
    scratch-ai-bridge guide                       print the Game Spec format
    scratch-ai-bridge spec game.json --out game.sb3 --playtest
    Read "feedback" in the JSON report, fix the spec, run spec again.
  Analyse existing .sb3 files:
    scratch-ai-bridge inspect work.sb3 --format student-markdown
    scratch-ai-bridge batch ./class --out ./class-report
  Never hand-write project.json or .sb3 files.

Usage:
  scratch-ai-bridge make <request> --out <new-file.sb3> [--spec-out <spec.json>] [--rounds <0-3>] [--playtest] [--force]
                         [--model <id>] [--base-url <url>] [--thinking]
  scratch-ai-bridge guide
  scratch-ai-bridge spec <game-spec.json> --out <new-file.sb3> [--ir <canonical-ir.json>] [--report <report.json>] [--playtest] [--force]
  scratch-ai-bridge inspect <file.sb3> [--format json|markdown|student-markdown]
  scratch-ai-bridge batch <directory> --out <new-directory> [--recursive] [--manifest <file.csv|json>] [--jobs 1|2]
  scratch-ai-bridge generate <design.json> --out <new-file.sb3> [--report <report.json>] [--preview <stage.png>] [--force]
  scratch-ai-bridge --help
  scratch-ai-bridge --version

"make" reads SCRATCH_BRIDGE_MODEL_URL (default http://127.0.0.1:8000/v1), SCRATCH_BRIDGE_MODEL (default: first listed
model) and SCRATCH_BRIDGE_API_KEY (OMLX_ENDPOINT / OMLX_API_KEY also work). It repairs once by default (--rounds 1).
"spec" builds from a Game Spec (entities + behaviors + rules + text map; see docs/game-spec.md) and, with --playtest,
runs scenarios generated from the spec in the real Scratch preview (needs a built dist/).
"generate" accepts Canonical IR JSON or the documented GameDesign JSON shape. Pass --preview <stage.png> to run the
browser renderer; gameplay behavior requires a separate deterministic smoke test.`

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Scratch VM logs to stdout; keep stdout reserved for the JSON report while `task` runs.
 * @param task - Work that may load the VM.
 * @returns The task's result.
 */
const withStdoutOnStderr = async <T>(task: () => Promise<T>): Promise<T> => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalConsoleLog = console.log
  console.log = (...items: unknown[]) => process.stderr.write(`${items.map(String).join(' ')}\n`)
  const redirectStdout: typeof process.stdout.write = (chunk: string | Uint8Array, ...rest: unknown[]) =>
    (process.stderr.write as (...params: unknown[]) => boolean)(chunk, ...rest)
  process.stdout.write = redirectStdout
  try {
    return await task()
  } finally {
    process.stdout.write = originalStdoutWrite
    console.log = originalConsoleLog
  }
}

const command = process.argv[2] ?? ''
const args = process.argv.slice(3)

if (command === '--help' || command === '-h' || command === '') {
  process.stdout.write(`${USAGE}\n`)
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${VERSION}\n`)
} else if (command === 'guide') {
  const { createGameSpecGuide } = await import('../spec/prompt')
  process.stdout.write(
    `把下面格式的 JSON 存成檔案，再執行：scratch-ai-bridge spec <檔案.json> --out <新遊戲.sb3> --playtest
報告中的 feedback 每一行「→」後面就是修改建議；照著改完再執行一次。

${createGameSpecGuide()}
`,
  )
} else if (command === 'make') {
  const positionals: string[] = []
  const values: Record<string, string> = {}
  let playtest = false
  let force = false
  let thinking = false
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
    else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }
  const rounds = Number(values['--rounds'] ?? '1')
  const request = positionals.join(' ').trim()
  if (argumentError || !request || !values['--out'] || !Number.isInteger(rounds) || rounds < 0 || rounds > 3) {
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
        outputFile,
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
      if (value !== 'json' && value !== 'markdown' && value !== 'student-markdown') {
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
      const result = await inspectSb3Bytes(bytes)
      if (format === 'markdown') process.stdout.write(`${inspectionToMarkdown(result)}\n`)
      else if (format === 'student-markdown') process.stdout.write(`${inspectionToStudentMarkdown(result)}\n`)
      else writeJson(result)
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

  if (argumentError || positionals.length !== 1 || !outputDirectory) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    try {
      const summary = await runBatch({
        inputDirectory: positionals[0] ?? '',
        outputDirectory,
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
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--out' || argument === '--ir' || argument === '--report') {
      const value = args[index + 1]
      if (!value || value.startsWith('-')) {
        argumentError = true
        break
      }
      values[argument] = value
      index += 1
    } else if (argument === '--playtest') playtest = true
    else if (argument === '--force') force = true
    else if (argument.startsWith('-')) {
      argumentError = true
      break
    } else positionals.push(argument)
  }
  if (argumentError || positionals.length !== 1 || !values['--out']) {
    process.stderr.write(`${USAGE}\n`)
    process.exitCode = 2
  } else {
    const { runSpecBuild } = await import('./spec-command')
    const outputFile = values['--out']
    const report = await withStdoutOnStderr(() =>
      runSpecBuild({
        specPath: positionals[0] ?? '',
        outputFile,
        ...(values['--ir'] ? { irPath: values['--ir'] } : {}),
        ...(values['--report'] ? { reportPath: values['--report'] } : {}),
        playtest,
        force,
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
} else {
  process.stderr.write(`${USAGE}\n`)
  process.exitCode = 2
}
