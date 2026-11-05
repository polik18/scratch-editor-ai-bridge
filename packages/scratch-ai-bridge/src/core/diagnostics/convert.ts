/**
 * Diagnostic converter - Convert internal diagnostics to student-friendly format
 *
 * This module provides functions to:
 * - Convert internal AnalysisDiagnostic to StudentDiagnostic
 * - Map diagnostic codes to student-friendly messages
 * - Add category and severity metadata
 */
import type { AnalysisDiagnostic } from '../analyzer/analyzer'
import type { StudentDiagnostic } from './catalog'
import { createStudentDiagnostic } from './messages'

/**
 * Map internal diagnostic codes to student-friendly diagnostic types
 */
const DIAGNOSTIC_CODE_MAP: Record<string, string> = {
  'cloud-variable-offline': 'variable-scope-mismatch',
  'monitor-variable-missing': 'undefined-variable',
  'monitor-list-missing': 'undefined-variable',
  'asset-missing-archive-entry': 'missing-costume',
  'asset-checksum-mismatch': 'missing-costume',
  'unsupported-extension-block': 'unsupported-block',
}

/**
 * Convert an internal AnalysisDiagnostic to a StudentDiagnostic
 * @param diagnostic - Internal diagnostic
 * @returns StudentDiagnostic or undefined if not mappable
 */
export function convertToStudentDiagnostic(diagnostic: AnalysisDiagnostic): StudentDiagnostic | undefined {
  // Map code to student diagnostic type
  const type = DIAGNOSTIC_CODE_MAP[diagnostic.code]

  if (type) {
    // Create student diagnostic with parameters
    const params: Record<string, string> = {}

    if (diagnostic.target) {
      params.name = diagnostic.target
    }
    if (diagnostic.variable) {
      params.name = diagnostic.variable
    }
    if (diagnostic.assetName) {
      params.name = diagnostic.assetName
    }

    return createStudentDiagnostic(type, params)
  }

  // For unmapped diagnostics, return undefined
  // These will be handled separately
  return undefined
}

/**
 * Convert all diagnostics to student-friendly format
 * @param diagnostics - Array of internal diagnostics
 * @returns Array of student diagnostics
 */
export function convertDiagnosticsToStudent(diagnostics: AnalysisDiagnostic[]): StudentDiagnostic[] {
  const result: StudentDiagnostic[] = []

  for (const diagnostic of diagnostics) {
    const studentDiagnostic = convertToStudentDiagnostic(diagnostic)
    if (studentDiagnostic) {
      result.push(studentDiagnostic)
    }
  }

  return result
}

/**
 * Get all diagnostic codes that can be converted
 * @returns Array of supported internal diagnostic error codes
 */
export function getConvertibleDiagnosticCodes(): string[] {
  return Object.keys(DIAGNOSTIC_CODE_MAP)
}

/**
 * Get the student diagnostic type for a code
 * @param code - Internal diagnostic code
 * @returns Student diagnostic type or undefined
 */
export function getStudentDiagnosticType(code: string): string | undefined {
  return DIAGNOSTIC_CODE_MAP[code]
}
