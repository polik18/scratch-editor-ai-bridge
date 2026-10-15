import type { ProjectMap, ProjectScore } from '../analyzer'

/**
 * Build a student-facing Gemini prompt from the local score and anonymized evidence.
 * @param score - Locally calculated rubric and evidence references.
 * @param map - Project facts used to explain the score.
 * @returns A student-focused prompt with an anonymized, bounded packet.
 */
export const createScoringFeedbackPrompt = (score: ProjectScore, map: ProjectMap): string => {
  const referenced = new Set(score.criteria.flatMap(({ evidenceIds }) => evidenceIds))
  const evidence = map.evidence
    .filter(({ id }) => referenced.has(id))
    .slice(0, 48)
    .map((item, index) => ({
      id: `E${index + 1}`,
      target: item.targetIndex === 0 ? '舞台' : `角色 ${item.targetIndex}`,
      script: item.scriptIndex === null ? null : item.scriptIndex + 1,
      opcode: item.opcode,
    }))
  const evidenceIds = new Map(
    map.evidence
      .filter(({ id }) => referenced.has(id))
      .slice(0, 48)
      .map((item, index) => [item.id, `E${index + 1}`]),
  )
  const anonymousNames = new Map(
    map.evidence.map(({ targetName, targetIndex }) => [
      targetName,
      targetIndex === 0 ? '舞台' : `角色 ${targetIndex}`,
    ]),
  )
  const observations = map.facts.slice(0, 24).map((fact) => {
    let claim = fact.claim
    for (const [target, anonymous] of [...anonymousNames].sort(([a], [b]) => b.length - a.length))
      claim = claim.replaceAll(target, anonymous)
    claim = claim.replaceAll(/「[^」]*」/g, '「作品文字已省略」').slice(0, 500)
    return {
      type: fact.kind,
      observation: claim,
      evidence: fact.evidence.map(({ id }) => evidenceIds.get(id)).filter(Boolean),
    }
  })
  const packet = {
    score: { total: score.total, max: score.max, rubric: score.rubric, coverage: score.coverage },
    criteria: score.criteria.map(({ id, title, score: points, points: max, explanation, evidenceIds: ids }) => ({
      id,
      title,
      score: points,
      max,
      explanation,
      evidence: ids.map((sourceId) => evidenceIds.get(sourceId)).filter(Boolean),
    })),
    evidence,
    observations,
    limits: score.limits,
  }
  return `你是 Scratch 學習助教。以下分數由 Scratch AI Bridge 依學生提供的 SB3 檔案和固定規準計算。請勿更改、重新計算或質疑分數，也不要增加或扣除分數。\n\n只根據下方資料，用繁體中文和學生對話：\n1. 指出一個具體做得好的地方，引用 evidence ID。\n2. 提出一個最值得嘗試的小改進，說明它和哪項評分依據有關。\n3. 提出一個學生容易回答的引導問題。\n\n不得聲稱作品已執行、已通過測試；不得評斷學生能力、創意或美感；不得把積木數量當成作品品質；不得編造證據。資料不足時請直接說無法判斷。不要替學生重寫整個作品。\n\nSB3 評分與匿名證據：\n${JSON.stringify(packet, null, 2)}`
}
