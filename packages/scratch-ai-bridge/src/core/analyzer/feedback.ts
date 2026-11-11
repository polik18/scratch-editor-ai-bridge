import type { AnalysisIR, ProjectMap } from './'

export type FeedbackKind = 'confirmed-structure' | 'likely-behavior' | 'design-question' | 'unsupported-feature'

export interface ProjectFeedbackItem {
  readonly id: string
  readonly kind: FeedbackKind
  readonly severity: 'info' | 'warning'
  readonly confidence: 'high' | 'limited'
  readonly title: string
  readonly message: string
  readonly nextStep: string
  readonly evidenceIds: readonly string[]
}

export interface ProjectFeedback {
  readonly format: 'scratch-ai-bridge/project-feedback'
  readonly version: 1
  readonly summary: string
  readonly items: readonly ProjectFeedbackItem[]
  readonly limits: readonly string[]
}

export const diagnosticFeedbackId = (diagnostic: AnalysisIR['diagnostics'][number]): string => {
  const base = `diagnostic:${diagnostic.code}:${encodeURIComponent(diagnostic.target ?? '')}:${diagnostic.script ?? 0}`
  const identity =
    diagnostic.monitorId ??
    (diagnostic.code === 'cloud-variable-offline' ? diagnostic.variable : undefined) ??
    (diagnostic.assetName !== undefined ? `${diagnostic.assetKind}:${diagnostic.assetName}` : undefined) ??
    diagnostic.blockId ??
    diagnostic.extensionId ??
    diagnostic.procedureName ??
    diagnostic.broadcastName ??
    diagnostic.evidencePaths?.[0]
  return identity ? `${base}:${encodeURIComponent(identity)}` : base
}

const kindForFact = (kind: ProjectMap['facts'][number]['kind']): FeedbackKind =>
  kind === 'limitation' ? 'unsupported-feature' : 'confirmed-structure'

/**
 * Convert evidence-backed facts and calibrated static diagnostics into formative feedback.
 * @param analysis - Static checks for the imported project.
 * @param map - Factual project map with source evidence.
 * @returns Feedback items that keep observations separate from design questions.
 */
export const createProjectFeedback = (analysis: AnalysisIR, map: ProjectMap): ProjectFeedback => {
  const seenTargets = new Set<number>()
  const representativeFacts = map.facts.filter((fact) => {
    if (fact.kind === 'limitation') {
      return !fact.evidence.some((source) =>
        analysis.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === 'block-graph-invalid-argument-reporter' &&
            diagnostic.severity === 'info' &&
            diagnostic.target === source.targetName &&
            diagnostic.blockId === source.blockId,
        ),
      )
    }
    if (fact.kind === 'trigger') return false
    const target = fact.evidence.at(0)?.targetIndex
    if (target === undefined || seenTargets.has(target)) return false
    seenTargets.add(target)
    return true
  })
  const items: ProjectFeedbackItem[] = representativeFacts.map((fact) => ({
    id: fact.id,
    kind: kindForFact(fact.kind),
    severity: 'info',
    confidence: fact.confidence,
    title: fact.kind === 'limitation' ? '目前無法完整解讀' : '作品觀察',
    message: fact.claim,
    nextStep:
      fact.kind === 'limitation'
        ? '可以在原 Scratch 專案中執行這段程式，確認這個積木帶來的效果。'
        : '想一想：這段程式對角色或作品有什麼作用？',
    evidenceIds: fact.evidence.map(({ id }) => id),
  }))

  const detachedByTarget = new Map<string, { index: number; count: number; firstLabel?: string }>()

  for (const diagnostic of analysis.diagnostics) {
    if (
      [
        'forever-reinitialize',
        'empty-event-hat',
        'single-costume-nextcostume-loop',
        'overlapping-comparison-chain',
        'concurrent-event-state-conflict',
        'duplicate-script-in-target',
      ].includes(diagnostic.code)
    ) {
      const scripts = [diagnostic.script, ...(diagnostic.relatedScripts ?? [])].filter(
        (index): index is number => index !== undefined,
      )
      const related = map.evidence.filter(
        (item) =>
          item.targetName === diagnostic.target &&
          item.scriptIndex !== null &&
          scripts.includes(item.scriptIndex + 1),
      )
      const selected =
        diagnostic.code === 'duplicate-script-in-target'
          ? scripts.flatMap((script) => related.filter((item) => item.scriptIndex === script - 1).slice(0, 1))
          : diagnostic.code === 'concurrent-event-state-conflict'
            ? scripts.flatMap((script) =>
                related
                  .filter(
                    (item) => item.scriptIndex === script - 1 && ['looks_show', 'looks_hide'].includes(item.opcode),
                  )
                  .slice(0, 1),
              )
            : diagnostic.code === 'overlapping-comparison-chain'
              ? related.filter(({ path }) => diagnostic.evidencePaths?.includes(path))
              : diagnostic.code === 'single-costume-nextcostume-loop'
                ? [
                    ...related.filter(({ opcode }) => opcode === 'looks_nextcostume').slice(0, 1),
                    ...map.evidence
                      .filter((item) => item.targetName === diagnostic.target && item.opcode === 'asset-costume')
                      .slice(0, 1),
                  ]
                : diagnostic.code === 'forever-reinitialize'
                  ? related
                      .filter(({ opcode }) => opcode === 'control_forever' || opcode === 'data_setvariableto')
                      .slice(0, 2)
                  : related.slice(0, 1)
      items.push({
        id: diagnosticFeedbackId(diagnostic),
        kind: 'design-question',
        severity: 'info',
        confidence: 'limited',
        title: '一個可以檢查的設計選擇',
        message: `${diagnostic.message} 這是程式結構觀察，不代表一定有錯。`,
        nextStep:
          diagnostic.code === 'forever-reinitialize'
            ? '如果這個值每一輪都要更新，保留目前寫法；若只想在開始時設定一次，再考慮移到迴圈前。'
            : '在 Scratch 中檢查這段程式，並測試是否符合你的設計。',
        evidenceIds: selected.map(({ id }) => id),
      })
      continue
    }
    if (diagnostic.severity !== 'warning' && !['detached-script', 'broadcast-no-receiver'].includes(diagnostic.code))
      continue
    const related = map.evidence.filter((item) => {
      if (diagnostic.target && item.targetName !== diagnostic.target) return false
      if (diagnostic.script && item.scriptIndex !== diagnostic.script - 1) return false
      if (diagnostic.script) return !diagnostic.evidencePaths || diagnostic.evidencePaths.includes(item.path)
      if (diagnostic.blockId !== undefined) return item.blockId === diagnostic.blockId
      if (diagnostic.monitorId !== undefined)
        return item.reference?.kind === 'monitor' && item.reference.key === diagnostic.monitorId
      if (diagnostic.assetName !== undefined && diagnostic.assetKind)
        return (
          item.reference?.kind === 'asset' && item.reference.key === `${diagnostic.assetKind}:${diagnostic.assetName}`
        )
      if (diagnostic.code === 'cloud-variable-offline')
        return item.reference?.kind === 'variable' && item.reference.key === diagnostic.variable
      if (diagnostic.procedureName)
        return item.reference?.kind === 'procedure' && item.reference.key === diagnostic.procedureName
      if (diagnostic.code.startsWith('extension-')) {
        const prefix = diagnostic.extensionId
        return (
          prefix !== undefined &&
          (item.opcode.split('_')[0].replace(/[^\w-]/g, '-') === prefix ||
            (item.reference?.kind === 'extension' && item.reference.key === prefix))
        )
      }
      if (diagnostic.code === 'broadcast-no-receiver') {
        const name = diagnostic.broadcastName
        const index = analysis.dependencies.broadcasts.findIndex((broadcast) => broadcast.name === name)
        return (
          index >= 0 &&
          item.symbol === `訊息 M${index + 1}` &&
          ['event_broadcast', 'event_broadcastandwait'].includes(item.opcode)
        )
      }
      return false
    })
    if (related.length === 0) continue
    const firstBlock =
      diagnostic.code === 'detached-script'
        ? related.find(({ path }) => path.endsWith(`/scripts/${(diagnostic.script ?? 1) - 1}/blocks/0`))
        : undefined
    const importantOpcodes: Partial<Record<string, readonly string[]>> = {
      'condition-variable-mismatch-in-loop': ['control_if', 'data_setvariableto', 'data_changevariableby'],
      'delete-clone-under-non-clone-hat': ['control_delete_this_clone'],
    }
    const opcodes = importantOpcodes[diagnostic.code]
    const matched = opcodes ? related.filter(({ opcode }) => opcodes.includes(opcode)) : related
    const duplicateEvidence =
      diagnostic.code === 'duplicate-script-in-target' && diagnostic.relatedScripts
        ? diagnostic.relatedScripts.flatMap((script) =>
            map.evidence
              .filter((item) => item.targetName === diagnostic.target && item.scriptIndex === script - 1)
              .slice(0, 1),
          )
        : []
    const warningEvidence = firstBlock
      ? [firstBlock]
      : [...matched.slice(0, duplicateEvidence.length ? 1 : 2), ...duplicateEvidence]
    if (warningEvidence.length === 0) continue
    if (diagnostic.code === 'detached-script') {
      const targetKey = diagnostic.target ?? ''
      const existing = detachedByTarget.get(targetKey)
      if (existing) {
        existing.count += 1
        const current = items[existing.index]
        const mergedEvidenceIds = [...new Set([...current.evidenceIds, ...warningEvidence.map(({ id }) => id)])]
        items[existing.index] = {
          ...current,
          message: existing.firstLabel
            ? `這段程式一開始是「${existing.firstLabel}」，同一角色共有 ${existing.count} 段沒有接上綠旗或按鍵等開始積木的程式，可能是草稿或手動執行，不一定是錯誤。`
            : `同一角色共有 ${existing.count} 段程式沒有事件積木（例如綠旗或按鍵），可能是草稿或手動執行，不一定是錯誤。`,
          evidenceIds: mergedEvidenceIds,
        }
        continue
      }
      detachedByTarget.set(targetKey, {
        index: items.length,
        count: 1,
        firstLabel: firstBlock?.studentLabel,
      })
    }
    const isInvalidArgReporter = diagnostic.code === 'block-graph-invalid-argument-reporter'
    items.push({
      id: diagnosticFeedbackId(diagnostic),
      kind: diagnostic.severity === 'info' ? 'design-question' : 'likely-behavior',
      severity: diagnostic.severity,
      confidence: 'limited',
      title:
        diagnostic.code === 'detached-script'
          ? '未接上事件積木的程式'
          : isInvalidArgReporter
            ? '自製積木參數積木不在對應定義中'
            : diagnostic.code === 'broadcast-no-receiver'
              ? '訊息傳送線索'
              : '建議確認',
      message:
        firstBlock && diagnostic.code === 'detached-script'
          ? `這段程式一開始是「${firstBlock.studentLabel}」，沒有接事件積木；可能是草稿或手動執行，不一定是錯誤。`
          : isInvalidArgReporter
            ? `${diagnostic.message} 這常發生於拆下或複製自製積木後留下的游離草稿積木，不一定代表正式程式有錯。`
            : diagnostic.message,
      nextStep:
        diagnostic.code === 'detached-script'
          ? '如果你希望這段程式自動執行，再確認應接哪個事件；草稿或手動執行的程式可以保留原樣。'
          : isInvalidArgReporter
            ? '在 Scratch 編輯器中檢查該角色是否有未接上的參數積木草稿，或確認「我的積木」定義中的參數名稱是否一致。'
            : diagnostic.code === 'broadcast-no-receiver'
              ? '如果預期其他程式收到這個訊息，可以檢查接收事件；預留或暫時未使用的訊息可保留。'
              : '在 Scratch 中執行作品，或檢查相關角色的事件與程式，再確認是否符合你的設計。',
      evidenceIds: warningEvidence.map(({ id }) => id),
    })
  }

  const priority = (item: ProjectFeedbackItem): number =>
    item.severity === 'warning'
      ? 0
      : item.kind === 'design-question'
        ? 1
        : item.kind === 'unsupported-feature'
          ? 2
          : 3
  items.sort((left, right) => priority(left) - priority(right))

  const confirmed = map.facts.filter(({ confidence }) => confidence === 'high').length
  return {
    format: 'scratch-ai-bridge/project-feedback',
    version: 1,
    summary: `找到 ${confirmed} 項有積木依據的作品觀察。這份分析來自專案結構，沒有替作品評分。`,
    items,
    limits: [
      '靜態分析無法判定創意、美感、難度、學生是否理解程式或作品的實際手感。',
      '除非明確附上 VM/瀏覽器測試結果，否則不代表作品已執行或 FPS 達標。',
      ...map.facts.filter(({ kind }) => kind === 'limitation').map(({ claim }) => claim),
    ],
  }
}
