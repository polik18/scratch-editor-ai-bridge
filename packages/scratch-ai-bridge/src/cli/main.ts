import { readFile } from 'node:fs/promises'
import { runBatch } from './batch'
import { inspectSb3Bytes, inspectionToMarkdown } from './inspect'

const VERSION = '0.1.0'
const USAGE = `Scratch AI Bridge CLI ${VERSION}

Usage:
  scratch-ai-bridge inspect <file.sb3> [--format json|markdown]
  scratch-ai-bridge batch <directory> --out <new-directory> [--recursive] [--manifest <file.csv|json>] [--jobs 1|2]
  scratch-ai-bridge --help
  scratch-ai-bridge --version

This CLI analyzes SB3 structure locally. It does not run Scratch projects or extensions.`

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const command = process.argv[2] ?? ''
const args = process.argv.slice(3)

if (command === '--help' || command === '-h' || command === '') {
  process.stdout.write(`${USAGE}\n`)
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${VERSION}\n`)
} else if (command === 'inspect') {
  const positionals: string[] = []
  let format = 'json'
  let argumentError = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--format') {
      const value = args[index + 1]
      if (value !== 'json' && value !== 'markdown') {
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
} else {
  process.stderr.write(`${USAGE}\n`)
  process.exitCode = 2
}
