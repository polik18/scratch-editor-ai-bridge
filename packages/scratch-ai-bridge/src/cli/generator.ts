/**
 * Generator - Single entry point for game generation
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import { compileCanonicalProjectToSb3 } from '../core/compiler/compiler.js';
import { CANONICAL_IR_FORMAT, type CanonicalProject } from '../core/ir/types.js';
import { designToCanonicalIR } from './design-to-ir.js';
import { createManifestEntry } from './manifest.js';

/**
 * Generator options
 */
export interface GeneratorOptions {
  outputDir?: string;
  manifest?: string;
  continueOnError?: boolean;
}

/**
 * Generator result
 */
export interface GeneratorResult {
  success: boolean;
  output?: string;
  manifest?: ManifestEntry;
  diagnostics: Diagnostic[];
}

/**
 * Manifest entry
 */
interface ManifestEntry {
  inputHash: string;
  toolVersion: string;
  gateResults: GateResult[];
  outputHash?: string;
  failurePath?: string[];
}

/**
 * Gate result
 */
interface GateResult {
  name: string;
  status: 'pass' | 'fail';
  message?: string;
}

/**
 * Diagnostic
 */
interface Diagnostic {
  type: 'error' | 'warning';
  stage: string;
  code: string;
  message: string;
  suggestion: string;
  location?: {
    target?: string;
    index?: number;
  };
}

/**
 * Generate game from input
 * @param input - Path to design file (JSON or Markdown)
 * @param options - Options
 * @returns Generator result
 */
export async function generateGame(
  input: string,
  options: GeneratorOptions = {},
): Promise<GeneratorResult> {
  const diagnostics: Diagnostic[] = [];
  
  try {
    // Read input file
    const inputText = await fs.readFile(input, 'utf-8');
    
    // Calculate input hash
    const inputHash = await calculateHash(inputText);
    
    // Parse design (JSON or Markdown)
    const design = parseDesign(inputText, input);

    // Canonical IR is the lossless, validated generation input. Keep the
    // legacy GameDesign adapter for its spritesDef format, but reject the
    // documented sprites[] shape that the adapter cannot currently consume.
    const canonicalIR = isCanonicalProject(design)
      ? design
      : (() => {
          if (Array.isArray(design?.sprites) && design.sprites.length > 0 && !Array.isArray(design.spritesDef)) {
            throw new Error('GameDesign sprites[] is not supported yet; provide a Canonical IR project instead.');
          }
          return designToCanonicalIR(design);
        })();
    
    // Compile to SB3
    const sb3Blob = await compileCanonicalProjectToSb3(canonicalIR);
    const sb3 = Buffer.from(await sb3Blob.arrayBuffer());
    
    // Calculate output hash
    const outputHash = await calculateHash(sb3);
    
    // Write to output directory
    let outputPath: string | undefined = undefined;
    if (options.outputDir) {
      await fs.mkdir(options.outputDir, { recursive: true });
      const outputFile = path.join(options.outputDir, path.basename(input, path.extname(input)) + '.sb3');
      await fs.writeFile(outputFile, sb3);
      outputPath = outputFile;
    }
    
    // Create manifest entry
    const manifest = createManifestEntry(
      inputHash,
      '0.1.0',
      [{ name: 'generate', status: 'pass' }],
      outputPath,
      { input },
    );
    manifest.outputHash = `sha256:${outputHash}`;
    
    return {
      success: true,
      output: outputPath,
      manifest,
      diagnostics,
    };
  } catch (error: any) {
    diagnostics.push({
      type: 'error',
      stage: 'generate',
      code: 'GENERATE_ERROR',
      message: error.message,
      suggestion: 'Check input file format and content',
    });
    
    return {
      success: false,
      diagnostics,
    };
  }
}

function isCanonicalProject(value: unknown): value is CanonicalProject {
  return typeof value === 'object' && value !== null && 'format' in value && value.format === CANONICAL_IR_FORMAT;
}

/**
 * Parse design from text
 * @param text - Input text
 * @param _path - File path (unused)
 * @returns Design object
 */
function parseDesign(text: string, _path: string): any {
  // Try JSON first
  try {
    return JSON.parse(text);
  } catch {
    // If JSON fails, try Markdown
    return parseMarkdownDesign(text);
  }
}

/**
 * Parse Markdown design
 * @param text - Markdown text
 * @returns Design object
 */
function parseMarkdownDesign(text: string): any {
  // Simplified Markdown parser
  const lines = text.split('\\n');
  const design: any = {
    sprites: [],
    variables: [],
    lists: [],
    scripts: [],
  };
  
  let currentSprite: any = null;
  
  for (const line of lines) {
    if (line.startsWith('# ')) {
      design.title = line.slice(2);
    } else if (line.startsWith('## Sprites')) {
      currentSprite = null;
    } else if (line.startsWith('### ')) {
      currentSprite = {
        name: line.slice(4),
        costumes: [],
        sounds: [],
      };
      design.sprites.push(currentSprite);
    } else if (line.includes('Position:')) {
      // Parse position
    } else if (line.includes('costumes:')) {
      // Parse costumes
    } else if (line.includes('sounds:')) {
      // Parse sounds
    }
  }
  
  return design;
}

/**
 * Calculate SHA-256 hash
 * @param data - Data to hash
 * @returns Hash string
 */
async function calculateHash(data: string | Buffer): Promise<string> {
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

/**
 * Generate game result report
 * @param result - Generator result
 * @returns Report string
 */
export function generateGameResultReport(result: GeneratorResult): string {
  const lines: string[] = [];
  
  lines.push('Game Generation Result');
  lines.push('======================');
  lines.push('');
  lines.push(`Success: ${result.success ? 'Yes' : 'No'}`);
  
  if (result.output) {
    lines.push(`Output: ${result.output}`);
  }
  
  if (result.diagnostics.length > 0) {
    lines.push('');
    lines.push('Diagnostics:');
    for (const diagnostic of result.diagnostics) {
      lines.push(`  - [${diagnostic.type.toUpperCase()}] ${diagnostic.code}: ${diagnostic.message}`);
      lines.push(`    Suggestion: ${diagnostic.suggestion}`);
    }
  }
  
  return lines.join('\\n');
}
