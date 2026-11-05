/**
 * Graph Validator - Validates Scratch block graph structure.
 */

/**
 * Detailed outcome produced by validating block graph integrity.
 */
export interface GraphValidationResult {
  status: 'pass' | 'fail'
  errors: string[]
  warnings: string[]
  diagnostics: {
    blockCount: number
    topBlockCount: number
    nextLinkCount: number
    parentLinkCount: number
    inputLinkCount: number
  }
}

/**
 * Validate Scratch block graph structure.
 * @param projectJson - Parsed project.json content to inspect.
 * @returns Validation result with errors, warnings, and diagnostics.
 */
export function validateBlockGraph(projectJson: unknown): GraphValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate project structure
  if (typeof projectJson !== 'object' || projectJson === null) {
    errors.push('project.json must be a valid JSON object')
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
    }
  }

  const pj = projectJson as Record<string, unknown>

  // Collect all block IDs
  const allBlockIds = new Set<string>()
  const blockMap = new Map<string, Record<string, unknown>>()
  const localReferences: { blockId: string; localIds: Set<string>; reference: string; relation: string }[] = []

  // Get all targets
  const targets = Array.isArray(pj.targets) ? pj.targets : []

  for (const target of targets) {
    if (typeof target !== 'object' || target === null) {
      continue
    }

    const t = target as Record<string, unknown>

    // Get blocks
    const blocks = t.blocks
    if (!blocks || typeof blocks !== 'object') {
      continue
    }
    const localIds = new Set(Object.keys(blocks))

    // Process each block
    for (const [blockId, block] of Object.entries(blocks)) {
      if (typeof block !== 'object' || block === null) {
        errors.push(`Block ${blockId} is not a valid object`)
        continue
      }

      const b = block as Record<string, unknown>
      const bid = String(blockId)

      allBlockIds.add(bid)
      blockMap.set(bid, b)
      for (const relation of ['next', 'parent'] as const) {
        const ref = b[relation]
        if (typeof ref === 'string' && ref) localReferences.push({ blockId: bid, localIds, reference: ref, relation })
      }

      // Validate block structure
      if (b.opcode === undefined) {
        errors.push(`Block ${bid} missing opcode`)
      }
      const invalidOpcodes: Record<string, string> = {
        motion_goto_xy: 'motion_gotoxy',
        motion_bounce_off_edge: 'motion_ifonedgebounce',
        sense_touchingobject: 'sensing_touchingobject',
      }
      if (typeof b.opcode === 'string' && invalidOpcodes[b.opcode]) {
        errors.push(`Block ${bid} has invalid opcode "${b.opcode}"; use "${invalidOpcodes[b.opcode]}"`)
      }

      // Check next link
      if (typeof b.next === 'string' && b.next !== '') {
        const nextId = b.next
        if (!allBlockIds.has(nextId) && !blockMap.has(nextId)) {
          // Will check later after collecting all IDs
        }
      }

      // Check parent
      if (typeof b.parent === 'string' && b.parent !== '') {
        const parentId = b.parent
        if (!allBlockIds.has(parentId)) {
          // Will check later
        }
      }

      // Check inputs
      if (b.inputs && typeof b.inputs === 'object') {
        for (const inputName in b.inputs) {
          const input = (b.inputs as Record<string, unknown>)[inputName]
          if (!Array.isArray(input)) {
            errors.push(`Block ${bid} input "${inputName}" must use Scratch SB3 array format`)
            continue
          }
          for (const ref of input.slice(1)) {
            if (typeof ref === 'string' && ref)
              localReferences.push({ blockId: bid, localIds, reference: ref, relation: `input "${inputName}"` })
          }
          if (Array.isArray(input) && input.length >= 2) {
            const [, targetBlockId] = input as [string, string | number | [string, string, string]]
            if (typeof targetBlockId === 'string' && targetBlockId !== '' && !allBlockIds.has(targetBlockId)) {
              // Will check later
            }
          }
        }
      }
    }
  }

  for (const { blockId, localIds, reference, relation } of localReferences) {
    if (!localIds.has(reference) && allBlockIds.has(reference)) {
      errors.push(`Block ${blockId} ${relation} points to block ${reference} on a different target`)
    }
  }

  // Second pass: validate links
  for (const [blockId, b] of blockMap.entries()) {
    // Validate next link
    if (typeof b.next === 'string' && b.next !== '') {
      const nextId = b.next
      if (!blockMap.has(nextId)) {
        errors.push(`Block ${blockId} has invalid next reference: ${nextId}`)
      }
    }

    // Validate parent link
    if (typeof b.parent === 'string' && b.parent !== '') {
      const parentId = b.parent
      if (!blockMap.has(parentId)) {
        errors.push(`Block ${blockId} has invalid parent reference: ${parentId}`)
      }
    }

    // Validate input links
    if (b.inputs && typeof b.inputs === 'object') {
      for (const [inputName, input] of Object.entries(b.inputs as Record<string, unknown>)) {
        if (Array.isArray(input) && input.length >= 2) {
          const [, targetBlockId] = input as [string, string | number | [string, string, string]]
          if (typeof targetBlockId === 'string' && targetBlockId !== '' && !blockMap.has(targetBlockId)) {
            errors.push(`Block ${blockId} has invalid input "${inputName}" reference: ${targetBlockId}`)
          }
        }
      }
    }
  }

  // Count statistics
  const blocks = Array.from(blockMap.values())
  const topBlockCount = blocks.filter((b) => b.parent === null || b.parent === undefined).length
  const nextLinkCount = blocks.filter((b) => typeof b.next === 'string' && b.next !== '').length
  const parentLinkCount = blocks.filter((b) => typeof b.parent === 'string' && b.parent !== '').length

  // Count input links
  let inputLinkCount = 0
  for (const b of blocks) {
    if (b.inputs && typeof b.inputs === 'object') {
      inputLinkCount += Object.keys(b.inputs).length
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
  }
}
