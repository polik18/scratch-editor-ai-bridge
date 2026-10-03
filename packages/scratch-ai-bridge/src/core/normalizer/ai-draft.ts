export interface AiDraftRepair {
  readonly path: string
  readonly code: string
  readonly message: string
}

export interface AiDraftWarning {
  readonly path: string
  readonly code: string
  readonly message: string
}

export interface AiDraftNormalizationResult {
  readonly data: unknown
  readonly repairs: readonly AiDraftRepair[]
  readonly warnings: readonly AiDraftWarning[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pointerPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')

/**
 * Normalize common LLM shorthand into Canonical IR structure without changing
 * ambiguous game logic.
 * @param input Untrusted JSON value produced by an AI model.
 * @returns A new value, structural repair log, and semantic warnings.
 */
export const normalizeAiDraft = (input: unknown): AiDraftNormalizationResult => {
  const repairs: AiDraftRepair[] = []
  const warnings: AiDraftWarning[] = []

  const repair = (path: string, code: string, message: string): void => {
    repairs.push({ path, code, message })
  }

  const warn = (path: string, code: string, message: string): void => {
    warnings.push({ path, code, message })
  }

  const normalizeBlock = (value: unknown, path: string): unknown => {
    if (!isRecord(value)) return value
    const block: Record<string, unknown> = { ...value }
    if (isRecord(block.inputs)) {
      block.inputs = Object.fromEntries(
        Object.entries(block.inputs).map(([name, input]) => [
          name,
          normalizeInput(input, name, `${path}/inputs/${pointerPart(name)}`),
        ]),
      )
    }
    return block
  }

  const normalizeInput = (value: unknown, inputName: string, path: string): unknown => {
    if (inputName.startsWith('SUBSTACK') && Array.isArray(value)) {
      repair(path, 'stack-input', `將 ${inputName} 陣列包裝為 stack input`)
      return { type: 'stack', blocks: value.map((block, index) => normalizeBlock(block, `${path}/blocks/${index}`)) }
    }

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      if (inputName === 'BROADCAST_INPUT' && typeof value === 'string') {
        repair(path, 'broadcast-input', '將廣播名稱包裝為 broadcast input')
        return { type: 'broadcast', name: value }
      }
      repair(path, 'literal-input', `將 ${inputName} 值包裝為 literal input`)
      return { type: 'literal', value: value ?? '' }
    }

    if (!isRecord(value)) return value

    if (typeof value.variable === 'string' && value.type === undefined) {
      repair(path, 'variable-input', '將 variable 簡寫轉為 Canonical variable input')
      if (inputName === 'CONDITION') {
        warn(path, 'condition-not-boolean', '數值變數不一定是合法布林條件，請確認比較邏輯')
      }
      return { type: 'variable', name: value.variable }
    }
    if (typeof value.list === 'string' && value.type === undefined) {
      repair(path, 'list-input', '將 list 簡寫轉為 Canonical list input')
      return { type: 'list', name: value.list }
    }
    if (typeof value.broadcast === 'string' && value.type === undefined) {
      repair(path, 'broadcast-input', '將 broadcast 簡寫轉為 Canonical broadcast input')
      return { type: 'broadcast', name: value.broadcast }
    }
    if (typeof value.opcode === 'string' && value.type === undefined) {
      repair(path, 'block-input', '將 reporter block 包裝為 block input')
      return { type: 'block', block: normalizeBlock(value, `${path}/block`) }
    }

    if (value.type === 'stack' && Array.isArray(value.blocks)) {
      return {
        ...value,
        blocks: value.blocks.map((block, index) => normalizeBlock(block, `${path}/blocks/${index}`)),
      }
    }
    if (value.type === 'block') {
      return { ...value, block: normalizeBlock(value.block, `${path}/block`) }
    }
    if (value.type === 'variable' && inputName === 'CONDITION') {
      warn(path, 'condition-not-boolean', '數值變數不一定是合法布林條件，請確認比較邏輯')
    }
    return { ...value }
  }

  const normalizeScript = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) {
      repair(path, 'script-wrapper', '將積木陣列包裝為 {blocks: [...]} script')
      return { blocks: value.map((block, index) => normalizeBlock(block, `${path}/blocks/${index}`)) }
    }
    if (!isRecord(value)) return value
    return {
      ...value,
      ...(Array.isArray(value.blocks)
        ? { blocks: value.blocks.map((block, index) => normalizeBlock(block, `${path}/blocks/${index}`)) }
        : {}),
    }
  }

  const addDefault = (target: Record<string, unknown>, key: string, value: unknown, path: string): void => {
    if (target[key] !== undefined) return
    target[key] = value
    repair(`${path}/${pointerPart(key)}`, 'target-default', `補上必要欄位 ${key}`)
  }

  const normalizeTarget = (value: unknown, path: string, kind: 'stage' | 'sprite'): unknown => {
    if (!isRecord(value)) return value
    const target: Record<string, unknown> = { ...value }
    addDefault(target, 'kind', kind, path)
    for (const key of ['variables', 'lists', 'costumes', 'sounds', 'scripts', 'procedures']) {
      addDefault(target, key, [], path)
    }
    if (kind === 'sprite') {
      addDefault(target, 'x', 0, path)
      addDefault(target, 'y', 0, path)
      addDefault(target, 'direction', 90, path)
      addDefault(target, 'size', 100, path)
      addDefault(target, 'visible', true, path)
      addDefault(target, 'draggable', false, path)
      addDefault(target, 'rotationStyle', 'all around', path)
    }
    if (Array.isArray(target.scripts)) {
      target.scripts = target.scripts.map((script, index) => normalizeScript(script, `${path}/scripts/${index}`))
    }
    return target
  }

  if (!isRecord(input)) {
    return { data: input, repairs, warnings }
  }

  const project: Record<string, unknown> = { ...input }
  project.stage = normalizeTarget(project.stage, '/stage', 'stage')
  if (Array.isArray(project.sprites)) {
    project.sprites = project.sprites.map((sprite, index) => normalizeTarget(sprite, `/sprites/${index}`, 'sprite'))
  }
  if (Array.isArray(project.broadcasts)) {
    const broadcasts: unknown[] = project.broadcasts
    project.broadcasts = broadcasts.map((broadcast, index) => {
      if (typeof broadcast !== 'string') return broadcast
      repair(`/broadcasts/${index}`, 'broadcast-declaration', '將廣播字串轉為 {name: ...}')
      return { name: broadcast }
    })
  }

  return { data: project, repairs, warnings }
}
