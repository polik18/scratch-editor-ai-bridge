import { getBlockCapability } from '../capabilities'
import canonicalSchema from '../ir/schema.json'
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

export interface RepeatedRepairIssue {
  readonly phase: RepairIssuePhase
  readonly code: string
  readonly path: string
  readonly previousFingerprint: string
  readonly currentFingerprint: string
}

const issueFingerprint = (issue: RepairIssue): string =>
  JSON.stringify([issue.phase, issue.code, issue.path, issue.opcode ?? ''])

export const findRepeatedRepairIssues = (
  previous: RepairReport | undefined,
  current: RepairReport,
): RepeatedRepairIssue[] => {
  if (!previous) return []
  const prior = new Map(previous.issues.map((issue) => [issueFingerprint(issue), issue]))
  return current.issues.flatMap((issue) => {
    const currentFingerprint = issueFingerprint(issue)
    const previousIssue = prior.get(currentFingerprint)
    if (!previousIssue) return []
    return [
      {
        phase: issue.phase,
        code: issue.code,
        path: issue.path,
        previousFingerprint: issueFingerprint(previousIssue),
        currentFingerprint,
      },
    ]
  })
}

export interface CreateRepairReportOptions {
  readonly data?: unknown
  readonly repairs?: readonly AiDraftRepair[]
  readonly normalizationWarnings?: readonly AiDraftWarning[]
  readonly schemaIssues?: readonly CanonicalIRValidationIssue[]
  readonly semanticIssues?: readonly CanonicalSemanticIssue[]
  readonly parseError?: unknown
  readonly normalizationError?: unknown
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
  if (issue.keyword === 'additionalProperties' && typeof issue.params.additionalProperty === 'string') {
    return `${issue.instancePath}/${pointerPart(issue.params.additionalProperty)}`
  }
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
  if (
    [
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
    ].includes(issue.keyword) &&
    typeof issue.params.limit === 'number'
  ) {
    const operator: Readonly<Record<string, string>> = {
      exclusiveMaximum: '<',
      exclusiveMinimum: '>',
      maxItems: '≤ items',
      maxLength: '≤ characters',
      maximum: '≤',
      minItems: '≥ items',
      minLength: '≥ characters',
      minimum: '≥',
    }
    return `${operator[issue.keyword]} ${issue.params.limit}`
  }
  if (issue.keyword === 'const' && 'allowedValue' in issue.params) {
    return `const=${JSON.stringify(issue.params.allowedValue)}`
  }
  if (issue.keyword === 'enum' && Array.isArray(issue.params.allowedValues)) {
    return `one of ${issue.params.allowedValues.map(String).join(', ')}`
  }
  return `Canonical IR schema keyword=${issue.keyword}`
}

type SchemaNode = Record<string, unknown>

const asSchemaNode = (value: unknown): SchemaNode | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as SchemaNode) : undefined

const schemaRoot = canonicalSchema as SchemaNode

const schemaValueAtPointer = (pointer: string): unknown => {
  if (!pointer.startsWith('#/')) return undefined
  let current: unknown = schemaRoot
  for (const part of pointer.slice(2).split('/')) {
    const key = decodePointerPart(part)
    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
    } else {
      current = asSchemaNode(current)?.[key]
    }
    if (current === undefined) return undefined
  }
  return current
}

const resolveSchemaNode = (input: unknown, depth = 0): SchemaNode | undefined => {
  if (depth > 32) return undefined
  const node = asSchemaNode(input)
  if (!node) return undefined
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    let resolved: unknown = schemaRoot
    for (const part of node.$ref.slice(2).split('/')) resolved = asSchemaNode(resolved)?.[decodePointerPart(part)]
    return resolveSchemaNode(resolved, depth + 1)
  }
  return node
}

const schemaNodeForValue = (input: unknown, value: unknown): SchemaNode | undefined => {
  const node = resolveSchemaNode(input)
  if (!node) return undefined
  const branches = Array.isArray(node.oneOf) ? node.oneOf : Array.isArray(node.anyOf) ? node.anyOf : undefined
  if (!branches) return node
  for (const branch of branches) {
    const candidate = resolveSchemaNode(branch)
    if (!candidate) continue
    const properties = asSchemaNode(candidate.properties)
    if (asSchemaNode(value) && properties) {
      const discriminator = Object.entries(properties).find(([, property]) => {
        const propertyNode = asSchemaNode(property)
        return propertyNode && Object.hasOwn(propertyNode, 'const')
      })
      if (
        discriminator &&
        (value as Record<string, unknown>)[discriminator[0]] === asSchemaNode(properties[discriminator[0]])?.const
      ) {
        return candidate
      }
    }
    if (candidate.type === 'null' && value === null) return candidate
    if (candidate.type === 'array' && Array.isArray(value)) return candidate
    if (candidate.type === 'object' && asSchemaNode(value)) return candidate
    if (candidate.type === 'string' && typeof value === 'string') return candidate
    if (candidate.type === 'number' && typeof value === 'number') return candidate
    if (candidate.type === 'boolean' && typeof value === 'boolean') return candidate
  }
  return resolveSchemaNode(branches[0])
}

const schemaAtInstancePath = (data: unknown, path: string, selectUnionBranch = true): SchemaNode | undefined => {
  let schema: unknown = schemaRoot
  let value = data
  for (const rawPart of path.split('/').filter(Boolean)) {
    const node = schemaNodeForValue(schema, value)
    if (!node) return undefined
    const part = decodePointerPart(rawPart)
    const properties = asSchemaNode(node.properties)
    if (Array.isArray(value) && node.items !== undefined) {
      schema = node.items
      value = value[Number(part)]
    } else if (properties && Object.hasOwn(properties, part)) {
      schema = properties[part]
      value = asSchemaNode(value)?.[part]
    } else if (node.additionalProperties !== undefined) {
      schema = node.additionalProperties
      value = asSchemaNode(value)?.[part]
    } else {
      return undefined
    }
  }
  return selectUnionBranch ? schemaNodeForValue(schema, value) : resolveSchemaNode(schema)
}

const schemaSample = (input: unknown, depth = 0): unknown => {
  if (depth > 24) return undefined
  const node = resolveSchemaNode(input)
  if (!node) return undefined
  if (Object.hasOwn(node, 'const')) return node.const
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0]
  const branches = Array.isArray(node.oneOf) ? node.oneOf : Array.isArray(node.anyOf) ? node.anyOf : undefined
  if (branches) {
    for (const branch of branches) {
      const sample = schemaSample(branch, depth + 1)
      if (sample !== undefined) return sample
    }
    return undefined
  }
  const type: unknown = Array.isArray(node.type)
    ? (node.type as unknown[]).find((candidate: unknown) => candidate !== 'null')
    : node.type
  if (type === 'string') return typeof node.minLength === 'number' && node.minLength > 0 ? 'Scratch Project' : ''
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'array') {
    const minimum = typeof node.minItems === 'number' ? Math.min(node.minItems, 16) : 0
    const item = schemaSample(node.items, depth + 1)
    return item === undefined ? [] : Array.from({ length: minimum }, () => item)
  }
  if (type === 'object') {
    const result: Record<string, unknown> = {}
    const properties = asSchemaNode(node.properties)
    for (const name of Array.isArray(node.required) ? node.required : []) {
      if (typeof name !== 'string' || !properties || !Object.hasOwn(properties, name)) continue
      const sample = schemaSample(properties[name], depth + 1)
      if (sample !== undefined) result[name] = sample
    }
    return result
  }
  return undefined
}

const schemaExample = (
  issue: CanonicalIRValidationIssue,
  data: unknown,
): { readonly example?: unknown; readonly expected?: string } => {
  if (issue.keyword === 'anyOf' || issue.keyword === 'oneOf') {
    const instanceSchema = schemaAtInstancePath(data, issue.instancePath, false)
    const branches =
      schemaValueAtPointer(issue.schemaPath) ??
      (issue.keyword === 'oneOf' ? instanceSchema?.oneOf : instanceSchema?.anyOf)
    if (!Array.isArray(branches)) return {}
    for (const branch of branches) {
      const sample = schemaSample(branch)
      if (sample !== undefined) {
        return {
          example: { replaceWith: sample },
          expected: `a value matching one of the ${issue.keyword === 'oneOf' ? 'exclusive' : 'allowed'} schema variants`,
        }
      }
    }
    return {}
  }
  if (issue.keyword === 'additionalProperties' && typeof issue.params.additionalProperty === 'string') {
    return {
      example: { removeProperty: issue.params.additionalProperty },
      expected: 'no additional property at this path',
    }
  }
  if (issue.keyword === 'required' && typeof issue.params.missingProperty === 'string') {
    const name = issue.params.missingProperty
    const properties = asSchemaNode(schemaAtInstancePath(data, issue.instancePath)?.properties)
    if (!properties || !Object.hasOwn(properties, name)) return {}
    const sample = schemaSample(properties[name])
    return {
      ...(sample === undefined ? {} : { example: { addProperty: { [name]: sample } } }),
      expected: `required property ${name}`,
    }
  }
  if (issue.keyword === 'enum' && Array.isArray(issue.params.allowedValues)) {
    const allowedValues = issue.params.allowedValues as unknown[]
    return { example: { replaceWith: allowedValues[0] }, expected: schemaExpectation(issue) }
  }
  if (issue.keyword === 'const' && Object.hasOwn(issue.params, 'allowedValue')) {
    return { example: { replaceWith: issue.params.allowedValue }, expected: schemaExpectation(issue) }
  }
  if (
    ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(issue.keyword) &&
    typeof issue.params.limit === 'number'
  ) {
    const limit = issue.params.limit
    const epsilon = Math.max(1, Math.abs(limit)) * Number.EPSILON
    const replacement =
      issue.keyword === 'minimum'
        ? limit
        : issue.keyword === 'maximum'
          ? limit
          : issue.keyword === 'exclusiveMinimum'
            ? limit + epsilon
            : limit - epsilon
    return { example: { replaceWith: replacement }, expected: schemaExpectation(issue) }
  }
  if (issue.keyword === 'minLength' && typeof issue.params.limit === 'number') {
    const preferred = 'Scratch Project'
    const instanceSchema = schemaAtInstancePath(data, issue.instancePath)
    const preferredFitsMaximum =
      typeof instanceSchema?.maxLength !== 'number' || instanceSchema.maxLength >= preferred.length
    const replacement =
      issue.params.limit <= preferred.length && preferredFitsMaximum ? preferred : 'x'.repeat(issue.params.limit)
    return { example: { replaceWith: replacement }, expected: schemaExpectation(issue) }
  }
  if (
    issue.keyword === 'maxLength' &&
    typeof issue.params.limit === 'number' &&
    typeof pointerValue(data, issue.instancePath || '/') === 'string'
  ) {
    const actual = pointerValue(data, issue.instancePath || '/') as string
    return { example: { replaceWith: actual.slice(0, issue.params.limit) }, expected: schemaExpectation(issue) }
  }
  if (issue.keyword === 'minItems' && typeof issue.params.limit === 'number') {
    const replacement = schemaSample(schemaAtInstancePath(data, issue.instancePath))
    return {
      ...(replacement === undefined ? {} : { example: { replaceWith: replacement } }),
      expected: schemaExpectation(issue),
    }
  }
  if (
    issue.keyword === 'maxItems' &&
    typeof issue.params.limit === 'number' &&
    Array.isArray(pointerValue(data, issue.instancePath || '/'))
  ) {
    const actual = pointerValue(data, issue.instancePath || '/') as unknown[]
    return { example: { replaceWith: actual.slice(0, issue.params.limit) }, expected: schemaExpectation(issue) }
  }
  if (issue.keyword === 'type' && typeof issue.params.type === 'string') {
    const sample = schemaSample(schemaAtInstancePath(data, issue.instancePath))
    const fallback: Readonly<Record<string, unknown>> = {
      array: [],
      boolean: false,
      integer: 0,
      number: 0,
      object: {},
      string: '',
    }
    return {
      example: { replaceWith: sample ?? fallback[issue.params.type] },
      expected: schemaExpectation(issue),
    }
  }
  return {}
}

const compileFailureGuidance: Readonly<Record<string, { expected: string; suggestion: string }>> = {
  'svg-preflight': {
    expected: 'well-formed SVG costume data that the browser XML parser accepts',
    suggestion: '修正錯誤素材路徑指出的 SVG XML；保留原造型名稱與畫面意圖，再重新驗證',
  },
  'raster-preflight': {
    expected: 'browser-decodable PNG, JPEG, or BMP costume data',
    suggestion: '以可解碼的 PNG、JPEG 或 BMP 還原錯誤素材路徑指出的造型，不要只補檔案簽章',
  },
  'audio-preflight': {
    expected: 'browser-decodable WAV or MP3 sound data',
    suggestion: '以可解碼的 WAV 或 MP3 還原錯誤素材路徑指出的音效，並保留原音效名稱與播放設定',
  },
  'archive-generation': {
    expected: 'Canonical project fields and assets that can be encoded into an SB3 archive',
    suggestion: '依錯誤路徑修正無法序列化的專案欄位或素材資料，保留其他未涉及的專案內容',
  },
  'scratch-vm-load': {
    expected: 'an SB3 archive accepted by the official Scratch VM',
    suggestion: '依 VM 錯誤路徑修正 Scratch 不接受的積木圖、符號或素材識別資料；不要移除未涉及的遊戲邏輯',
  },
  'scratch-vm-save': {
    expected: 'a loaded Scratch VM project that can be serialized as SB3',
    suggestion: '檢查 VM 載入後的專案資料與素材，修正導致 SB3 保存失敗的內容並保留遊戲意圖',
  },
  unknown: {
    expected: 'a project accepted by the local Scratch project compiler',
    suggestion: '保留專案結構，依錯誤訊息修正無法編譯的積木或素材資料',
  },
}

const semanticSuggestion = (issue: CanonicalSemanticIssue): string => {
  const suggestions: Readonly<Record<string, string>> = {
    'asset-data-invalid': '從來源專案重新匯入有效素材資料；Data URI 或 Base64 必須可解碼且非空',
    'asset-format-mismatch': '確認 costume 的 dataFormat 與來源素材實際格式相符，再從來源專案重新匯入素材',
    'asset-checksum-mismatch': '從來源專案還原與原始校驗值相符的素材，再重新匯入；不要用佔位素材取代',
    'asset-missing': '從來源專案封存檔還原缺少的素材後重新匯入；不要用佔位素材取代',
    'current-costume-out-of-range': '將 currentCostume 改成現有造型的索引；索引從 0 開始',
    'condition-not-boolean':
      '改用 operator_equals、operator_gt、operator_lt 或 capability registry 標示為 boolean 的 reporter 表達明確條件；不要在 block JSON 加入 shape 欄位',
    'boolean-input-type':
      '將此 input 改成 capability registry 標示為 boolean 的 reporter block；不要在 block JSON 加入 shape 欄位',
    'broadcast-input-type': '使用 {"type":"broadcast","name":"..."} input，並在 broadcasts 宣告同名廣播',
    'hat-not-first': '把事件 hat 移到 script 的第一個 block，或拆成另一個 script',
    'hat-not-top-level': '事件 hat 只能位於 script 第一層的第一個 block',
    'input-block-shape':
      '依 capability registry 確認此 input 接受的 block 類型；boolean 類型由 opcode 決定，不要在 block JSON 輸出 shape',
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
    'invalid-argument-reporter': '確認 VALUE 名稱與型別屬於目前 procedure 的參數',
    'duplicate-procedure-argument':
      '將重複名稱改為唯一的 procedure 參數名稱，並同步更新呼叫 input 與 argument reporter',
    'missing-procedure-argument': '依被呼叫 procedure 的參數定義補上同名 input',
    'procedure-argument-type': '依 procedure 參數 kind 提供正確的 literal 或 reporter',
    'unknown-procedure': '建立同 target 的 procedure definition，或修正 procedure 名稱',
    'unknown-procedure-argument': '移除 procedure 未宣告的參數 input，或修正參數名稱',
  }
  return suggestions[issue.code] ?? '依錯誤訊息與 capability registry 修正此項目'
}

const pathTail = (path: string): string => decodePointerPart(path.slice(path.lastIndexOf('/') + 1))

const canonicalInputExample = (
  kind: 'any' | 'number' | 'string' | 'boolean' | 'stack' | 'broadcast' | 'menu' | 'color',
  menuValue?: string,
): unknown => {
  if (kind === 'stack') return { type: 'stack', blocks: [] }
  if (kind === 'broadcast') return undefined
  if (kind === 'boolean') return { type: 'literal', value: false }
  if (kind === 'number') return { type: 'literal', value: 0 }
  if (kind === 'color') return { type: 'literal', value: '#000000' }
  if (kind === 'menu' && menuValue === undefined) return undefined
  return { type: 'literal', value: menuValue ?? '' }
}

const semanticExample = (
  issue: CanonicalSemanticIssue,
  data: unknown,
): { readonly example?: unknown; readonly expected?: string } => {
  if (issue.code === 'asset-data-invalid') return { expected: 'non-empty decodable Base64, data URI, or inline SVG' }
  if (issue.code === 'asset-format-mismatch')
    return { expected: 'raster asset signature must match the declared dataFormat' }
  if (issue.code === 'asset-missing') return { expected: 'source asset bytes must be present' }
  if (issue.code === 'asset-checksum-mismatch')
    return { expected: 'source asset bytes must match the original checksum' }
  if (issue.code === 'current-costume-out-of-range') {
    const targetPath = issue.path.replace(/\/currentCostume$/, '')
    const target = pointerValue(data, targetPath) as { costumes?: unknown[] } | undefined
    const lastAvailableIndex = Math.max(0, (target?.costumes?.length ?? 0) - 1)
    return {
      example: { replaceWith: lastAvailableIndex },
      expected: `integer index from 0 through ${lastAvailableIndex}`,
    }
  }
  const opcode = opcodeAtPath(data, issue.path)
  const capability = opcode ? getBlockCapability(opcode) : undefined
  const propertyName = pathTail(issue.path)

  if (issue.code === 'missing-input' || issue.code === 'input-kind' || issue.code === 'boolean-input-type') {
    const input = capability?.inputs?.[propertyName]
    if (!input) return {}
    let menuValue: string | undefined
    if (input.kind === 'menu' && input.shadow) {
      menuValue = getBlockCapability(input.shadow.opcode)?.fields?.[input.shadow.field]?.values?.[0]
    }
    const example = canonicalInputExample(input.kind, menuValue)
    return {
      ...(example === undefined ? {} : { example: { [propertyName]: example } }),
      expected: `Canonical input kind=${input.kind}`,
    }
  }

  if (issue.code === 'missing-field' || issue.code === 'invalid-field-value') {
    const field = capability?.fields?.[propertyName]
    if (!field) return {}
    return {
      ...(field.values?.length ? { example: { [propertyName]: field.values[0] } } : {}),
      expected: field.values?.length ? `one of ${field.values.join(', ')}` : 'scalar field value',
    }
  }

  return {}
}

const schemaSuggestion = (issue: CanonicalIRValidationIssue): string => {
  if (issue.keyword === 'required') return '補上必要欄位，並依 Canonical IR schema 使用正確資料形狀'
  if (issue.keyword === 'additionalProperties') return '移除 schema 未定義的欄位'
  if (issue.keyword === 'type') return '將值改成 expected 指定的資料型別'
  if (issue.keyword === 'anyOf' || issue.keyword === 'oneOf') return '改用符合其中一種 Canonical IR schema 結構的值'
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
    const details = schemaExample(issue, data)
    issues.push({
      severity: 'error',
      status: 'must-fix',
      phase: 'schema',
      code: `schema-${issue.keyword}`,
      path,
      message: issue.message,
      ...(actual === undefined ? {} : { actual }),
      expected: details.expected ?? schemaExpectation(issue),
      suggestion: schemaSuggestion(issue),
      ...(details.example === undefined ? {} : { example: details.example }),
    })
  }

  for (const issue of options.semanticIssues ?? []) {
    const actual = pointerValue(data, issue.path)
    const opcode = opcodeAtPath(data, issue.path)
    const details = semanticExample(issue, data)
    issues.push({
      severity: issue.severity,
      status: issue.severity === 'error' ? 'must-fix' : 'review',
      phase: 'semantic',
      code: issue.code,
      path: issue.path || '/',
      ...(opcode ? { opcode } : {}),
      message: issue.message,
      ...(actual === undefined ? {} : { actual }),
      ...(details.expected ? { expected: details.expected } : {}),
      suggestion: semanticSuggestion(issue),
      ...(details.example === undefined ? {} : { example: details.example }),
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
      suggestion: '先修復錯誤位置附近的 JSON 語法（逗號、括號或字串逸出），只改語法，不要重寫遊戲邏輯',
    })
  }

  if (options.normalizationError !== undefined) {
    issues.push({
      severity: 'error',
      status: 'must-fix',
      phase: 'normalize',
      code: 'normalization-failed',
      path: '/',
      message: errorMessage(options.normalizationError),
      expected: 'parsed AI data within normalization depth and value limits',
      suggestion: '縮小巢狀資料或移除循環參照，再重新輸出完整 Canonical IR JSON',
    })
  }

  if (options.compileError !== undefined) {
    const message = errorMessage(options.compileError)
    const path = /\bat (\/[^:]+):/.exec(message)?.[1] ?? '/'
    const stage =
      isRecord(options.compileError) && typeof options.compileError.stage === 'string'
        ? options.compileError.stage
        : 'unknown'
    const guidance = compileFailureGuidance[stage] ?? compileFailureGuidance.unknown
    issues.push({
      severity: 'error',
      status: 'must-fix',
      phase: 'compile',
      code: 'compile-failed',
      path,
      message,
      actual: { stage },
      expected: guidance.expected,
      suggestion: guidance.suggestion,
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
 * @param repeatedIssues - Matching issue fingerprints from the prior attempt.
 * @returns Plain text without Markdown fences.
 */
export const createRepairPrompt = (
  report: RepairReport,
  currentProject: unknown,
  capabilityGuide: string,
  repeatedIssues: readonly RepeatedRepairIssue[] = [],
): string => {
  const parseIssue = report.issues.find((issue) => issue.phase === 'parse')
  if (parseIssue && typeof currentProject === 'string') {
    const sourceResponse = sanitizeSensitiveText(currentProject)
    const responseEnvelope = /"format"\s*:\s*"scratch-ai-bridge\/ai-response"/u.test(sourceResponse)
    return `上一版回覆在 JSON 解析階段就失敗，Bridge 尚未檢查或修改作品積木。錯誤訊息：${parseIssue.message}

請只修復下方原文的 JSON 語法錯誤，保留所有角色、素材、積木、變數、需求覆蓋資料及其值，不要重新設計、刪減或改寫遊戲邏輯，也不要新增積木。特別檢查錯誤位置附近的逗號、方括號、大括號與字串逸出。
${responseEnvelope ? '原文使用 scratch-ai-bridge/ai-response 外層格式；請保留 format、version、project 與 requirementCoverage 欄位。project 內才是 Canonical IR。' : '原文使用 scratch-ai-bridge/canonical-ir 根物件；請保留其 format、version 與完整專案欄位。'}
只輸出一份完整且可解析的 JSON，不要 Markdown、說明或多個候選版本。

需要修復的完整原文：
${sourceResponse}`
  }

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

Canonical IR 欄位優先規則：registry 中的 shape 只描述積木類型，不是 JSON 欄位。每個 block 只能輸出 Canonical IR 定義的欄位；絕不可輸出 shape。boolean 類型由 opcode 決定。

${
  repeatedIssues.length > 0
    ? `前一次修正後仍存在 ${repeatedIssues.length} 個相同問題。請優先處理前後 fingerprint 相同的欄位，勿重複上一輪的修法：\n${repeatedIssues.map(({ previousFingerprint, currentFingerprint }) => `- before ${previousFingerprint}\n  after  ${currentFingerprint}`).join('\n')}\n${JSON.stringify(repeatedIssues, null, 2)}\n`
    : ''
}

Repair Report:
${JSON.stringify(report, null, 2)}

Current Canonical IR:
${serializedProject}`
}
