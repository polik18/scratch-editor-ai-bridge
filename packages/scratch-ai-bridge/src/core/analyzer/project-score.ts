import { getBlockCapability } from '../capabilities'
import type { CanonicalBlock, CanonicalProject } from '../ir/types'
import type { AnalysisIR, ProjectMap } from './'
import { createProjectFeedback, type ProjectFeedback } from './feedback'

export interface ProjectScoreCriterion {
  readonly id: string
  readonly title: string
  readonly points: number
  readonly score: number | null
  readonly applicability: 'applicable' | 'not-applicable'
  readonly explanation: string
  readonly evidenceIds: readonly string[]
}

export interface ProjectScore {
  readonly format: 'scratch-ai-bridge/project-score'
  readonly version: 1
  readonly rubric: 'sb3-static-v3'
  readonly total: number | null
  readonly max: 100
  readonly coverage: number
  readonly criteria: readonly ProjectScoreCriterion[]
  readonly limits: readonly string[]
}

const collectBlocks = (blocks: readonly CanonicalBlock[]): CanonicalBlock[] => {
  const result: CanonicalBlock[] = []
  const visit = (block: CanonicalBlock): void => {
    result.push(block)
    for (const input of Object.values(block.inputs ?? {})) {
      if (input.type === 'block') visit(input.block)
      if (input.type === 'stack') input.blocks.forEach(visit)
    }
  }
  blocks.forEach(visit)
  return result
}

const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, Math.round(value)))

const criterionEvidence = (map: ProjectMap, opcodes: readonly string[]): string[] => {
  const accepted = new Set(opcodes)
  return map.evidence
    .filter(({ opcode }) => accepted.has(opcode))
    .slice(0, 12)
    .map(({ id }) => id)
}

/**
 * Create a reproducible, SB3-only structural reference score. It evaluates visible code structure,
 * never runtime behavior, learner ability, aesthetics, or block counts as quality.
 * @param project - Canonical projection of the uploaded SB3.
 * @param analysis - Static analyzer findings for the project.
 * @param map - Evidence and import coverage for the project.
 * @param projectFeedback - Optional already computed feedback for this project.
 * @returns The fixed-version rubric score and its evidence/limitations.
 */
export const createProjectScore = (
  project: CanonicalProject,
  analysis: AnalysisIR,
  map: ProjectMap,
  projectFeedback?: ProjectFeedback,
): ProjectScore => {
  const targets = [project.stage, ...project.sprites]
  const scripts = targets.flatMap((target) => target.scripts.map((script) => collectBlocks(script.blocks)))
  const triggeredScripts = scripts.filter((blocks) => {
    const first = blocks.at(0)
    return (
      first !== undefined &&
      (getBlockCapability(first.opcode)?.shape === 'hat' || first.opcode === 'control_start_as_clone')
    )
  })
  const activeScripts = triggeredScripts.filter((blocks) => blocks.length > 1)
  const procedureBlocks = targets.flatMap((target) => target.procedures.flatMap(({ body }) => collectBlocks(body)))
  const allBlocks = [...triggeredScripts.flat(), ...procedureBlocks]
  const controlOpcodes = allBlocks
    .filter(({ opcode }) =>
      /^(control_if|control_if_else|control_repeat|control_repeat_until|control_forever|control_wait)$/.test(opcode),
    )
    .map(({ opcode }) => opcode)
  const dataOpcodes = allBlocks.filter(({ opcode }) => opcode.startsWith('data_')).map(({ opcode }) => opcode)
  const interactionOpcodes = allBlocks
    .filter(({ opcode }) =>
      /^(event_whenkeypressed|event_whenthisspriteclicked|event_whenstageclicked|sensing_touchingobject|event_broadcast|event_broadcastandwait|event_whenbroadcastreceived)$/.test(
        opcode,
      ),
    )
    .map(({ opcode }) => opcode)
  const integrityIssues = analysis.diagnostics.filter(
    ({ code, severity }) =>
      severity === 'warning' &&
      ![
        'forever-reinitialize',
        'cloud-variable-offline',
        'extension-runtime-disabled',
        'extension-runtime-unavailable',
        'extension-runtime-unverified',
        'extension-hardware-unverified',
        'extension-data-egress',
        'raw-block-graph-preserved',
        'raw-block-graph-unmodeled-opcodes',
        'broadcast-no-receiver',
        'duplicate-script-in-target',
        'condition-variable-mismatch-in-loop',
      ].includes(code),
  )
  const structuralCoverage =
    map.coverage.importedBlocks === 0 ? 100 : (map.coverage.recognizedBlocks / map.coverage.importedBlocks) * 100
  const readableEvidence = map.evidence.some(({ reference }) => !reference)
  const knownGraphIssues = analysis.diagnostics.filter(({ code }) => code.startsWith('block-graph-')).length
  const unknownGraphIssues = Math.max(0, map.coverage.malformedGraphIssues - knownGraphIssues)
  const integrityScore = clamp(15 - integrityIssues.length * 3 - unknownGraphIssues * 2, 15)
  const usedVariableNames = new Set(
    analysis.targets.flatMap((target) =>
      [...target.scripts, ...target.procedures].flatMap(({ reads, writes }) => [...reads, ...writes]),
    ),
  )
  for (const monitor of analysis.dependencies.monitors) if (monitor.variable) usedVariableNames.add(monitor.variable)
  const unusedVariables = targets
    .flatMap(({ variables }) => variables)
    .filter(({ name }) => !usedVariableNames.has(name)).length
  const stateIssues = analysis.diagnostics.filter(({ code }) =>
    ['monitor-variable-missing', 'condition-variable-mismatch-in-loop'].includes(code),
  ).length
  const hasState =
    dataOpcodes.length > 0 ||
    analysis.dependencies.monitors.some(({ variable, list }) => Boolean(variable) || Boolean(list)) ||
    stateIssues > 0
  const missingMonitors = analysis.diagnostics.filter(({ code }) => code === 'monitor-variable-missing').length
  const dataScore = clamp(15 - Math.min(10, missingMonitors * 3), 15)
  const hasReusableProcedure = targets.some((target) => {
    const definitions = new Set(target.procedures.map(({ name }) => name))
    const calls = [
      ...target.scripts.flatMap(({ blocks }) => {
        const first = blocks.at(0)
        return first &&
          (getBlockCapability(first.opcode)?.shape === 'hat' || first.opcode === 'control_start_as_clone')
          ? collectBlocks(blocks)
          : []
      }),
      ...target.procedures.flatMap(({ body }) => collectBlocks(body)),
    ]
    return calls.some(
      ({ opcode, procedure }) => opcode === 'procedures_call' && procedure && definitions.has(procedure.name),
    )
  })
  const receivedMessages = new Set(
    triggeredScripts.flatMap((blocks) => {
      const first = blocks[0]
      const name = first.opcode === 'event_whenbroadcastreceived' ? first.fields?.BROADCAST_OPTION : undefined
      return typeof name === 'string' ? [name] : []
    }),
  )
  const hasCoordinatedBroadcast = allBlocks.some(({ opcode, inputs }) => {
    if (opcode !== 'event_broadcast' && opcode !== 'event_broadcastandwait') return false
    const input = inputs?.BROADCAST_INPUT
    const name =
      input?.type === 'broadcast' ? input.name : input?.type === 'literal' ? String(input.value) : undefined
    return name !== undefined && receivedMessages.has(name)
  })
  const interactionScore = interactionOpcodes.length === 0 ? 0 : 10 + (hasCoordinatedBroadcast ? 5 : 0)
  const logicScore =
    allBlocks.length === 0
      ? 0
      : 10 + (activeScripts.length > 0 ? 5 : 0) + (controlOpcodes.length > 0 ? 5 : 0) + (hasReusableProcedure ? 5 : 0)
  const structureScore =
    triggeredScripts.length === 0 ? 0 : clamp(15 + 10 * (activeScripts.length / triggeredScripts.length), 25)
  const organizationIssues = analysis.diagnostics.filter(({ code }) =>
    ['duplicate-script-in-target', 'empty-event-hat'].includes(code),
  )
  const fragmentedEvents = targets.reduce((sum, target) => {
    const counts = new Map<string, number>()
    for (const { blocks } of target.scripts) {
      const first = blocks.at(0)
      if (!first || !/^(event_when|control_start_as_clone)/.test(first.opcode)) continue
      const key = JSON.stringify({ opcode: first.opcode, fields: first.fields, inputs: first.inputs })
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return sum + [...counts.values()].filter((count) => count > 4).length
  }, 0)
  const organizationScore =
    triggeredScripts.length === 0 ? 0 : clamp((5 * activeScripts.length) / triggeredScripts.length, 5)

  const feedback = projectFeedback ?? createProjectFeedback(analysis, map)
  const evidenceFor = (codes: readonly string[]): string[] =>
    [
      ...new Set(
        feedback.items
          .filter(({ id }) => codes.some((code) => id.startsWith(`diagnostic:${code}:`)))
          .flatMap(({ evidenceIds }) => evidenceIds),
      ),
    ].slice(0, 12)
  const integrityEvidence =
    integrityIssues.length > 0
      ? evidenceFor(integrityIssues.map(({ code }) => code))
      : map.evidence
          .filter(({ reference }) => !reference)
          .slice(0, 12)
          .map(({ id }) => id)

  const criteria: ProjectScoreCriterion[] = [
    {
      id: 'structure',
      title: '作品結構與可辨識的行為',
      points: 25,
      score: structureScore,
      applicability: 'applicable',
      explanation: `有 ${triggeredScripts.length} 組可辨認事件腳本，其中 ${activeScripts.length} 組接有指令；未接事件的草稿不扣分。`,
      evidenceIds: criterionEvidence(
        map,
        allBlocks.map(({ opcode }) => opcode),
      ),
    },
    {
      id: 'logic',
      title: '程式邏輯與流程',
      points: 25,
      score: logicScore,
      applicability: 'applicable',
      explanation: `${activeScripts.length} 組事件腳本；控制流程${controlOpcodes.length > 0 ? '已辨認' : '未辨認'}；自製積木重用${hasReusableProcedure ? '已辨認' : '未辨認'}。`,
      evidenceIds: criterionEvidence(map, controlOpcodes),
    },
    {
      id: 'state',
      title: '變數、清單與狀態運用',
      points: 15,
      score: hasState ? dataScore : null,
      applicability: hasState ? 'applicable' : 'not-applicable',
      explanation: !hasState
        ? '沒有看到可辨認的資料使用；未使用的宣告不扣分。'
        : `作品中有 ${dataOpcodes.length} 個資料相關積木；${unusedVariables} 個宣告變數未見讀寫，另有 ${stateIssues} 項變數監視器或迴圈條件的結構提醒。`,
      evidenceIds: [
        ...new Set([
          ...evidenceFor(['monitor-variable-missing', 'condition-variable-mismatch-in-loop']),
          ...map.evidence
            .filter(({ reference }) => reference?.kind === 'variable' && !usedVariableNames.has(reference.key))
            .map(({ id }) => id),
          ...criterionEvidence(map, dataOpcodes),
        ]),
      ].slice(0, 12),
    },
    {
      id: 'interaction',
      title: '角色互動與回饋設計',
      points: 15,
      score: interactionOpcodes.length === 0 ? null : interactionScore,
      applicability: interactionOpcodes.length === 0 ? 'not-applicable' : 'applicable',
      explanation:
        interactionOpcodes.length === 0
          ? '作品沒有可辨識的互動積木；此項不適用，不加分也不扣分。'
          : `找到 ${interactionOpcodes.length} 個互動或事件積木；${hasCoordinatedBroadcast ? '有訊息發送與接收線索' : '未辨認到訊息發送與接收組合'}。`,
      evidenceIds: criterionEvidence(map, interactionOpcodes),
    },
    {
      id: 'integrity',
      title: '靜態完整性與錯誤風險',
      points: 15,
      score: integrityScore,
      applicability: 'applicable',
      explanation: `${integrityIssues.length} 項列入完整性計算的警告；${map.coverage.malformedGraphIssues} 項原始積木圖檢查紀錄（其中草稿不扣分）。`,
      evidenceIds: integrityEvidence,
    },
    {
      id: 'organization',
      title: '腳本可讀性與組織',
      points: 5,
      score: organizationScore,
      applicability: 'applicable',
      explanation: `${activeScripts.length}/${triggeredScripts.length} 組事件腳本接有指令；${organizationIssues.length} 項重複或空事件、${fragmentedEvents} 組分段事件僅供觀察，不自動扣分。`,
      evidenceIds: [
        ...new Set([
          ...evidenceFor(['duplicate-script-in-target', 'empty-event-hat']),
          ...criterionEvidence(
            map,
            allBlocks.map(({ opcode }) => opcode),
          ),
        ]),
      ].slice(0, 12),
    },
  ]
  const limits = [
    '這是依 SB3 可讀結構計算的暫定參考分，不是作品品質、正式成績或學生能力分數。',
    '部分結構面向（如自製積木或廣播）對不同作品不一定必要；未使用不代表有錯，也不能據此比較創意或學習成果。',
    '本機沒有執行作品；分數不代表作品實際運作穩定，也不評創意、美感或作者理解程度。',
    ...(map.coverage.opaqueBlocks > 0
      ? [`${map.coverage.opaqueBlocks} 個積木未能完整辨識；Bridge 無法判讀的內容不當作學生錯誤。`]
      : []),
    ...(map.coverage.malformedGraphIssues > 0
      ? [`原始積木圖有 ${map.coverage.malformedGraphIssues} 項檢查紀錄；未接草稿不等於執行錯誤。`]
      : []),
    ...(!readableEvidence ? ['目前沒有足夠的積木證據可供評分。'] : []),
    ...(readableEvidence && (!triggeredScripts.length || (!hasState && interactionOpcodes.length === 0))
      ? ['可辨認的事件、互動或資料證據不足以換算總分；不代表作品不好。']
      : []),
  ]
  const applicableCriteria = criteria.filter(
    (criterion): criterion is ProjectScoreCriterion & { score: number } => criterion.score !== null,
  )
  const applicablePoints = applicableCriteria.reduce((sum, criterion) => sum + criterion.points, 0)
  const total =
    readableEvidence &&
    triggeredScripts.length > 0 &&
    (hasState || interactionOpcodes.length > 0) &&
    applicablePoints >= 50
      ? clamp((applicableCriteria.reduce((sum, criterion) => sum + criterion.score, 0) / applicablePoints) * 100, 100)
      : null
  return {
    format: 'scratch-ai-bridge/project-score',
    version: 1,
    rubric: 'sb3-static-v3',
    total,
    max: 100,
    coverage: clamp(structuralCoverage, 100),
    criteria,
    limits,
  }
}
