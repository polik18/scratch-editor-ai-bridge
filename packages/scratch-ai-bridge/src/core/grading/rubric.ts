import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** Where a criterion's evidence may come from. Only `static`/`runtime`/`visual`/`audio` can be checked automatically. */
export type EvidenceSource = 'static' | 'runtime' | 'visual' | 'audio' | 'ai' | 'teacher'

export const PROJECT_TYPES = [
  'game',
  'animation',
  'story',
  'interactive-art',
  'music',
  'quiz',
  'tutorial',
  'simulation',
  'mixed',
  'custom',
] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

/**
 * A machine-checkable predicate over the grading evidence. Runtime checks need a real playtest; static checks read
 * the SB3. A criterion without checks can only be graded by an AI provider or the teacher.
 */
export type RubricCheck =
  | { readonly kind: 'runtime-ready' }
  | { readonly kind: 'runtime-no-errors' }
  | { readonly kind: 'runtime-opcode'; readonly opcodes: readonly string[]; readonly min?: number }
  | { readonly kind: 'runtime-collision' }
  | { readonly kind: 'runtime-motion'; readonly sprite?: string }
  | { readonly kind: 'runtime-sprite-changed'; readonly sprite?: string; readonly min?: number }
  | { readonly kind: 'runtime-variable-changed'; readonly variable?: string }
  | { readonly kind: 'runtime-clones'; readonly min?: number }
  | { readonly kind: 'runtime-control'; readonly key?: string }
  | { readonly kind: 'runtime-feedback-kinds'; readonly min: number }
  | { readonly kind: 'static-opcode'; readonly opcodes: readonly string[]; readonly min?: number }
  | { readonly kind: 'static-sprites'; readonly min: number }
  | { readonly kind: 'static-scripts'; readonly min: number }
  | { readonly kind: 'static-diagnostic'; readonly min: number }

export const CHECK_KINDS: readonly RubricCheck['kind'][] = [
  'runtime-ready',
  'runtime-no-errors',
  'runtime-opcode',
  'runtime-collision',
  'runtime-motion',
  'runtime-sprite-changed',
  'runtime-variable-changed',
  'runtime-clones',
  'runtime-control',
  'runtime-feedback-kinds',
  'static-opcode',
  'static-sprites',
  'static-scripts',
  'static-diagnostic',
]

export interface RubricLevel {
  readonly ratio: number
  readonly description: string
  /** All must pass for this level to be awarded automatically. */
  readonly checks?: readonly RubricCheck[]
}

export interface RubricComponent {
  readonly id: string
  readonly points: number
  readonly description: string
  readonly checks?: readonly RubricCheck[]
}

export interface RubricCriterion {
  readonly id: string
  readonly title: string
  readonly points: number
  readonly mode: 'binary' | 'partial' | 'components'
  readonly evidence: readonly EvidenceSource[]
  readonly description?: string
  readonly testPlan?: readonly string[]
  /** `binary`: all checks must pass for full points. */
  readonly checks?: readonly RubricCheck[]
  /** `partial`: teacher-defined levels; the highest level whose checks pass is awarded. */
  readonly levels?: readonly RubricLevel[]
  /** `components`: teacher-defined sub-items whose points add up to the criterion's points. */
  readonly components?: readonly RubricComponent[]
  /** Always send this criterion to the teacher review queue. */
  readonly reviewRequired?: boolean
}

/** Optional overrides for the automatic playtest. */
export interface RubricRuntimeSettings {
  readonly playMs?: number
  readonly keys?: readonly string[]
  readonly clicks?: boolean
}

export interface RubricApproval {
  readonly by: string
  readonly at: string
  readonly rubricHash: string
}

export interface Rubric {
  readonly format: 'scratch-ai-bridge/rubric'
  readonly version: 1
  readonly id: string
  readonly title: string
  readonly projectType: ProjectType
  readonly totalPoints: number
  readonly criteria: readonly RubricCriterion[]
  readonly runtime?: RubricRuntimeSettings
  /** Absent on drafts. A rubric must be approved (and unchanged since) before it produces formal grades. */
  readonly approval?: RubricApproval
  /** Who wrote it: a teacher's own rubric or the built-in fallback profile. */
  readonly origin?: 'teacher' | 'fallback' | 'draft'
}

export interface RubricIssue {
  readonly path: string
  readonly code: string
  readonly message: string
}

export interface RubricValidation {
  readonly ok: boolean
  readonly errors: readonly RubricIssue[]
  readonly warnings: readonly RubricIssue[]
  readonly rubricHash?: string
  readonly approved: boolean
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const EVIDENCE: readonly EvidenceSource[] = ['static', 'runtime', 'visual', 'audio', 'ai', 'teacher']
const POINT_EPSILON = 1e-9

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/**
 * Stable SHA-256 of a rubric's grading content (key order and the approval record do not change it), so a whole
 * class is provably graded with the same version.
 * @param rubric Rubric object (validated or not).
 * @returns Hex digest.
 */
export const rubricHash = (rubric: unknown): string => {
  const content = isRecord(rubric)
    ? Object.fromEntries(Object.entries(rubric).filter(([key]) => key !== 'approval'))
    : rubric
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(content))))
}

const validateCheck = (check: unknown, path: string, errors: RubricIssue[]): void => {
  if (
    !isRecord(check) ||
    typeof check.kind !== 'string' ||
    !CHECK_KINDS.includes(check.kind as RubricCheck['kind'])
  ) {
    errors.push({
      path,
      code: 'check-kind-invalid',
      message: `不認得的自動檢查類型；可用：${CHECK_KINDS.join('、')}`,
    })
    return
  }
  if (check.kind === 'runtime-opcode' || check.kind === 'static-opcode') {
    if (
      !Array.isArray(check.opcodes) ||
      check.opcodes.length === 0 ||
      !check.opcodes.every((opcode) => typeof opcode === 'string' && /^[a-z0-9_]+(:true)?$/i.test(opcode))
    )
      errors.push({ path: `${path}.opcodes`, code: 'check-opcodes-invalid', message: '需要至少一個 opcode 名稱。' })
  }
  if (['static-sprites', 'static-scripts', 'static-diagnostic', 'runtime-feedback-kinds'].includes(check.kind)) {
    if (typeof check.min !== 'number' || !Number.isFinite(check.min) || check.min < 0)
      errors.push({ path: `${path}.min`, code: 'check-min-invalid', message: '需要 0 以上的 min。' })
  } else if (
    check.min !== undefined &&
    (typeof check.min !== 'number' || !Number.isInteger(check.min) || check.min < 1)
  )
    errors.push({ path: `${path}.min`, code: 'check-min-invalid', message: 'min 必須是 1 以上的整數。' })
}

const validateChecks = (checks: unknown, path: string, errors: RubricIssue[]): void => {
  if (checks === undefined) return
  if (!Array.isArray(checks)) {
    errors.push({ path, code: 'checks-invalid', message: 'checks 必須是陣列。' })
    return
  }
  checks.forEach((check, index) => validateCheck(check, `${path}[${index}]`, errors))
}

/**
 * Validate a teacher rubric: format, unique IDs, point totals, level ratios, component sums and automatic checks.
 * Errors block grading; warnings are shown to the teacher (for example a criterion nothing can check automatically).
 * @param input Parsed JSON.
 * @returns Errors, warnings, the content hash and whether the approval still matches it.
 */
export const validateRubric = (input: unknown): RubricValidation => {
  const errors: RubricIssue[] = []
  const warnings: RubricIssue[] = []
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: '$', code: 'rubric-invalid', message: 'rubric 必須是 JSON 物件。' }],
      warnings,
      approved: false,
    }
  }
  if (input.format !== 'scratch-ai-bridge/rubric')
    errors.push({ path: 'format', code: 'format-invalid', message: 'format 必須是 "scratch-ai-bridge/rubric"。' })
  if (input.version !== 1) errors.push({ path: 'version', code: 'version-invalid', message: 'version 必須是 1。' })
  if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id))
    errors.push({ path: 'id', code: 'id-invalid', message: 'id 只能用英數字、-、_、.，最多 64 字。' })
  if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 200)
    errors.push({ path: 'title', code: 'title-invalid', message: '需要 1～200 字的標題。' })
  if (typeof input.projectType !== 'string' || !(PROJECT_TYPES as readonly string[]).includes(input.projectType))
    errors.push({
      path: 'projectType',
      code: 'project-type-invalid',
      message: `projectType 必須是 ${PROJECT_TYPES.join('、')} 其中之一。`,
    })
  if (!isPositiveNumber(input.totalPoints))
    errors.push({ path: 'totalPoints', code: 'total-invalid', message: 'totalPoints 必須是正數。' })

  const criteria = input.criteria
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.length > 50) {
    errors.push({ path: 'criteria', code: 'criteria-invalid', message: '需要 1～50 個評量項目。' })
  } else {
    const ids = new Set<string>()
    let sum = 0
    criteria.forEach((criterion: unknown, index) => {
      const path = `criteria[${index}]`
      if (!isRecord(criterion)) {
        errors.push({ path, code: 'criterion-invalid', message: '評量項目必須是物件。' })
        return
      }
      if (typeof criterion.id !== 'string' || !ID_PATTERN.test(criterion.id))
        errors.push({ path: `${path}.id`, code: 'criterion-id-invalid', message: 'criterion id 格式無效。' })
      else if (ids.has(criterion.id))
        errors.push({
          path: `${path}.id`,
          code: 'criterion-id-duplicate',
          message: `criterion id「${criterion.id}」重複。`,
        })
      else ids.add(criterion.id)
      if (typeof criterion.title !== 'string' || criterion.title.trim().length === 0)
        errors.push({ path: `${path}.title`, code: 'criterion-title-invalid', message: '需要項目名稱。' })
      if (!isPositiveNumber(criterion.points))
        errors.push({ path: `${path}.points`, code: 'criterion-points-invalid', message: '配分必須是正數。' })
      else sum += criterion.points
      if (
        !Array.isArray(criterion.evidence) ||
        criterion.evidence.length === 0 ||
        !criterion.evidence.every((source) => EVIDENCE.includes(source as EvidenceSource))
      )
        errors.push({
          path: `${path}.evidence`,
          code: 'criterion-evidence-invalid',
          message: `evidence 需要至少一種：${EVIDENCE.join('、')}。`,
        })
      if (criterion.testPlan !== undefined) {
        if (!Array.isArray(criterion.testPlan) || !criterion.testPlan.every((step) => typeof step === 'string'))
          errors.push({ path: `${path}.testPlan`, code: 'test-plan-invalid', message: 'testPlan 必須是文字陣列。' })
      } else
        warnings.push({
          path: `${path}.testPlan`,
          code: 'test-plan-missing',
          message: '沒有測試步驟，教師較難核對。',
        })
      validateChecks(criterion.checks, `${path}.checks`, errors)

      let automatic = Array.isArray(criterion.checks) && criterion.checks.length > 0
      if (criterion.mode === 'binary') {
        if (criterion.levels !== undefined || criterion.components !== undefined)
          errors.push({ path, code: 'binary-extra', message: 'binary 項目不能有 levels 或 components。' })
      } else if (criterion.mode === 'partial') {
        const levels = criterion.levels
        if (!Array.isArray(levels) || levels.length < 2) {
          errors.push({ path: `${path}.levels`, code: 'levels-invalid', message: 'partial 項目需要至少兩個級距。' })
        } else {
          const ratios = new Set<number>()
          levels.forEach((level: unknown, levelIndex) => {
            const levelPath = `${path}.levels[${levelIndex}]`
            if (!isRecord(level) || typeof level.ratio !== 'number' || level.ratio < 0 || level.ratio > 1) {
              errors.push({ path: levelPath, code: 'level-ratio-invalid', message: 'ratio 必須介於 0 和 1。' })
              return
            }
            if (ratios.has(level.ratio))
              errors.push({ path: levelPath, code: 'level-ratio-duplicate', message: `ratio ${level.ratio} 重複。` })
            ratios.add(level.ratio)
            if (typeof level.description !== 'string' || level.description.trim().length === 0)
              errors.push({
                path: `${levelPath}.description`,
                code: 'level-description-invalid',
                message: '需要級距說明。',
              })
            validateChecks(level.checks, `${levelPath}.checks`, errors)
            if (Array.isArray(level.checks) && level.checks.length > 0) automatic = true
          })
          if (!ratios.has(1))
            errors.push({
              path: `${path}.levels`,
              code: 'level-full-missing',
              message: '需要一個 ratio 1（滿分）的級距。',
            })
          if (!ratios.has(0))
            warnings.push({
              path: `${path}.levels`,
              code: 'level-zero-missing',
              message: '沒有 0 分級距；未達任何級距時會進人工複核。',
            })
        }
      } else if (criterion.mode === 'components') {
        const components = criterion.components
        if (!Array.isArray(components) || components.length === 0) {
          errors.push({
            path: `${path}.components`,
            code: 'components-invalid',
            message: 'components 項目需要子項目。',
          })
        } else {
          const componentIds = new Set<string>()
          let componentSum = 0
          components.forEach((component: unknown, componentIndex) => {
            const componentPath = `${path}.components[${componentIndex}]`
            if (!isRecord(component)) {
              errors.push({ path: componentPath, code: 'component-invalid', message: '子項目必須是物件。' })
              return
            }
            if (typeof component.id !== 'string' || !ID_PATTERN.test(component.id))
              errors.push({
                path: `${componentPath}.id`,
                code: 'component-id-invalid',
                message: '子項目 id 格式無效。',
              })
            else if (componentIds.has(component.id))
              errors.push({
                path: `${componentPath}.id`,
                code: 'component-id-duplicate',
                message: `子項目 id「${component.id}」重複。`,
              })
            else componentIds.add(component.id)
            if (!isPositiveNumber(component.points))
              errors.push({
                path: `${componentPath}.points`,
                code: 'component-points-invalid',
                message: '子項目配分必須是正數。',
              })
            else componentSum += component.points
            if (typeof component.description !== 'string' || component.description.trim().length === 0)
              errors.push({
                path: `${componentPath}.description`,
                code: 'component-description-invalid',
                message: '需要子項目說明。',
              })
            validateChecks(component.checks, `${componentPath}.checks`, errors)
            if (Array.isArray(component.checks) && component.checks.length > 0) automatic = true
          })
          if (isPositiveNumber(criterion.points) && Math.abs(componentSum - criterion.points) > POINT_EPSILON)
            errors.push({
              path: `${path}.components`,
              code: 'component-sum-mismatch',
              message: `子項目配分合計 ${componentSum}，與項目配分 ${criterion.points} 不同。`,
            })
        }
      } else {
        errors.push({
          path: `${path}.mode`,
          code: 'mode-invalid',
          message: 'mode 必須是 binary、partial 或 components。',
        })
      }
      if (!automatic)
        warnings.push({
          path,
          code: 'criterion-manual',
          message: `「${String(criterion.title)}」沒有自動檢查，需要 AI 評量或教師判定才會有分數。`,
        })
    })
    if (isPositiveNumber(input.totalPoints) && Math.abs(sum - input.totalPoints) > POINT_EPSILON)
      errors.push({
        path: 'criteria',
        code: 'points-sum-mismatch',
        message: `各項配分合計 ${sum}，與 totalPoints ${input.totalPoints} 不同。`,
      })
  }

  if (input.runtime !== undefined) {
    const runtime = input.runtime
    if (!isRecord(runtime)) errors.push({ path: 'runtime', code: 'runtime-invalid', message: 'runtime 必須是物件。' })
    else {
      if (
        runtime.playMs !== undefined &&
        (typeof runtime.playMs !== 'number' || runtime.playMs < 1000 || runtime.playMs > 120_000)
      )
        errors.push({
          path: 'runtime.playMs',
          code: 'runtime-play-invalid',
          message: 'playMs 必須介於 1000 和 120000。',
        })
      if (
        runtime.keys !== undefined &&
        (!Array.isArray(runtime.keys) || !runtime.keys.every((key) => typeof key === 'string'))
      )
        errors.push({ path: 'runtime.keys', code: 'runtime-keys-invalid', message: 'keys 必須是文字陣列。' })
      if (runtime.clicks !== undefined && typeof runtime.clicks !== 'boolean')
        errors.push({
          path: 'runtime.clicks',
          code: 'runtime-clicks-invalid',
          message: 'clicks 必須是 true 或 false。',
        })
    }
  }

  const hash = errors.length === 0 ? rubricHash(input) : undefined
  const approval = input.approval
  const approved =
    hash !== undefined &&
    isRecord(approval) &&
    typeof approval.by === 'string' &&
    approval.by.length > 0 &&
    typeof approval.at === 'string' &&
    approval.rubricHash === hash
  if (hash !== undefined && approval !== undefined && !approved)
    warnings.push({
      path: 'approval',
      code: 'approval-stale',
      message: 'rubric 在核准後被修改過（hash 不同），需要重新核准。',
    })
  return { ok: errors.length === 0, errors, warnings, ...(hash ? { rubricHash: hash } : {}), approved }
}

/**
 * Mark a valid rubric as approved by a teacher, pinning its current hash.
 * @param rubric Valid rubric.
 * @param by Reviewer label (no personal data needed; a role or initials is enough).
 * @param at ISO timestamp.
 * @returns The rubric with an approval record.
 */
export const approveRubric = (rubric: Rubric, by: string, at: string = new Date().toISOString()): Rubric => {
  const validation = validateRubric(rubric)
  if (!validation.ok || !validation.rubricHash) throw new Error('rubric-invalid')
  return { ...rubric, approval: { by, at, rubricHash: validation.rubricHash } }
}

/**
 * Parse and validate rubric JSON text.
 * @param text JSON text.
 * @returns The rubric and its validation; `rubric` is set only when valid.
 */
export const parseRubric = (text: string): { readonly rubric?: Rubric; readonly validation: RubricValidation } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return {
      validation: {
        ok: false,
        errors: [{ path: '$', code: 'json-invalid', message: 'rubric 不是有效的 JSON。' }],
        warnings: [],
        approved: false,
      },
    }
  }
  const validation = validateRubric(parsed)
  return validation.ok ? { rubric: parsed as Rubric, validation } : { validation }
}
