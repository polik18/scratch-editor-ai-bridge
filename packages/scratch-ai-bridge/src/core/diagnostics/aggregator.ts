/**
 * Diagnostic Aggregator - Aggregate and group diagnostics
 *
 * This module provides functions to:
 * - Aggregate diagnostics by category and severity
 * - Generate thematic groups for student-friendly display
 * - Sort diagnostics by severity
 */
import type {
  StudentDiagnostic,
  DiagnosticGroup,
  DiagnosticSummary,
  DiagnosticCategory,
  DiagnosticSeverity,
} from './catalog'

/**
 * Aggregate diagnostics into groups by category and severity
 * @param diagnostics - Array of student diagnostics
 * @returns Array of diagnostic groups
 */
export function aggregateDiagnostics(diagnostics: StudentDiagnostic[]): DiagnosticGroup[] {
  // Group by category + severity
  const groups = new Map<string, StudentDiagnostic[]>()

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.category}-${diagnostic.severity}`
    const list = groups.get(key)
    if (list) {
      list.push(diagnostic)
    } else {
      groups.set(key, [diagnostic])
    }
  }

  // Convert to array of groups
  const result: DiagnosticGroup[] = []
  for (const [key, diags] of groups) {
    const [category, severity] = key.split('-') as [DiagnosticCategory, DiagnosticSeverity]
    result.push({
      category,
      severity,
      count: diags.length,
      diagnostics: diags,
      categoryId: category,
    })
  }

  // Sort by severity (high → medium → low) then by category
  result.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 }
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity]
    }
    return a.category.localeCompare(b.category)
  })

  return result
}

/**
 * Generate a summary of diagnostics
 * @param diagnostics - Array of student diagnostics
 * @returns Aggregated statistics and metric breakdown
 */
export function generateDiagnosticSummary(diagnostics: StudentDiagnostic[]): DiagnosticSummary {
  const summary: DiagnosticSummary = {
    total: diagnostics.length,
    high: 0,
    medium: 0,
    low: 0,
    categories: {
      structure: { high: 0, medium: 0, low: 0 },
      variable: { high: 0, medium: 0, low: 0 },
      asset: { high: 0, medium: 0, low: 0 },
      block: { high: 0, medium: 0, low: 0 },
      logic: { high: 0, medium: 0, low: 0 },
      sprite: { high: 0, medium: 0, low: 0 },
      stage: { high: 0, medium: 0, low: 0 },
      extension: { high: 0, medium: 0, low: 0 },
      'best-practice': { high: 0, medium: 0, low: 0 },
    },
  }

  for (const diagnostic of diagnostics) {
    summary[diagnostic.severity]++
    summary.categories[diagnostic.category][diagnostic.severity]++
  }

  return summary
}

/**
 * Get high-priority diagnostics (only high severity)
 * @param diagnostics - Array of student diagnostics
 * @returns Filtered array of urgent issues
 */
export function getHighPriorityDiagnostics(diagnostics: StudentDiagnostic[]): StudentDiagnostic[] {
  return diagnostics.filter((d) => d.severity === 'high')
}

/**
 * Get diagnostics with medium or high severity
 * @param diagnostics - Array of student diagnostics
 * @returns High and medium priority diagnostics
 */
export function getHighMediumPriorityDiagnostics(diagnostics: StudentDiagnostic[]): StudentDiagnostic[] {
  return diagnostics.filter((d) => d.severity === 'high' || d.severity === 'medium')
}

/**
 * Format diagnostic group for CLI output
 * @param group - Categorized diagnostics bucket
 * @returns Formatted string
 */
export function formatDiagnosticGroup(group: DiagnosticGroup): string {
  const lines: string[] = []

  // Group header
  lines.push(
    `\n${GROUP_HEADER_ICONS[group.category]} ${getCategoryTitle(group.category, group.severity)} (${group.count} 個相關項目)`,
  )

  // Add separator line
  lines.push('─'.repeat(60))

  // List diagnostics
  for (const diagnostic of group.diagnostics) {
    lines.push(`\n${diagnostic.fix.split('\n')[0]}`) // Show only the first line of fix
    lines.push(`  → ${diagnostic.impact}`)

    if (diagnostic.example) {
      lines.push(`  ✅ 範例: ${diagnostic.example.split('\n')[0]}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format diagnostic groups for CLI output
 * @param groups - Array of diagnostic groups
 * @returns Formatted string
 */
export function formatDiagnosticGroups(groups: DiagnosticGroup[]): string {
  const lines: string[] = []

  // Summary header
  const highGroups = groups.filter((g) => g.severity === 'high')
  const mediumGroups = groups.filter((g) => g.severity === 'medium')
  const lowGroups = groups.filter((g) => g.severity === 'low')

  lines.push('📊 預期的問題')
  lines.push('─'.repeat(60))

  if (highGroups.length > 0) {
    lines.push(`\n⚠️ ${highGroups.length} 個高優先問題（作品可能無法正常運作）`)
    for (const group of highGroups) {
      lines.push(formatDiagnosticGroup(group))
    }
  }

  if (mediumGroups.length > 0) {
    lines.push(`\n💡 ${mediumGroups.length} 個中優先問題（建議修正以改善作品）`)
    for (const group of mediumGroups) {
      lines.push(formatDiagnosticGroup(group))
    }
  }

  if (lowGroups.length > 0) {
    lines.push(`\n✨ ${lowGroups.length} 個低優先建議（改進後會更好）`)
    for (const group of lowGroups) {
      lines.push(formatDiagnosticGroup(group))
    }
  }

  if (groups.length === 0) {
    lines.push('✅ 沒有發現明顯問題！')
  }

  return lines.join('\n')
}

/**
 * Get category title for display
 * @param category - Diagnostic category
 * @param severity - Severity level
 * @returns User-friendly localized header
 */
export function getCategoryTitle(category: DiagnosticCategory, severity: DiagnosticSeverity): string {
  const severityPrefix = severity === 'high' ? '⚠️' : severity === 'medium' ? '💡' : '✨'
  return `${severityPrefix} ${category}`
}

/**
 * Icons for each category
 */
const GROUP_HEADER_ICONS: Record<DiagnosticCategory, string> = {
  structure: '🏗️',
  variable: '📦',
  asset: '🎨',
  block: '🧩',
  logic: '🧠',
  sprite: '🎭',
  stage: '🎭',
  extension: '🔌',
  'best-practice': '🌟',
}
