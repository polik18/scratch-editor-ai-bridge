import type { AnalysisIR, ProjectMap } from '../analyzer'

export interface EvidencePacketV1 {
  readonly format: 'scratch-ai-bridge/evidence-packet'
  readonly version: 1
  readonly question: string
  readonly summary: AnalysisIR['summary']
  readonly observations: readonly {
    id: string
    kind: string
    claim: string
    confidence: string
    evidenceIds: string[]
  }[]
  readonly evidence: readonly {
    id: string
    target: string
    script: number | null
    blockId?: string
    opcode: string
    path: string
  }[]
  readonly limitations: readonly string[]
  readonly coverage: {
    scripts: readonly {
      target: string
      scriptIndex: number
      recognizedBlocks: number
      opaqueBlocks: number
      malformedGraphIssues: number
      runtime: string
    }[]
    roundTrip: ProjectMap['coverage']['roundTrip']
    importedBlocks: number
    recognizedBlocks: number
    opaqueBlocks: number
    malformedGraphIssues: number
  }
}

export const EVIDENCE_PACKET_MAX_CHARS = 24_000

const redactQuotedText = (value: string): string => value.replaceAll(/「[^」]*」/g, '「內容已省略」').slice(0, 500)

/**
 * Build a bounded, asset-free packet for deliberate user copy to an external AI.
 * @param analysis - Bounded structural analysis.
 * @param projectMap - Evidence map linked to imported block IDs.
 * @param question - Optional teacher question to include in the shared packet.
 * @returns A bounded, asset-free JSON evidence packet.
 */
export const createEvidencePacket = (
  analysis: AnalysisIR,
  projectMap: ProjectMap,
  question = '',
): EvidencePacketV1 => {
  const allEvidence = new Map(projectMap.evidence.map((item, index) => [item.id, { item, id: `E${index + 1}` }]))
  const facts = projectMap.facts.slice(0, 40)
  const referencedIds = new Set(facts.flatMap((fact) => fact.evidence.map(({ id }) => id)))
  const evidence = [...allEvidence.values()]
    .filter(({ item }) => referencedIds.has(item.id))
    .slice(0, 80)
    .map(({ item, id }) => ({
      id,
      target: item.targetIndex === 0 ? '舞台' : `角色 ${item.targetIndex}`,
      script: item.scriptIndex === null ? null : item.scriptIndex + 1,
      opcode: item.opcode,
      path: item.path.replaceAll(/\/targets\/\d+\/blocks\/[^/]+/g, '/targets/INDEX/blocks/BLOCK'),
    }))
  const evidenceIds = new Map([...allEvidence.values()].map(({ item, id }) => [item.id, id]))
  const targetNames = analysis.targets.map(({ name }) => name)
  const coverage = {
    ...projectMap.coverage,
    scripts: projectMap.coverage.scripts.map(({ targetName, ...script }) => ({
      target: targetName === targetNames[0] ? '舞台' : `角色 ${Math.max(1, targetNames.indexOf(targetName))}`,
      ...script,
    })),
  }
  let observations = facts.map((fact, index) => ({
    id: `F${index + 1}`,
    kind: fact.kind,
    claim: redactQuotedText(fact.claim),
    confidence: fact.confidence,
    evidenceIds: fact.evidence.flatMap(({ id }) => {
      const evidenceId = evidenceIds.get(id)
      return evidenceId ? [evidenceId] : []
    }),
  }))
  const createPacket = (): EvidencePacketV1 => ({
    format: 'scratch-ai-bridge/evidence-packet',
    version: 1,
    question: question.slice(0, 2_000),
    summary: analysis.summary,
    observations,
    evidence,
    limitations: [
      ...projectMap.facts.filter(({ kind }) => kind === 'limitation').map(({ claim }) => redactQuotedText(claim)),
      ...analysis.diagnostics
        .filter(({ severity }) => severity === 'warning')
        .map(({ code }) => `靜態檢查提示：${code}`),
      '這是靜態結構分析；沒有執行作品，不能推論遊戲實際效果、手感或 FPS。',
    ].slice(0, 30),
    coverage,
  })
  let packet = createPacket()
  while (JSON.stringify(packet).length > EVIDENCE_PACKET_MAX_CHARS && observations.length > 1) {
    observations = observations.slice(0, -1)
    packet = createPacket()
  }
  return packet
}
