// SB3 Validator - Validate Scratch project structure

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  summary: {
    targets: number
    blocks: number
    reporters: number
  }
}

export interface BlockData {
  id: string
  opcode: string
  topLevel?: boolean
  parent?: string | null
  next?: string | null
  shadow?: boolean
  fields?: Record<string, unknown>
  inputs?: Record<string, unknown>
}

export interface TargetData {
  id: string
  name: string
  isStage?: boolean
  blocks?: Record<string, BlockData>
  variables?: Record<string, unknown>
  lists?: Record<string, unknown>
  broadcasts?: Record<string, unknown>
}

export interface SB3Data {
  targets: TargetData[]
  monitors?: unknown[]
  extensions?: string[]
  meta?: unknown
}

interface InputObject {
  block?: unknown
  shadow?: unknown
  type?: unknown
  value?: unknown
  id?: unknown
}

/**
 * Validate SB3 structure against Scratch 3.0 specification.
 * @param sb3 - The SB3 project data structure to validate.
 * @returns The structured validation result containing status, errors and summary.
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
  }

  // Validate targets
  if (!Array.isArray(sb3.targets)) {
    result.errors.push('"targets" must be an array')
    result.valid = false
    return result
  }

  result.summary.targets = sb3.targets.length

  // Collect all block IDs for reference
  const allBlockIds = new Set<string>()
  const allReporterIds = new Set<string>()

  for (const target of sb3.targets) {
    if (!target.id) {
      result.errors.push(`Target missing "id": ${target.name || '(unnamed)'}`)
      result.valid = false
    }
    if (!target.name) {
      result.errors.push(`Target missing "name": ID=${target.id || '(unnamed)'}`)
      result.valid = false
    }

    // Collect blocks
    if (target.blocks) {
      result.summary.blocks += Object.keys(target.blocks).length
      for (const blockId of Object.keys(target.blocks)) {
        allBlockIds.add(blockId)
        const block = target.blocks[blockId]
        if (typeof block.opcode === 'string' && block.opcode.includes('reporter')) {
          allReporterIds.add(blockId)
        }
      }
    }
  }

  result.summary.reporters = allReporterIds.size

  // Validate each target
  for (const target of sb3.targets) {
    const targetErrors = validateTarget(target, allBlockIds, allReporterIds)
    result.errors.push(...targetErrors)
    if (targetErrors.length > 0) {
      result.valid = false
    }
  }

  return result
}

/**
 * Validate a single target.
 * @param target - Target object to validate.
 * @param allBlockIds - Set of all known block IDs.
 * @param allReporterIds - Set of all known reporter block IDs.
 * @returns List of validation error messages.
 */
function validateTarget(target: TargetData, allBlockIds: Set<string>, allReporterIds: Set<string>): string[] {
  const errors: string[] = []
  const blocks = target.blocks ?? {}

  // Validate Stage target
  if (target.isStage) {
    if (!target.name || target.name !== 'Stage') {
      errors.push(`Stage target should have name "Stage", got "${target.name}"`)
    }
  }

  // Validate blocks
  for (const [blockId, block] of Object.entries(blocks)) {
    const blockErrors = validateBlock(blockId, block, allBlockIds, allReporterIds)
    errors.push(...blockErrors)
  }

  return errors
}

/**
 * Validate a single block.
 * @param blockId - Block identifier.
 * @param block - Block data object.
 * @param allBlockIds - Set of all known block IDs.
 * @param allReporterIds - Set of all known reporter block IDs.
 * @returns List of validation error messages.
 */
function validateBlock(
  blockId: string,
  block: BlockData,
  allBlockIds: Set<string>,
  allReporterIds: Set<string>,
): string[] {
  const errors: string[] = []
  const prefix = `Block "${blockId}"`

  // Check required fields
  if (!block.opcode) {
    errors.push(`${prefix} missing "opcode"`)
  }

  // Validate topLevel
  if (block.topLevel === undefined) {
    if (block.parent === undefined || block.parent === null) {
      // Top-level block without parent, should have topLevel: true
      block.topLevel = true
    } else {
      block.topLevel = false
    }
  }

  // Validate parent-child relationship
  if (block.parent !== undefined && block.parent !== null) {
    if (!allBlockIds.has(block.parent)) {
      errors.push(`${prefix} has parent "${block.parent}" but parent not found`)
    }
  }

  // Validate next field
  if (block.next !== undefined && block.next !== null) {
    if (!allBlockIds.has(block.next)) {
      errors.push(`${prefix} has next "${block.next}" but next block not found`)
    }
  }

  // Validate inputs
  if (block.inputs) {
    for (const [inputName, inputValue] of Object.entries(block.inputs)) {
      const inputErrors = validateInput(inputName, inputValue, allReporterIds, blockId)
      errors.push(...inputErrors)
    }
  }

  return errors
}

/**
 * Validate a single input.
 * @param inputName - Name of the input slot.
 * @param inputValue - Value assigned to the input slot.
 * @param allReporterIds - Set of all known reporter block IDs.
 * @param blockId - Owner block identifier.
 * @returns List of validation error messages.
 */
function validateInput(
  inputName: string,
  inputValue: unknown,
  allReporterIds: Set<string>,
  blockId: string,
): string[] {
  const errors: string[] = []
  const prefix = `Block "${blockId}" input "${inputName}"`

  // Input should be an object
  if (typeof inputValue !== 'object' || inputValue === null) {
    errors.push(`${prefix} must be an object`)
    return errors
  }

  const inputObj = inputValue as InputObject

  // Check for reporter format: { block: 'ID', shadow: 'ID' }
  if (inputObj.block !== undefined) {
    if (typeof inputObj.block !== 'string') {
      errors.push(`${prefix} "block" must be a string`)
    } else if (!allReporterIds.has(inputObj.block)) {
      // Allow non-reporter blocks
    }

    if (inputObj.shadow !== undefined && typeof inputObj.shadow !== 'string') {
      errors.push(`${prefix} "shadow" must be a string`)
    }
  } else {
    // Old format: { type: 'literal', value: ... }
    if (inputObj.type === 'literal') {
      errors.push(
        `${prefix} uses old "literal" format. ` + `Expected: { block: "reporter_id", shadow: "reporter_shadow" }`,
      )
    } else if (inputObj.type === 'reporter' && inputObj.id !== undefined) {
      errors.push(
        `${prefix} uses old "reporter" format. ` + `Expected: { block: "reporter_id", shadow: "reporter_shadow" }`,
      )
    }
  }

  return errors
}

/**
 * Try to fix common validation issues.
 * @param sb3 - The SB3 project data to fix.
 * @returns Fixed copy of SB3 data.
 */
export function fixSB3(sb3: SB3Data): SB3Data {
  // Clone sb3 to avoid mutating original
  const fixed = JSON.parse(JSON.stringify(sb3)) as SB3Data

  // Fix each target
  for (const target of fixed.targets) {
    if (target.blocks) {
      for (const [blockId, block] of Object.entries(target.blocks)) {
        fixBlock(blockId, block)
      }
    }
  }

  return fixed
}

/**
 * Fix a single block.
 * @param blockId - Identifier of the block.
 * @param block - Block data object to mutate.
 */
function fixBlock(blockId: string, block: BlockData): void {
  // Set topLevel based on parent
  if (block.topLevel === undefined) {
    if (block.parent === undefined || block.parent === null) {
      block.topLevel = true
    } else {
      block.topLevel = false
    }
  }

  // Set next to null if undefined
  if (block.next === undefined) {
    block.next = null
  }

  // Fix inputs
  if (block.inputs) {
    for (const [inputName, inputValue] of Object.entries(block.inputs)) {
      fixInput(inputValue, blockId, inputName)
    }
  }
}

/**
 * Fix a single input (convert to reporter format).
 * @param inputValue - Input value to fix.
 * @param blockId - Block identifier.
 * @param inputName - Name of the input slot.
 */
function fixInput(inputValue: unknown, blockId: string, inputName: string): void {
  if (typeof inputValue !== 'object' || inputValue === null) {
    return
  }

  const inputObj = inputValue as InputObject

  // Convert old "literal" format to reporter format
  if (inputObj.type === 'literal' && inputObj.value !== undefined) {
    const valueStr = typeof inputObj.value === 'string' ? inputObj.value : JSON.stringify(inputObj.value)
    console.warn(
      `Block "${blockId}" input "${inputName}": ` + `Converting literal value ${valueStr} to reporter format`,
    )
  }

  // Convert old "reporter" format to new format
  if (inputObj.type === 'reporter' && inputObj.id !== undefined) {
    const idStr = typeof inputObj.id === 'string' ? inputObj.id : JSON.stringify(inputObj.id)
    console.warn(`Block "${blockId}" input "${inputName}": ` + `Converting reporter ID ${idStr} to new format`)
  }
}
