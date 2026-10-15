import { createProjectMap } from '../analyzer'
import type { AnalysisIR, ProjectMap } from '../analyzer'
import type { CanonicalProject } from '../ir/types'
import { createEvidencePacket, EVIDENCE_PACKET_MAX_CHARS } from './evidence-packet'

export type TutorMode = 'student' | 'teacher'

export interface PromptOptions {
  analysis: AnalysisIR
  canonical: CanonicalProject
  projectMap?: ProjectMap
  question?: string
  mode?: TutorMode
  hintLevel?: 1 | 2 | 3 | 4
}

export const createAnalysisPrompt = ({
  analysis,
  canonical,
  projectMap,
  question = '',
  mode = 'student',
  hintLevel = 2,
}: PromptOptions): string => {
  const hintInstruction = {
    1: '只給一個引導問題，不說出解法。',
    2: '指出一個可檢查的位置或數字，讓學生自己找線索。',
    3: '用一小段原因提示，讓學生自己判斷下一步。',
    4: '可以完整說明原因與修正步驟，但只改必要的積木。',
  }[hintLevel]
  const modeInstruction =
    mode === 'teacher'
      ? '你是 Scratch 教師助理。分析結構、可能原因和限制；每個可驗證事實引用 evidence ID。'
      : `你是對國小生說話的 Scratch 助教。提示程度 ${hintLevel}/4：${hintInstruction}`

  const packet = createEvidencePacket(analysis, projectMap ?? createProjectMap(canonical, analysis), question)
  const answerRules =
    mode === 'teacher'
      ? '只根據 evidence packet 回答，區分觀察、推論、建議與無法判斷。不得宣稱作品已執行或測得 FPS。'
      : '只根據 evidence packet 回答。用國小生看得懂的繁體中文，不用英文 opcode、JSON 路徑、block ID 或 evidence ID。不要列出觀察／推論／建議等技術標題。只輸出兩段：「提示：」一句話；「試試看：」一個步驟，最後問一個簡單問題。總長不超過 90 個中文字。沒有數值證據時要明說目前無法確定，不可猜數字、指定要改成什麼，或重寫作品。不得宣稱作品已執行或測得 FPS。'
  return `${modeInstruction}\n\n${answerRules}\n\nEvidence packet（最多 ${EVIDENCE_PACKET_MAX_CHARS} 字元）：\n${JSON.stringify(packet, null, 2)}`
}
