/**
 * Manifest Format - Machine-readable manifest for batch generation
 */

/**
 * Gate result
 */
export interface GateResult {
  name: string;
  status: 'pass' | 'fail' | 'not-run';
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Manifest entry for a single generation
 */
export interface ManifestEntry {
  inputHash: string;
  toolVersion: string;
  timestamp: string;
  gateResults: GateResult[];
  outputHash?: string;
  outputFile?: string;
  failurePath?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Batch manifest
 */
export interface BatchManifest {
  version: string;
  toolVersion: string;
  timestamp: string;
  total: number;
  success: number;
  fail: number;
  entries: ManifestEntry[];
}

/**
 * Create a manifest entry
 * @param inputHash - Input file hash
 * @param toolVersion - Tool version
 * @param gateResults - Gate results
 * @param outputFile - Output file path
 * @param metadata - Additional metadata
 * @returns Manifest entry
 */
export function createManifestEntry(
  inputHash: string,
  toolVersion: string,
  gateResults: GateResult[] = [],
  outputFile?: string,
  metadata?: Record<string, unknown>,
): ManifestEntry {
  const success = gateResults.every(r => r.status !== 'fail');
  
  return {
    inputHash,
    toolVersion,
    timestamp: new Date().toISOString(),
    gateResults,
    outputHash: outputFile ? `sha256:${outputFile}` : undefined,
    outputFile,
    failurePath: success ? undefined : gateResults.filter(r => r.status === 'fail').map(r => r.name),
    metadata,
  };
}

/**
 * Create a batch manifest
 * @param entries - Manifest entries
 * @param toolVersion - Tool version
 * @returns Batch manifest
 */
export function createBatchManifest(entries: ManifestEntry[], toolVersion: string): BatchManifest {
  const success = entries.filter(e => !e.failurePath).length;
  
  return {
    version: '1.0',
    toolVersion,
    timestamp: new Date().toISOString(),
    total: entries.length,
    success,
    fail: entries.length - success,
    entries,
  };
}

/**
 * Calculate success rate
 * @param manifest - Batch manifest
 * @returns Success rate (0-1)
 */
export function calculateSuccessRate(manifest: BatchManifest): number {
  if (manifest.total === 0) return 1.0;
  return manifest.success / manifest.total;
}

/**
 * Get gate failure counts
 * @param manifest - Batch manifest
 * @returns Gate failure counts
 */
export function getGateFailureCounts(manifest: BatchManifest): Record<string, number> {
  const counts: Record<string, number> = {};
  
  for (const entry of manifest.entries) {
    if (entry.failurePath) {
      for (const gate of entry.failurePath) {
        counts[gate] = (counts[gate] || 0) + 1;
      }
    }
  }
  
  return counts;
}

/**
 * Generate human-readable manifest report
 * @param manifest - Batch manifest
 * @returns Report string
 */
export function generateManifestReport(manifest: BatchManifest): string {
  const lines: string[] = [];
  
  lines.push('Batch Generation Manifest Report');
  lines.push('================================');
  lines.push('');
  lines.push(`Tool version: ${manifest.toolVersion}`);
  lines.push(`Generated at: ${manifest.timestamp}`);
  lines.push('');
  lines.push('Summary:');
  lines.push(`  - Total: ${manifest.total}`);
  lines.push(`  - Success: ${manifest.success}`);
  lines.push(`  - Fail: ${manifest.fail}`);
  lines.push(`  - Success rate: ${(calculateSuccessRate(manifest) * 100).toFixed(1)}%`);
  lines.push('');
  
  const gateCounts = getGateFailureCounts(manifest);
  if (Object.keys(gateCounts).length > 0) {
    lines.push('Gate failure counts:');
    for (const [gate, count] of Object.entries(gateCounts)) {
      lines.push(`  - ${gate}: ${count}`);
    }
    lines.push('');
  }
  
  lines.push('Entries:');
  for (const entry of manifest.entries) {
    lines.push(`  - ${entry.inputHash.substring(0, 8)}: ${entry.failurePath ? 'FAIL' : 'PASS'}`);
    if (entry.outputFile) {
      lines.push(`    Output: ${entry.outputFile}`);
    }
    if (entry.failurePath) {
      lines.push(`    Failed gates: ${entry.failurePath.join(', ')}`);
    }
  }
  
  return lines.join('\n');
}
