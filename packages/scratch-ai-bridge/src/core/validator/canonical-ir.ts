import type { ErrorObject } from 'ajv'
import type { CanonicalProject } from '../ir/types'
import validateProject from './generated/canonical-ir.mjs'

export interface CanonicalIRValidationIssue {
  instancePath: string
  schemaPath: string
  keyword: string
  message: string
  params: Record<string, unknown>
}

export type CanonicalIRValidationResult =
  { valid: true; data: CanonicalProject } | { valid: false; errors: CanonicalIRValidationIssue[] }

const normalizeError = (error: ErrorObject): CanonicalIRValidationIssue => ({
  instancePath: error.instancePath,
  schemaPath: error.schemaPath,
  keyword: error.keyword,
  message: error.message ?? 'Schema validation failed',
  params: error.params as Record<string, unknown>,
})

export const validateCanonicalProject = (input: unknown): CanonicalIRValidationResult => {
  if (validateProject(input)) {
    return { valid: true, data: input }
  }

  return {
    valid: false,
    errors: (validateProject.errors ?? []).map(normalizeError),
  }
}
