import { CANONICAL_OPCODES } from '../capabilities'
import type { CanonicalBlockMappingEntry, ScratchTargetBlockGraph } from '../graph'
import type { CanonicalBlock, CanonicalInput, CanonicalProject } from '../ir/types'
import type { AnalysisIR } from './analyzer'

export interface ProjectEvidence {
  readonly id: string
  readonly targetId: string
  readonly targetName: string
  readonly targetIndex: number
  readonly scriptIndex: number | null
  readonly blockId?: string
  readonly opcode: string
  readonly studentLabel: string
  readonly path: string
}

export interface ProjectMapFact {
  readonly id: string
  readonly kind: 'trigger' | 'action' | 'state' | 'broadcast' | 'limitation'
  readonly targetName: string
  readonly scriptIndex?: number
  readonly claim: string
  readonly evidence: readonly ProjectEvidence[]
  readonly confidence: 'high' | 'limited'
}

export interface ProjectScriptCoverage {
  readonly targetName: string
  readonly scriptIndex: number
  readonly recognizedBlocks: number
  readonly opaqueBlocks: number
  readonly malformedGraphIssues: number
  readonly runtime: 'core' | 'verified-extension' | 'unverified-extension' | 'unavailable-extension'
}

export interface ProjectMap {
  readonly format: 'scratch-ai-bridge/project-map'
  readonly version: 1
  readonly projectName: string
  readonly facts: readonly ProjectMapFact[]
  readonly evidence: readonly ProjectEvidence[]
  readonly coverage: {
    readonly scripts: readonly ProjectScriptCoverage[]
    readonly roundTrip: 'not-run'
    readonly importedBlocks: number
    readonly recognizedBlocks: number
    readonly opaqueBlocks: number
    readonly malformedGraphIssues: number
  }
}

const knownOpcodes = new Set<string>(CANONICAL_OPCODES)
const CORE_PREFIXES = [
  'argument',
  'colour',
  'control',
  'data',
  'event',
  'looks',
  'math',
  'motion',
  'operator',
  'procedures',
  'sensing',
  'sound',
]
const VERIFIED_EXTENSIONS = new Set(['music', 'pen'])
const UNAVAILABLE_EXTENSIONS = new Set(['faceSensing', 'videoSensing'])

const pointerPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')

const nestedBlocks = (block: CanonicalBlock): { block: CanonicalBlock; suffix: string }[] => {
  const result: { block: CanonicalBlock; suffix: string }[] = [{ block, suffix: '' }]
  for (const [name, input] of Object.entries(block.inputs ?? {})) {
    if (input.type === 'block')
      result.push(
        ...nestedBlocks(input.block).map((entry) => ({
          ...entry,
          suffix: `/inputs/${pointerPart(name)}/block${entry.suffix}`,
        })),
      )
    if (input.type === 'stack') {
      input.blocks.forEach((nested, index) => {
        const children = nestedBlocks(nested).map((entry) => ({
          ...entry,
          suffix: `/inputs/${pointerPart(name)}/blocks/${index}${entry.suffix}`,
        }))
        result.push(...children)
      })
    }
  }
  return result
}

const literalValue = (input: CanonicalInput | undefined): string | number | boolean | undefined =>
  input?.type === 'literal' ? input.value : undefined

const numericLiteralValue = (input: CanonicalInput | undefined): number | undefined => {
  const value = literalValue(input)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  return undefined
}

const safeNumber = (input: CanonicalInput | undefined): string => {
  if (!input) return '未提供數字'
  if (input.type === 'variable') return '由變數提供'
  if (input.type === 'block') return '由其他積木決定'
  if (input.type !== 'literal') return '內容已隱去'
  const value = literalValue(input)
  const number = numericLiteralValue(input)
  if (number !== undefined) return String(value)
  return '文字內容已隱去'
}

const safeKeyName = (value: unknown): string => {
  const key = String(value ?? '').toLocaleLowerCase()
  if (key === 'space') return '空白鍵'
  if (key === 'up arrow') return '向上鍵'
  if (key === 'down arrow') return '向下鍵'
  if (key === 'left arrow') return '向左鍵'
  if (key === 'right arrow') return '向右鍵'
  if (key === 'any') return '任意按鍵'
  return /^[a-z0-9]$/.test(key) ? `${key} 鍵` : '指定按鍵'
}

const xPositionHint = (input: CanonicalInput | undefined): string => {
  const x = numericLiteralValue(input)
  if (x === undefined) return ''
  if (x > 0) return '（在舞台中線右邊）'
  if (x < 0) return '（在舞台中線左邊）'
  return '（在舞台正中間）'
}

const xMovementHint = (input: CanonicalInput | undefined): string => {
  const dx = numericLiteralValue(input)
  if (dx === undefined) return ''
  if (dx > 0) return '（往右移）'
  if (dx < 0) return '（往左移）'
  return '（不會左右移動）'
}

const studentBlockLabel = (block: CanonicalBlock): string => {
  const inputs = block.inputs ?? {}
  switch (block.opcode) {
    case 'event_whenflagclicked':
      return '當綠旗被點擊'
    case 'event_whenkeypressed':
      return `當按下${safeKeyName(block.fields?.KEY_OPTION)}`
    case 'event_whenbroadcastreceived':
      return '當收到角色訊息'
    case 'event_whenthisspriteclicked':
      return '當這個角色被點擊'
    case 'event_whenstageclicked':
      return '當舞台被點擊'
    case 'control_start_as_clone':
      return '當分身建立'
    case 'motion_gotoxy':
      return `定位到 x：${safeNumber(inputs.X)}、y：${safeNumber(inputs.Y)}${xPositionHint(inputs.X)}`
    case 'motion_setx':
      return `把 x 設成 ${safeNumber(inputs.X)}${xPositionHint(inputs.X)}`
    case 'motion_sety':
      return `把 y 設成 ${safeNumber(inputs.Y)}`
    case 'motion_changexby':
      return `x 改變 ${safeNumber(inputs.DX)}${xMovementHint(inputs.DX)}`
    case 'motion_changeyby':
      return `y 改變 ${safeNumber(inputs.DY)}`
    case 'motion_movesteps':
      return `移動 ${safeNumber(inputs.STEPS)} 步`
    case 'looks_say':
      return '顯示對話'
    case 'control_forever':
      return '重複執行裡面的積木'
    case 'control_repeat':
      return `重複 ${safeNumber(inputs.TIMES)} 次`
    case 'control_if':
      return '如果條件成立，就執行裡面的積木'
    case 'control_if_else':
      return '依照條件選擇要執行的積木'
    case 'control_wait':
      return `等待 ${safeNumber(inputs.DURATION)} 秒`
    case 'data_setvariableto':
      return `把一個變數設成 ${safeNumber(inputs.VALUE)}`
    case 'data_changevariableby':
      return `改變一個變數 ${safeNumber(inputs.VALUE)}`
    case 'sensing_touchingobject':
      return '看看有沒有碰到另一個角色'
    case 'event_broadcast':
      return '送出角色訊息'
    case 'operator_equals':
      return '比較兩個值是否相同'
    case 'operator_gt':
      return '比較左邊的數字是否比較大'
    case 'operator_lt':
      return '比較左邊的數字是否比較小'
    case 'operator_and':
      return '兩個情況都要符合'
    case 'operator_or':
      return '兩個情況至少一個符合'
    case 'operator_not':
      return '把結果反過來看'
    case 'sensing_keypressed':
      return '檢查有沒有按下按鍵'
    case 'procedures_call':
      return '執行一個自己做的積木'
    default:
      return '其他 Scratch 積木'
  }
}

const triggerText = (block: CanonicalBlock): string | undefined => {
  if (block.opcode === 'event_whenflagclicked') return '按下綠旗時'
  if (block.opcode === 'event_whenkeypressed') return `按下「${String(block.fields?.KEY_OPTION ?? '未指定按鍵')}」時`
  if (block.opcode === 'event_whenbroadcastreceived')
    return `收到「${String(block.fields?.BROADCAST_OPTION ?? '未命名廣播')}」訊息時`
  if (block.opcode === 'event_whenthisspriteclicked') return '點選這個角色時'
  if (block.opcode === 'event_whenstageclicked') return '點選舞台時'
  if (block.opcode === 'control_start_as_clone') return '角色分身建立時'
  if (block.opcode === 'procedures_definition') return '自訂積木被呼叫時'
  return undefined
}

const actionText = (block: CanonicalBlock): { kind: ProjectMapFact['kind']; text: string } | undefined => {
  const inputs = block.inputs ?? {}
  switch (block.opcode) {
    case 'motion_movesteps':
      return { kind: 'action', text: `移動 ${String(literalValue(inputs.STEPS) ?? '指定步數')} 步` }
    case 'motion_gotoxy':
      return {
        kind: 'action',
        text: `移到座標（${String(literalValue(inputs.X) ?? '?')}，${String(literalValue(inputs.Y) ?? '?')}）`,
      }
    case 'motion_changexby':
      return { kind: 'action', text: `水平移動 ${String(literalValue(inputs.DX) ?? '指定距離')}` }
    case 'motion_changeyby':
      return { kind: 'action', text: `垂直移動 ${String(literalValue(inputs.DY) ?? '指定距離')}` }
    case 'looks_say': {
      const message = literalValue(inputs.MESSAGE)
      return { kind: 'action', text: typeof message === 'string' ? `說出「${message.slice(0, 80)}」` : '顯示對話' }
    }
    case 'data_setvariableto':
      return { kind: 'state', text: `設定變數「${String(block.fields?.VARIABLE ?? '未命名')}」` }
    case 'data_changevariableby':
      return { kind: 'state', text: `更新變數「${String(block.fields?.VARIABLE ?? '未命名')}」` }
    case 'event_broadcast': {
      const name = inputs.BROADCAST_INPUT
      return {
        kind: 'broadcast',
        text: `送出「${name.type === 'broadcast' ? name.name : String(literalValue(name) ?? '未命名')}」訊息`,
      }
    }
    default:
      return undefined
  }
}

const extensionRuntime = (opcode: string): ProjectScriptCoverage['runtime'] => {
  const prefix = opcode.includes('_') ? opcode.slice(0, opcode.indexOf('_')) : ''
  if (!prefix || CORE_PREFIXES.includes(prefix)) return 'core'
  if (UNAVAILABLE_EXTENSIONS.has(prefix)) return 'unavailable-extension'
  if (VERIFIED_EXTENSIONS.has(prefix)) return 'verified-extension'
  return 'unverified-extension'
}

/**
 * Build factual, evidence-linked observations from the bounded Canonical projection.
 * @param project - Normalized Scratch project.
 * @param analysis - Static analysis generated from the project.
 * @param rawGraphs - Original block graphs retained during import.
 * @param mappings - Canonical-to-original block ID mapping.
 * @returns Evidence-linked facts and structural coverage.
 */
export const createProjectMap = (
  project: CanonicalProject,
  analysis: AnalysisIR,
  rawGraphs: readonly ScratchTargetBlockGraph[] = [],
  mappings: readonly CanonicalBlockMappingEntry[] = [],
): ProjectMap => {
  const facts: ProjectMapFact[] = []
  const evidence: ProjectEvidence[] = []
  const scriptsCoverage: ProjectScriptCoverage[] = []
  let recognizedBlocks = 0
  let opaqueBlocks = 0
  const targets = [project.stage, ...project.sprites]

  targets.forEach((target, targetIndex) => {
    const targetId = `${target.kind}:${encodeURIComponent(target.name)}`
    const rawTarget = rawGraphs.find(
      (graph) => graph.targetName === target.name && graph.isStage === (target.kind === 'stage'),
    )
    const rawEntries = rawTarget ? Object.entries(rawTarget.blocks).filter(([, node]) => node.shadow !== true) : []
    const rawScriptByBlockId = new Map<string, number>()
    if (rawTarget) {
      for (const mapping of mappings) {
        if (mapping.targetName !== target.name || mapping.isStage !== (target.kind === 'stage')) continue
        const scriptMatch = /\/scripts\/(\d+)\//.exec(mapping.irPath)
        const scriptIndex = Number(scriptMatch?.[1])
        if (!Number.isInteger(scriptIndex)) continue
        let blockId: string | null = mapping.blockId
        const visited = new Set<string>()
        while (blockId && !visited.has(blockId)) {
          visited.add(blockId)
          rawScriptByBlockId.set(blockId, scriptIndex)
          const parentId: unknown = rawTarget.blocks[blockId].parent
          blockId = typeof parentId === 'string' ? parentId : null
        }
      }
    }
    target.scripts.forEach((script, scriptIndex) => {
      const scriptPath = target.kind === 'stage' ? '/stage' : `/sprites/${targetIndex - 1}`
      const allBlocks = script.blocks.flatMap((block, blockIndex) =>
        nestedBlocks(block).map(({ block: nested, suffix }) => ({
          block: nested,
          path: `${scriptPath}/scripts/${scriptIndex}/blocks/${blockIndex}${suffix}`,
        })),
      )
      const scriptEvidence = allBlocks.map(({ block, path }) => {
        const mapping = mappings.find((entry) => entry.irPath === path)
        const rawId = mapping?.blockId
        const sourceId = rawId ?? path
        return {
          id: `evidence:${targetId}:${encodeURIComponent(sourceId)}`,
          targetId,
          targetName: target.name,
          targetIndex,
          scriptIndex,
          ...(rawId ? { blockId: rawId } : {}),
          opcode: block.opcode,
          studentLabel: studentBlockLabel(block),
          path,
        } satisfies ProjectEvidence
      })
      evidence.push(...scriptEvidence)
      const trigger = allBlocks.map(({ block }) => block).find((block) => triggerText(block) !== undefined)
      if (trigger) {
        const triggerIndex = allBlocks.findIndex(({ block }) => block === trigger)
        const triggerEvidence = scriptEvidence[triggerIndex]
        facts.push({
          id: `fact:${targetId}:script-${scriptIndex}:trigger`,
          kind: 'trigger',
          targetName: target.name,
          scriptIndex,
          claim: `${triggerText(trigger)}，角色「${target.name}」開始執行這段程式。`,
          evidence: [triggerEvidence],
          confidence: 'high',
        })
      }
      const actions = allBlocks.flatMap(({ block }, index) => {
        const description = actionText(block)
        const source = scriptEvidence[index]
        return description ? [{ ...description, source }] : []
      })
      for (const action of actions.slice(0, 4)) {
        facts.push({
          id: `fact:${targetId}:script-${scriptIndex}:${encodeURIComponent(action.source.id)}`,
          kind: action.kind,
          targetName: target.name,
          scriptIndex,
          claim: `這段程式包含「${action.text}」積木；它是否執行，取決於作品當時的條件與狀態。`,
          evidence: [action.source],
          confidence: 'high',
        })
      }
      const scriptPathPrefix = `${scriptPath}/scripts/${scriptIndex}/blocks/`
      const scriptRawIds = new Set(
        mappings.filter((entry) => entry.irPath.startsWith(scriptPathPrefix)).map(({ blockId }) => blockId),
      )
      const scriptRawEntries = rawTarget
        ? rawEntries.filter(([id]) => scriptRawIds.has(id) || rawScriptByBlockId.get(id) === scriptIndex)
        : allBlocks.map(({ path, block }) => [path, block] as const)
      const rawNodes = scriptRawEntries.map(([, node]) => node)
      const recognized = rawNodes.filter(({ opcode }) => knownOpcodes.has(opcode)).length
      const opaque = rawNodes.length - recognized
      const runtime = rawNodes.reduce<ProjectScriptCoverage['runtime']>((current, block) => {
        const detected = extensionRuntime(block.opcode)
        if (detected === 'unavailable-extension') return detected
        if (detected === 'unverified-extension' && current !== 'unavailable-extension') return detected
        if (detected === 'verified-extension' && current === 'core') return detected
        return current
      }, 'core')
      scriptsCoverage.push({
        targetName: target.name,
        scriptIndex: scriptIndex + 1,
        recognizedBlocks: recognized,
        opaqueBlocks: opaque,
        malformedGraphIssues:
          rawTarget?.issues.filter(({ blockId }) => scriptRawEntries.some(([id]) => id === blockId)).length ?? 0,
        runtime,
      })
      if (opaque > 0) {
        const unknownEntry = scriptRawEntries.find(([, node]) => !knownOpcodes.has(node.opcode))
        const source = unknownEntry?.[0]
        const unknown = unknownEntry?.[1]
        const rawEvidence = source
          ? ({
              id: `evidence:${targetId}:${encodeURIComponent(source)}`,
              targetId,
              targetName: target.name,
              targetIndex,
              scriptIndex,
              blockId: source,
              opcode: unknown?.opcode ?? 'unknown',
              studentLabel: '目前無法解讀的積木',
              path: `${scriptPath}/blocks/${source}`,
            } satisfies ProjectEvidence)
          : undefined
        if (rawEvidence) evidence.push(rawEvidence)
        facts.push({
          id: `fact:${targetId}:script-${scriptIndex}:opaque`,
          kind: 'limitation',
          targetName: target.name,
          scriptIndex,
          claim: `這段程式有 ${opaque} 個目前無法完整解讀的積木；其行為需要在 Scratch 或對應 extension 中確認。`,
          evidence: rawEvidence ? [rawEvidence] : [],
          confidence: 'limited',
        })
      }
    })
  })

  for (const graph of rawGraphs) {
    const targetIndex = targets.findIndex(
      (target) => target.name === graph.targetName && (target.kind === 'stage') === graph.isStage,
    )
    const targetId = `${graph.isStage ? 'stage' : 'sprite'}:${encodeURIComponent(graph.targetName)}`
    for (const [blockId, block] of Object.entries(graph.blocks)) {
      if (
        block.shadow === true ||
        knownOpcodes.has(block.opcode) ||
        evidence.some((entry) => entry.blockId === blockId)
      )
        continue
      const source: ProjectEvidence = {
        id: `evidence:${targetId}:${encodeURIComponent(blockId)}`,
        targetId,
        targetName: graph.targetName,
        targetIndex: targetIndex < 0 ? graph.targetIndex : targetIndex,
        scriptIndex: null,
        blockId,
        opcode: block.opcode,
        studentLabel: '目前無法解讀的擴充積木',
        path: `/targets/${graph.targetIndex}/blocks/${pointerPart(blockId)}`,
      }
      evidence.push(source)
      facts.push({
        id: `fact:${targetId}:opaque:${encodeURIComponent(blockId)}`,
        kind: 'limitation',
        targetName: graph.targetName,
        claim: `原始積木圖保留了一個目前未識別的「${block.opcode}」積木，Bridge 無法判定它的行為。`,
        evidence: [source],
        confidence: 'limited',
      })
    }
    for (const issue of graph.issues) {
      const existing = evidence.find((entry) => entry.blockId === issue.blockId)
      const issueBlock = Object.entries(graph.blocks).find(([blockId]) => blockId === issue.blockId)?.[1]
      const source =
        existing ??
        ({
          id: `evidence:${targetId}:${encodeURIComponent(issue.blockId)}`,
          targetId,
          targetName: graph.targetName,
          targetIndex: targetIndex < 0 ? graph.targetIndex : targetIndex,
          scriptIndex: null,
          blockId: issue.blockId,
          // Invalid graph entries are intentionally omitted from `graph.blocks`.
          // Keep their diagnostic evidence without dereferencing a missing node.
          opcode: issueBlock?.opcode ?? 'unknown',
          studentLabel: '目前無法解讀的積木',
          path: `/targets/${graph.targetIndex}/blocks/${pointerPart(issue.blockId)}`,
        } satisfies ProjectEvidence)
      if (!existing) evidence.push(source)
      facts.push({
        id: `fact:${targetId}:graph-issue:${encodeURIComponent(issue.code)}:${encodeURIComponent(issue.blockId)}`,
        kind: 'limitation',
        targetName: graph.targetName,
        claim: `原始積木 ${issue.blockId} 有結構問題：${issue.message}`,
        evidence: [source],
        confidence: 'limited',
      })
    }
  }

  for (const item of analysis.dependencies.broadcasts) {
    if (item.senders.length === 0 || item.receivers.length === 0) continue
    const sources = evidence.filter(
      (entry) => entry.opcode === 'event_broadcast' || entry.opcode === 'event_whenbroadcastreceived',
    )
    const relevant = sources.filter((entry) => {
      const endpoints = item.senders.concat(item.receivers)
      const { scriptIndex } = entry
      return (
        scriptIndex !== null && endpoints.some((endpoint) => endpoint === `${entry.targetName}#${scriptIndex + 1}`)
      )
    })
    if (relevant.length > 0)
      facts.push({
        id: `fact:broadcast:${encodeURIComponent(item.name)}`,
        kind: 'broadcast',
        targetName: '多個角色',
        claim: `訊息「${item.name}」由 ${item.senders.length} 個位置送出，並由 ${item.receivers.length} 段程式接收。`,
        evidence: relevant,
        confidence: 'high',
      })
  }

  const allRawNodes = rawGraphs.flatMap((graph) =>
    Object.values(graph.blocks).filter(({ shadow }) => shadow !== true),
  )
  const importedBlocks = allRawNodes.length
  recognizedBlocks = allRawNodes.filter(({ opcode }) => knownOpcodes.has(opcode)).length
  opaqueBlocks = importedBlocks - recognizedBlocks
  return {
    format: 'scratch-ai-bridge/project-map',
    version: 1,
    projectName: project.name,
    facts,
    evidence,
    coverage: {
      scripts: scriptsCoverage,
      roundTrip: 'not-run',
      importedBlocks,
      recognizedBlocks,
      opaqueBlocks,
      malformedGraphIssues: rawGraphs.reduce((sum, graph) => sum + graph.issues.length, 0),
    },
  }
}
