/**
 * Archive Validator - Validates SB3 ZIP structure and basic integrity
 */

import JSZip from 'jszip';
import type { RawArchiveIR } from '../core/ir/raw-archive.js';

/**
 * Validate SB3 archive structure and basic integrity
 */
export interface ArchiveValidationResult {
  status: 'pass' | 'fail' | 'skipped';
  errors: string[];
  warnings: string[];
  diagnostics: {
    hasProjectJson: boolean;
    hasEntries: boolean;
    entryCount: number;
    hasAssets: boolean;
    assetCount: number;
    md5extCoverage: number;
  };
}

/**
 * Validate SB3 archive structure and basic integrity
 * @param archive - Raw archive bytes
 * @returns Validation result with errors, warnings, and diagnostics
 */
export async function validateArchive(archive: Uint8Array): Promise<ArchiveValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    const zip = await JSZip.loadAsync(archive);
    
    // Check for project.json
    const projectJsonEntry = zip.file('project.json');
    const hasProjectJson = !!projectJsonEntry;
    if (!hasProjectJson) {
      errors.push('Missing project.json in SB3 archive');
    }
    
    // Get all entries
    const allEntries = zip.files;
    const entryCount = Object.keys(allEntries).length;
    const hasEntries = entryCount > 0;
    
    const project = projectJsonEntry ? JSON.parse(await projectJsonEntry.async('string')) as {
      targets?: { costumes?: { md5ext?: unknown }[]; sounds?: { md5ext?: unknown }[] }[];
    } : undefined;
    const assetNames = new Set<string>();
    for (const [targetIndex, target] of (project?.targets ?? []).entries()) {
      for (const [kind, entries] of [['costumes', target.costumes ?? []], ['sounds', target.sounds ?? []]] as const) {
        for (const [assetIndex, asset] of entries.entries()) {
          if (typeof asset.md5ext !== 'string' || asset.md5ext.length === 0) {
            errors.push(`/targets/${targetIndex}/${kind}/${assetIndex} is missing md5ext`);
            continue;
          }
          assetNames.add(asset.md5ext);
          if (!zip.file(asset.md5ext)) errors.push(`Missing referenced asset entry "${asset.md5ext}"`);
        }
      }
    }

    const assetCount = assetNames.size;
    const md5extCoverage = [...assetNames].filter((name) => Boolean(zip.file(name))).length;
    const hasAssets = assetCount > 0 && md5extCoverage === assetCount;
    
    return {
      status: errors.length === 0 ? 'pass' : 'fail',
      errors,
      warnings,
      diagnostics: {
        hasProjectJson,
        hasEntries,
        entryCount,
        hasAssets,
        assetCount,
        md5extCoverage,
      }
    };
  } catch (error) {
    errors.push(`Failed to parse SB3 archive: ${(error as Error).message}`);
    return {
      status: 'fail',
      errors,
      warnings: [],
      diagnostics: {
        hasProjectJson: false,
        hasEntries: false,
        entryCount: 0,
        hasAssets: false,
        assetCount: 0,
        md5extCoverage: 0,
      }
    };
  }
}

/**
 * Validate project.json content structure
 * @param projectJson - Parsed project.json content
 * @returns Validation result
 */
export function validateProjectJson(projectJson: unknown): { status: 'pass' | 'fail', errors: string[] } {
  const errors: string[] = [];
  
  if (typeof projectJson !== 'object' || projectJson === null) {
    errors.push('project.json must be a valid JSON object');
    return { status: 'fail', errors };
  }
  
  const pj = projectJson as Record<string, unknown>;
  
  // Check for required top-level fields
  const requiredFields = ['targets', 'extensions', 'meta'];
  for (const field of requiredFields) {
    if (pj[field] === undefined) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Validate targets
  if (Array.isArray(pj.targets)) {
    for (let i = 0; i < pj.targets.length; i++) {
      const target = pj.targets[i];
      if (typeof target !== 'object' || target === null) {
        errors.push(`Target ${i} must be a valid object`);
        continue;
      }
      
      const t = target as Record<string, unknown>;
      
      // Check for required target fields
      if (t.isStage === undefined) {
        errors.push(`Target ${i} missing isStage field`);
      }
      if (t.name === undefined) {
        errors.push(`Target ${i} missing name field`);
      }
      if (t.variables === undefined) {
        errors.push(`Target ${i} missing variables field`);
      }
      if (t.blocks === undefined) {
        errors.push(`Target ${i} missing blocks field`);
      }
      if (t.costumes === undefined) {
        errors.push(`Target ${i} missing costumes field`);
      }
      if (t.sounds === undefined && t.isStage !== true) {
        errors.push(`Target ${i} missing sounds field`);
      }
    }
  } else {
    errors.push('targets must be an array');
  }
  
  return {
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
  };
}

/**
 * Create a RawArchiveIR from validated archive
 * @param archive - Raw archive bytes
 * @param projectJson - Parsed project.json content
 * @returns RawArchiveIR object
 */
export async function createRawArchiveIR(archive: Uint8Array, projectJson: unknown): Promise<RawArchiveIR> {
  const zip = await JSZip.loadAsync(archive);
  
  const entries: Record<string, Uint8Array> = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) {
      entries[name] = new Uint8Array(await file.async('uint8array'));
    }
  }
  
  return {
    projectJson,
    entries,
    comment: '',
    warnings: [],
  };
}
