/**
 * Manifest Format - Machine-readable manifest for batch generation.
 */

/**
 * Inspection outcome of an individual validation gate.
 */
export interface GateResult {
  name: string
  status: 'pass' | 'fail' | 'not-run'
  message?: string
  details?: Record<string, unknown>
}

/**
 * Manifest entry for a single generation.
 */
export interface ManifestEntry {
  inputHash: string
  toolVersion: string
  timestamp: string
  gateResults: GateResult[]
  outputHash?: string
  outputFile?: string
  failurePath?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Aggregated run results covering all processed designs.
 */
export interface BatchManifest {
  version: string
  toolVersion: string
  timestamp: string
  total: number
  success: number
  fail: number
  entries: ManifestEntry[]
}

/**
 * Create a manifest entry.
 * @param inputHash - Checksum of source design JSON.
 * @param toolVersion - Semantic version of generation tool.
 * @param gateResults - Verification outcomes for this artifact.
 * @param outputFile - Location of emitted SB3 file.
 * @param metadata - Arbitrary contextual key-value pairs.
 * @returns Serialized entry record.
 */
export function createManifestEntry(
  inputHash: string,
  toolVersion: string,
  gateResults: GateResult[] = [],
  outputFile?: string,
  metadata?: Record<string, unknown>,
): ManifestEntry {
  const success = gateResults.every((r) => r.status !== 'fail')

  return {
    inputHash,
    toolVersion,
    timestamp: new Date().toISOString(),
    gateResults,
    outputHash: outputFile ? `sha256:${outputFile}` : undefined,
    outputFile,
    failurePath: success ? undefined : gateResults.filter((r) => r.status === 'fail').map((r) => r.name),
    metadata,
  }
}

/**
 * Create a batch manifest.
 * @param entries - Collection of individual output records.
 * @param toolVersion - Semantic version string of pipeline tool.
 * @returns Master manifest object covering the batch run.
 */
export function createBatchManifest(entries: ManifestEntry[], toolVersion: string): BatchManifest {
  const success = entries.filter((e) => !e.failurePath).length

  return {
    version: '1.0',
    toolVersion,
    timestamp: new Date().toISOString(),
    total: entries.length,
    success,
    fail: entries.length - success,
    entries,
  }
}

/**
 * Compute the fraction of successful generation jobs.
 * @param manifest - Batch manifest data to analyze.
 * @returns Decimal ratio between 0.0 and 1.0.
 */
export function calculateSuccessRate(manifest: BatchManifest): number {
  if (manifest.total === 0) return 1.0
  return manifest.success / manifest.total
}

/**
 * Tally how many times each verification gate failed.
 * @param manifest - Batch manifest containing execution traces.
 * @returns Mapping of gate identifiers to failure counts.
 */
export function getGateFailureCounts(manifest: BatchManifest): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const entry of manifest.entries) {
    if (entry.failurePath) {
      for (const gate of entry.failurePath) {
        counts[gate] = (counts[gate] || 0) + 1
      }
    }
  }

  return counts
}

/**
 * Generate human-readable manifest report.
 * @param manifest - Source manifest to format.
 * @returns Plain text summary block.
 */
export function generateManifestReport(manifest: BatchManifest): string {
  const lines: string[] = []

  lines.push('Batch Generation Manifest Report')
  lines.push('================================')
  lines.push('')
  lines.push(`Tool version: ${manifest.toolVersion}`)
  lines.push(`Generated at: ${manifest.timestamp}`)
  lines.push('')
  lines.push('Summary:')
  lines.push(`  - Total: ${manifest.total}`)
  lines.push(`  - Success: ${manifest.success}`)
  lines.push(`  - Fail: ${manifest.fail}`)
  lines.push(`  - Success rate: ${(calculateSuccessRate(manifest) * 100).toFixed(1)}%`)
  lines.push('')

  const failureCounts = getGateFailureCounts(manifest)
  if (Object.keys(failureCounts).length > 0) {
    lines.push('Gate failures:')
    for (const [gate, count] of Object.entries(failureCounts)) {
      lines.push(`  - ${gate}: ${count}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
