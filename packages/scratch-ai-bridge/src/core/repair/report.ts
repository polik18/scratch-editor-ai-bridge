import type { AiDraftRepair, AiDraftWarning } from '../normalizer'
import type { CanonicalIRValidationIssue, CanonicalSemanticIssue } from '../validator'

export type RepairIssueSeverity = 'info' | 'warning' | 'error'
export type RepairIssueStatus = 'auto-repaired' | 'review' | 'must-fix'
export type RepairIssuePhase = 'parse' | 'normalize' | 'schema' | 'semantic' | 'compile'

export interface RepairIssue {
  readonly severity: RepairIssueSeverity
  readonly status: RepairIssueStatus
  readonly phase: RepairIssuePhase
  readonly code: string
  readonly path: string
  readonly opcode?: string
  readonly message: string
  readonly actual?: unknown
  readonly expected?: string
  readonly suggestion: string
  readonly example?: unknown
}

export interface RepairReport {
  readonly format: 'scratch-ai-bridge/repair-report'
  readonly version: 1
  readonly canonicalVersion: 1
  readonly projectName: string
  readonly summary: {
    readonly autoRepaired: number
    readonly errors: number
    readonly warnings: number
  }
  readonly issues: readonly RepairIssue[]
}

export interface CreateRepairReportOptions {
  readonly data?: unknown
  readonly repairs?: readonly AiDraftRepair[]
  readonly normalizationWarnings?: readonly AiDraftWarning[]
  readonly schemaIssues?: readonly CanonicalIRValidationIssue[]
  readonly semanticIssues?: readonly CanonicalSemanticIssue[]
  readonly parseError?: unknown
  readonly compileError?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pointerPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')

const decodePointerPart = (value: string): string => value.replaceAll('~1', '/').replaceAll('~0', '~')

const pointerValue = (data: unknown, path: string): unknown => {
  if (path === '' || path === '/') return undefined
  let current = data
  for (const rawPart of path.slice(1).split('/')) {
    const part = decodePointerPart(rawPart)
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
    } else if (isRecord(current)) {
      current = current[part]
    } else {
      return undefined
    }
  }
  return current
}

const opcodeAtPath = (data: unknown, path: string): string | undefined => {
  if (!path.startsWith('/')) return undefined
  const parts = path.slice(1).split('/')
  while (parts.length > 0) {
    const value = pointerValue(data, `/${parts.join('/')}`)
    if (isRecord(value) && typeof value.opcode === 'string') return value.opcode
    parts.pop()
  }
  return undefined
}

const sanitizeSensitiveText = (value: string): string =>
  value.replaceAll(/\/Users\/[^\s"'`]+/g, '[local path]').replaceAll(/[A-Za-z]:\\[^\s"'`]+/g, '[local path]')

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeSensitiveText(message)
}

const schemaPath = (issue: CanonicalIRValidationIssue): string => {
  if (issue.keyword !== 'required' || typeof issue.params.missingProperty !== 'string') {
    return issue.instancePath || '/'
  }
  return `${issue.instancePath}/${pointerPart(issue.params.missingProperty)}`
}

const schemaExpectation = (issue: CanonicalIRValidationIssue): string => {
  if (issue.keyword === 'required' && typeof issue.params.missingProperty === 'string') {
    return `required property ${issue.params.missingProperty}`
  }
  if (issue.keyword === 'type' && typeof issue.params.type === 'string') return `type=${issue.params.type}`
  if (issue.keyword === 'const' && 'allowedValue' in issue.params) {
    return `const=${JSON.stringify(issue.params.allowedValue)}`
  }
  if (issue.keyword === 'enum' && Array.isArray(issue.params.allowedValues)) {
    return `one of ${issue.params.allowedValues.map(String).join(', ')}`
  }
  return `Canonical IR schema keyword=${issue.keyword}`
}

const semanticSuggestion = (issue: CanonicalSemanticIssue): string => {
  const suggestions: Readonly<Record<string, string>> = {
    'condition-not-boolean':
      '改用 operator_equals、operator_gt、operator_lt 或其他 shape=boolean reporter 表達明確條件',
    'boolean-input-type': '將此 input 改成 shape=boolean 的 reporter block',
    'broadcast-input-type': '使用 {"type":"broadcast","name":"..."} input，並在 broadcasts 宣告同名廣播',
    'hat-not-first': '把事件 hat 移到 script 的第一個 block，或拆成另一個 script',
    'hat-not-top-level': '事件 hat 只能位於 script 第一層的第一個 block',
    'input-block-shape': '改用 reporter 或 boolean shape 的積木作為 input',
    'input-kind': '依 capability registry 改用 literal 或 reporter input',
    'invalid-field-value': '改用 capability registry 列出的 field 值',
    'missing-field': '依 capability registry 補上必要 field，且 field 值必須是純量',
    'missing-input': '依 capability registry 補上必要 Canonical input union 物件',
    'substack-type': '使用 {"type":"stack","blocks":[...]}',
    'target-not-supported': '將積木移至 capability registry 允許的 stage 或 sprite target',
    'unknown-broadcast': '在根層 broadcasts 加入同名 {"name":"..."} 宣告，或修正拼字',
    'unknown-field': '移除 capability registry 未定義的 field，或改用正確 field 名稱',
    'unknown-input': '移除 capability registry 未定義的 input，或改用正確 input 名稱',
    'unknown-list': '在目前 target 或 stage 宣告同名清單，或修正拼字',
    'unknown-opcode': '改用 capability registry 支援的 opcode；沒有安全替代時請簡化功能',
    'unknown-sprite': '將碰撞目標改成既有角色名稱、_edge_ 或 _mouse_',
    'unknown-variable': '在目前 target 或 stage 宣告同名變數，或修正拼字',
  }
  return suggestions[issue.code] ?? '依錯誤訊息與 capability registry 修正此項目'
}

const schemaSuggestion = (issue: CanonicalIRValidationIssue): string => {
  if (issue.keyword === 'required') return '補上必要欄位，並依 Canonical IR schema 使用正確資料形狀'
  if (issue.keyword === 'additionalProperties') return '移除 schema 未定義的欄位'
  if (issue.keyword === 'type') return '將值改成 expected 指定的資料型別'
  return '依 Canonical IR schema 修正此值'
}

const deduplicateIssues = (issues: readonly RepairIssue[]): RepairIssue[] => {
  const unique = new Map<string, RepairIssue>()
  for (const issue of issues) {
    const key = `${issue.status}:${issue.code}:${issue.path}`
    if (!unique.has(key)) unique.set(key, issue)
  }
  return [...unique.values()]
}

/**
 * Convert parser, normalizer, schema, semantic, and compiler diagnostics into a stable user-safe report.
 * @param options Diagnostic sources collected while processing AI-authored input.
 * @returns A serializable Repair Report v1.
 */
export const createRepairReport = (options: CreateRepairReportOptions): RepairReport => {
  const data = options.data
  const issues: RepairIssue[] = []

  for (const repair of options.repairs ?? []) {
    issues.push({
      severity: 'info',
      status: 'auto-repaired',
      phase: 'normalize',
      code: repair.code,
      path: repair.path || '/',
      message: repair.message,
      suggestion: 'Bridge 已安全套用此結構修復，不需要 AI 再次修改',
    })
  }

  for (const issue of options.schemaIssues ?? []) {
    const path = schemaPath(issue)
    const actual = pointerValue(data, path)
    issues.push({
      severity: 'error',
      status: 'must-fix',
      phase: 'schema',
      code: `schema-${issue.keyword}`,
      path,
      message: issue.message,
      ...(actual === undefined ? {} : { actual }),
      expected: schemaExpectation(issue),
      suggestion: schemaSuggestion(issue),
    })
  }

  for (const issue of options.semanticIssues ?? []) {
    const actual = pointerValue(data, issue.path)
    const opcode = opcodeAtPath(data, issue.path)
    issues.push({
      severity: issue.severity,
      status: issue.severity === 'error' ? 'must-fix' : 'review',
      phase: 'semantic',
      code: issue.code,
      path: issue.path || '/',
      ...(opcode ? { opcode } : {}),
      message: issue.message,
      ...(actual === undefined ? {} : { actual }),
      suggestion: semanticSuggestion(issue),
    })
  }

  for (const warning of options.normalizationWarnings ?? []) {
    const actual = pointerValue(data, warning.path)
    issues.push({
      severity: 'warning',
      status: 'review',
      phase: 'normalize',
      code: warning.code,
      path: warning.path || '/',
      message: warning.message,
      ...(actual === undefined ? {} : { actual }),
      suggestion: '請依原始遊戲意圖確認此項目，並改成明確的 Canonical IR 表達方式',
    })
  }

  if (options.parseError !== undefined) {
    issues.push({
      severity: 'error',
      status: 'must-fix',
      phase: 'parse',
      code: 'parse-no-canonical-json',
      path: '/',
      message: errorMessage(options.parseError),
      expected: 'one complete scratch-ai-bridge/canonical-ir v1 JSON root object',
      suggestion: '只回傳一個完整 Canonical IR JSON 根物件，不要 Markdown、Python、說明或多個候選版本',
    })
  }

  if (options.compileError !== undefined) {
    issues.push({
      severity: 'error',
      status: 'must-fix',
      phase: 'compile',
      code: 'compile-failed',
      path: '/',
      message: errorMessage(options.compileError),
      expected: 'project accepted by the Scratch VM compiler',
      suggestion: '保留專案結構，依錯誤訊息修正無法編譯的積木或素材資料',
    })
  }

  const uniqueIssues = deduplicateIssues(issues)
  const projectName = isRecord(data) && typeof data.name === 'string' ? data.name : 'Untitled Scratch Project'
  return {
    format: 'scratch-ai-bridge/repair-report',
    version: 1,
    canonicalVersion: 1,
    projectName,
    summary: {
      autoRepaired: uniqueIssues.filter((issue) => issue.status === 'auto-repaired').length,
      errors: uniqueIssues.filter((issue) => issue.status === 'must-fix').length,
      warnings: uniqueIssues.filter((issue) => issue.status === 'review').length,
    },
    issues: uniqueIssues,
  }
}

/**
 * Build text that can be pasted directly into an AI chat to request a complete corrected project.
 * @param report Complete machine-readable diagnostics.
 * @param currentProject Current normalized project, or raw input when parsing failed.
 * @param capabilityGuide Current Canonical IR authoring contract.
 * @returns Plain text without Markdown fences.
 */
export const createRepairPrompt = (
  report: RepairReport,
  currentProject: unknown,
  capabilityGuide: string,
): string => {
  const serializedProject =
    typeof currentProject === 'string'
      ? sanitizeSensitiveText(currentProject)
      : JSON.stringify(currentProject, null, 2)
  return `你正在修正 Scratch AI Bridge Canonical IR v1。
只回傳一個完整 JSON 根物件，不要 Markdown、Python、說明、patch 或多個候選版本。
保留目前角色、素材名稱與未被錯誤指出的遊戲邏輯；不要杜撰 capability registry 以外的 opcode。

修正規則：
1. 逐項處理 must-fix。
2. review 項目要依原遊戲意圖改成明確布林 reporter 或合法 Canonical IR。
3. fields 值必須是純量；inputs 必須使用 Canonical input union。
4. 回傳完整專案，不可只回傳修改片段。

可用能力與格式規則：
${capabilityGuide}

Repair Report:
${JSON.stringify(report, null, 2)}

Current Canonical IR:
${serializedProject}`
}
