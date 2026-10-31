import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import type { CanonicalProject } from '../ir/types'
import { createLiveVariablePatchInstruction, parseLiveVariablePatch } from '../normalizer'

export interface AiPatchCandidate {
  readonly candidateId: string
  readonly patchJson: string
  readonly summary: string
  readonly baseRevision: number
  readonly operationCount: number
  readonly changes: readonly string[]
}

export const inspectProjectForAi = (project: CanonicalProject, revision: number): string =>
  createLiveVariablePatchInstruction(project, revision)

export const proposeLivePatch = (
  project: CanonicalProject,
  revision: number,
  patchJson: string,
): AiPatchCandidate => {
  const patch = parseLiveVariablePatch(patchJson, project, revision)
  const normalizedJson = JSON.stringify(patch)
  const changes = patch.operations.map((operation) => {
    if (operation.op === 'set-variable')
      return `${operation.target}/${operation.name}: ${JSON.stringify(operation.beforeValue)} → ${JSON.stringify(operation.value)}`
    if (operation.op === 'set-target-property')
      return `${operation.target}.${operation.property}: ${JSON.stringify(operation.beforeValue)} → ${JSON.stringify(operation.value)}`
    if (operation.op === 'set-stage-property')
      return `Stage.${operation.property}: ${JSON.stringify(operation.beforeValue)} → ${JSON.stringify(operation.value)}`
    if (operation.op === 'add-target-script')
      return `${operation.target}: 新增腳本（${operation.script.blocks.length} blocks）`
    if (operation.op === 'replace-target-script') return `${operation.target}: 替換腳本 ${operation.selector}`
    return `${operation.target}: 移除腳本 ${operation.selector}`
  })
  return {
    candidateId: bytesToHex(sha256(new TextEncoder().encode(normalizedJson))),
    patchJson: normalizedJson,
    summary: patch.summary,
    baseRevision: patch.baseRevision,
    operationCount: patch.operations.length,
    changes,
  }
}
