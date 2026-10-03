import type { CanonicalBlock, CanonicalInput, CanonicalProject, CanonicalTargetBase } from '../ir/types'

export type CanonicalSemanticSeverity = 'error' | 'warning'

export interface CanonicalSemanticIssue {
  readonly severity: CanonicalSemanticSeverity
  readonly code: string
  readonly path: string
  readonly message: string
}

const HAT_OPCODES = new Set(['event_whenflagclicked', 'event_whenbroadcastreceived'])

const REQUIRED_INPUTS: Readonly<Record<string, readonly string[]>> = {
  motion_movesteps: ['STEPS'],
  looks_say: ['MESSAGE'],
  control_wait: ['DURATION'],
  control_repeat: ['TIMES', 'SUBSTACK'],
  control_forever: ['SUBSTACK'],
  control_if: ['CONDITION', 'SUBSTACK'],
  control_if_else: ['CONDITION', 'SUBSTACK', 'SUBSTACK2'],
  data_setvariableto: ['VALUE'],
  data_changevariableby: ['VALUE'],
  event_broadcast: ['BROADCAST_INPUT'],
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

  const issue = (severity: CanonicalSemanticSeverity, code: string, path: string, message: string): void => {
    issues.push({ severity, code, path, message })
  }

  const validateTarget = (target: CanonicalTargetBase, targetPath: string): void => {
    const variables = new Set([...stageVariables, ...target.variables.map((variable) => variable.name)])
    const lists = new Set([...stageLists, ...target.lists.map((list) => list.name)])

    const validateInput = (input: CanonicalInput, inputName: string, path: string): void => {
      if (input.type === 'variable' && !variables.has(input.name)) {
        issue('error', 'unknown-variable', path, `變數 ${input.name} 尚未宣告`)
      }
      if (input.type === 'list' && !lists.has(input.name)) {
        issue('error', 'unknown-list', path, `清單 ${input.name} 尚未宣告`)
      }
      if (input.type === 'broadcast' && !broadcasts.has(input.name)) {
        issue('error', 'unknown-broadcast', path, `廣播 ${input.name} 尚未在 broadcasts 宣告`)
      }
      if (inputName === 'CONDITION') {
        if (input.type === 'variable' || input.type === 'list') {
          issue('warning', 'condition-not-boolean', path, '條件使用數值／清單 reporter，應改用布林比較積木')
        } else if (input.type === 'literal' && typeof input.value !== 'boolean') {
          issue('warning', 'condition-not-boolean', path, '條件常數不是布林值')
        }
      }
      if (inputName.startsWith('SUBSTACK') && input.type !== 'stack') {
        issue('error', 'substack-type', path, `${inputName} 必須是 stack input`)
      }
      if (input.type === 'stack') validateBlocks(input.blocks, `${path}/blocks`, false)
      if (input.type === 'block') validateBlock(input.block, `${path}/block`, false)
    }

    const validateBlock = (block: CanonicalBlock, path: string, topLevel: boolean): void => {
      if (!topLevel && HAT_OPCODES.has(block.opcode)) {
        issue('error', 'hat-not-top-level', path, `事件積木 ${block.opcode} 只能放在 script 開頭`)
      }
      for (const requiredInput of REQUIRED_INPUTS[block.opcode] ?? []) {
        if (!block.inputs?.[requiredInput]) {
          issue(
            'error',
            'missing-input',
            `${path}/inputs/${pointerPart(requiredInput)}`,
            `缺少 ${requiredInput} input`,
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
      const broadcastInput = Object.entries(block.inputs ?? {}).find(([name]) => name === 'BROADCAST_INPUT')?.[1]
      if (block.opcode === 'event_broadcast' && broadcastInput?.type !== 'broadcast') {
        issue('error', 'broadcast-input-type', `${path}/inputs/BROADCAST_INPUT`, '廣播積木必須使用 broadcast input')
      }

      for (const [inputName, input] of Object.entries(block.inputs ?? {})) {
        validateInput(input, inputName, `${path}/inputs/${pointerPart(inputName)}`)
      }
    }

    const validateBlocks = (blocks: readonly CanonicalBlock[], path: string, isScript: boolean): void => {
      blocks.forEach((block, index) => {
        const blockPath = `${path}/${index}`
        if (isScript && index > 0 && HAT_OPCODES.has(block.opcode)) {
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
