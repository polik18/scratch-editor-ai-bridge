/**
 * Syntax repair for JSON written by chat models. Students copy replies by hand, and a stray comma or comment would
 * otherwise cost a whole round trip to the AI just to fix punctuation. Only punctuation and quoting change; values
 * are never invented, except `null` for a key whose value was cut off.
 */

export interface JsonRepairResult {
  readonly text: string
  /** What was changed, in plain Chinese, once per kind; empty when the text was already valid. */
  readonly fixes: readonly string[]
}

const FIX = {
  comment: '刪掉 JSON 不允許的註解',
  trailingComma: '刪掉結尾多餘的逗號',
  missingComma: '補上漏掉的逗號',
  singleQuote: '單引號改成雙引號',
  controlCharacter: '字串中直接換行的地方改成 \\n',
  pythonLiteral: 'True／False／None 改成 true／false／null',
  truncated: '回覆被截斷，已補上結尾的括號（後面的內容沒有收到）',
} as const

const ESCAPES: Partial<Record<string, string>> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
const PYTHON: Partial<Record<string, string>> = { True: 'true', False: 'false', None: 'null' }

/**
 * @param source - Text that should be one JSON value.
 * @returns Repaired JSON text and the kinds of changes made.
 */
export const repairJson = (source: string): JsonRepairResult => {
  const fixes = new Set<string>()
  const stack: string[] = []
  let out = ''
  // True right after a complete value, when the next value or key needs a comma before it.
  let afterValue = false

  const dropTrailingComma = (): void => {
    const trimmed = out.trimEnd()
    if (trimmed.endsWith(',')) {
      out = trimmed.slice(0, -1)
      fixes.add(FIX.trailingComma)
    }
  }
  const startValue = (): void => {
    if (afterValue) {
      out += ','
      fixes.add(FIX.missingComma)
    }
  }

  let index = 0
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      index = end < 0 ? source.length : end
      fixes.add(FIX.comment)
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      fixes.add(FIX.comment)
      continue
    }

    if (char === '"' || char === "'") {
      startValue()
      if (char === "'") fixes.add(FIX.singleQuote)
      out += '"'
      index += 1
      let closed = false
      while (index < source.length) {
        const inner = source[index]
        if (inner === '\\') {
          const escaped = source[index + 1] ?? ''
          // \' is not a JSON escape; a single quote needs none inside double quotes.
          out += escaped === "'" ? "'" : `\\${escaped}`
          index += 2
          continue
        }
        if (inner === char) {
          closed = true
          index += 1
          break
        }
        if (inner === '"') out += '\\"'
        else if (ESCAPES[inner]) {
          out += ESCAPES[inner]
          fixes.add(FIX.controlCharacter)
        } else out += inner
        index += 1
      }
      out += '"'
      if (!closed) fixes.add(FIX.truncated)
      afterValue = true
      continue
    }

    if (char === '{' || char === '[') {
      startValue()
      stack.push(char === '{' ? '}' : ']')
      out += char
      afterValue = false
      index += 1
      continue
    }
    if (char === '}' || char === ']') {
      dropTrailingComma()
      if (stack.at(-1) === char) stack.pop()
      out += char
      afterValue = true
      index += 1
      continue
    }
    if (char === ',' || char === ':') {
      out += char
      afterValue = false
      index += 1
      continue
    }

    const word = /^[-+\w.]+/.exec(source.slice(index))?.[0]
    if (word) {
      startValue()
      const python = PYTHON[word]
      if (python) fixes.add(FIX.pythonLiteral)
      out += python ?? word
      afterValue = true
      index += word.length
      continue
    }

    out += char
    index += 1
  }

  if (stack.length > 0) {
    const trimmed = out.trimEnd()
    if (trimmed.endsWith(':')) out = `${trimmed} null`
    dropTrailingComma()
    out += stack.reverse().join('')
    fixes.add(FIX.truncated)
  }
  return { text: out, fixes: [...fixes] }
}
