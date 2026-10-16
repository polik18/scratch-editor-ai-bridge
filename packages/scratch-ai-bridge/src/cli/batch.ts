import { readdir, readFile, lstat, mkdir, rename, rm, writeFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inspectSb3Bytes, inspectionToMarkdown, type CliInspection } from './inspect'

interface ManifestRow {
  readonly studentId: string
  readonly file: string
}

interface BatchRecord {
  readonly studentId: string
  readonly status: 'ok' | 'partial' | 'failed'
  readonly inspection?: CliInspection
  readonly error?: { readonly code: string; readonly message: string }
}

const MAX_BATCH_FILES = 500
const isWithin = (parent: string, child: string): boolean => child === parent || child.startsWith(`${parent}${sep}`)

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index)
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') quoted = false
      else cell += character
    } else if (character === '"' && cell.length === 0) quoted = true
    else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  if (quoted) throw new Error('manifest-invalid')
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  if (rows.length === 0) throw new Error('manifest-invalid')
  const headerRow = rows.at(0)
  if (!headerRow) throw new Error('manifest-invalid')
  const headers = headerRow.map((header) => header.trim())
  const idIndex = headers.indexOf('studentId')
  const fileIndex = headers.indexOf('file')
  if (idIndex < 0 || fileIndex < 0) throw new Error('manifest-invalid')
  return rows.slice(1).map((values) => [values[idIndex] ?? '', values[fileIndex] ?? ''])
}

const readManifest = async (manifestPath: string): Promise<ManifestRow[]> => {
  const source = (await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, '')
  let rows: unknown
  try {
    rows =
      extname(manifestPath).toLowerCase() === '.csv'
        ? parseCsv(source).map(([studentId, file]) => ({ studentId, file }))
        : JSON.parse(source)
  } catch {
    throw new Error('manifest-invalid')
  }
  let entries: unknown[] | null = null
  if (Array.isArray(rows)) entries = rows
  else if (rows && typeof rows === 'object' && 'files' in rows && Array.isArray(rows.files)) entries = rows.files
  if (!entries) throw new Error('manifest-invalid')
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || !('studentId' in entry) || !('file' in entry)) {
      throw new Error('manifest-invalid')
    }
    const studentId = entry.studentId
    const file = entry.file
    if (
      typeof studentId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(studentId) ||
      typeof file !== 'string' ||
      file.length === 0
    ) {
      throw new Error('manifest-invalid')
    }
    return { studentId, file }
  })
}

const scanSb3Files = async (directory: string, recursive: boolean): Promise<string[]> => {
  const output: string[] = []
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (recursive) await visit(path)
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.sb3') output.push(path)
    }
  }
  await visit(directory)
  return output.sort((left, right) => relative(directory, left).localeCompare(relative(directory, right), 'en'))
}

const csvCell = (value: string | number): string => {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const summarize = (records: readonly BatchRecord[]) => {
  const scores = records
    .flatMap((record) =>
      record.inspection?.score.total === null || !record.inspection ? [] : [record.inspection.score.total],
    )
    .sort((a, b) => a - b)
  const median = (() => {
    if (scores.length === 0) return null
    const lowerIndex = Math.floor((scores.length - 1) / 2)
    const upperIndex = Math.floor(scores.length / 2)
    const lower = scores[lowerIndex] ?? 0
    const upper = scores[upperIndex] ?? lower
    return (lower + upper) / 2
  })()
  return {
    format: 'scratch-ai-bridge/class-summary',
    version: 1,
    rubricVersion: 'sb3-static-v2',
    total: records.length,
    ok: records.filter(({ status }) => status === 'ok').length,
    partial: records.filter(({ status }) => status === 'partial').length,
    failed: records.filter(({ status }) => status === 'failed').length,
    score: {
      scored: scores.length,
      mean: scores.length
        ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
        : null,
      median,
      min: scores.length ? scores[0] : null,
      max: scores.length ? scores.at(-1) : null,
    },
    records: records.map(({ studentId, status, inspection, error }) => ({
      studentId,
      status,
      ...(inspection ? { score: inspection.score.total, coverage: inspection.score.coverage } : {}),
      ...(error ? { error: error.code } : {}),
    })),
    limitations: [
      '分數是 SB3 靜態結構估分，不代表 Scratch 執行結果、創意、美感、理解程度或 FPS。',
      '本批次沒有載入或執行 Scratch extension、硬體或線上服務。',
    ],
  }
}

/**
 * Analyze a directory of SB3 projects and atomically publish anonymized reports.
 * @param options Batch paths and concurrency controls.
 * @param options.inputDirectory Directory containing SB3 projects.
 * @param options.outputDirectory New directory for reports.
 * @param options.recursive Whether to scan subdirectories.
 * @param options.jobs Number of files to inspect concurrently.
 * @param options.manifestPath Optional manifest mapping student IDs to relative file paths.
 * @returns An anonymized class summary.
 */
export const runBatch = async (options: {
  readonly inputDirectory: string
  readonly outputDirectory: string
  readonly recursive: boolean
  readonly jobs: number
  readonly manifestPath?: string
}): Promise<ReturnType<typeof summarize>> => {
  if (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 2) throw new Error('arguments-invalid')
  const inputDirectory = await realpath(options.inputDirectory)
  const inputStat = await lstat(inputDirectory)
  if (!inputStat.isDirectory()) throw new Error('input-invalid')
  const outputParent = await realpath(dirname(resolve(options.outputDirectory)))
  const outputDirectory = join(outputParent, basename(resolve(options.outputDirectory)))
  if (isWithin(inputDirectory, outputDirectory)) throw new Error('output-path-invalid')
  try {
    await lstat(outputDirectory)
    throw new Error('output-exists')
  } catch (error) {
    if (error instanceof Error && error.message !== 'output-exists' && 'code' in error && error.code !== 'ENOENT')
      throw error
    if (error instanceof Error && error.message === 'output-exists') throw error
  }

  const files = await scanSb3Files(inputDirectory, options.recursive)
  if (files.length === 0 || files.length > MAX_BATCH_FILES) throw new Error('input-count-invalid')
  let idByPath = new Map<string, string>()
  if (options.manifestPath) {
    const manifest = await readManifest(options.manifestPath)
    const ids = new Set<string>()
    for (const row of manifest) {
      const normalized = row.file.replaceAll('\\', '/')
      if (isAbsolute(normalized) || normalized.split('/').includes('..')) throw new Error('manifest-invalid')
      const target = resolve(inputDirectory, normalized)
      if (
        !isWithin(inputDirectory, target) ||
        !files.includes(target) ||
        ids.has(row.studentId) ||
        idByPath.has(target)
      ) {
        throw new Error('manifest-invalid')
      }
      ids.add(row.studentId)
      idByPath.set(target, row.studentId)
    }
    if (idByPath.size !== files.length) throw new Error('manifest-invalid')
  } else {
    idByPath = new Map(files.map((file, index) => [file, `S${String(index + 1).padStart(4, '0')}`]))
  }

  const temporaryDirectory = `${outputDirectory}.tmp-${process.pid}`
  await mkdir(temporaryDirectory, { mode: 0o700 })
  const records: (BatchRecord | undefined)[] = new Array<BatchRecord | undefined>(files.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= files.length) return
      const file = files[index]
      const studentId = idByPath.get(file)
      if (studentId === undefined) throw new Error('manifest-invalid')
      try {
        const inspection = await inspectSb3Bytes(await readFile(file))
        records[index] = { studentId, status: inspection.status, inspection }
      } catch {
        records[index] = {
          studentId,
          status: 'failed',
          error: { code: 'inspect-failed', message: '無法讀取或解析這份 Scratch 專案。' },
        }
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(options.jobs, files.length) }, worker))
    const completeRecords = records.flatMap((record) => (record ? [record] : []))
    const summary = summarize(completeRecords)
    const jsonl =
      completeRecords
        .map((record) =>
          JSON.stringify({
            format: 'scratch-ai-bridge/batch-record',
            version: 1,
            studentId: record.studentId,
            status: record.status,
            ...(record.inspection ? { inspection: record.inspection } : { error: record.error }),
          }),
        )
        .join('\n') + '\n'
    await writeFile(join(temporaryDirectory, 'results.jsonl'), jsonl, { encoding: 'utf8', mode: 0o600 })
    for (const record of completeRecords) {
      const filename = `${record.studentId}`
      const output = record.inspection
        ? JSON.stringify({ studentId: record.studentId, ...record.inspection }, null, 2)
        : JSON.stringify({ studentId: record.studentId, status: 'failed', error: record.error }, null, 2)
      await writeFile(join(temporaryDirectory, `${filename}.json`), `${output}\n`, { encoding: 'utf8', mode: 0o600 })
      const markdown = record.inspection
        ? inspectionToMarkdown(record.inspection)
        : `# Scratch 作品分析\n\n分析失敗：${record.error?.message ?? '無法解析作品。'}\n`
      await writeFile(join(temporaryDirectory, `${filename}.md`), markdown, { encoding: 'utf8', mode: 0o600 })
    }
    await writeFile(join(temporaryDirectory, 'class-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    const csv =
      [
        ['studentId', 'status', 'score', 'coverage'].join(','),
        ...completeRecords.map((record) =>
          [
            record.studentId,
            record.status,
            record.inspection?.score.total ?? '',
            record.inspection?.score.coverage ?? '',
          ]
            .map(csvCell)
            .join(','),
        ),
      ].join('\n') + '\n'
    await writeFile(join(temporaryDirectory, 'scores.csv'), csv, { encoding: 'utf8', mode: 0o600 })
    const privateMap =
      [
        ['studentId', 'relativeFile'],
        ...files.map((file, index) => [idByPath.get(file) ?? `S${index + 1}`, relative(inputDirectory, file)]),
      ]
        .map((row) => row.map(csvCell).join(','))
        .join('\n') + '\n'
    await writeFile(join(temporaryDirectory, 'PRIVATE-teacher-source-map.csv'), privateMap, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryDirectory, outputDirectory)
    return summary
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}
