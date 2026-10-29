/**
 * Aggregate Batch Results - Aggregate multiple batch manifests
 */

import { promises as fs } from 'node:fs';

import type { BatchManifest } from './manifest.js';

/**
 * Aggregate batch results
 * @param manifestPaths - Manifest file paths
 * @returns Aggregated result
 */
export async function aggregateBatchResults(manifestPaths: string[]): Promise<AggregatedResult> {
  const manifests: BatchManifest[] = [];
  const errors: string[] = [];
  
  // Read all manifests
  for (const manifestPath of manifestPaths) {
    try {
      const manifestText = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestText) as BatchManifest;
      manifests.push(manifest);
    } catch (error: any) {
      errors.push(`Failed to read ${manifestPath}: ${error.message}`);
    }
  }
  
  // Aggregate totals
  const total = manifests.reduce((sum, m) => sum + m.total, 0);
  const success = manifests.reduce((sum, m) => sum + m.success, 0);
  const fail = manifests.reduce((sum, m) => sum + m.fail, 0);
  
  // Calculate overall success rate
  const successRate = calculateSuccessRate({
    version: '1.0',
    toolVersion: 'aggregated',
    timestamp: new Date().toISOString(),
    total,
    success,
    fail,
    entries: manifests.flatMap(m => m.entries),
  });
  
  // Aggregate gate failure counts
  const gateFailureCounts: Record<string, number> = {};
  for (const manifest of manifests) {
    const counts = getGateFailureCounts(manifest);
    for (const [gate, count] of Object.entries(counts)) {
      gateFailureCounts[gate] = (gateFailureCounts[gate] || 0) + count;
    }
  }
  
  // Sort gate failure counts
  const sortedGateFailureCounts = Object.entries(gateFailureCounts)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [gate, count]) => ({ ...acc, [gate]: count }), {});
  
  return {
    total,
    success,
    fail,
    successRate,
    gateFailureCounts: sortedGateFailureCounts,
    manifestCount: manifests.length,
    errors,
  };
}

/**
 * Calculate success rate
 * @param manifest - Batch manifest
 * @returns Success rate (0-1)
 */
function calculateSuccessRate(manifest: BatchManifest): number {
  if (manifest.total === 0) return 1.0;
  return manifest.success / manifest.total;
}

/**
 * Get gate failure counts
 * @param manifest - Batch manifest
 * @returns Gate failure counts
 */
function getGateFailureCounts(manifest: BatchManifest): Record<string, number> {
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
 * Aggregated result
 */
export interface AggregatedResult {
  total: number;
  success: number;
  fail: number;
  successRate: number;
  gateFailureCounts: Record<string, number>;
  manifestCount: number;
  errors: string[];
}

/**
 * Generate aggregated result report
 * @param result - Aggregated result
 * @returns Report string
 */
export function generateAggregatedResultReport(result: AggregatedResult): string {
  const lines: string[] = [];
  
  lines.push('Aggregated Batch Results');
  lines.push('========================');
  lines.push('');
  lines.push(`Manifests processed: ${result.manifestCount}`);
  lines.push('');
  lines.push('Summary:');
  lines.push(`  - Total: ${result.total}`);
  lines.push(`  - Success: ${result.success}`);
  lines.push(`  - Fail: ${result.fail}`);
  lines.push(`  - Success rate: ${(result.successRate * 100).toFixed(1)}%`);
  lines.push('');
  
  if (Object.keys(result.gateFailureCounts).length > 0) {
    lines.push('Gate failure counts:');
    for (const [gate, count] of Object.entries(result.gateFailureCounts)) {
      lines.push(`  - ${gate}: ${count}`);
    }
    lines.push('');
  }
  
  if (result.errors.length > 0) {
    lines.push('Errors:');
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Generate machine-readable JSON report
 * @param result - Aggregated result
 * @returns JSON string
 */
export function generateAggregatedJsonReport(result: AggregatedResult): string {
  return JSON.stringify(
    {
      total: result.total,
      success: result.success,
      fail: result.fail,
      successRate: result.successRate,
      gateFailureCounts: result.gateFailureCounts,
      manifestCount: result.manifestCount,
    },
    null,
    2,
  );
}
