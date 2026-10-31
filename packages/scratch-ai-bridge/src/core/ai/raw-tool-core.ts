import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import {
  patchRawSb3Properties,
  patchRawSb3Variables,
  rawSb3Revision,
  type RawPropertyChange,
  type RawSb3Project,
} from '../archive'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

export const inspectRawProjectForAi = (project: RawSb3Project): string => {
  const targets = Array.isArray(project.projectJson.targets) ? project.projectJson.targets.filter(record) : []
  const inventory = targets.slice(0, 30).map((target) => {
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
    return { name: target.name, isStage: target.isStage, fields, variables: vars }
  })
  const instruction = `你是 Scratch 遊戲修改助手。僅提出一項修改，不能修改積木或雲端變數。輸出 JSON：{"format":"scratch-ai-bridge/raw-patch","version":1,"baseRevision":"下方 revision","summary":"簡述","change":{"kind":"property","targetName":"角色名稱","property":"x","expected":原值,"value":新值}}。變數使用 change {"kind":"variable","targetName":"角色名稱","variableId":"清單中的 ID","expected":原值,"value":新值}。expected 必須與清單完全相同；不可猜測省略的內容。只提案，使用者會確認。\nrevision: ${rawSb3Revision(project)}\n清單（最多 30 角色，每個最多 30 個變數；可能省略）：${JSON.stringify(inventory)}`
  if (new TextEncoder().encode(instruction).byteLength > 24000) throw new Error('作品摘要過大，請改用手動修改。')
  return instruction
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
  if (typeof change.targetName !== 'string' || !scalar(change.expected) || !scalar(change.value))
    throw new Error('Raw patch 修改欄位無效。')
  let next: RawSb3Project
  if (change.kind === 'property') {
    if (
      Object.keys(change).some((key) => !['kind', 'targetName', 'property', 'expected', 'value'].includes(key)) ||
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
  } else if (change.kind === 'variable') {
    if (
      Object.keys(change).some((key) => !['kind', 'targetName', 'variableId', 'expected', 'value'].includes(key)) ||
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
  } else throw new Error('Raw patch 僅支援 property 或 variable。')
  const normalized = JSON.stringify(input)
  return {
    candidateId: bytesToHex(sha256(new TextEncoder().encode(normalized))),
    patchJson: normalized,
    summary: input.summary,
    baseRevision: input.baseRevision,
    changes: [
      `${change.targetName}/${String(change.property ?? change.variableId)}：${JSON.stringify(change.expected)} → ${JSON.stringify(change.value)}`,
    ],
    project: next,
  }
}
