import type { ScratchTargetBlockGraph, ScratchTargetBlockPatch } from './block-graph'

export const PRESERVATION_EDIT_FORMAT = 'scratch-ai-bridge/block-graph-patch' as const
const MAX_PATCH_RESPONSE_CHARACTERS = 1_000_000
const MAX_PATCHED_BLOCKS = 5_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pointerSegments = (path: string): string[] =>
  path
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))

const pointerPathsOverlap = (left: string, right: string): boolean => {
  const leftSegments = pointerSegments(left)
  const rightSegments = pointerSegments(right)
  const sharedLength = Math.min(leftSegments.length, rightSegments.length)
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftSegments[index] !== rightSegments[index]) return false
  }
  return true
}

/**
 * Build an AI instruction that edits only selected raw graph nodes.
 * @param targets Original block graphs from the source SB3.
 * @param request User's intended change.
 * @returns A prompt containing the source graph and a strict patch envelope.
 */
export const createPreservationEditPrompt = (
  targets: readonly ScratchTargetBlockGraph[],
  request: string,
): string => {
  const trimmedRequest = request.trim()
  if (!trimmedRequest) throw new Error('請先寫下希望 AI 修改的內容')
  if (trimmedRequest.length > 2_000) throw new Error('修改需求不可超過 2,000 個字元')

  const sourceTargets = targets.map(({ targetIndex, targetName, isStage, blocks }) => ({
    targetIndex,
    targetName,
    isStage,
    blocks,
  }))
  const sourceGraph = JSON.stringify(sourceTargets)
  if (sourceGraph.length > MAX_PATCH_RESPONSE_CHARACTERS) {
    throw new Error('原始積木圖太大，無法安全放入單次 AI 修正指令')
  }

  return [
    '你是 Scratch 專案的局部積木圖修正工具。只依照修改需求編輯指定積木，不要重寫整份專案。',
    '只輸出一個 JSON 根物件，不要 Markdown、說明文字、程式碼或遠端 extension 程式。',
    '格式必須是 {"format":"scratch-ai-bridge/block-graph-patch","version":1,"patches":[{"targetIndex":0,"targetName":"Stage","isStage":true,"blocks":{"block-id":{"fields":{}}}}]}。',
    'patches 只列出有變更的 target；blocks 只列出要修改、新增或刪除的 block ID。未列出的 target、block 與欄位必須保持原樣。',
    '修改既有 block 時只輸出要變更的頂層屬性；inputs、fields、mutation 一旦提供，就會整個取代該屬性。若只改巢狀既有欄位，使用 setPaths: [{"path":"/mutation/argumentids","value":"[]"}]；刪除巢狀欄位使用 removePaths: ["/mutation/argumentids"]。路徑是 JSON Pointer，只能走訪並修改既有物件欄位，不可建立欄位或使用陣列索引。要刪除頂層屬性，使用 removeProperties，例如 {"removeProperties":["mutation"]}；刪除 block 請將該 ID 設為 null。新增 block 必須提供完整合法 graph node，且不能使用移除或路徑操作。',
    '維持 next、parent、inputs block references 的一致性；不要更動未受影響的 ID。patch 會在本機驗證，無效時不會匯出。',
    '未知 opcode、mutation、extension 欄位及素材會由本機原始 SB3 保留；不得要求載入或執行 extension 程式碼。',
    `修改需求：${trimmedRequest}`,
    `原始積木圖：${sourceGraph}`,
  ].join('\n\n')
}

/**
 * Parse and bind an AI patch envelope to the exact uploaded target identities.
 * @param input AI response text.
 * @param sourceTargets Original target graph snapshots.
 * @returns Target-scoped raw block patches.
 */
export const parsePreservationEditPatch = (
  input: string,
  sourceTargets: readonly ScratchTargetBlockGraph[],
): ScratchTargetBlockPatch[] => {
  if (input.length === 0 || input.length > MAX_PATCH_RESPONSE_CHARACTERS) {
    throw new Error('Patch 回覆不可為空，且不可超過 1,000,000 個字元')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new Error('Patch 必須是有效的 JSON 根物件')
  }
  if (!isRecord(parsed) || parsed.format !== PRESERVATION_EDIT_FORMAT || parsed.version !== 1) {
    throw new Error('Patch 格式或版本不支援')
  }
  if (!Array.isArray(parsed.patches) || parsed.patches.length === 0 || parsed.patches.length > sourceTargets.length) {
    throw new Error('Patch 必須列出至少一個、且不超過原專案 target 數量的修改')
  }

  const targetsByIndex = new Map(sourceTargets.map((target) => [target.targetIndex, target]))
  const seenTargets = new Set<number>()
  let patchedBlockCount = 0
  return parsed.patches.map((value, patchIndex) => {
    if (!isRecord(value)) throw new Error(`Patch target ${patchIndex} 必須是物件`)
    const { targetIndex, targetName, isStage, blocks } = value
    if (
      !Number.isSafeInteger(targetIndex) ||
      typeof targetName !== 'string' ||
      typeof isStage !== 'boolean' ||
      !isRecord(blocks) ||
      Object.keys(blocks).length === 0
    ) {
      throw new Error(`Patch target ${patchIndex} 的識別資訊或 blocks 無效`)
    }
    const target = targetsByIndex.get(targetIndex as number)
    if (!target) throw new Error(`Patch target ${patchIndex} 與上傳專案不符`)
    if (target.targetName !== targetName || target.isStage !== isStage || seenTargets.has(target.targetIndex)) {
      throw new Error(`Patch target ${patchIndex} 與上傳專案不符或重複`)
    }
    seenTargets.add(target.targetIndex)

    for (const [blockId, nodePatch] of Object.entries(blocks)) {
      patchedBlockCount += 1
      if (blockId.length === 0 || blockId.length > 256) throw new Error('Patch block ID 長度無效')
      if (nodePatch === null) continue
      if (!isRecord(nodePatch)) throw new Error(`Patch block ${blockId} 必須是物件或 null`)
      if (nodePatch.opcode !== undefined && typeof nodePatch.opcode !== 'string') {
        throw new Error(`Patch block ${blockId} 的 opcode 必須是文字`)
      }
      if (nodePatch.removeProperties !== undefined) {
        if (
          !Array.isArray(nodePatch.removeProperties) ||
          nodePatch.removeProperties.length === 0 ||
          nodePatch.removeProperties.some(
            (property: unknown) => typeof property !== 'string' || property.length === 0,
          ) ||
          new Set<unknown>(nodePatch.removeProperties).size !== nodePatch.removeProperties.length ||
          nodePatch.removeProperties.some(
            (property: unknown) => typeof property === 'string' && Object.hasOwn(nodePatch, property),
          )
        ) {
          throw new Error(`Patch block ${blockId} 的 removeProperties 必須是唯一、非空且未同時被修改的屬性名稱清單`)
        }
      }
      if (nodePatch.setPaths !== undefined) {
        if (
          !Array.isArray(nodePatch.setPaths) ||
          nodePatch.setPaths.length === 0 ||
          nodePatch.setPaths.some(
            (entry: unknown) => !isRecord(entry) || typeof entry.path !== 'string' || !Object.hasOwn(entry, 'value'),
          )
        )
          throw new Error(`Patch block ${blockId} 的 setPaths 格式無效`)
      }
      if (nodePatch.removePaths !== undefined) {
        if (
          !Array.isArray(nodePatch.removePaths) ||
          nodePatch.removePaths.length === 0 ||
          nodePatch.removePaths.some((path: unknown) => typeof path !== 'string') ||
          new Set<unknown>(nodePatch.removePaths).size !== nodePatch.removePaths.length
        )
          throw new Error(`Patch block ${blockId} 的 removePaths 格式無效`)
      }
      const pathOperations = [
        ...((nodePatch.setPaths ?? []) as { path: string }[]).map(({ path }) => path),
        ...((nodePatch.removePaths ?? []) as string[]),
      ]
      if (
        pathOperations.some((path, pathIndex) =>
          pathOperations.slice(pathIndex + 1).some((otherPath) => pointerPathsOverlap(path, otherPath)),
        )
      ) {
        throw new Error(`Patch block ${blockId} 不可操作重疊巢狀路徑`)
      }
      for (const path of pathOperations) {
        if (!path.startsWith('/') || path.length > 512 || /~(?![01])/.test(path)) {
          throw new Error(`Patch block ${blockId} 的巢狀路徑不是有效 JSON Pointer`)
        }
        const segments = path
          .slice(1)
          .split('/')
          .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
        if (segments.some((segment) => !segment || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
          throw new Error(`Patch block ${blockId} 的巢狀路徑包含空白或不安全欄位`)
        }
        const first = path.startsWith('/') ? path.slice(1).split('/')[0].replace(/~1/g, '/').replace(/~0/g, '~') : ''
        if (Object.hasOwn(nodePatch, first))
          throw new Error(`Patch block ${blockId} 不可同時整體替換與局部修改 ${first}`)
      }
    }
    if (patchedBlockCount > MAX_PATCHED_BLOCKS) throw new Error('單次 patch 不可修改超過 5,000 個積木')

    return {
      targetIndex: target.targetIndex,
      targetName: target.targetName,
      isStage: target.isStage,
      blocks: blocks as ScratchTargetBlockPatch['blocks'],
    }
  })
}
