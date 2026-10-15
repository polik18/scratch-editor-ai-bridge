import type { ProjectCompileFailureStage } from '../compiler/compiler'
import type { RequirementCoverageEntry } from '../normalizer'
import type { RepairReport } from './report'

export type ValidationCheckStatus = 'passed' | 'failed' | 'review' | 'skipped'

export interface AiOutputValidationReport {
  readonly format: 'scratch-ai-bridge/validation-report'
  readonly version: 2
  readonly canonicalVersion: 1
  readonly projectName: string
  readonly sourceResponseSha256: string
  readonly canonicalProjectSha256: string | null
  readonly compileFailureStage: ProjectCompileFailureStage | null
  readonly checks: {
    readonly responseParsed: ValidationCheckStatus
    readonly normalization: ValidationCheckStatus
    readonly canonicalSchema: ValidationCheckStatus
    readonly semanticValidation: ValidationCheckStatus
    readonly scratchVmCompile: ValidationCheckStatus
  }
  readonly repairReport: RepairReport
  readonly requirementCoverage?: readonly RequirementCoverageEntry[]
}

export interface CreateAiOutputValidationReportOptions {
  readonly sourceResponse: string
  readonly canonicalProject?: unknown
  readonly repairReport: RepairReport
  readonly checks: AiOutputValidationReport['checks']
  readonly compileFailureStage?: ProjectCompileFailureStage | null
  readonly requirementCoverage?: readonly RequirementCoverageEntry[]
}

const sha256Text = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Create a content-addressed validation record for an AI response that produced a Scratch VM artifact.
 * @param options Source text, optional normalized project, repair report, and validation gate results.
 * @returns A report that identifies both the response and the compiled Canonical project by SHA-256.
 */
export const createAiOutputValidationReport = async (
  options: CreateAiOutputValidationReportOptions,
): Promise<AiOutputValidationReport> => {
  const {
    sourceResponse,
    canonicalProject,
    repairReport,
    checks,
    compileFailureStage = null,
    requirementCoverage,
  } = options
  const canonicalJson = canonicalProject === undefined ? undefined : JSON.stringify(canonicalProject)
  return {
    format: 'scratch-ai-bridge/validation-report',
    version: 2,
    canonicalVersion: 1,
    projectName: repairReport.projectName,
    sourceResponseSha256: await sha256Text(sourceResponse),
    canonicalProjectSha256: canonicalJson === undefined ? null : await sha256Text(canonicalJson),
    compileFailureStage,
    checks,
    repairReport,
    ...(requirementCoverage ? { requirementCoverage } : {}),
  }
}
