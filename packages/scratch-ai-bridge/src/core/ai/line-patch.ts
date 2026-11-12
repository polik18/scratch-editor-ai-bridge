/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unsafe-assignment -- Lossless SB3 graphs are external JSON and must retain defensive runtime checks. */
import type { RawSb3Project } from '../archive'
import { encodeCanonicalScriptsToBlockGraph, extractProjectBlockGraphs, type ScratchTargetBlockPatch } from '../graph'
import type { CanonicalBlock } from '../ir/types'
import { readProjectForAi } from '../reader'
import { parseScratchblocks } from '../scratchblocks'

export interface LinePatchSetOperation {
  readonly op: 'set'
  readonly line: string
  readonly slot: number
  readonly value: string | number | boolean
}

export interface LinePatchTextOperation {
  readonly op: 'replace' | 'insert_after'
  readonly line: string
  readonly text: string
}

export interface LinePatchDeleteOperation {
  readonly op: 'delete'
  readonly line: string
}

export type LinePatchOperation = LinePatchSetOperation | LinePatchTextOperation | LinePatchDeleteOperation

interface RawNode {
  readonly opcode: string
  readonly next?: string | null
  readonly parent?: string | null
  readonly inputs?: Record<string, unknown>
  readonly fields?: Record<string, unknown>
  readonly shadow?: boolean
  readonly topLevel?: boolean
  readonly [key: string]: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

const primitive = (value: string | number | boolean, inputName: string): [number, string | number] => {
  if (typeof value === 'boolean') return [10, value ? 'true' : 'false']
  if (typeof value === 'number') return [Number.isInteger(value) ? 4 : 5, value]
  if (/COLOR/i.test(inputName) && /^#[0-9a-f]{6}$/i.test(value)) return [9, value]
  return [10, value]
}

const asLine = (value: unknown): string => {
  if (typeof value !== 'string' || !/^L\d+$/.test(value)) throw new Error('行號必須是 L1、L2 這種格式。')
  return value
}

/**
 * Translate the small amount of reader zh-tw text needed for local line edits.
 * @param source Reader-formatted line.
 * @returns Parser-compatible Scratchblocks line.
 */
const toParserText = (source: string): string => {
  const text = source.trim().replace(/^L\d+\s+/, '')
  const replacements: readonly [RegExp, string][] = [
    [/^當綠旗被點擊$/, 'when green flag clicked'],
    [/^當這個角色被點擊$/, 'when this sprite clicked'],
    [/^顯示$/, 'show'],
    [/^隱藏$/, 'hide'],
    [/^分身刪除$/, 'stop this script'],
    [/^播放音效\s+(.+)$/, 'play sound $1'],
    [/^等待\s+(.+)\s+秒$/, 'wait $1 seconds'],
    [/^移動\s+(.+)\s+點$/, 'move $1 steps'],
    [/^x\s+改變\s+(.+)$/, 'change x by $1'],
    [/^y\s+改變\s+(.+)$/, 'change y by $1'],
    [/^x\s+設為\s+(.+)$/, 'set x to $1'],
    [/^y\s+設為\s+(.+)$/, 'set y to $1'],
    [/^定位到\s*x:\s*(.+?)\s*y:\s*(.+)$/, 'go to x:$1 y:$2'],
    [/^造型換成\s+(.+)$/, 'switch costume to $1'],
    [/^廣播訊息\s+(.+)$/, 'broadcast $1'],
    [/^變數\s+(.+)\s+設為\s+(.+)$/, 'set $1 to $2'],
    [/^變數\s+(.+)\s+改變\s+(.+)$/, 'change $1 by $2'],
    [/^重複無限次$/, 'forever'],
    [/^重複\s+(.+)\s+次$/, 'repeat $1'],
    [/^如果\s+(.+)\s+那麼$/, 'if $1 then'],
    [/^如果\s+(.+)\s+不成立\s+那麼$/, 'if not $1 then'],
  ]
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) return text.replace(pattern, replacement)
  }
  return text
}

const firstParsedBlock = (source: string): CanonicalBlock => {
  const parsed = parseScratchblocks(toParserText(source))
  const blocks = parsed.project.sprites[0]?.scripts[0]?.blocks ?? []
  if (parsed.skippedLines !== 0 || parsed.warnings.length !== 0 || blocks.length !== 1)
    throw new Error(`無法把這一行轉回 Scratch 積木：${source}`)
  const block = blocks[0]
  if (!block) throw new Error(`無法把這一行轉回 Scratch 積木：${source}`)
  return block
}

const compileBlock = (
  block: CanonicalBlock,
  target: Record<string, unknown>,
  rootId: string,
  existingIds: ReadonlySet<string>,
): Record<string, RawNode> => {
  const variables = isRecord(target.variables) ? target.variables : {}
  const lists = isRecord(target.lists) ? target.lists : {}
  const broadcasts = isRecord(target.broadcasts) ? target.broadcasts : {}
  let sequence = 0
  const nextId = (): string => {
    for (;;) {
      sequence += 1
      const id = `sab_line_${sequence.toString(36)}`
      if (!existingIds.has(id)) return id
    }
  }
  const encoded = encodeCanonicalScriptsToBlockGraph([{ blocks: [block] }], {
    nextId: () => (sequence++ === 0 ? rootId : nextId()),
    resolveVariable: (name) =>
      Object.entries(variables).find(([, value]) => Array.isArray(value) && value[0] === name)?.[0] ?? name,
    resolveList: (name) =>
      Object.entries(lists).find(([, value]) => Array.isArray(value) && value[0] === name)?.[0] ?? name,
    resolveBroadcast: (name) => Object.entries(broadcasts).find(([, value]) => value === name)?.[0] ?? name,
  })
  return encoded
}

const descriptorRef = (descriptor: unknown, id: string): boolean =>
  Array.isArray(descriptor) && descriptor.some((value) => value === id)

const mergeBlock = (
  patches: Map<number, ScratchTargetBlockPatch>,
  targetIndex: number,
  target: Record<string, unknown>,
  id: string,
  node: Record<string, unknown> | null,
): void => {
  const existing = patches.get(targetIndex)
  const blocks = { ...(existing?.blocks ?? {}), [id]: node }
  patches.set(targetIndex, {
    targetIndex,
    targetName: typeof target.name === 'string' ? target.name : '',
    isStage: target.isStage === true,
    blocks,
  })
}

const patchInputs = (node: RawNode, name: string, value: unknown): Record<string, unknown> => ({
  ...(node.inputs ?? {}),
  [name]: value,
})

/**
 * Convert reader line operations into target-scoped, ID-preserving graph edits.
 * @param project Imported lossless SB3 project.
 * @param operations Bounded line operations proposed by the AI.
 * @returns Target-scoped block graph patches.
 */
export const buildLinePatch = (
  project: RawSb3Project,
  operations: readonly LinePatchOperation[],
): ScratchTargetBlockPatch[] => {
  if (operations.length === 0 || operations.length > 20) throw new Error('一次行號修改必須包含 1～20 個操作。')
  const reader = readProjectForAi(project.projectJson, { entries: project.entries })
  const graphs = extractProjectBlockGraphs(project.projectJson)
  const rawTargets = Array.isArray(project.projectJson.targets) ? project.projectJson.targets : []
  const patches = new Map<number, ScratchTargetBlockPatch>()
  const touched = new Set<string>()
  for (const operation of operations) {
    const line = asLine(operation.line)
    const location = reader.lineMap.get(line)
    if (!location) throw new Error(`找不到讀本行號 ${line}。`)
    const key = `${location.targetIndex}:${location.blockId}`
    if (touched.has(key)) throw new Error(`${line} 不可在同一份提案中重複修改。`)
    touched.add(key)
    const graph = graphs[location.targetIndex]
    const target = rawTargets[location.targetIndex]
    const current = graph?.blocks[location.blockId]
    if (!graph || !isRecord(target) || !current) throw new Error(`${line} 對應的積木不存在。`)
    const rawCurrent = current as RawNode
    if (operation.op === 'set') {
      if (!Number.isSafeInteger(operation.slot) || operation.slot < 1 || !scalar(operation.value))
        throw new Error(`${line} 的 slot 或 value 無效。`)
      const inputNames = Object.keys(rawCurrent.inputs ?? {})
      const fieldNames = Object.keys(rawCurrent.fields ?? {})
      const name =
        inputNames[operation.slot - 1] ?? (inputNames.length === 0 ? fieldNames[operation.slot - 1] : undefined)
      if (!name) throw new Error(`${line} 沒有第 ${operation.slot} 個可修改欄位。`)
      if (inputNames.includes(name)) {
        const old = rawCurrent.inputs?.[name]
        const encoded = primitive(operation.value, name)
        const descriptor = Array.isArray(old) && old[0] === 3 ? [3, encoded, old[2]] : [1, encoded]
        mergeBlock(patches, location.targetIndex, target, location.blockId, {
          inputs: patchInputs(rawCurrent, name, descriptor),
        })
      } else {
        const old = rawCurrent.fields?.[name]
        const id =
          Array.isArray(old) && typeof old[1] === 'string'
            ? [String(operation.value), old[1]]
            : [String(operation.value)]
        mergeBlock(patches, location.targetIndex, target, location.blockId, {
          fields: { ...(rawCurrent.fields ?? {}), [name]: id },
        })
      }
      continue
    }
    if (operation.op === 'replace' || operation.op === 'insert_after') {
      const rootId =
        operation.op === 'replace'
          ? location.blockId
          : `sab_line_${location.blockId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`
      const compiled = compileBlock(
        firstParsedBlock(operation.text),
        target,
        rootId,
        new Set(Object.keys(graph.blocks)),
      )
      const compiledRoot = compiled[rootId]
      if (!compiledRoot) throw new Error(`${line} 的新積木無法建立。`)
      if (operation.op === 'replace') {
        mergeBlock(patches, location.targetIndex, target, location.blockId, {
          opcode: compiledRoot.opcode,
          inputs: compiledRoot.inputs,
          fields: compiledRoot.fields,
          ...(compiledRoot.mutation ? { mutation: compiledRoot.mutation } : {}),
        })
        for (const [id, node] of Object.entries(compiled))
          if (id !== rootId) mergeBlock(patches, location.targetIndex, target, id, node)
      } else {
        const next = rawCurrent.next ?? null
        const inserted = { ...compiledRoot, next, parent: location.blockId, topLevel: false }
        mergeBlock(patches, location.targetIndex, target, location.blockId, { next: rootId })
        mergeBlock(patches, location.targetIndex, target, rootId, inserted)
        if (next && graph.blocks[next]) mergeBlock(patches, location.targetIndex, target, next, { parent: rootId })
        for (const [id, node] of Object.entries(compiled))
          if (id !== rootId) mergeBlock(patches, location.targetIndex, target, id, node)
      }
      continue
    }
    const predecessors = Object.entries(graph.blocks).filter(([, node]) => node.next === location.blockId)
    if (predecessors.length > 1) throw new Error(`${line} 的積木鏈有多個前一塊，不能安全刪除。`)
    const predecessor = predecessors[0]
    const next = rawCurrent.next ?? null
    if (predecessor) {
      mergeBlock(patches, location.targetIndex, target, predecessor[0], { next })
    } else if (rawCurrent.parent && graph.blocks[rawCurrent.parent]) {
      const parent = graph.blocks[rawCurrent.parent] as RawNode
      const substack = Object.entries(parent.inputs ?? {}).find(
        ([name, descriptor]) => name.startsWith('SUBSTACK') && descriptorRef(descriptor, location.blockId),
      )
      if (!substack) throw new Error(`${line} 不是可單獨刪除的程式行。`)
      mergeBlock(patches, location.targetIndex, target, rawCurrent.parent, {
        inputs: patchInputs(parent, substack[0], Array.isArray(substack[1]) ? [substack[1][0], next] : [2, next]),
      })
    }
    if (next && graph.blocks[next])
      mergeBlock(patches, location.targetIndex, target, next, {
        parent: predecessor?.[0] ?? rawCurrent.parent ?? null,
      })
    mergeBlock(patches, location.targetIndex, target, location.blockId, null)
  }
  return [...patches.values()]
}
/* eslint-enable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unsafe-assignment */
