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
    blockLabel: string
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

const targetLabel = (targetIndex: number | undefined): string =>
  targetIndex === undefined ? '作品' : targetIndex === 0 ? '舞台' : `第 ${targetIndex} 個角色`

const locationLabel = (targetIndex: number | undefined, scriptIndex: number | undefined): string => {
  const target = targetLabel(targetIndex)
  return scriptIndex === undefined ? target : `${target}的第 ${scriptIndex + 1} 段程式`
}

const studentSafeClaim = (
  fact: ProjectMap['facts'][number],
  source: ProjectMap['evidence'][number] | undefined,
): string => {
  const location = locationLabel(source?.targetIndex, fact.scriptIndex)
  if (fact.kind === 'limitation') return `${location}有目前無法讀懂的積木，所以不能確定它們的作用。`
  const blockLabel = source?.studentLabel
  if (!blockLabel) return `${location}有一段程式可以再檢查。`
  if (fact.kind === 'trigger') return `${location}的開始方式是${blockLabel.replace(/^當/, '')}。`
  if (fact.kind === 'broadcast') return `${location}有送出或接收訊息的積木。`
  return `${location}包含「${blockLabel}」這個積木。`
}

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
  const regularFacts = projectMap.facts.filter(({ kind }) => kind !== 'limitation').slice(0, 36)
  const limitationFacts = projectMap.facts.filter(({ kind }) => kind === 'limitation')
  const facts = [
    ...regularFacts,
    ...(limitationFacts.length > 0
      ? [
          {
            ...limitationFacts[0],
            id: 'fact:limitations:grouped',
            evidence: limitationFacts.flatMap(({ evidence }) => evidence),
          },
        ]
      : []),
  ]
  const referencedIds = new Set(facts.flatMap((fact) => fact.evidence.map(({ id }) => id)))
  const evidence = [...allEvidence.values()]
    .filter(({ item }) => referencedIds.has(item.id))
    .slice(0, 80)
    .map(({ item, id }) => ({
      id,
      target: targetLabel(item.targetIndex),
      script: item.scriptIndex === null ? null : item.scriptIndex + 1,
      opcode: item.opcode,
      blockLabel: item.studentLabel,
      path: item.path.replaceAll(/\/targets\/\d+\/blocks\/[^/]+/g, '/targets/INDEX/blocks/BLOCK'),
    }))
  const evidenceIds = new Map([...allEvidence.values()].map(({ item, id }) => [item.id, id]))
  const sourceEvidence = new Map([...allEvidence.values()].map(({ item }) => [item.id, item]))
  const targetNames = analysis.targets.map(({ name }) => name)
  const coverage = {
    ...projectMap.coverage,
    scripts: projectMap.coverage.scripts.map(({ targetName, ...script }) => ({
      target: targetName === targetNames[0] ? '舞台' : `第 ${Math.max(1, targetNames.indexOf(targetName))} 個角色`,
      ...script,
    })),
  }
  let observations = facts.map((fact, index) => ({
    id: `F${index + 1}`,
    kind: fact.kind,
    claim: studentSafeClaim(fact, sourceEvidence.get(fact.evidence[0]?.id)),
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
      ...(limitationFacts.length > 0 ? ['有積木尚未解讀，不能推斷這些積木的效果。'] : []),
      '這是靜態檢查；作品尚未實際執行。',
    ],
    coverage,
  })
  let packet = createPacket()
  while (JSON.stringify(packet).length > EVIDENCE_PACKET_MAX_CHARS && observations.length > 1) {
    observations = observations.slice(0, -1)
    packet = createPacket()
  }
  return packet
}
