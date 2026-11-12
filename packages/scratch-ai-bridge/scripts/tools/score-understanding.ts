/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Corpus fixtures are deliberately permissive because model replies may be malformed. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

interface Control {
  readonly input: string
  readonly action?: string
}

interface Answer {
  readonly controls: readonly Control[]
  readonly goal: string
  readonly keywords: readonly string[]
}

interface ScoreRow {
  readonly name: string
  readonly controlScore: number | null
  readonly goalScore: number
  readonly passed: boolean
  readonly error?: string
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const normalizeInput = (value: string): string => {
  const compact = value
    .trim()
    .toLocaleLowerCase('zh-TW')
    .replace(/[\s，。、「」『』（）()_-]+/g, '')
  if (/^(←→|左右鍵|左右方向鍵|左右方向鍵|左\/右方向鍵|ad鍵|ad按鍵)$/.test(compact)) return '左右方向鍵'
  if (/^(↑↓|上下鍵|上下方向鍵|上下方向鍵|ws鍵|ws按鍵)$/.test(compact)) return '上下方向鍵'
  if (/^(方向鍵|上下左右|wasd|wasd鍵)$/.test(compact)) return '方向鍵'
  if (/^(space|空白|空白鍵|空白按鍵)$/.test(compact)) return '空白鍵'
  if (/^(滑鼠移動|移動滑鼠|跟著滑鼠)$/.test(compact)) return '滑鼠移動'
  if (/^(點擊|點選|按滑鼠|滑鼠左鍵|滑鼠拖曳|滑鼠點擊)$/.test(compact)) return '滑鼠點擊'
  if (/^(enter|回車|輸入鍵)$/.test(compact)) return 'Enter鍵'
  if (/^(綠旗|綠旗子|按綠旗開始|按綠旗)$/.test(compact)) return '綠旗'
  const letter = /^(?:([a-z])(?:鍵|按鍵)?|數字([0-9])(?:鍵|按鍵)?)$/.exec(compact)
  if (letter) return `${(letter[1] ?? letter[2]).toUpperCase()}鍵`
  return value.trim().toLocaleUpperCase('zh-TW').replace(/\s+/g, '')
}

const controlsMatch = (expected: string, actual: string): boolean => {
  if (expected === actual) return true
  if (expected === '方向鍵') return actual === '左右方向鍵' || actual === '上下方向鍵'
  if (actual === '方向鍵') return expected === '左右方向鍵' || expected === '上下方向鍵'
  return false
}

const readAnswer = (file: string): Answer => {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const record = asRecord(parsed)
  if (
    !record ||
    !Array.isArray(record.controls) ||
    typeof record.goal !== 'string' ||
    !Array.isArray(record.keywords)
  )
    throw new Error('缺少 controls、goal 或 keywords')
  const controls = record.controls.map((item) => {
    const control = asRecord(item)
    if (
      !control ||
      typeof control.input !== 'string' ||
      (control.action !== undefined && typeof control.action !== 'string')
    )
      throw new Error('controls 內有無效項目')
    return { input: control.input, ...(typeof control.action === 'string' ? { action: control.action } : {}) }
  })
  const keywords = record.keywords.map((keyword) => {
    if (typeof keyword !== 'string' || !keyword.trim()) throw new Error('keywords 內有無效項目')
    return keyword
  })
  return { controls, goal: record.goal, keywords }
}

const readReply = (file: string): { controls: readonly Control[]; goal: string } => {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const record = asRecord(parsed)
  if (!record || !Array.isArray(record.controls) || typeof record.goal !== 'string')
    throw new Error('缺少 controls 或 goal')
  const controls = record.controls.map((item) => {
    const control = asRecord(item)
    if (!control || typeof control.input !== 'string') throw new Error('controls 內有無效項目')
    return { input: control.input, ...(typeof control.action === 'string' ? { action: control.action } : {}) }
  })
  return { controls, goal: record.goal }
}

const scoreOne = (answerFile: string, replyFile: string): ScoreRow => {
  const name = basename(answerFile, '.answer.json')
  let answer: Answer
  let reply: { controls: readonly Control[]; goal: string }
  try {
    answer = readAnswer(answerFile)
    if (!existsSync(replyFile)) throw new Error('找不到 AI 回答檔')
    reply = readReply(replyFile)
  } catch (error) {
    return {
      name,
      controlScore: null,
      goalScore: 0,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const expectedInputs = answer.controls.map((control) => normalizeInput(control.input))
  const actualInputs = reply.controls.map((control) => normalizeInput(control.input))
  const matched = expectedInputs.filter((expected) =>
    actualInputs.some((actual) => controlsMatch(expected, actual)),
  ).length
  const controlScore = expectedInputs.length === 0 ? null : matched / expectedInputs.length
  const goalText = reply.goal.toLocaleLowerCase('zh-TW')
  const goalScore =
    answer.keywords.length === 0
      ? 0
      : answer.keywords.filter((keyword) => goalText.includes(keyword.toLocaleLowerCase('zh-TW'))).length /
        answer.keywords.length
  return { name, controlScore, goalScore, passed: controlScore === null || controlScore >= 0.8 }
}

const main = (): void => {
  const [answersDirectory, repliesDirectory] = process.argv.slice(2)
  if (!answersDirectory || !repliesDirectory)
    throw new Error('用法：score-understanding.ts <標準答案資料夾> <AI 回答資料夾>')
  const answerFiles = readdirSync(resolve(answersDirectory))
    .filter((file) => file.endsWith('.answer.json'))
    .sort()
  const rows = answerFiles.map((file) =>
    scoreOne(
      join(resolve(answersDirectory), file),
      join(resolve(repliesDirectory), file.replace(/\.answer\.json$/, '.reply.json')),
    ),
  )
  const measured = rows.filter((row) => row.controlScore !== null)
  const passed = measured.filter((row) => row.passed).length
  const output = {
    files: rows.length,
    controlMeasured: measured.length,
    controlPasses: passed,
    controlPassRate: measured.length === 0 ? null : passed / measured.length,
    rows,
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

void main()
/* eslint-enable @typescript-eslint/no-unnecessary-condition */
