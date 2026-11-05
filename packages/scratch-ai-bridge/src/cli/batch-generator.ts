/**
 * Batch Generator - Batch generation with machine-readable manifest.
 */
import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { compileCanonicalProjectToSb3 } from '../core/compiler/compiler.js'
import type { GameDesign } from '../core/ir/design-interface.js'
import { designToCanonicalIR } from './design-to-ir.js'
import { createManifestEntry, createBatchManifest, type GateResult, type ManifestEntry } from './manifest.js'

/**
 * Configuration options for batch project generation.
 */
export interface BatchOptions {
  outputDir?: string
  manifest?: string
  continueOnError?: boolean
}

/**
 * Summary metrics and logs from a batch run.
 */
export interface BatchResult {
  total: number
  success: number
  fail: number
  manifest?: string
  errors: string[]
}

/**
 * Generate SB3 from a single design file.
 * @param designPath - Path pointing to JSON game design document.
 * @param outputDir - Optional folder receiving the compiled binary.
 * @returns Result object containing compiled buffer or failure diagnostics.
 */
async function generateSingleDesign(
  designPath: string,
  outputDir?: string,
): Promise<{ sb3: Buffer | null; error: string | null; gateResults: GateResult[] }> {
  try {
    // Read design file
    const designText = await fs.readFile(designPath, 'utf-8')

    // Parse design
    const design = JSON.parse(designText) as unknown as GameDesign

    // Convert to Canonical IR
    const canonicalIR = designToCanonicalIR(design)

    // Compile to SB3
    const sb3Blob = await compileCanonicalProjectToSb3(canonicalIR)
    const sb3 = Buffer.from(await sb3Blob.arrayBuffer())

    // Write to output directory
    if (outputDir) {
      const outputFile = path.join(outputDir, `${path.basename(designPath, '.json')}.sb3`)
      await fs.writeFile(outputFile, sb3)
    }

    return {
      sb3,
      error: null,
      gateResults: [],
    }
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error)
    return {
      sb3: null,
      error: errMessage,
      gateResults: [{ name: 'unknown', status: 'fail', message: errMessage }],
    }
  }
}

/**
 * Batch generate SB3 files from multiple design inputs.
 * @param designPaths - Array of JSON design file paths.
 * @param outputDir - Destination folder for emitted files.
 * @param options - Execution flags controlling error handling.
 * @returns Aggregated metrics and failed item reports.
 */
export async function generateBatch(
  designPaths: string[],
  outputDir?: string,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const errors: string[] = []
  const entries: ManifestEntry[] = []
  let success = 0
  let fail = 0

  // Create output directory if not exists
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true })
  }

  // Generate each design
  for (const designPath of designPaths) {
    const result = await generateSingleDesign(designPath, outputDir)

    // Calculate input hash
    const designText = await fs.readFile(designPath, 'utf-8')
    const inputHash = await calculateHash(designText)

    // Create manifest entry
    const entry = createManifestEntry(
      inputHash,
      '1.0.0',
      result.gateResults,
      outputDir ? path.join(outputDir, `${path.basename(designPath, '.json')}.sb3`) : undefined,
      { designPath },
    )
    entries.push(entry)

    // Count success/fail
    if (result.error) {
      errors.push(`${designPath}: ${result.error}`)
      fail++
      if (!options.continueOnError) {
        break
      }
    } else {
      success++
    }
  }

  // Create batch manifest
  const manifest = createBatchManifest(entries, '1.0.0')

  // Write manifest if specified
  if (options.manifest) {
    await fs.writeFile(options.manifest, JSON.stringify(manifest, null, 2))
  }

  return {
    total: designPaths.length,
    success,
    fail,
    manifest: options.manifest,
    errors,
  }
}

/**
 * Calculate SHA-256 hash.
 * @param data - Input string to compute checksum for.
 * @returns Hex-encoded SHA-256 digest.
 */
async function calculateHash(data: string): Promise<string> {
  const crypto = await import('node:crypto')
  const hash = crypto.createHash('sha256')
  hash.update(data)
  return hash.digest('hex')
}

/**
 * Format a human-readable text report from batch generation results.
 * @param result - Aggregated metrics object.
 * @returns Formatted summary block suitable for printing.
 */
export function generateBatchResultReport(result: BatchResult): string {
  const lines: string[] = []

  lines.push('Batch Generation Result')
  lines.push('=======================')
  lines.push('')
  lines.push(`Total: ${result.total}`)
  lines.push(`Success: ${result.success}`)
  lines.push(`Fail: ${result.fail}`)

  if (result.errors.length > 0) {
    lines.push('')
    lines.push('Errors:')
    for (const error of result.errors) {
      lines.push(`  - ${error}`)
    }
  }

  return lines.join('\n')
}
