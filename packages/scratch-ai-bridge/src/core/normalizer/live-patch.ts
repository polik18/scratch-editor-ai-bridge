import { sha256 } from '@noble/hashes/sha256'
import type { CanonicalProject, CanonicalScalar, CanonicalVariable, CanonicalScript } from '../ir/types'

export const LIVE_PATCH_FORMAT = 'scratch-ai-bridge/live-patch' as const
export const LIVE_PATCH_VERSION = 1 as const
export const LIVE_PATCH_MAX_BYTES = 16 * 1024
export const LIVE_PATCH_MAX_OPERATIONS = 20

export interface LiveVariablePatchOperation {
  readonly op: 'set-variable'
  readonly target: string
  readonly name: string
  readonly value: CanonicalScalar
  readonly beforeValue: CanonicalScalar
}

export type LiveTargetProperty = 'x' | 'y' | 'direction' | 'size' | 'visible' | 'currentCostume'
export type LiveStageProperty = 'tempo' | 'volume' | 'backdropIndex'

export interface LiveTargetPropertyPatchOperation {
  readonly op: 'set-target-property'
  readonly target: string
  readonly property: LiveTargetProperty
  readonly value: CanonicalScalar
  readonly beforeValue: CanonicalScalar
}

export interface LiveStagePropertyPatchOperation {
  readonly op: 'set-stage-property'
  readonly property: LiveStageProperty
  readonly value: number
  readonly beforeValue: number
}

export type LiveScriptPatchOperation =
  | { readonly op: 'add-target-script'; readonly target: string; readonly script: CanonicalScript }
  | {
      readonly op: 'replace-target-script'
      readonly target: string
      readonly selector: string
      readonly script: CanonicalScript
    }
  | { readonly op: 'remove-target-script'; readonly target: string; readonly selector: string }

export type LivePatchOperation =
  | LiveVariablePatchOperation
  | LiveTargetPropertyPatchOperation
  | LiveStagePropertyPatchOperation
  | LiveScriptPatchOperation

export interface ParsedLiveVariablePatch {
  readonly format: typeof LIVE_PATCH_FORMAT
  readonly version: typeof LIVE_PATCH_VERSION
  readonly baseRevision: number
  readonly summary: string
  readonly operations: readonly LivePatchOperation[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isScalar = (value: unknown): value is CanonicalScalar =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

const findVariable = (project: CanonicalProject, targetName: string, variableName: string): CanonicalVariable => {
  const targets = [project.stage, ...project.sprites]
  const matchingTargets = targets.filter((target) => target.name === targetName)
  if (matchingTargets.length !== 1) throw new Error(`找不到唯一 target「${targetName}」。`)
  const matches = matchingTargets[0]!.variables.filter((variable) => variable.name === variableName)
  if (matches.length !== 1) throw new Error(`target「${targetName}」中找不到唯一變數「${variableName}」。`)
  const variable = matches[0]!
  if (variable.cloud) throw new Error(`雲端變數「${targetName}/${variableName}」不可即時修改。`)
  if (!isScalar(variable.value)) throw new Error(`變數「${targetName}/${variableName}」不是 scalar。`)
  return variable
}

const findTarget = (project: CanonicalProject, targetName: string) => {
  const matches = [project.stage, ...project.sprites].filter((target) => target.name === targetName)
  if (matches.length !== 1) throw new Error(`找不到唯一 target「${targetName}」。`)
  return matches[0]!
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value)
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`
}

export const getLivePatchScriptSelector = (script: CanonicalScript): string => {
  const digest = sha256(new TextEncoder().encode(stableJson(script)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const listLivePatchScripts = (project: CanonicalProject) =>
  [project.stage, ...project.sprites].flatMap((target) =>
    target.scripts.map((script) => ({
      target: target.name,
      selector: getLivePatchScriptSelector(script),
      blocks: script.blocks.map((block) => block.opcode),
    })),
  )

const parseCanonicalScript = (value: unknown, index: number): CanonicalScript => {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'blocks' && key !== 'position'))
    throw new Error(`operations[${index}].script 必須是 Canonical script 物件。`)
  if (!Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 5000)
    throw new Error(`operations[${index}].script.blocks 必須有 1–5000 個積木。`)
  if (value.position !== undefined) {
    if (!isRecord(value.position) || Object.keys(value.position).some((key) => key !== 'x' && key !== 'y'))
      throw new Error(`operations[${index}].script.position 無效。`)
    if (
      typeof value.position.x !== 'number' ||
      !Number.isFinite(value.position.x) ||
      typeof value.position.y !== 'number' ||
      !Number.isFinite(value.position.y)
    )
      throw new Error(`operations[${index}].script.position x/y 必須是有限數字。`)
  }
  return structuredClone(value) as unknown as CanonicalScript
}

const findScriptIndex = (target: ReturnType<typeof findTarget>, selector: string, targetName: string): number => {
  if (!/^[0-9a-f]{64}$/.test(selector)) throw new Error('script selector 必須是 64 位十六進位指紋。')
  const matches = target.scripts.flatMap((script, index) =>
    getLivePatchScriptSelector(script) === selector ? [index] : [],
  )
  if (matches.length !== 1)
    throw new Error(`target「${targetName}」的 script selector 找到 ${matches.length} 個結果；必須唯一。`)
  return matches[0]!
}

const parseScriptOperation = (
  project: CanonicalProject,
  item: Record<string, unknown>,
  index: number,
): LiveScriptPatchOperation => {
  if (item.op === 'add-target-script') {
    if (Object.keys(item).some((key) => !['op', 'target', 'script'].includes(key)))
      throw new Error(`operations[${index}] 含有不支援的欄位。`)
    if (typeof item.target !== 'string' || item.target.length < 1 || item.target.length > 80)
      throw new Error(`operations[${index}].target 無效。`)
    const target = findTarget(project, item.target)
    const script = parseCanonicalScript(item.script, index)
    if (
      target.scripts.some((existing) => getLivePatchScriptSelector(existing) === getLivePatchScriptSelector(script))
    )
      throw new Error(`target「${item.target}」已有完全相同的 script。`)
    return { op: 'add-target-script', target: item.target, script }
  }
  if (item.op === 'replace-target-script' || item.op === 'remove-target-script') {
    const allowedKeys =
      item.op === 'replace-target-script' ? ['op', 'target', 'selector', 'script'] : ['op', 'target', 'selector']
    if (Object.keys(item).some((key) => !allowedKeys.includes(key)))
      throw new Error(`operations[${index}] 含有不支援的欄位。`)
    if (typeof item.target !== 'string' || item.target.length < 1 || item.target.length > 80)
      throw new Error(`operations[${index}].target 無效。`)
    if (typeof item.selector !== 'string') throw new Error(`operations[${index}].selector 無效。`)
    const target = findTarget(project, item.target)
    findScriptIndex(target, item.selector, item.target)
    if (item.op === 'remove-target-script')
      return { op: 'remove-target-script', target: item.target, selector: item.selector }
    return {
      op: 'replace-target-script',
      target: item.target,
      selector: item.selector,
      script: parseCanonicalScript(item.script, index),
    }
  }
  throw new Error(`operations[${index}] script 操作不支援。`)
}

const parsePropertyOperation = (
  project: CanonicalProject,
  item: Record<string, unknown>,
  index: number,
): LiveTargetPropertyPatchOperation | LiveStagePropertyPatchOperation => {
  if (item.op === 'set-target-property') {
    if (Object.keys(item).some((key) => !['op', 'target', 'property', 'value'].includes(key)))
      throw new Error(`operations[${index}] 含有不支援的欄位。`)
    if (typeof item.target !== 'string' || item.target.length < 1 || item.target.length > 80)
      throw new Error(`operations[${index}].target 無效。`)
    if (
      item.property !== 'x' &&
      item.property !== 'y' &&
      item.property !== 'direction' &&
      item.property !== 'size' &&
      item.property !== 'visible' &&
      item.property !== 'currentCostume'
    )
      throw new Error(`operations[${index}].property 不支援。`)
    const target = findTarget(project, item.target)
    if (target.kind !== 'sprite') throw new Error('Stage 的可視屬性請使用 set-stage-property。')
    const property = item.property
    const value = item.value
    if (property === 'visible') {
      if (typeof value !== 'boolean') throw new Error(`operations[${index}].value 必須是布林值。`)
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`operations[${index}].value 必須是有限數字。`)
    } else if (property === 'x' && (value < -240 || value > 240)) {
      throw new Error('x 必須在 -240 到 240 之間。')
    } else if (property === 'y' && (value < -180 || value > 180)) {
      throw new Error('y 必須在 -180 到 180 之間。')
    } else if (property === 'direction' && (value < -180 || value > 180)) {
      throw new Error('direction 必須在 -180 到 180 之間。')
    } else if (property === 'size' && (value < 1 || value > 500)) {
      throw new Error('size 必須在 1 到 500 之間。')
    } else if (
      property === 'currentCostume' &&
      (!Number.isSafeInteger(value) || value < 0 || value >= target.costumes.length)
    ) {
      throw new Error(`currentCostume 必須是有效造型索引（0–${Math.max(0, target.costumes.length - 1)}）。`)
    }
    const beforeValue = property === 'currentCostume' ? (target.currentCostume ?? 0) : target[property]
    if (beforeValue === undefined) throw new Error(`target「${item.target}」沒有 ${property}。`)
    return { op: 'set-target-property', target: item.target, property, value: value as CanonicalScalar, beforeValue }
  }
  if (item.op === 'set-stage-property') {
    if (Object.keys(item).some((key) => !['op', 'property', 'value'].includes(key)))
      throw new Error(`operations[${index}] 含有不支援的欄位。`)
    if (item.property !== 'tempo' && item.property !== 'volume' && item.property !== 'backdropIndex')
      throw new Error(`operations[${index}].property 不支援。`)
    const value = item.value
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(`operations[${index}].value 必須是有限數字。`)
    if (item.property === 'tempo' && (value < 20 || value > 500)) throw new Error('tempo 必須在 20 到 500 之間。')
    if (item.property === 'volume' && (value < 0 || value > 100)) throw new Error('volume 必須在 0 到 100 之間。')
    if (
      item.property === 'backdropIndex' &&
      (!Number.isSafeInteger(value) || value < 0 || value >= project.stage.costumes.length)
    )
      throw new Error(`backdropIndex 必須是有效背景索引（0–${Math.max(0, project.stage.costumes.length - 1)}）。`)
    const beforeValue =
      item.property === 'backdropIndex'
        ? (project.stage.currentCostume ?? 0)
        : (project.stage[item.property] ?? (item.property === 'tempo' ? 60 : 100))
    return { op: 'set-stage-property', property: item.property, value, beforeValue }
  }
  throw new Error(`operations[${index}] 操作不支援。`)
}

export const parseLiveVariablePatch = (
  source: string,
  project: CanonicalProject,
  expectedRevision: number,
): ParsedLiveVariablePatch => {
  if (new TextEncoder().encode(source).byteLength > LIVE_PATCH_MAX_BYTES)
    throw new Error(`Patch 超過 ${LIVE_PATCH_MAX_BYTES} bytes 上限。`)
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('Patch 不是有效 JSON。')
  }
  if (!isRecord(value)) throw new Error('Patch 根節點必須是物件。')
  const allowedKeys = ['format', 'version', 'baseRevision', 'summary', 'operations']
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error('Patch 含有不支援的欄位。')
  if (value.format !== LIVE_PATCH_FORMAT || value.version !== LIVE_PATCH_VERSION)
    throw new Error(`Patch 格式必須為 ${LIVE_PATCH_FORMAT} v${LIVE_PATCH_VERSION}。`)
  if (
    typeof value.baseRevision !== 'number' ||
    !Number.isSafeInteger(value.baseRevision) ||
    value.baseRevision !== expectedRevision
  )
    throw new Error(`Patch revision 過期；目前版本是 ${expectedRevision}。請重新產生修改指令。`)
  if (typeof value.summary !== 'string' || value.summary.trim().length < 1 || value.summary.length > 240)
    throw new Error('Patch summary 必須是 1–240 字元。')
  if (
    !Array.isArray(value.operations) ||
    value.operations.length < 1 ||
    value.operations.length > LIVE_PATCH_MAX_OPERATIONS
  )
    throw new Error(`Patch operations 必須有 1–${LIVE_PATCH_MAX_OPERATIONS} 項。`)

  const seen = new Set<string>()
  const operations = value.operations.map((item, index): LivePatchOperation => {
    if (!isRecord(item)) throw new Error(`operations[${index}] 必須是物件。`)
    const key =
      item.op === 'set-variable'
        ? `variable\u0000${String(item.target)}\u0000${String(item.name)}`
        : item.op === 'set-target-property'
          ? `target-property\u0000${String(item.target)}\u0000${String(item.property)}`
          : item.op === 'set-stage-property'
            ? `stage-property\u0000${String(item.property)}`
            : item.op === 'add-target-script'
              ? `add-script\u0000${String(item.target)}\u0000${isRecord(item.script) ? getLivePatchScriptSelector(item.script as unknown as CanonicalScript) : 'invalid'}`
              : `script\u0000${String(item.target)}\u0000${String(item.selector)}`
    if (seen.has(key)) throw new Error(`Patch 重複修改欄位「${key.replaceAll('\u0000', '/')}」。`)
    seen.add(key)
    if (item.op === 'set-variable') {
      if (Object.keys(item).some((field) => !['op', 'target', 'name', 'value'].includes(field)))
        throw new Error(`operations[${index}] 含有不支援的欄位。`)
      if (typeof item.target !== 'string' || item.target.length < 1 || item.target.length > 80)
        throw new Error(`operations[${index}].target 無效。`)
      if (typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 80)
        throw new Error(`operations[${index}].name 無效。`)
      if (!isScalar(item.value)) throw new Error(`operations[${index}].value 必須是有限數字、字串或布林值。`)
      if (typeof item.value === 'number' && Math.abs(item.value) > 1_000_000)
        throw new Error(`operations[${index}].value 數值超出安全範圍。`)
      if (typeof item.value === 'string' && item.value.length > 512)
        throw new Error(`operations[${index}].value 字串超過 512 字元。`)
      const variable = findVariable(project, item.target, item.name)
      return {
        op: 'set-variable',
        target: item.target,
        name: item.name,
        beforeValue: variable.value,
        value: item.value,
      }
    }
    if (item.op === 'add-target-script' || item.op === 'replace-target-script' || item.op === 'remove-target-script')
      return parseScriptOperation(project, item, index)
    return parsePropertyOperation(project, item, index)
  })

  const hasScriptOperation = operations.some(
    (operation) =>
      operation.op === 'add-target-script' ||
      operation.op === 'replace-target-script' ||
      operation.op === 'remove-target-script',
  )
  if (hasScriptOperation && !operations.every((operation) => operation.op.includes('-target-script')))
    throw new Error('結構 script patch 不可與 runtime variable/property patch 混用。')

  return {
    format: LIVE_PATCH_FORMAT,
    version: LIVE_PATCH_VERSION,
    baseRevision: expectedRevision,
    summary: value.summary.trim(),
    operations,
  }
}

export const applyLiveVariablePatchToProject = (
  project: CanonicalProject,
  operations: readonly LivePatchOperation[],
): CanonicalProject => {
  const nextProject = structuredClone(project)
  for (const operation of operations) {
    if (operation.op === 'set-variable') {
      const variable = findVariable(nextProject, operation.target, operation.name)
      variable.value = operation.value
    } else if (operation.op === 'set-target-property') {
      const target = findTarget(nextProject, operation.target)
      if (target.kind !== 'sprite') throw new Error(`Stage 不支援 ${operation.property}。`)
      target[operation.property] = operation.value as never
    } else if (operation.op === 'set-stage-property' && operation.property === 'backdropIndex') {
      nextProject.stage.currentCostume = operation.value
    } else if (operation.op === 'set-stage-property') {
      if (operation.property === 'tempo') nextProject.stage.tempo = operation.value
      else nextProject.stage.volume = operation.value
    } else if (operation.op === 'add-target-script') {
      findTarget(nextProject, operation.target).scripts.push(structuredClone(operation.script))
    } else if (operation.op === 'replace-target-script') {
      const target = findTarget(nextProject, operation.target)
      const scriptIndex = findScriptIndex(target, operation.selector, operation.target)
      target.scripts[scriptIndex] = structuredClone(operation.script)
    } else {
      const target = findTarget(nextProject, operation.target)
      const scriptIndex = findScriptIndex(target, operation.selector, operation.target)
      target.scripts.splice(scriptIndex, 1)
    }
  }
  return nextProject
}

export const createLiveVariablePatchInstruction = (project: CanonicalProject, baseRevision: number): string => {
  const compactInventory = (lines: string[], maxItems: number, maxChars: number): string => {
    const selected: string[] = []
    let length = 0
    for (const line of lines.slice(0, maxItems)) {
      const compactLine = line.slice(0, 500)
      if (length + compactLine.length + 1 > maxChars) break
      selected.push(compactLine)
      length += compactLine.length + 1
    }
    if (selected.length < lines.length) selected.push(`- （其餘 ${lines.length - selected.length} 項省略；請先要求列出目標）`)
    return selected.length > 0 ? selected.join('\n') : '（無）'
  }
  const targets = [project.stage, ...project.sprites]
  const variables = targets.flatMap((target) =>
    target.variables
      .filter((variable) => !variable.cloud && isScalar(variable.value))
      .map((variable) => `- ${target.name}/${variable.name} = ${JSON.stringify(variable.value)}`),
  )
  const sprites = project.sprites.map(
    (sprite) =>
      `- ${sprite.name}: x=${sprite.x}, y=${sprite.y}, direction=${sprite.direction}, size=${sprite.size}, visible=${sprite.visible}, costumes=[${sprite.costumes.map((costume, index) => `${index}:${costume.name}`).join(', ')}]`,
  )
  const stageProperties = `- Stage: tempo=${project.stage.tempo ?? 60}, volume=${project.stage.volume ?? 100}, backdrops=[${project.stage.costumes.map((costume, index) => `${index}:${costume.name}`).join(', ')}]`
  const scripts = listLivePatchScripts(project).map(
    (script) => `- ${script.target} selector=${script.selector} blocks=${script.blocks.join(' → ')}`,
  )
  return (
    `請只提出對目前 Scratch 遊戲既有變數、舞台/角色可視屬性或單一既有腳本的調整。不得執行 JS、修改外部素材或 extension。依名稱/造型判斷用途；若無法判斷或有多種可能，先詢問使用者，不要猜測重要玩法。

只輸出 JSON，不要 Markdown：
{"format":"scratch-ai-bridge/live-patch","version":1,"baseRevision":${baseRevision},"summary":"一句話說明修改","operations":[{"op":"set-target-property","target":"Player","property":"size","value":85}]}

規則：operations 限 1–${LIVE_PATCH_MAX_OPERATIONS} 項；runtime operations 可混用，script operations 不能和 runtime operations 混用。target/name/property/selector 必須完全符合清單/允許欄位；set-variable 只能改既有非 cloud scalar；target property 只可設 x(-240–240)、y(-180–180)、direction(-180–180)、size(1–500)、visible(bool)、currentCostume(索引)；stage property 只可設 tempo(20–500)、volume(0–100)、backdropIndex(索引)。既有腳本以 SHA-256 selector 唯一指定；用 replace-target-script / remove-target-script 必須提供 selector；新增用 add-target-script。結構修改會重載預覽並重置遊戲進度；腳本 blocks 必須符合 Canonical IR。不要一次提出互相矛盾的修改。` +
    `\n\n目前遊戲：${project.name.slice(0, 200)}\n可調整變數：\n${compactInventory(variables, 40, 2_000)}\n可調整角色：\n${compactInventory(sprites, 40, 2_500)}\n可調整舞台：\n${stageProperties.slice(0, 600)}\n既有腳本 selector：\n${compactInventory(scripts, 80, 5_000)}`
  )
}
