import type { AnalysisDiagnostic } from './analyzer'

export interface DiagnosticDisplayGroup {
  readonly code: string
  readonly severity: AnalysisDiagnostic['severity']
  readonly count: number
  readonly summary: string
  readonly items: readonly AnalysisDiagnostic[]
}

/**
 * Group repeated observations for a readable student-facing overview.
 * @param diagnostics Static diagnostics to display.
 * @returns Grouped diagnostics, with warnings first.
 */
export const groupDiagnosticsForDisplay = (diagnostics: readonly AnalysisDiagnostic[]): DiagnosticDisplayGroup[] => {
  const byKey = new Map<string, AnalysisDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}:${diagnostic.code}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(diagnostic)
    else byKey.set(key, [diagnostic])
  }
  return [...byKey.values()]
    .map((items): DiagnosticDisplayGroup => {
      const first = items[0]
      const count = items.length
      const summary =
        first.code === 'detached-script'
          ? `有 ${count} 段未接事件積木的程式；可能是草稿或手動執行，不一定是錯誤。`
          : first.code === 'block-graph-invalid-argument-reporter' && first.severity === 'info'
            ? `有 ${count} 個未接草稿中的自製積木參數，不一定影響作品。`
            : count === 1
              ? first.message
              : `${count} 項相似的觀察：${first.message}`
      return { code: first.code, severity: first.severity, count, summary, items }
    })
    .sort((a, b) => Number(b.severity === 'warning') - Number(a.severity === 'warning'))
}
