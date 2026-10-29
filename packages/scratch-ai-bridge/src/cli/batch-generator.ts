/**
 * Batch Generator - Batch generation with machine-readable manifest
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import { compileCanonicalProjectToSb3 } from '../core/compiler/compiler.js';
import { designToCanonicalIR } from './design-to-ir.js';
import { createManifestEntry, createBatchManifest } from './manifest.js';

/**
 * Batch generation options
 */
export interface BatchOptions {
  outputDir?: string;
  manifest?: string;
  continueOnError?: boolean;
}

/**
 * Batch generation result
 */
export interface BatchResult {
  total: number;
  success: number;
  fail: number;
  manifest?: string;
  errors: string[];
}

/**
 * Generate SB3 from a single design file
 * @param designPath - Design file path
 * @param outputDir - Output directory
 * @returns { sb3: Buffer | null, error: string | null, gateResults: any[] }
 */
async function generateSingleDesign(designPath: string, outputDir?: string): Promise<{ sb3: Buffer | null; error: string | null; gateResults: any[] }> {
  try {
    // Read design file
    const designText = await fs.readFile(designPath, 'utf-8');
    
    // Parse design
    const design = JSON.parse(designText);
    
    // Convert to Canonical IR
    const canonicalIR = designToCanonicalIR(design);
    
    // Compile to SB3
    const sb3Blob = await compileCanonicalProjectToSb3(canonicalIR);
    const sb3 = Buffer.from(await sb3Blob.arrayBuffer());
    
    // Write to output directory
    if (outputDir) {
      const outputFile = path.join(outputDir, path.basename(designPath, '.json') + '.sb3');
      await fs.writeFile(outputFile, sb3);
    }
    
    return {
      sb3,
      error: null,
      gateResults: [],
    };
  } catch (error: any) {
    return {
      sb3: null,
      error: error.message,
      gateResults: [{ name: 'unknown', status: 'fail', message: error.message }],
    };
  }
}

/**
 * Batch generate SB3 files
 * @param designPaths - Design file paths
 * @param outputDir - Output directory
 * @param options - Options
 * @returns Batch result
 */
export async function generateBatch(
  designPaths: string[],
  outputDir?: string,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const errors: string[] = [];
  const entries: any[] = [];
  let success = 0;
  let fail = 0;
  
  // Create output directory if not exists
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
  }
  
  // Generate each design
  for (const designPath of designPaths) {
    const result = await generateSingleDesign(designPath, outputDir);
    
    // Calculate input hash
    const designText = await fs.readFile(designPath, 'utf-8');
    const inputHash = await calculateHash(designText);
    
    // Create manifest entry
    const entry = createManifestEntry(
      inputHash,
      '1.0.0',
      result.gateResults,
      outputDir ? path.join(outputDir, path.basename(designPath, '.json') + '.sb3') : undefined,
      { designPath },
    );
    entries.push(entry);
    
    // Count success/fail
    if (result.error) {
      errors.push(`${designPath}: ${result.error}`);
      fail++;
      if (!options.continueOnError) {
        break;
      }
    } else {
      success++;
    }
  }
  
  // Create batch manifest
  const manifest = createBatchManifest(entries, '1.0.0');
  
  // Write manifest if specified
  if (options.manifest) {
    await fs.writeFile(options.manifest, JSON.stringify(manifest, null, 2));
  }
  
  return {
    total: designPaths.length,
    success,
    fail,
    manifest: options.manifest,
    errors,
  };
}

/**
 * Calculate SHA-256 hash
 * @param data - Data to hash
 * @returns Hash string
 */
async function calculateHash(data: string): Promise<string> {
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Generate batch result report
 * @param result - Batch result
 * @returns Report string
 */
export function generateBatchResultReport(result: BatchResult): string {
  const lines: string[] = [];
  
  lines.push('Batch Generation Result');
  lines.push('=======================');
  lines.push('');
  lines.push(`Total: ${result.total}`);
  lines.push(`Success: ${result.success}`);
  lines.push(`Fail: ${result.fail}`);
  
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }
  
  if (result.manifest) {
    lines.push('');
    lines.push(`Manifest written to: ${result.manifest}`);
  }
  
  return lines.join('\\n');
}
