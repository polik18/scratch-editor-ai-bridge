import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import {
  patchRawSb3Properties,
  patchRawSb3Variables,
  patchLosslessSb3BlockGraphs,
  rawSb3Revision,
  type RawPropertyChange,
  type RawSb3Project,
} from '../archive'
import { extractProjectBlockGraphs, parsePreservationEditPatch } from '../graph'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

export const inspectRawProjectForAi = (project: RawSb3Project): string => {
  const targets = Array.isArray(project.projectJson.targets) ? project.projectJson.targets : []
  const inventory = targets.slice(0, 30).flatMap((target: unknown, targetIndex: number) => {
    if (!record(target)) return []
    const fields = Object.fromEntries(
      ['x', 'y', 'direction', 'size', 'visible', 'currentCostume', 'volume', 'tempo']
        .filter((field) => scalar(target[field]))
        .map((field) => [field, target[field]]),
    )
    const vars = record(target.variables)
      ? Object.entries(target.variables)
          .slice(0, 30)
          .flatMap(([id, item]) => {
            if (!Array.isArray(item) || typeof item[0] !== 'string' || !scalar(item[1]) || item[2] === true) return []
            return [
              {
                id,
                name: item[0].slice(0, 80),
                value: typeof item[1] === 'string' ? item[1].slice(0, 512) : item[1],
              },
            ]
          })
      : []
    return [{ targetIndex, name: target.name, isStage: target.isStage, fields, variables: vars }]
  })
  const instruction = `你是 Scratch 遊戲修改助手。僅提出一項修改，不可修改雲端變數。輸出 JSON：{"format":"scratch-ai-bridge/raw-patch","version":1,"baseRevision":"下方 revision","summary":"簡述","change":{"kind":"property","targetName":"角色名稱","property":"x","expected":原值,"value":新值}}。變數使用 change {"kind":"variable","targetName":"角色名稱","variableId":"清單中的 ID","expected":原值,"value":新值}。積木先呼叫 inspect_raw_blocks 讀取目標圖，再使用 change {"kind":"blocks","graphPatch":{"format":"scratch-ai-bridge/block-graph-patch","version":1,"patches":[{"targetIndex":0,"targetName":"Stage","isStage":true,"blocks":{"block-id":{"fields":{}}}}]}}。既有 block 只提供要替換的頂層屬性；inputs/fields/mutation 會整個替換。可用 inspect_raw_targets 和 inspect_raw_variables 分頁讀取未顯示的角色和變數。不可猜測省略的內容，必須維持 parent、next 和 inputs 圖結構。只提案，使用者會確認。\nrevision: ${rawSb3Revision(project)}\n清單（最多 30 角色，每個最多 30 個變數；可能省略）：${JSON.stringify(inventory)}`
  if (new TextEncoder().encode(instruction).byteLength > 24000) throw new Error('作品摘要過大，請改用手動修改。')
  return instruction
}

export const inspectRawTargets = (project: RawSb3Project, baseRevision: string, offset = 0, limit = 20) => {
  if (rawSb3Revision(project) !== baseRevision) throw new Error('SB3 revision has changed')
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 30)
    throw new Error('Invalid raw target page request.')
  const targets = project.projectJson.targets
  if (!Array.isArray(targets)) throw new Error('Raw project targets are missing.')
  const page = targets.slice(offset, offset + limit).map((target: unknown, index: number) => {
    if (
      !record(target) ||
      typeof target.name !== 'string' ||
      typeof target.isStage !== 'boolean' ||
      target.name.length > 256
    )
      throw new Error('Invalid raw target identity.')
    const fields = Object.fromEntries(
      ['x', 'y', 'direction', 'size', 'visible', 'currentCostume', 'volume', 'tempo']
        .filter((field) => scalar(target[field]))
        .map((field) => [field, target[field]]),
    )
    return {
      targetIndex: offset + index,
      name: target.name,
      isStage: target.isStage,
      fields,
      blockCount: record(target.blocks) ? Object.keys(target.blocks).length : 0,
    }
  })
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > 10000)
    throw new Error('Target page too large; reduce limit.')
  return {
    baseRevision,
    offset,
    targets: page,
    nextOffset: offset + page.length < targets.length ? offset + page.length : null,
    total: targets.length,
  }
}

export const inspectRawVariables = (
  project: RawSb3Project,
  baseRevision: string,
  targetIndex: number,
  offset = 0,
  limit = 20,
) => {
  if (rawSb3Revision(project) !== baseRevision) throw new Error('SB3 revision has changed')
  if (
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 30
  )
    throw new Error('Invalid raw variable page request.')
  const targets = project.projectJson.targets
  const target: unknown = Array.isArray(targets) ? targets.at(targetIndex) : undefined
  if (!record(target) || typeof target.name !== 'string') throw new Error('Raw target not found.')
  const variables = record(target.variables)
    ? Object.entries(target.variables).filter(
        ([, item]) => Array.isArray(item) && typeof item[0] === 'string' && scalar(item[1]) && item[2] !== true,
      )
    : []
  const page = variables.slice(offset, offset + limit).map(([id, item]) => {
    const entry = item as unknown[]
    if (typeof entry[1] === 'string' && entry[1].length > 512)
      throw new Error('Variable value is too large for AI inspection.')
    return { id, name: entry[0], value: entry[1] }
  })
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > 10000)
    throw new Error('Variable page too large; reduce limit.')
  return {
    baseRevision,
    targetIndex,
    targetName: target.name,
    offset,
    variables: page,
    nextOffset: offset + page.length < variables.length ? offset + page.length : null,
    total: variables.length,
  }
}

export const inspectRawBlocks = (
  project: RawSb3Project,
  baseRevision: string,
  targetIndex: number,
  offset = 0,
  limit = 10,
) => {
  if (rawSb3Revision(project) !== baseRevision) throw new Error('SB3 revision has changed')
  if (
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw new Error('Invalid raw block page request.')
  const target = extractProjectBlockGraphs(project.projectJson).at(targetIndex)
  if (!target) throw new Error('Raw block target not found.')
  if (target.issues.length) throw new Error('Target block graph has existing issues and cannot be safely patched.')
  const all = Object.entries(target.blocks)
  const page: [string, unknown][] = []
  for (const [id, block] of all.slice(offset, offset + limit)) {
    const candidate = [...page, [id, block]]
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > 10000) {
      if (!page.length) throw new Error('A block is too large to inspect safely.')
      break
    }
    page.push([id, block])
  }
  return {
    baseRevision,
    targetIndex,
    targetName: target.targetName,
    isStage: target.isStage,
    offset,
    blocks: Object.fromEntries(page),
    nextOffset: offset + page.length < all.length ? offset + page.length : null,
    total: all.length,
  }
}

export const proposeRawLivePatch = (project: RawSb3Project, patchJson: string) => {
  if (new TextEncoder().encode(patchJson).byteLength > 16 * 1024) throw new Error('Raw patch 超過 16 KiB。')
  const input: unknown = JSON.parse(patchJson)
  if (
    !record(input) ||
    Object.keys(input).some((key) => !['format', 'version', 'baseRevision', 'summary', 'change'].includes(key)) ||
    input.format !== 'scratch-ai-bridge/raw-patch' ||
    input.version !== 1 ||
    typeof input.baseRevision !== 'string' ||
    typeof input.summary !== 'string' ||
    !input.summary.trim() ||
    input.summary.length > 200 ||
    !record(input.change)
  )
    throw new Error('Raw patch 格式無效。')
  const change = input.change
  let next: RawSb3Project
  let changes: string[]
  let requiresVmValidation = false
  if (change.kind === 'property') {
    if (
      Object.keys(change).some((key) => !['kind', 'targetName', 'property', 'expected', 'value'].includes(key)) ||
      typeof change.targetName !== 'string' ||
      !scalar(change.expected) ||
      !scalar(change.value) ||
      typeof change.property !== 'string' ||
      typeof change.expected === 'string' ||
      typeof change.value === 'string'
    )
      throw new Error('Raw property patch 格式無效。')
    next = patchRawSb3Properties(project, input.baseRevision, [
      {
        targetName: change.targetName,
        property: change.property as RawPropertyChange['property'],
        expected: change.expected,
        value: change.value,
      },
    ])
    changes = [
      `${change.targetName}/${change.property}：${JSON.stringify(change.expected)} → ${JSON.stringify(change.value)}`,
    ]
  } else if (change.kind === 'variable') {
    if (
      Object.keys(change).some((key) => !['kind', 'targetName', 'variableId', 'expected', 'value'].includes(key)) ||
      typeof change.targetName !== 'string' ||
      !scalar(change.expected) ||
      !scalar(change.value) ||
      typeof change.variableId !== 'string'
    )
      throw new Error('Raw variable patch 格式無效。')
    next = patchRawSb3Variables(project, input.baseRevision, [
      {
        targetName: change.targetName,
        variableId: change.variableId,
        expected: change.expected,
        value: change.value,
      },
    ])
    changes = [
      `${change.targetName}/${change.variableId}：${JSON.stringify(change.expected)} → ${JSON.stringify(change.value)}`,
    ]
  } else if (change.kind === 'blocks') {
    if (Object.keys(change).some((key) => !['kind', 'graphPatch'].includes(key)) || !record(change.graphPatch))
      throw new Error('Raw block patch 格式無效。')
    if (rawSb3Revision(project) !== input.baseRevision) throw new Error('SB3 revision has changed')
    const graphs = extractProjectBlockGraphs(project.projectJson)
    const patches = parsePreservationEditPatch(JSON.stringify(change.graphPatch), graphs)
    if (patches.reduce((count, patch) => count + Object.keys(patch.blocks).length, 0) > 20)
      throw new Error('單次 AI 積木提案最多修改 20 個積木。')
    if (patches.some((patch) => graphs[patch.targetIndex]?.issues.length))
      throw new Error('Target block graph has existing issues and cannot be safely patched.')
    next = patchLosslessSb3BlockGraphs(project, patches)
    const nextGraphs = extractProjectBlockGraphs(next.projectJson)
    changes = patches.flatMap((patch) =>
      Object.keys(patch.blocks).map((id) => {
        const before = JSON.stringify(graphs[patch.targetIndex]?.blocks[id] ?? null)
        const after = JSON.stringify(nextGraphs[patch.targetIndex]?.blocks[id] ?? null)
        if (before.length > 3000 || after.length > 3000) throw new Error('積木差異太大，請縮小修改範圍。')
        return `${patch.targetName}/${id}\n之前：${before}\n之後：${after}`
      }),
    )
    if (changes.join('\n').length > 12000) throw new Error('積木差異太大，請縮小修改範圍。')
    requiresVmValidation = true
  } else throw new Error('Raw patch 僅支援 property、variable 或 blocks。')
  const normalized = JSON.stringify(input)
  return {
    candidateId: bytesToHex(sha256(new TextEncoder().encode(normalized))),
    patchJson: normalized,
    summary: input.summary,
    baseRevision: input.baseRevision,
    changes,
    requiresVmValidation,
    project: next,
  }
}
