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
  const modeInstruction =
    mode === 'teacher'
      ? '你是 Scratch 教師助理。請分析結構、指出可能錯誤、說明原因，並列出相關角色與腳本。'
      : `你是 Scratch 學習助教。不要一開始直接給完整答案。提示層級 ${hintLevel}/4；先協助學生定位問題，再逐步提示。`

  const packet = createEvidencePacket(analysis, projectMap ?? createProjectMap(canonical, analysis), question)
  return `${modeInstruction}\n\n請只根據 evidence packet 回答。每項可驗證事實都附 evidence ID；區分觀察、推論、建議與無法判斷。不得宣稱作品已執行或測得 FPS。學生模式先給一個提示與一個可嘗試步驟，不直接重寫作品。\n\nEvidence packet（最多 ${EVIDENCE_PACKET_MAX_CHARS} 字元）：\n${JSON.stringify(packet, null, 2)}`
}
