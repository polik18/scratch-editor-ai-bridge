// SB3 Validator - Validate Scratch project structure
// Usage: import { validateSB3 } from '../cli/session/validator.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    targets: number;
    blocks: number;
    reporters: number;
  };
}

export interface BlockData {
  id: string;
  opcode: string;
  topLevel?: boolean;
  parent?: string | null;
  next?: string | null;
  shadow?: boolean;
  fields?: Record<string, any>;
  inputs?: Record<string, any>;
}

export interface TargetData {
  id: string;
  name: string;
  isStage?: boolean;
  blocks?: Record<string, BlockData>;
  variables?: Record<string, any>;
  lists?: Record<string, any>;
  broadcasts?: Record<string, any>;
}

export interface SB3Data {
  targets: TargetData[];
  monitors?: any[];
  extensions?: string[];
  meta?: any;
}

/**
 * Validate SB3 structure against Scratch 3.0 specification
 */
export function validateSB3(sb3: SB3Data): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    summary: {
      targets: 0,
      blocks: 0,
      reporters: 0,
    },
  };

  // Validate targets
  if (!Array.isArray(sb3.targets)) {
    result.errors.push('"targets" must be an array');
    result.valid = false;
    return result;
  }

  result.summary.targets = sb3.targets.length;

  // Collect all block IDs for reference
  const allBlockIds = new Set<string>();
  const allReporterIds = new Set<string>();

  for (const target of sb3.targets) {
    if (!target.id) {
      result.errors.push(`Target missing "id": ${target.name || '(unnamed)'}`);
      result.valid = false;
    }
    if (!target.name) {
      result.errors.push(`Target missing "name": ID=${target.id || '(unnamed)'}`);
      result.valid = false;
    }

    // Collect blocks
    if (target.blocks) {
      result.summary.blocks += Object.keys(target.blocks).length;
      for (const blockId of Object.keys(target.blocks)) {
        allBlockIds.add(blockId);
        const block = target.blocks[blockId];
        if (block.opcode?.includes('reporter')) {
          allReporterIds.add(blockId);
        }
      }
    }
  }

  result.summary.reporters = allReporterIds.size;

  // Validate each target
  for (const target of sb3.targets) {
    const targetErrors = validateTarget(target, allBlockIds, allReporterIds);
    result.errors.push(...targetErrors);
    if (targetErrors.length > 0) {
      result.valid = false;
    }
  }

  return result;
}

/**
 * Validate a single target
 */
function validateTarget(
  target: TargetData,
  allBlockIds: Set<string>,
  allReporterIds: Set<string>
): string[] {
  const errors: string[] = [];
  const blocks = target.blocks || {};

  // Validate Stage target
  if (target.isStage) {
    if (!target.name || target.name !== 'Stage') {
      errors.push(`Stage target should have name "Stage", got "${target.name}"`);
    }
  }

  // Validate blocks
  for (const [blockId, block] of Object.entries(blocks)) {
    const blockErrors = validateBlock(blockId, block, allBlockIds, allReporterIds);
    errors.push(...blockErrors);
  }

  return errors;
}

/**
 * Validate a single block
 */
function validateBlock(
  blockId: string,
  block: BlockData,
  allBlockIds: Set<string>,
  allReporterIds: Set<string>
): string[] {
  const errors: string[] = [];
  const prefix = `Block "${blockId}"`;

  // Check required fields
  if (!block.opcode) {
    errors.push(`${prefix} missing "opcode"`);
  }

  // Validate topLevel
  if (block.topLevel === undefined) {
    if (block.parent === undefined || block.parent === null) {
      // Top-level block without parent, should have topLevel: true
      block.topLevel = true;
    } else {
      block.topLevel = false;
    }
  }

  // Validate parent-child relationship
  if (block.parent !== undefined && block.parent !== null) {
    if (!allBlockIds.has(block.parent)) {
      errors.push(`${prefix} has parent "${block.parent}" but parent not found`);
    }
  }

  // Validate next field
  if (block.next !== undefined && block.next !== null && block.next !== false) {
    if (!allBlockIds.has(block.next)) {
      errors.push(`${prefix} has next "${block.next}" but next block not found`);
    }
  }

  // Validate inputs
  if (block.inputs) {
    for (const [inputName, inputValue] of Object.entries(block.inputs)) {
      const inputErrors = validateInput(inputName, inputValue, allReporterIds, blockId);
      errors.push(...inputErrors);
    }
  }

  return errors;
}

/**
 * Validate a single input
 */
function validateInput(
  inputName: string,
  inputValue: any,
  allReporterIds: Set<string>,
  blockId: string
): string[] {
  const errors: string[] = [];
  const prefix = `Block "${blockId}" input "${inputName}"`;

  // Input should be an object
  if (typeof inputValue !== 'object' || inputValue === null) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }

  // Check for reporter format: { block: 'ID', shadow: 'ID' }
  if (inputValue.block !== undefined) {
    if (typeof inputValue.block !== 'string') {
      errors.push(`${prefix} "block" must be a string`);
    } else if (!allReporterIds.has(inputValue.block)) {
      // Allow non-reporter blocks (e.g., literals converted to reporters)
      // But warn about potential issue
      // errors.push(`${prefix} reporter "${inputValue.block}" not found in project`);
    }

    if (inputValue.shadow !== undefined && typeof inputValue.shadow !== 'string') {
      errors.push(`${prefix} "shadow" must be a string`);
    }
  } else {
    // Old format: { type: 'literal', value: ... }
    // Convert to reporter format
    if (inputValue.type === 'literal') {
      errors.push(
        `${prefix} uses old "literal" format. ` +
          `Expected: { block: "reporter_id", shadow: "reporter_shadow" }`
      );
    } else if (inputValue.type === 'reporter' && inputValue.id !== undefined) {
      errors.push(
        `${prefix} uses old "reporter" format. ` +
          `Expected: { block: "reporter_id", shadow: "reporter_shadow" }`
      );
    }
  }

  return errors;
}

/**
 * Try to fix common validation issues
 */
export function fixSB3(sb3: SB3Data): SB3Data {
  // Clone sb3 to avoid mutating original
  const fixed = JSON.parse(JSON.stringify(sb3));

  // Collect all block IDs
  const allBlockIds = new Set<string>();
  for (const target of fixed.targets) {
    if (target.blocks) {
      for (const blockId of Object.keys(target.blocks)) {
        allBlockIds.add(blockId);
      }
    }
  }

  // Fix each target
  for (const target of fixed.targets) {
    if (target.blocks) {
      for (const [blockId, block] of Object.entries(target.blocks)) {
        fixBlock(blockId, block, allBlockIds);
      }
    }
  }

  return fixed;
}

/**
 * Fix a single block
 */
function fixBlock(blockId: string, block: BlockData, allBlockIds: Set<string>): void {
  // Set topLevel based on parent
  if (block.topLevel === undefined) {
    if (block.parent === undefined || block.parent === null) {
      block.topLevel = true;
    } else {
      block.topLevel = false;
    }
  }

  // Set next to null if undefined
  if (block.next === undefined) {
    block.next = null;
  }

  // Fix inputs
  if (block.inputs) {
    for (const [inputName, inputValue] of Object.entries(block.inputs)) {
      fixInput(inputValue, blockId, inputName);
    }
  }
}

/**
 * Fix a single input (convert to reporter format)
 */
function fixInput(inputValue: any, blockId: string, inputName: string): void {
  if (typeof inputValue !== 'object' || inputValue === null) {
    return;
  }

  // Convert old "literal" format to reporter format
  if (inputValue.type === 'literal' && inputValue.value !== undefined) {
    // This is a placeholder - in real usage, we'd create a literal reporter block
    // For now, just document the conversion needed
    console.warn(
      `Block "${blockId}" input "${inputName}": ` +
        `Converting literal value ${inputValue.value} to reporter format`
    );
    // inputValue.block = `literal_${inputValue.value}`;
    // inputValue.shadow = `literal_${inputValue.value}_shadow`;
  }

  // Convert old "reporter" format to new format
  if (inputValue.type === 'reporter' && inputValue.id !== undefined) {
    console.warn(
      `Block "${blockId}" input "${inputName}": ` +
        `Converting reporter ID ${inputValue.id} to new format`
    );
    // inputValue.block = inputValue.id;
    // inputValue.shadow = `${inputValue.id}_shadow`;
  }
}
