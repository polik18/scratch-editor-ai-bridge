import { createStudentProjectInstruction } from './registry'

/**
 * Prepare a manual AI handoff with the complete current Canonical IR.
 * @param projectJson Current validated project.
 * @param modificationRequest Student's requested change.
 * @param originalRequest Student's original idea, if available.
 * @returns A complete instruction for the external AI.
 */
export const createStudentIterationInstruction = (
  projectJson: string,
  modificationRequest: string,
  originalRequest: string,
): string => {
  const guide = createStudentProjectInstruction(originalRequest || modificationRequest)
  return `${guide}\n\n# 修改現有作品\n請依照下方要求修改此 Canonical IR 作品；保留未要求變更的角色、積木、資料及素材。請回傳完整修改後的 Canonical IR，讓學生貼回 Scratch AI Bridge 檢查。\n\n修改要求：${modificationRequest}\n\n目前作品：\n\`\`\`json\n${projectJson}\n\`\`\``
}
