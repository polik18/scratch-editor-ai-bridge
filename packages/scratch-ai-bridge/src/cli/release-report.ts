/**
 * Release Report - Generate release report with gate statistics.
 */
import { trackGatesFromManifest } from './gate-tracker.js'
import type { BatchManifest } from './manifest.js'

/**
 * Single test case entry included in the release summary.
 */
export interface TestCaseReportItem {
  name: string
  type: string
  result: string
}

/**
 * Failure item detailing broken gates and root causes.
 */
export interface FailureCaseReportItem {
  id: string
  title: string
  gate: string
  reason: string
}

/**
 * Structured metrics and changelog payload for release readiness.
 */
export interface ReleaseReportData {
  version: string
  date: string
  commit: string
  success: number
  fail: number
  total: number
  successRate: number
  gateStats: Record<string, unknown>
  uncoveredTypes: string[]
  knownIssues: string[]
  testCases: TestCaseReportItem[]
  failureCases: FailureCaseReportItem[]
  correctiveActions: string[]
  nextActions: string[]
}

/**
 * Format markdown release documentation from batch results.
 * @param manifest - Source batch execution records.
 * @param data - Release metrics and qualitative issue lists.
 * @returns Markdown document text.
 */
export function generateReleaseReport(manifest: BatchManifest, data: ReleaseReportData): string {
  const lines: string[] = []

  lines.push('# Release Report')
  lines.push('')
  lines.push('## Version Information')
  lines.push('')
  lines.push(`- Version: ${data.version}`)
  lines.push(`- Release Date: ${data.date}`)
  lines.push(`- Commit: ${data.commit}`)
  lines.push('')
  lines.push('## End-to-End Success Rate')
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('|--------|-------|')
  lines.push(`| Success | ${data.success} |`)
  lines.push(`| Fail | ${data.fail} |`)
  lines.push(`| Total | ${data.total} |`)
  lines.push(`| Success Rate | ${(data.successRate * 100).toFixed(1)}% |`)
  lines.push('')
  lines.push('## Gate Failure Statistics')
  lines.push('')
  lines.push('| Gate | Fail Count | Percentage |')
  lines.push('|------|------------|------------|')

  const gateStats = trackGatesFromManifest(manifest)
  for (const [gate, count] of Object.entries(gateStats.gateFailureCounts)) {
    const percentage = ((count / gateStats.total) * 100).toFixed(1)
    lines.push(`| ${gate} | ${count} | ${percentage}% |`)
  }
  lines.push('')
  lines.push('## Uncovered Types')
  lines.push('')
  for (const type of data.uncoveredTypes) {
    lines.push(`- ${type}`)
  }
  lines.push('')
  lines.push('## Known Issues')
  lines.push('')
  for (const issue of data.knownIssues) {
    lines.push(`- ${issue}`)
  }
  lines.push('')
  lines.push('## Test Cases')
  lines.push('')
  lines.push('| Case | Type | Result |')
  lines.push('|------|------|--------|')
  for (const testCase of data.testCases) {
    lines.push(`| ${testCase.name} | ${testCase.type} | ${testCase.result} |`)
  }
  lines.push('')
  lines.push('## Failure Cases')
  lines.push('')
  lines.push('| ID | Title | Gate | Reason |')
  lines.push('|----|-------|------|--------|')
  for (const failureCase of data.failureCases) {
    lines.push(`| ${failureCase.id} | ${failureCase.title} | ${failureCase.gate} | ${failureCase.reason} |`)
  }
  lines.push('')
  lines.push('## Corrective Actions')
  lines.push('')
  for (const action of data.correctiveActions) {
    lines.push(`- ${action}`)
  }
  lines.push('')
  lines.push('## Next Actions')
  lines.push('')
  for (const action of data.nextActions) {
    lines.push(`- ${action}`)
  }

  return lines.join('\n')
}

/**
 * Serialize release report data into formatted JSON.
 * @param data - Metrics and changelog payload to serialize.
 * @returns Indented JSON representation.
 */
export function generateReleaseJsonReport(data: ReleaseReportData): string {
  return JSON.stringify(data, null, 2)
}
