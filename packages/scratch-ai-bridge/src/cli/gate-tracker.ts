/**
 * Gate Tracker - Track gate failures and success rates
 */

import type { BatchManifest, GateResult } from './manifest.js';

/**
 * Gate statistics
 */
export interface GateStats {
  total: number;
  success: number;
  fail: number;
  successRate: number;
  gateFailureCounts: Record<string, number>;
}

/**
 * Track gate results
 * @param results - Gate results
 * @returns Gate statistics
 */
export function trackGates(results: GateResult[]): GateStats {
  const total = results.length;
  const success = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  
  const successRate = total > 0 ? success / total : 1.0;
  
  const gateFailureCounts: Record<string, number> = {};
  for (const result of results) {
    if (result.status === 'fail' && result.name) {
      gateFailureCounts[result.name] = (gateFailureCounts[result.name] || 0) + 1;
    }
  }
  
  return {
    total,
    success,
    fail,
    successRate,
    gateFailureCounts,
  };
}

/**
 * Track gate results from batch manifest
 * @param manifest - Batch manifest
 * @returns Gate statistics
 */
export function trackGatesFromManifest(manifest: BatchManifest): GateStats {
  const gateResults: GateResult[] = [];
  
  for (const entry of manifest.entries) {
    for (const result of entry.gateResults) {
      gateResults.push(result);
    }
  }
  
  return trackGates(gateResults);
}

/**
 * Generate gate statistics report
 * @param stats - Gate statistics
 * @returns Report string
 */
export function generateGateStatsReport(stats: GateStats): string {
  const lines: string[] = [];
  
  lines.push('Gate Statistics Report');
  lines.push('======================');
  lines.push('');
  lines.push('Summary:');
  lines.push(`  - Total gates: ${stats.total}`);
  lines.push(`  - Passed: ${stats.success}`);
  lines.push(`  - Failed: ${stats.fail}`);
  lines.push(`  - Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
  lines.push('');
  
  if (Object.keys(stats.gateFailureCounts).length > 0) {
    lines.push('Gate failure counts:');
    for (const [gate, count] of Object.entries(stats.gateFailureCounts)) {
      lines.push(`  - ${gate}: ${count}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Generate machine-readable JSON report
 * @param stats - Gate statistics
 * @returns JSON string
 */
export function generateGateStatsJson(stats: GateStats): string {
  return JSON.stringify(
    {
      total: stats.total,
      success: stats.success,
      fail: stats.fail,
      successRate: stats.successRate,
      gateFailureCounts: stats.gateFailureCounts,
    },
    null,
    2,
  );
}
