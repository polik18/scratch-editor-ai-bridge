import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileCanonicalProjectToSb3 } from '../core/compiler/compiler.js';
import { designToCanonicalIR } from './design-to-ir.js';
import type { GameDesign } from '../core/ir/design-interface.js';

/**
 * Parse game design from Markdown file.
 */
function parseGameDesignFromMarkdown(content: string): GameDesign | null {
  // Extract YAML frontmatter
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!yamlMatch) {
    return null;
  }

  const yaml = yamlMatch[1];
  const design: GameDesign = {
    id: '',
    title: '',
    type: '',
    sprites: 0,
    blocks: 0,
    difficulty: '',
    version: '1.0',
    created: new Date().toISOString(),
    designDoc: '',
    outputSb3: '',
    outputJson: '',
  };

  // Simple YAML parser
  const lines = yaml.split('\n');
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (!key || !valueParts.length) continue;
    const value = valueParts.join(':').trim();

    switch (key.trim()) {
      case 'id':
        design.id = value;
        break;
      case 'title':
        design.title = value;
        break;
      case 'type':
        design.type = value;
        break;
      case 'sprites':
        design.sprites = parseInt(value, 10) || 0;
        break;
      case 'blocks':
        design.blocks = parseInt(value, 10) || 0;
        break;
      case 'difficulty':
        design.difficulty = value;
        break;
      case 'version':
        design.version = value;
        break;
    }
  }

  return design;
}

/**
 * Parse game design from JSON file.
 */
function parseGameDesignFromJson(content: string): GameDesign | null {
  try {
    return JSON.parse(content) as GameDesign;
  } catch {
    return null;
  }
}

/**
 * Generate a complete game from design file.
 * This function now uses designToCanonicalIR to ensure complete field consumption.
 */
export async function generateGameFromDesign(designPath: string, outputDir: string): Promise<string> {
  const absoluteDesignPath = path.resolve(designPath);
  const content = fs.readFileSync(absoluteDesignPath, 'utf-8');
  
  let design: GameDesign | null = null;
  
  if (absoluteDesignPath.endsWith('.json')) {
    design = parseGameDesignFromJson(content);
  } else if (absoluteDesignPath.endsWith('.md')) {
    design = parseGameDesignFromMarkdown(content);
  }
  
  if (!design) {
    throw new Error(`Failed to parse game design from ${designPath}`);
  }

  console.log(`Creating game: ${design.title}`);
  console.log(`  Type: ${design.type}`);
  console.log(`  Difficulty: ${design.difficulty}`);
  console.log(`  Sprites: ${design.sprites}`);
  console.log(`  Blocks: ${design.blocks}`);

  // Use designToCanonicalIR to convert design to Canonical IR
  // This ensures all design fields are consumed
  console.log('  Converting design to Canonical IR...');
  const canonicalProject = designToCanonicalIR(design);
  
  // Compile Canonical IR to SB3
  console.log('  Compiling Canonical IR to SB3...');
  const sb3Blob = await compileCanonicalProjectToSb3(canonicalProject);
  
  // Save to file
  const outputSb3Path = path.join(outputDir, `${design.id}.sb3`);
  console.log(`  Saving to: ${outputSb3Path}`);
  
  // Write the blob to file
  const arrayBuffer = await sb3Blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  fs.writeFileSync(outputSb3Path, uint8Array);
  
  console.log(`✓ Game created successfully: ${outputSb3Path}`);

  return outputSb3Path;
}

/**
 * Generate a complete game from design JSON.
 */
export async function generateGameFromDesignJson(jsonPath: string, outputDir: string): Promise<string> {
  return generateGameFromDesign(jsonPath, outputDir);
}

/**
 * Generate a complete game from design Markdown.
 */
export async function generateGameFromDesignMarkdown(mdPath: string, outputDir: string): Promise<string> {
  return generateGameFromDesign(mdPath, outputDir);
}
