import * as fs from 'node:fs';
import * as path from 'node:path';

interface GameDesign {
  id: string;
  title: string;
  type: string;
  sprites: number;
  blocks: number;
  difficulty: string;
  version: string;
  created: string;
  designDoc: string;
  outputSb3: string;
  outputJson: string;
  spritesDef?: SpriteDef[];
  variables?: VariableDef[];
  lists?: ListDef[];
  scripts?: ScriptDef[];
}

interface SpriteDef {
  name: string;
  costumes: string[];
  x?: number;
  y?: number;
  direction?: number;
  visible?: boolean;
  draggable?: boolean;
}

interface VariableDef {
  name: string;
  value: number | string;
  sprite?: string;
}

interface ListDef {
  name: string;
  values: (number | string)[];
  sprite?: string;
}

interface ScriptDef {
  target: string;
  blocks: BlockDef[];
}

interface BlockDef {
  opcode: string;
  next?: string;
  parent?: string;
  inputs?: Record<string, any>;
  fields?: Record<string, any>;
}

/**
 * Parse game design from Markdown file.
 */
export function parseGameDesignFromMarkdown(content: string): GameDesign | null {
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
export function parseGameDesignFromJson(content: string): GameDesign | null {
  try {
    return JSON.parse(content) as GameDesign;
  } catch {
    return null;
  }
}

/**
 * Load game design from file.
 */
export function loadGameDesign(filePath: string): GameDesign | null {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');

  if (filePath.endsWith('.json')) {
    return parseGameDesignFromJson(content);
  } else if (filePath.endsWith('.md')) {
    return parseGameDesignFromMarkdown(content);
  } else {
    return null;
  }
}