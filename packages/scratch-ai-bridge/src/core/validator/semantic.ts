import { getBlockCapability, type CanonicalBlockCapability, type CanonicalInputCapability } from '../capabilities'
import type { CanonicalBlock, CanonicalInput, CanonicalProcedure, CanonicalProject } from '../ir/types'

export type CanonicalSemanticSeverity = 'error' | 'warning'

export interface CanonicalSemanticIssue {
  readonly severity: CanonicalSemanticSeverity
  readonly code: string
  readonly path: string
  readonly message: string
}

const pointerPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')

const isValidAssetData = (data: string, allowInlineSvg: boolean): boolean => {
  if (data.length === 0) return false
  if (data.startsWith('data:')) {
    const comma = data.indexOf(',')
    if (comma < 5 || comma === data.length - 1) return false
    const encoded = data.slice(0, comma).endsWith(';base64')
    data = data.slice(comma + 1)
    if (!encoded) {
      try {
        decodeURIComponent(data)
        return true
      } catch {
        return false
      }
    }
  }
  if (allowInlineSvg && data.trimStart().startsWith('<')) {
    return true
  }

  let symbols = 0
  let padding = 0
  let padded = false
  for (const character of data) {
    if (character.trim() === '') continue
    if (character === '=') {
      padded = true
      padding += 1
      if (padding > 2) return false
    } else {
      const code = character.charCodeAt(0)
      const valid =
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        character === '+' ||
        character === '/'
      if (!valid || padded) return false
      symbols += 1
    }
  }
  if (symbols === 0) return false
  if (padding === 0) return symbols % 4 !== 1
  return (
    (symbols + padding) % 4 === 0 && ((padding === 1 && symbols % 4 === 3) || (padding === 2 && symbols % 4 === 2))
  )
}

const hasExpectedCostumeSignature = (data: string, dataFormat: string): boolean => {
  if (dataFormat === 'svg') return true
  const dataUrl = /^data:[^,]*?(;base64)?,(.*)$/s.exec(data)
  if (dataUrl && !dataUrl[1]) return false
  const payload = dataUrl ? dataUrl[2] : data
  const prefix = payload.replace(/\s/g, '').slice(0, 16)
  const expectedPrefix: Readonly<Record<string, string>> = {
    bmp: 'Qk',
    jpeg: '/9j/',
    jpg: '/9j/',
    png: 'iVBORw0KGgo',
  }
  return prefix.startsWith(expectedPrefix[dataFormat] ?? '')
}

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
    const availableCostumes = Math.max(1, target.costumes.length)
    if (target.currentCostume !== undefined && target.currentCostume >= availableCostumes) {
      issue(
        'error',
        'current-costume-out-of-range',
        `${targetPath}/currentCostume`,
        `目前造型索引 ${target.currentCostume} 超出可用範圍 0–${availableCostumes - 1}`,
      )
    }
    target.costumes.forEach((costume, index) => {
      if (costume.assetIssue === 'missing-archive-entry') {
        issue(
          'error',
          'asset-missing',
          `${targetPath}/costumes/${index}/assetIssue`,
          '服裝素材在來源專案封存檔中不存在',
        )
      } else if (costume.assetIssue === 'checksum-mismatch') {
        issue(
          'error',
          'asset-checksum-mismatch',
          `${targetPath}/costumes/${index}/assetIssue`,
          '服裝素材內容與來源校驗值不符',
        )
      }
      if (costume.data !== undefined && !isValidAssetData(costume.data, costume.dataFormat === 'svg')) {
        issue(
          'error',
          'asset-data-invalid',
          `${targetPath}/costumes/${index}/data`,
          '服裝素材不是有效的非空 Base64 或 Data URI',
        )
      } else if (costume.data !== undefined && !hasExpectedCostumeSignature(costume.data, costume.dataFormat)) {
        issue(
          'error',
          'asset-format-mismatch',
          `${targetPath}/costumes/${index}/data`,
          `服裝素材內容與宣告的 ${costume.dataFormat} 格式不符`,
        )
      }
    })
    target.sounds.forEach((sound, index) => {
      if (sound.assetIssue === 'missing-archive-entry') {
        issue(
          'error',
          'asset-missing',
          `${targetPath}/sounds/${index}/assetIssue`,
          '音效素材在來源專案封存檔中不存在',
        )
      } else if (sound.assetIssue === 'checksum-mismatch') {
        issue(
          'error',
          'asset-checksum-mismatch',
          `${targetPath}/sounds/${index}/assetIssue`,
          '音效素材內容與來源校驗值不符',
        )
      }
      if (sound.data !== undefined && !isValidAssetData(sound.data, false)) {
        issue(
          'error',
          'asset-data-invalid',
          `${targetPath}/sounds/${index}/data`,
          '音效素材不是有效的非空 Base64 或 Data URI',
        )
      }
    })
    const variables = new Set([...stageVariables, ...target.variables.map((variable) => variable.name)])
    const lists = new Set([...stageLists, ...target.lists.map((list) => list.name)])
    target.procedures.forEach((procedure, procedureIndex) => {
      const seenParameterNames = new Set<string>()
      procedure.parameters.forEach((parameter, parameterIndex) => {
        if (seenParameterNames.has(parameter.name)) {
          issue(
            'error',
            'duplicate-procedure-argument',
            `${targetPath}/procedures/${procedureIndex}/parameters/${parameterIndex}/name`,
            `程序「${procedure.name}」的參數名稱「${parameter.name}」重複；Scratch 無法區分同名參數`,
          )
        }
        seenParameterNames.add(parameter.name)
      })
    })

    const validateInput = (
      input: CanonicalInput,
      inputName: string,
      path: string,
      inputCapability: CanonicalInputCapability | undefined,
      procedureScope?: CanonicalProcedure,
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
        } else if (
          input.type === 'block' &&
          input.block.opcode !== 'argument_reporter_boolean' &&
          getBlockCapability(input.block.opcode)?.shape !== 'boolean'
        ) {
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
        ['any', 'number', 'string', 'menu', 'color'].includes(inputCapability.kind) &&
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
      if (input.type === 'stack') validateBlocks(input.blocks, `${path}/blocks`, false, procedureScope)
      if (input.type === 'block') validateBlock(input.block, `${path}/block`, false, procedureScope)
    }

    const validateBlock = (
      block: CanonicalBlock,
      path: string,
      topLevel: boolean,
      procedureScope?: CanonicalProcedure,
    ): void => {
      if (block.opcode === 'procedures_call') {
        const procedure = target.procedures.find(({ name }) => name === block.procedure?.name)
        if (!procedure) {
          issue('error', 'unknown-procedure', path, `找不到程序 ${block.procedure?.name ?? ''}`)
          return
        }
        const expected = new Set(procedure.parameters.map(({ name }) => name))
        for (const name of expected) {
          const input = block.inputs?.[name]
          if (!input)
            issue('error', 'missing-procedure-argument', `${path}/inputs/${pointerPart(name)}`, `缺少參數 ${name}`)
          else {
            const parameter = procedure.parameters.find((candidate) => candidate.name === name)
            if (
              parameter?.kind === 'boolean' &&
              !(input.type === 'literal' && typeof input.value === 'boolean') &&
              !(
                input.type === 'block' &&
                (input.block.opcode === 'argument_reporter_boolean' ||
                  getBlockCapability(input.block.opcode)?.shape === 'boolean')
              )
            ) {
              issue('error', 'procedure-argument-type', `${path}/inputs/${pointerPart(name)}`, `${name} 必須是布林值`)
            }
            if (
              (parameter?.kind === 'string-number' || parameter?.kind === 'number') &&
              (input.type === 'stack' || input.type === 'broadcast')
            ) {
              issue(
                'error',
                'procedure-argument-type',
                `${path}/inputs/${pointerPart(name)}`,
                `${name} 必須是字串、數值或 reporter`,
              )
            }
            validateInput(input, name, `${path}/inputs/${pointerPart(name)}`, undefined, procedureScope)
          }
        }
        for (const name of Object.keys(block.inputs ?? {})) {
          if (!expected.has(name))
            issue(
              'error',
              'unknown-procedure-argument',
              `${path}/inputs/${pointerPart(name)}`,
              `程序沒有參數 ${name}`,
            )
        }
        return
      }
      if (block.opcode === 'argument_reporter_string_number' || block.opcode === 'argument_reporter_boolean') {
        const argumentName = block.fields?.VALUE
        const parameter = procedureScope?.parameters.find(({ name }) => name === argumentName)
        const validKind =
          block.opcode === 'argument_reporter_boolean'
            ? parameter?.kind === 'boolean'
            : parameter?.kind === 'string-number' || parameter?.kind === 'number'
        if (!validKind) {
          issue(
            'error',
            'invalid-argument-reporter',
            path,
            `參數 reporter ${String(argumentName ?? '')} 不屬於目前程序或型別不符`,
          )
        }
        return
      }
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
        validateInput(input, inputName, `${path}/inputs/${pointerPart(inputName)}`, inputCapability, procedureScope)
      }
    }

    const validateBlocks = (
      blocks: readonly CanonicalBlock[],
      path: string,
      isScript: boolean,
      procedureScope?: CanonicalProcedure,
    ): void => {
      blocks.forEach((block, index) => {
        const blockPath = `${path}/${index}`
        if (isScript && index > 0 && getBlockCapability(block.opcode)?.shape === 'hat') {
          issue('error', 'hat-not-first', blockPath, `事件積木 ${block.opcode} 必須是 script 第一個積木`)
        }
        validateBlock(block, blockPath, isScript && index === 0, procedureScope)
      })
    }

    target.scripts.forEach((script, index) =>
      validateBlocks(script.blocks, `${targetPath}/scripts/${index}/blocks`, true),
    )
    target.procedures.forEach((procedure: CanonicalProcedure, index) =>
      validateBlocks(procedure.body, `${targetPath}/procedures/${index}/body`, true, procedure),
    )
  }

  validateTarget(project.stage, '/stage')
  project.sprites.forEach((sprite, index) => validateTarget(sprite, `/sprites/${index}`))
  return issues
}
