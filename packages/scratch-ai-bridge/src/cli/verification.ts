/**
 * Verification - End-to-end verification of Scratch projects
 */

import { validateArchive, validateProjectJson } from './archive-validator.js';
import { validateBlockGraph } from './graph-validator.js';
import type { ArchiveValidationResult } from './archive-validator.js';
import type { GraphValidationResult } from './graph-validator.js';
import { ScratchSession } from './session/session.js';

/**
 * Verification result for end-to-end validation
 */
export interface VerificationResult {
  status: 'pass' | 'fail';
  gates: {
    archive: ArchiveValidationResult;
    projectJson: { status: 'pass' | 'fail', errors: string[] };
    blockGraph: GraphValidationResult;
    vmLoad?: { status: 'pass' | 'fail', error?: string };
    vmSave?: { status: 'pass' | 'fail', error?: string };
    vmReload?: { status: 'pass' | 'fail', error?: string };
  };
  diagnostics: {
    archive: {
      entryCount: number;
      hasProjectJson: boolean;
      assetCount: number;
    };
    blockGraph: {
      blockCount: number;
      topBlockCount: number;
    };
    overall: {
      gatesPassed: number;
      gatesTotal: number;
      errors: string[];
      warnings: string[];
    };
  };
}

/**
 * Perform archive validation
 */
export async function verifyArchive(archive: Uint8Array): Promise<ArchiveValidationResult> {
  return await validateArchive(archive);
}

/**
 * Perform project.json validation
 */
export function verifyProjectJson(projectJson: unknown): { status: 'pass' | 'fail', errors: string[] } {
  return validateProjectJson(projectJson);
}

/**
 * Perform block graph validation
 */
export function verifyBlockGraph(projectJson: unknown): GraphValidationResult {
  return validateBlockGraph(projectJson);
}

/**
 * Perform full end-to-end verification
 * @param archive - Raw archive bytes
 * @returns Verification result
 */
export async function verifyEndToEnd(archive: Uint8Array): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Step 1: Archive validation
  const archiveResult = await verifyArchive(archive);
  if (archiveResult.status === 'fail') {
    errors.push(...archiveResult.errors);
  }
  
  // Extract project.json for further validation
  let projectJson: unknown = null;
  try {
    const zip = await (await import('jszip')).default.loadAsync(archive);
    const projectEntry = zip.file('project.json');
    if (projectEntry) {
      const content = new TextDecoder().decode(await projectEntry.async('uint8array'));
      projectJson = JSON.parse(content);
    }
  } catch (err) {
    errors.push(`Failed to parse project.json: ${(err as Error).message}`);
    projectJson = null;
  }
  
  // Step 2: Project JSON validation
  let projectJsonResult: { status: 'pass' | 'fail', errors: string[] } = { status: 'fail', errors: ['No project.json'] };
  if (projectJson) {
    projectJsonResult = verifyProjectJson(projectJson);
    if (projectJsonResult.status === 'fail') {
      errors.push(...projectJsonResult.errors);
    }
  }
  
  // Step 3: Block graph validation
  let blockGraphResult: GraphValidationResult = { status: 'fail', errors: [], warnings: [], diagnostics: { blockCount: 0, topBlockCount: 0, nextLinkCount: 0, parentLinkCount: 0, inputLinkCount: 0 } };
  if (projectJson) {
    blockGraphResult = verifyBlockGraph(projectJson);
    if (blockGraphResult.status === 'fail') {
      errors.push(...blockGraphResult.errors);
    }
  }
  
  // Count gates
  let gatesPassed = 0;
  let gatesTotal = 3; // archive, projectJson, blockGraph
  
  if (archiveResult.status === 'pass') gatesPassed++;
  if (projectJsonResult.status === 'pass') gatesPassed++;
  if (blockGraphResult.status === 'pass') gatesPassed++;
  
  return {
    status: errors.length === 0 ? 'pass' : 'fail',
    gates: {
      archive: archiveResult,
      projectJson: projectJsonResult,
      blockGraph: blockGraphResult,
    },
    diagnostics: {
      archive: {
        entryCount: archiveResult.diagnostics.entryCount,
        hasProjectJson: archiveResult.diagnostics.hasProjectJson,
        assetCount: archiveResult.diagnostics.assetCount,
      },
      blockGraph: {
        blockCount: blockGraphResult.diagnostics.blockCount,
        topBlockCount: blockGraphResult.diagnostics.topBlockCount,
      },
      overall: {
        gatesPassed,
        gatesTotal,
        errors,
        warnings,
      },
    },
  };
}

/**
 * Verify a ScratchSession
 * @param session - ScratchSession instance
 * @returns Verification result
 */
export async function verifySession(session: ScratchSession): Promise<VerificationResult> {
  // Get raw archive
  const archive = await session.compile();
  return await verifyEndToEnd(archive);
}

/**
 * Generate human-readable verification report
 */
export function generateVerificationReport(result: VerificationResult): string {
  const lines: string[] = [];
  
  lines.push('=== Verification Report ===');
  lines.push(`Status: ${result.status.toUpperCase()}`);
  lines.push('');
  
  lines.push('Archive Validation:');
  lines.push(`  Status: ${result.gates.archive.status}`);
  lines.push(`  Entries: ${result.diagnostics.archive.entryCount}`);
  lines.push(`  Has project.json: ${result.diagnostics.archive.hasProjectJson}`);
  lines.push(`  Assets: ${result.diagnostics.archive.assetCount}`);
  if (result.gates.archive.warnings.length > 0) {
    lines.push(`  Warnings: ${result.gates.archive.warnings.length}`);
  }
  if (result.gates.archive.errors.length > 0) {
    lines.push(`  Errors:`);
    for (const err of result.gates.archive.errors) {
      lines.push(`    - ${err}`);
    }
  }
  lines.push('');
  
  lines.push('Project JSON Validation:');
  lines.push(`  Status: ${result.gates.projectJson.status}`);
  for (const error of result.gates.projectJson.errors) lines.push(`    - ${error}`);
  lines.push('');

  lines.push('Block Graph Validation:');
  lines.push(`  Status: ${result.gates.blockGraph.status}`);
  lines.push(`  Blocks: ${result.diagnostics.blockGraph.blockCount}`);
  lines.push(`  Top blocks: ${result.diagnostics.blockGraph.topBlockCount}`);
  if (result.gates.blockGraph.warnings.length > 0) {
    lines.push(`  Warnings: ${result.gates.blockGraph.warnings.length}`);
  }
  if (result.gates.blockGraph.errors.length > 0) {
    lines.push(`  Errors:`);
    for (const err of result.gates.blockGraph.errors) {
      lines.push(`    - ${err}`);
    }
  }
  lines.push('');
  
  lines.push('Summary:');
  lines.push(`  Gates passed: ${result.diagnostics.overall.gatesPassed}/${result.diagnostics.overall.gatesTotal}`);
  if (result.diagnostics.overall.errors.length > 0) {
    lines.push(`  Total errors: ${result.diagnostics.overall.errors.length}`);
  }
  if (result.diagnostics.overall.warnings.length > 0) {
    lines.push(`  Total warnings: ${result.diagnostics.overall.warnings.length}`);
  }
  
  return lines.join('\n');
}
