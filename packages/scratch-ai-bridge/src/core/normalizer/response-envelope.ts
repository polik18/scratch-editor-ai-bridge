import { CANONICAL_OPCODES } from '../capabilities'

export type RequirementCoverageStatus =
  'implemented-structure' | 'approximated' | 'not-implemented' | 'runtime-unavailable' | 'not-verifiable-from-ir'

export interface RequirementCoverageEntry {
  readonly id: string
  readonly requirement: string
  readonly status: RequirementCoverageStatus
  readonly evidencePointers: readonly string[]
}

export interface AiProjectResponse {
  readonly format: 'scratch-ai-bridge/ai-response'
  readonly version: 1
  readonly project: unknown
  readonly requirementCoverage?: readonly RequirementCoverageEntry[]
  readonly features?: readonly string[]
}

export interface ParsedAiProjectResponse {
  readonly project: unknown
  readonly requirementCoverage: readonly RequirementCoverageEntry[] | null
  readonly features: readonly string[] | null
  readonly envelope: boolean
}

const statuses = new Set<RequirementCoverageStatus>([
  'implemented-structure',
  'approximated',
  'not-implemented',
  'runtime-unavailable',
  'not-verifiable-from-ir',
])
const supportedOpcodes = new Set<string>(CANONICAL_OPCODES)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pointerValue = (root: unknown, pointer: string): unknown => {
  if (pointer === '') return root
  if (!pointer.startsWith('/')) return undefined
  return pointer
    .slice(1)
    .split('/')
    .reduce<unknown>((value, rawPart) => {
      if (/~(?![01])/.test(rawPart)) return undefined
      const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~')
      if (Array.isArray(value)) return /^\d+$/.test(part) ? value[Number(part)] : undefined
      return isRecord(value) && Object.hasOwn(value, part) ? value[part] : undefined
    }, root)
}

/**
 * Keep the legacy bare Canonical IR response valid while validating optional requirement tracking.
 * @param value - Parsed JSON value returned by an external model.
 * @returns Project payload and optional requirement coverage statements.
 */
export const parseAiProjectResponse = (value: unknown): ParsedAiProjectResponse => {
  if (!isRecord(value) || value.format !== 'scratch-ai-bridge/ai-response') {
    return { project: value, requirementCoverage: null, features: null, envelope: false }
  }
  if (
    Object.keys(value).some(
      (key) => !['format', 'version', 'project', 'requirementCoverage', 'features'].includes(key),
    )
  ) {
    throw new Error('AI response envelope 不可包含未定義欄位')
  }
  if (value.version !== 1 || !isRecord(value.project)) {
    throw new Error('AI response envelope 必須包含 version=1 與 project 物件')
  }
  const hasRequirementCoverage = Array.isArray(value.requirementCoverage)
  const hasFeatures = Array.isArray(value.features)
  if (!hasRequirementCoverage && !hasFeatures) {
    throw new Error('AI response envelope 必須包含 features 或 requirementCoverage 陣列')
  }
  const featureValues = hasFeatures ? (value.features as unknown[]) : []
  const features = hasFeatures
    ? featureValues.map((feature, index) => {
        if (typeof feature !== 'string' || !feature.trim()) {
          throw new Error(`features[${index}] 必須是非空字串`)
        }
        return feature.trim()
      })
    : null
  if (features && new Set(features).size !== features.length) {
    throw new Error('features 不可重複')
  }
  const coverageValues = hasRequirementCoverage ? (value.requirementCoverage as unknown[]) : []
  const coverage = hasRequirementCoverage
    ? coverageValues.map((entry, index): RequirementCoverageEntry => {
        if (
          !isRecord(entry) ||
          typeof entry.id !== 'string' ||
          !entry.id.trim() ||
          typeof entry.requirement !== 'string' ||
          !entry.requirement.trim() ||
          typeof entry.status !== 'string' ||
          !statuses.has(entry.status as RequirementCoverageStatus) ||
          Object.keys(entry).some((key) => !['id', 'requirement', 'status', 'evidencePointers'].includes(key)) ||
          !Array.isArray(entry.evidencePointers) ||
          !entry.evidencePointers.every((pointer) => typeof pointer === 'string')
        ) {
          throw new Error(`requirementCoverage[${index}] 欄位不符合 AI response envelope v1`)
        }
        if (new Set(entry.evidencePointers).size !== entry.evidencePointers.length) {
          throw new Error(`requirementCoverage[${index}] evidencePointers 不可重複`)
        }
        for (const pointer of entry.evidencePointers) {
          // Models sometimes write JSON Pointers from the outer response envelope
          // (`/project/...`) even though the documented root is the project object.
          // Accept both forms while keeping the supplied pointer for reporting.
          const projectPointer = pointer.startsWith('/project/') ? pointer.slice('/project'.length) : pointer
          const evidence = pointerValue(value.project, projectPointer)
          if (evidence === undefined) {
            throw new Error(`requirementCoverage[${index}] 的 evidence pointer 不存在：${pointer}`)
          }
          if (!isRecord(evidence) || typeof evidence.opcode !== 'string') {
            throw new Error(`requirementCoverage[${index}] 的 evidence pointer 必須指向 block：${pointer}`)
          }
          if (entry.status === 'implemented-structure' && !supportedOpcodes.has(evidence.opcode)) {
            throw new Error(
              `requirementCoverage[${index}] 以未支援 opcode 宣稱 implemented-structure：${evidence.opcode}`,
            )
          }
        }
        if (entry.status === 'implemented-structure' && entry.evidencePointers.length === 0) {
          throw new Error(`requirementCoverage[${index}] 標示 implemented-structure 時必須附 evidence pointer`)
        }
        return {
          id: entry.id,
          requirement: entry.requirement,
          status: entry.status as RequirementCoverageStatus,
          evidencePointers: [...entry.evidencePointers],
        }
      })
    : null
  if (coverage && new Set(coverage.map(({ id }) => id)).size !== coverage.length) {
    throw new Error('requirementCoverage 的 id 不可重複')
  }
  return { project: value.project, requirementCoverage: coverage, features, envelope: true }
}
