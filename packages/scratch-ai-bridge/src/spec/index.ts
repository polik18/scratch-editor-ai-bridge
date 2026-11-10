import type { CanonicalProject } from '../core/ir/types'
import { checkGameSpec } from './check'
import { compileGameSpec } from './compile'
import { extractJson, normalizeGameSpec } from './normalize'
import type { GameSpec, SpecDiagnostic } from './types'

export { checkGameSpec } from './check'
export { compileGameSpec, entityCells, findPlayer, SPEC_NAMES } from './compile'
export { extractJson, normalizeGameSpec } from './normalize'
export { createSpecScenarios } from './scenario'
export type * from './types'
export type { SpecScenario, ScenarioStep } from './scenario'

export interface SpecBuildResult {
  readonly spec?: GameSpec
  readonly project?: CanonicalProject
  readonly diagnostics: readonly SpecDiagnostic[]
}

/**
 * Text → normalized spec → game checks → Canonical IR. Stops before compiling when any error remains.
 * @param text - Spec JSON, optionally wrapped in prose or code fences.
 * @returns Normalized spec, diagnostics and, when no error remains, the Canonical IR project.
 */
export const buildFromSpecText = (text: string): SpecBuildResult => {
  let raw: unknown
  let repaired = false
  try {
    ;({ value: raw, repaired } = extractJson(text))
  } catch (error) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'SPEC_NOT_JSON',
          where: '整份描述',
          message: error instanceof Error ? error.message : String(error),
          suggestion: '只輸出一個 JSON 物件，不要加其他文字。',
        },
      ],
    }
  }
  const parsed = normalizeGameSpec(raw)
  const normalized = repaired
    ? {
        ...parsed,
        diagnostics: [
          {
            severity: 'fixed' as const,
            code: 'JSON_REPAIRED',
            where: '整份描述',
            message: 'JSON 的括號沒有對齊或有多餘逗號，已自動修正。',
          },
          ...parsed.diagnostics,
        ],
      }
    : parsed
  if (!normalized.spec || normalized.diagnostics.some((item) => item.severity === 'error'))
    return { ...(normalized.spec ? { spec: normalized.spec } : {}), diagnostics: normalized.diagnostics }
  const diagnostics = [...normalized.diagnostics, ...checkGameSpec(normalized.spec)]
  if (diagnostics.some((item) => item.severity === 'error')) return { spec: normalized.spec, diagnostics }
  return { spec: normalized.spec, project: compileGameSpec(normalized.spec), diagnostics }
}

/**
 * One line per diagnostic, in the form shown to authors and fed back to models.
 * @param diagnostics - Diagnostics to format.
 * @returns Newline-separated feedback lines.
 */
export const formatSpecDiagnostics = (diagnostics: readonly SpecDiagnostic[]): string =>
  diagnostics
    .map((item) => {
      const tag = item.severity === 'error' ? '錯誤' : item.severity === 'warning' ? '注意' : '已自動修正'
      return `[${tag}] ${item.where}：${item.message}${item.suggestion ? ` → ${item.suggestion}` : ''}`
    })
    .join('\n')
