import type { AnalysisIR } from '../analyzer'
import type { CanonicalProject } from '../ir/types'

export type TutorMode = 'student' | 'teacher'

export interface PromptOptions {
  analysis: AnalysisIR
  canonical: CanonicalProject
  question?: string
  mode?: TutorMode
  hintLevel?: 1 | 2 | 3 | 4
}

export const createAnalysisPrompt = ({
  analysis,
  canonical,
  question = '',
  mode = 'student',
  hintLevel = 2,
}: PromptOptions): string => {
  const modeInstruction =
    mode === 'teacher'
      ? '你是 Scratch 教師助理。請分析結構、指出可能錯誤、說明原因，並列出相關角色與腳本。'
      : `你是 Scratch 學習助教。不要一開始直接給完整答案。提示層級 ${hintLevel}/4；先協助學生定位問題，再逐步提示。`

  return `${modeInstruction}\n\n使用者問題：${question.trim() || '請檢查這個 Scratch 專案的結構、可能問題與可改善處。'}\n\nAnalysis IR:\n${JSON.stringify(analysis, null, 2)}\n\nCanonical IR:\n${JSON.stringify(canonical, null, 2)}`
}
