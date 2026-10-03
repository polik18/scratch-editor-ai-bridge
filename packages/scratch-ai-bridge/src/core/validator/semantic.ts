import { getBlockCapability, type CanonicalBlockCapability, type CanonicalInputCapability } from '../capabilities'
import type { CanonicalBlock, CanonicalInput, CanonicalProject } from '../ir/types'

export type CanonicalSemanticSeverity = 'error' | 'warning'

export interface CanonicalSemanticIssue {
  readonly severity: CanonicalSemanticSeverity
  readonly code: string
  readonly path: string
  readonly message: string
}

const pointerPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')

/**
 * Check symbol references and block-shape semantics that JSON Schema cannot
 * express on its own.
 * @param project Schema-valid Canonical IR project.
 * @returns Semantic errors and warnings with JSON-pointer paths.
 */
export const validateCanonicalSemantics = (project: CanonicalProject): readonly CanonicalSemanticIssue[] => {
  const issues: CanonicalSemanticIssue[] = []
  const stageVariables = new Set(project.stage.variables.map((variable) => variable.name))
  const stageLists = new Set(project.stage.lists.map((list) => list.name))
  const broadcasts = new Set(project.broadcasts.map((broadcast) => broadcast.name))
  const spriteNames = new Set(project.sprites.map((sprite) => sprite.name))

  const issue = (severity: CanonicalSemanticSeverity, code: string, path: string, message: string): void => {
    issues.push({ severity, code, path, message })
  }

  const validateTarget = (
    target: CanonicalProject['stage'] | CanonicalProject['sprites'][number],
    targetPath: string,
  ): void => {
    const variables = new Set([...stageVariables, ...target.variables.map((variable) => variable.name)])
    const lists = new Set([...stageLists, ...target.lists.map((list) => list.name)])

    const validateInput = (
      input: CanonicalInput,
      inputName: string,
      path: string,
      inputCapability: CanonicalInputCapability | undefined,
    ): void => {
      if (input.type === 'variable' && !variables.has(input.name)) {
        issue('error', 'unknown-variable', path, `變數 ${input.name} 尚未宣告`)
      }
      if (input.type === 'list' && !lists.has(input.name)) {
        issue('error', 'unknown-list', path, `清單 ${input.name} 尚未宣告`)
      }
      if (input.type === 'broadcast' && !broadcasts.has(input.name)) {
        issue('error', 'unknown-broadcast', path, `廣播 ${input.name} 尚未在 broadcasts 宣告`)
      }
      if (inputCapability?.kind === 'boolean') {
        if (input.type === 'variable' || input.type === 'list') {
          issue('warning', 'condition-not-boolean', path, '條件使用數值／清單 reporter，應改用布林比較積木')
        } else if (input.type === 'literal' && typeof input.value !== 'boolean') {
          issue('warning', 'condition-not-boolean', path, '條件常數不是布林值')
        } else if (input.type === 'block' && getBlockCapability(input.block.opcode)?.shape !== 'boolean') {
          issue('error', 'boolean-input-type', path, `${inputName} 必須使用布林 reporter`)
        }
      }
      if (inputCapability?.kind === 'stack' && input.type !== 'stack') {
        issue('error', 'substack-type', path, `${inputName} 必須是 stack input`)
      }
      if (inputCapability?.kind === 'broadcast' && input.type !== 'broadcast') {
        issue('error', 'broadcast-input-type', path, `${inputName} 必須是 broadcast input`)
      }
      if (
        inputCapability &&
        ['any', 'number', 'string', 'menu'].includes(inputCapability.kind) &&
        (input.type === 'stack' || input.type === 'broadcast')
      ) {
        issue('error', 'input-kind', path, `${inputName} 必須是常數或 reporter input`)
      }
      if (inputCapability?.kind === 'boolean' && (input.type === 'stack' || input.type === 'broadcast')) {
        issue('error', 'boolean-input-type', path, `${inputName} 必須使用布林 reporter`)
      }
      if (input.type === 'block') {
        const nestedCapability = getBlockCapability(input.block.opcode)
        if (nestedCapability?.shape === 'hat' || nestedCapability?.shape === 'command') {
          issue('error', 'input-block-shape', path, `${input.block.opcode} 不能當作 reporter input`)
        }
      }
      if (input.type === 'stack') validateBlocks(input.blocks, `${path}/blocks`, false)
      if (input.type === 'block') validateBlock(input.block, `${path}/block`, false)
    }

    const validateBlock = (block: CanonicalBlock, path: string, topLevel: boolean): void => {
      const capability: CanonicalBlockCapability | undefined = getBlockCapability(block.opcode)
      if (!capability) {
        issue('error', 'unknown-opcode', `${path}/opcode`, `不支援 opcode ${block.opcode}`)
        return
      }
      if (!capability.targets.includes(target.kind)) {
        issue('error', 'target-not-supported', path, `${block.opcode} 不可用於 ${target.kind}`)
      }
      if (!topLevel && capability.shape === 'hat') {
        issue('error', 'hat-not-top-level', path, `事件積木 ${block.opcode} 只能放在 script 開頭`)
      }
      for (const [inputName, inputCapability] of Object.entries(capability.inputs ?? {})) {
        if (inputCapability.required && !block.inputs?.[inputName]) {
          issue('error', 'missing-input', `${path}/inputs/${pointerPart(inputName)}`, `缺少 ${inputName} input`)
        }
      }
      for (const [fieldName, fieldCapability] of Object.entries(capability.fields ?? {})) {
        const value = block.fields?.[fieldName]
        if (fieldCapability.required && value === undefined) {
          issue('error', 'missing-field', `${path}/fields/${pointerPart(fieldName)}`, `缺少 ${fieldName} field`)
        }
        if (value !== undefined && fieldCapability.values && !fieldCapability.values.includes(String(value))) {
          issue('error', 'invalid-field-value', `${path}/fields/${pointerPart(fieldName)}`, `${fieldName} 值無效`)
        }
      }
      for (const fieldName of Object.keys(block.fields ?? {})) {
        if (!capability.fields?.[fieldName]) {
          issue(
            'error',
            'unknown-field',
            `${path}/fields/${pointerPart(fieldName)}`,
            `${block.opcode} 沒有 ${fieldName} field`,
          )
        }
      }

      const variableName = block.fields?.VARIABLE
      if (variableName !== undefined && !variables.has(String(variableName))) {
        issue('error', 'unknown-variable', `${path}/fields/VARIABLE`, `變數 ${String(variableName)} 尚未宣告`)
      }
      const listName = block.fields?.LIST
      if (listName !== undefined && !lists.has(String(listName))) {
        issue('error', 'unknown-list', `${path}/fields/LIST`, `清單 ${String(listName)} 尚未宣告`)
      }
      const broadcastName = block.fields?.BROADCAST_OPTION
      if (broadcastName !== undefined && !broadcasts.has(String(broadcastName))) {
        issue(
          'error',
          'unknown-broadcast',
          `${path}/fields/BROADCAST_OPTION`,
          `廣播 ${String(broadcastName)} 尚未在 broadcasts 宣告`,
        )
      }
      const touchingInput = block.inputs?.TOUCHINGOBJECTMENU
      if (
        block.opcode === 'sensing_touchingobject' &&
        touchingInput?.type === 'literal' &&
        typeof touchingInput.value === 'string' &&
        !['_edge_', '_mouse_'].includes(touchingInput.value) &&
        !spriteNames.has(touchingInput.value)
      ) {
        issue(
          'error',
          'unknown-sprite',
          `${path}/inputs/TOUCHINGOBJECTMENU`,
          `碰撞目標 ${touchingInput.value} 不存在`,
        )
      }

      for (const [inputName, input] of Object.entries(block.inputs ?? {})) {
        const inputCapability = capability.inputs?.[inputName]
        if (!inputCapability) {
          issue(
            'error',
            'unknown-input',
            `${path}/inputs/${pointerPart(inputName)}`,
            `${block.opcode} 沒有 ${inputName} input`,
          )
        }
        validateInput(input, inputName, `${path}/inputs/${pointerPart(inputName)}`, inputCapability)
      }
    }

    const validateBlocks = (blocks: readonly CanonicalBlock[], path: string, isScript: boolean): void => {
      blocks.forEach((block, index) => {
        const blockPath = `${path}/${index}`
        if (isScript && index > 0 && getBlockCapability(block.opcode)?.shape === 'hat') {
          issue('error', 'hat-not-first', blockPath, `事件積木 ${block.opcode} 必須是 script 第一個積木`)
        }
        validateBlock(block, blockPath, isScript && index === 0)
      })
    }

    target.scripts.forEach((script, index) =>
      validateBlocks(script.blocks, `${targetPath}/scripts/${index}/blocks`, true),
    )
  }

  validateTarget(project.stage, '/stage')
  project.sprites.forEach((sprite, index) => validateTarget(sprite, `/sprites/${index}`))
  return issues
}
