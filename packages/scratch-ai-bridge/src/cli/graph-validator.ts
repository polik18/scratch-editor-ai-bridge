/**
 * Graph Validator - Validates Scratch block graph structure
 */

/**
 * Graph validation result
 */
export interface GraphValidationResult {
  status: 'pass' | 'fail';
  errors: string[];
  warnings: string[];
  diagnostics: {
    blockCount: number;
    topBlockCount: number;
    nextLinkCount: number;
    parentLinkCount: number;
    inputLinkCount: number;
  };
}

/**
 * Validate Scratch block graph structure
 * @param projectJson - Parsed project.json content
 * @returns Validation result with errors, warnings, and diagnostics
 */
export function validateBlockGraph(projectJson: unknown): GraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Validate project structure
  if (typeof projectJson !== 'object' || projectJson === null) {
    errors.push('project.json must be a valid JSON object');
    return {
      status: 'fail',
      errors,
      warnings: [],
      diagnostics: {
        blockCount: 0,
        topBlockCount: 0,
        nextLinkCount: 0,
        parentLinkCount: 0,
        inputLinkCount: 0,
      },
    };
  }
  
  const pj = projectJson as Record<string, unknown>;
  
  // Collect all block IDs
  const allBlockIds = new Set<string>();
  const blockMap = new Map<string, Record<string, unknown>>();
  
  // Get all targets
  const targets = Array.isArray(pj.targets) ? pj.targets : [];
  
  for (const target of targets) {
    if (typeof target !== 'object' || target === null) {
      continue;
    }
    
    const t = target as Record<string, unknown>;
    
    // Get blocks
    const blocks = t.blocks;
    if (!blocks || typeof blocks !== 'object') {
      continue;
    }
    
    // Process each block
    for (const [blockId, block] of Object.entries(blocks)) {
      if (typeof block !== 'object' || block === null) {
        errors.push(`Block ${blockId} is not a valid object`);
        continue;
      }
      
      const b = block as Record<string, unknown>;
      const bid = String(blockId);
      
      allBlockIds.add(bid);
      blockMap.set(bid, b);
      
      // Validate block structure
      if (b.opcode === undefined) {
        errors.push(`Block ${bid} missing opcode`);
      }
      
      // Check next link
      if (b.next !== null && b.next !== undefined) {
        const nextId = String(b.next);
        if (nextId !== '' && !allBlockIds.has(nextId) && !blockMap.has(nextId)) {
          // Will check later after collecting all IDs
        }
      }
      
      // Check parent
      if (b.parent !== null && b.parent !== undefined) {
        const parentId = String(b.parent);
        if (parentId !== '' && !allBlockIds.has(parentId)) {
          // Will check later
        }
      }
      
      // Check inputs
      if (b.inputs && typeof b.inputs === 'object') {
        for (const inputName in b.inputs) {
          const input = (b.inputs as Record<string, unknown>)[inputName];
          if (Array.isArray(input) && input.length >= 2) {
            const [_, targetBlockId] = input as [string, string | number | [string, string, string]];
            if (typeof targetBlockId === 'string' && targetBlockId !== '' && !allBlockIds.has(targetBlockId)) {
              // Will check later
            }
          }
        }
      }
    }
  }
  
  // Second pass: validate links
  for (const [blockId, block] of blockMap.entries()) {
    const b = block as Record<string, unknown>;
    
    // Validate next link
    if (b.next !== null && b.next !== undefined) {
      const nextId = String(b.next);
      if (nextId !== '' && !blockMap.has(nextId)) {
        errors.push(`Block ${blockId} has invalid next reference: ${nextId}`);
      }
    }
    
    // Validate parent link
    if (b.parent !== null && b.parent !== undefined) {
      const parentId = String(b.parent);
      if (parentId !== '' && !blockMap.has(parentId)) {
        errors.push(`Block ${blockId} has invalid parent reference: ${parentId}`);
      }
    }
    
    // Validate input links
    if (b.inputs) {
      for (const [inputName, input] of Object.entries(b.inputs)) {
        if (Array.isArray(input) && input.length >= 2) {
          const [_, targetBlockId] = input as [string, string | number | [string, string, string]];
          if (typeof targetBlockId === 'string' && targetBlockId !== '' && !blockMap.has(targetBlockId)) {
            errors.push(`Block ${blockId} has invalid input "${inputName}" reference: ${targetBlockId}`);
          }
        }
      }
    }
  }
  
  // Count statistics
  const topBlockCount = Array.from(blockMap.values()).filter(b => (b as Record<string, unknown>).parent === null || (b as Record<string, unknown>).parent === undefined).length;
  const nextLinkCount = Array.from(blockMap.values()).filter(b => (b as Record<string, unknown>).next !== null && (b as Record<string, unknown>).next !== undefined && String((b as Record<string, unknown>).next) !== '').length;
  const parentLinkCount = Array.from(blockMap.values()).filter(b => (b as Record<string, unknown>).parent !== null && (b as Record<string, unknown>).parent !== undefined && String((b as Record<string, unknown>).parent) !== '').length;
  
  // Count input links (simplified)
  let inputLinkCount = 0;
  for (const block of blockMap.values()) {
    const b = block as Record<string, unknown>;
    if (b.inputs) {
      inputLinkCount += Object.keys(b.inputs).length;
    }
  }
  
  return {
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    diagnostics: {
      blockCount: blockMap.size,
      topBlockCount,
      nextLinkCount,
      parentLinkCount,
      inputLinkCount,
    },
  };
}

/**
 * Validate block graph reciprocity (next/parent/inputs all point to valid blocks)
 * @param projectJson - Parsed project.json content
 * @returns Validation result
 */
export function validateBlockGraphReciprocity(projectJson: unknown): { status: 'pass' | 'fail', errors: string[] } {
  const result = validateBlockGraph(projectJson);
  return {
    status: result.status,
    errors: result.errors,
  };
}
