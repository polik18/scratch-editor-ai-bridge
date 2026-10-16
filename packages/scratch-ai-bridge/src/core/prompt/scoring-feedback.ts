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
    criteria: score.criteria.map(
      ({ id, title, score: points, points: max, applicability, explanation, evidenceIds: ids }) => ({
        id,
        title,
        score: points,
        max,
        applicability,
        explanation,
        evidence: ids.map((sourceId) => evidenceIds.get(sourceId)).filter(Boolean),
      }),
    ),
    evidence,
    observations,
    limits: score.limits,
  }
  return `你是 Scratch 學習助教。下方分數是依 SB3 靜態結構計算的參考分，不是正式成績、學生能力或作品整體品質。由於只看 SB3，不能判斷創意、實際玩法或執行效果。N/A 項目不加分也不扣分，總分只按適用面向換算；總分為 null 時不可自行推算。請勿更改或重新計算分數。\n\n只根據下方資料，用繁體中文和學生對話：\n1. 指出一個具體做得好的地方，引用 evidence ID。\n2. 提出一個最值得嘗試的小改進，說明它和哪項可見證據有關。\n3. 提出一個學生容易回答的引導問題。\n\n不得聲稱作品已執行、已通過測試；不得評斷學生能力、創意或美感；不得把積木數量當成作品品質；不得編造證據。資料不足時請直接說無法判斷。不要替學生重寫整個作品。\n\nSB3 結構參考分與匿名證據：\n${JSON.stringify(packet, null, 2)}`
}
