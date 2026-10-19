import type { AnalysisIR, ProjectMap } from '../analyzer'

export interface EvidencePacketV1 {
  readonly format: 'scratch-ai-bridge/evidence-packet'
  readonly version: 1
  readonly question: string
  readonly summary: AnalysisIR['summary']
  readonly observations: readonly {
    kind: string
    claim: string
    confidence: string
  }[]
  readonly evidence: readonly {
    target: string
    script: number | null
    blockLabel: string
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
    extensions: readonly {
      extensionName: string
      recognizedBlocks: number
      opaqueBlocks: number
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

const targetLabel = (targetIndex: number | undefined): string => {
  if (targetIndex === undefined) return '作品'
  if (targetIndex === 0) return '舞台'
  let suffix = ''
  let value = targetIndex - 1
  do {
    suffix = String.fromCharCode(65 + (value % 26)) + suffix
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return `角色 ${suffix}`
}

const locationLabel = (targetIndex: number | undefined, scriptIndex: number | undefined): string => {
  const target = targetLabel(targetIndex)
  return scriptIndex === undefined ? target : `${target}的第 ${scriptIndex + 1} 段程式`
}

const studentSafeClaim = (
  fact: ProjectMap['facts'][number],
  source: ProjectMap['evidence'][number] | undefined,
): string => {
  const location = locationLabel(source?.targetIndex, fact.scriptIndex)
  if (fact.kind === 'limitation') {
    const count = fact.evidence.length
    return `${location}有 ${count} 個積木目前無法讀懂，所以不能確定它們的作用。`
  }
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
  const allEvidence = new Map(projectMap.evidence.map((item) => [item.id, item]))
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
    .filter((item) => referencedIds.has(item.id))
    .slice(0, 80)
    .map((item) => ({
      target: targetLabel(item.targetIndex),
      script: item.scriptIndex === null ? null : item.scriptIndex + 1,
      blockLabel: item.studentLabel,
    }))
  const sourceEvidence = allEvidence
  const targetNames = analysis.targets.map(({ name }) => name)
  const coverage = {
    roundTrip: projectMap.coverage.roundTrip,
    importedBlocks: projectMap.coverage.importedBlocks,
    recognizedBlocks: projectMap.coverage.recognizedBlocks,
    opaqueBlocks: projectMap.coverage.opaqueBlocks,
    malformedGraphIssues: projectMap.coverage.malformedGraphIssues,
    scripts: projectMap.coverage.scripts.map(({ targetName, ...script }) => ({
      target: targetLabel(targetNames.indexOf(targetName)),
      ...script,
    })),
    extensions: projectMap.coverage.extensions.map(({ extensionName, recognizedBlocks, opaqueBlocks, runtime }) => ({
      extensionName,
      recognizedBlocks,
      opaqueBlocks,
      runtime,
    })),
  }
  let observations = facts.map((fact) => ({
    kind: fact.kind,
    claim: studentSafeClaim(fact, sourceEvidence.get(fact.evidence[0]?.id)),
    confidence: fact.confidence,
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
