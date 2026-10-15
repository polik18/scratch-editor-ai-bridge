import type { CanonicalBlock, CanonicalProject } from '../ir/types'
import type { AnalysisIR, ProjectMap } from './'

export interface ProjectScoreCriterion {
  readonly id: string
  readonly title: string
  readonly points: number
  readonly score: number
  readonly explanation: string
  readonly evidenceIds: readonly string[]
}

export interface ProjectScore {
  readonly format: 'scratch-ai-bridge/project-score'
  readonly version: 1
  readonly rubric: 'sb3-static-v1'
  readonly total: number
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
 * Create a reproducible, SB3-only formative score. It evaluates visible code structure,
 * never runtime behavior, learner ability, aesthetics, or block counts as quality.
 * @param project - Canonical projection of the uploaded SB3.
 * @param analysis - Static analyzer findings for the project.
 * @param map - Evidence and import coverage for the project.
 * @returns The fixed-version rubric score and its evidence/limitations.
 */
export const createProjectScore = (
  project: CanonicalProject,
  analysis: AnalysisIR,
  map: ProjectMap,
): ProjectScore => {
  const targets = [project.stage, ...project.sprites]
  const scripts = targets.flatMap((target) => target.scripts.map((script) => collectBlocks(script.blocks)))
  const allBlocks = scripts.flat()
  const nonHat = (blocks: readonly CanonicalBlock[]): CanonicalBlock[] =>
    blocks.filter(({ opcode }) => !opcode.startsWith('event_when') && opcode !== 'control_start_as_clone')
  const activeScripts = scripts.filter((blocks) => blocks.length > 1 && nonHat(blocks).length > 0)
  const triggeredScripts = scripts.filter((blocks) =>
    blocks.some(({ opcode }) => opcode.startsWith('event_when') || opcode === 'control_start_as_clone'),
  )
  const controlOpcodes = allBlocks
    .filter(({ opcode }) =>
      /^(control_if|control_if_else|control_repeat|control_repeat_until|control_forever|control_wait)$/.test(opcode),
    )
    .map(({ opcode }) => opcode)
  const dataOpcodes = allBlocks.filter(({ opcode }) => opcode.startsWith('data_')).map(({ opcode }) => opcode)
  const interactionOpcodes = allBlocks
    .filter(({ opcode }) =>
      /^(event_whenkeypressed|event_whenthisspriteclicked|event_whenstageclicked|sensing_touchingobject|event_broadcast|event_whenbroadcastreceived)$/.test(
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
      ].includes(code),
  )
  const structuralCoverage =
    map.coverage.importedBlocks === 0 ? 100 : (map.coverage.recognizedBlocks / map.coverage.importedBlocks) * 100
  const readableEvidence = map.evidence.length > 0
  const integrityScore = clamp(15 - integrityIssues.length * 3 - map.coverage.malformedGraphIssues * 2, 15)
  const dataScore =
    dataOpcodes.length === 0
      ? 15
      : clamp(15 - Math.min(10, analysis.diagnostics.filter(({ code }) => code.includes('variable')).length * 3), 15)
  const interactionScore =
    interactionOpcodes.length === 0
      ? 15
      : clamp(15 * Math.min(1, activeScripts.length / Math.max(1, triggeredScripts.length)), 15)
  const logicScore =
    allBlocks.length === 0
      ? 0
      : clamp(10 + (activeScripts.length > 0 ? 8 : 0) + (controlOpcodes.length > 0 ? 7 : 0), 25)
  const structureScore =
    scripts.length === 0
      ? 0
      : clamp(15 * (triggeredScripts.length / scripts.length) + 10 * (activeScripts.length / scripts.length), 25)
  const organizationScore = scripts.length === 0 ? 0 : clamp((5 * activeScripts.length) / scripts.length, 5)

  const criteria: ProjectScoreCriterion[] = [
    {
      id: 'structure',
      title: '作品結構與可辨識的行為',
      points: 25,
      score: structureScore,
      explanation: `${triggeredScripts.length}/${scripts.length} 組腳本有事件入口；${activeScripts.length} 組腳本包含入口後的指令。`,
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
      explanation: `${activeScripts.length} 組腳本形成指令流程；${controlOpcodes.length} 個可辨識的控制流程積木。`,
      evidenceIds: criterionEvidence(map, controlOpcodes),
    },
    {
      id: 'state',
      title: '變數、清單與狀態運用',
      points: 15,
      score: dataScore,
      explanation:
        dataOpcodes.length === 0
          ? '作品沒有使用變數或清單；此面向不因未使用資料積木而扣分。'
          : `作品中有 ${dataOpcodes.length} 個資料相關積木；已檢查可辨識的變數診斷。`,
      evidenceIds: criterionEvidence(map, dataOpcodes),
    },
    {
      id: 'interaction',
      title: '角色互動與回饋設計',
      points: 15,
      score: interactionScore,
      explanation:
        interactionOpcodes.length === 0
          ? '作品沒有可辨識的互動積木；不因作品採非互動形式而扣分。'
          : `找到 ${interactionOpcodes.length} 個互動或事件積木，並檢查其腳本是否接續指令。`,
      evidenceIds: criterionEvidence(map, interactionOpcodes),
    },
    {
      id: 'integrity',
      title: '靜態完整性與錯誤風險',
      points: 15,
      score: integrityScore,
      explanation: `${integrityIssues.length} 項可由分析確認的警告；${map.coverage.malformedGraphIssues} 項積木圖結構問題。`,
      evidenceIds: map.evidence.slice(0, 12).map(({ id }) => id),
    },
    {
      id: 'organization',
      title: '腳本可讀性與組織',
      points: 5,
      score: organizationScore,
      explanation: `${activeScripts.length}/${scripts.length} 組腳本有事件入口及後續指令。`,
      evidenceIds: criterionEvidence(
        map,
        allBlocks.map(({ opcode }) => opcode),
      ),
    },
  ]
  const limits = [
    '這是依 SB3 可讀結構計算的暫定作品分數，並非學生能力或學習成效分數。',
    '本機沒有執行作品；分數不代表作品實際運作穩定，也不評創意、美感或作者理解程度。',
    ...(map.coverage.opaqueBlocks > 0
      ? [`${map.coverage.opaqueBlocks} 個積木未能完整辨識；Bridge 無法判讀的內容不當作學生錯誤。`]
      : []),
    ...(map.coverage.malformedGraphIssues > 0
      ? [`積木圖有 ${map.coverage.malformedGraphIssues} 項結構疑慮，需降低分數解讀信心。`]
      : []),
    ...(!readableEvidence ? ['目前沒有足夠的積木證據可供評分。'] : []),
  ]
  const total = readableEvidence ? criteria.reduce((sum, criterion) => sum + criterion.score, 0) : 0
  return {
    format: 'scratch-ai-bridge/project-score',
    version: 1,
    rubric: 'sb3-static-v1',
    total,
    max: 100,
    coverage: clamp(structuralCoverage, 100),
    criteria,
    limits,
  }
}
