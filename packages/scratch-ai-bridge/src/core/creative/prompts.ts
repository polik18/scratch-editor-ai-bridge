import type { CanonicalProject } from '../ir/types'
import type { IntentAnchors } from './anchors'
import { renderCards, selectCards } from './cards'
import type { ProjectSlice } from './plan'

/**
 * Stage A: free creation. No format, no Scratch vocabulary, no capability list — the model only designs the work.
 * @param request The user's request.
 * @returns Prompt text.
 */
export const createFreeCreationPrompt = (request: string): string => `請自由構想一個 Scratch 作品。

需求：${request}

用你最自然的方式說明你的構想：想帶給誰什麼感受或學習、有哪些角色與內容、怎麼互動或怎麼播放、節奏和風格、怎樣算完成。
不用寫程式、積木、清單格式或 JSON；長短都可以，想到什麼就寫什麼。`

const decisionsText = (anchors: IntentAnchors): string =>
  anchors.unsupported.length
    ? `\n這些想法 Scratch 目前做不到，請選擇近似方式，並在輸出最上方用「// 近似：原想法 → 做法」各寫一行：\n${anchors.unsupported
        .map(({ phrase, suggestion }) => `- ${phrase}：建議 ${suggestion}`)
        .join('\n')}\n`
    : ''

const outputRules = `輸出規則：只輸出積木文字；可以用「// 」開頭寫一行註解。不要 Markdown 說明、JSON 或多個版本。
外觀、背景、音效寫官方素材名稱或簡短中文描述，Bridge 會找最接近的官方素材。`

/**
 * Stage B (one shot): translate the free-creation text into a whole project using only the relevant cards.
 * @param brief Stage A text.
 * @param anchors Extracted anchors.
 * @returns Prompt text.
 */
export const createTranslationPrompt = (
  brief: string,
  anchors: IntentAnchors,
): string => `把下面的作品構想做成 Scratch 專案。保留構想的角色、內容、互動和風格，不要改成另一種作品。

構想：
${brief.trim()}
${decisionsText(anchors)}
可用的積木寫法（只列這個作品用得到的）：
${renderCards(selectCards(anchors.features))}

${outputRules}`

/**
 * Short outline of the current project for slice prompts: targets and what their scripts start with.
 * @param project Current project.
 * @returns Outline text.
 */
export const outlineProject = (project: CanonicalProject | undefined): string => {
  if (!project) return '（還沒有內容）'
  const hats = (scripts: CanonicalProject['sprites'][number]['scripts']) =>
    scripts.map((script) => script.blocks[0]?.opcode.replace(/^(event|control)_/, '') ?? '').filter(Boolean)
  return [
    `舞台：背景 ${project.stage.costumes.map(({ name }) => name).join('、')}；變數 ${project.stage.variables.map(({ name }) => name).join('、') || '無'}`,
    ...project.sprites.map(
      (sprite) =>
        `角色 ${sprite.name}：外觀 ${sprite.costumes.map(({ name }) => name).join('、')}；程式 ${hats(sprite.scripts).join('、') || '無'}`,
    ),
  ].join('\n')
}

/**
 * Stage C: implement one slice on top of the current project.
 * @param input Brief, anchors, slice, current project and the last runtime feedback.
 * @param input.brief Stage A text.
 * @param input.anchors Extracted anchors.
 * @param input.slice The slice to implement now.
 * @param input.project Current project, if any.
 * @param input.feedback Runtime or parse feedback from the previous attempt.
 * @returns Prompt text.
 */
export const createSlicePrompt = (input: {
  readonly brief: string
  readonly anchors: IntentAnchors
  readonly slice: ProjectSlice
  readonly project?: CanonicalProject
  readonly feedback?: readonly string[]
}): string => `我們正在分段完成這個 Scratch 作品。這一次只做一段。

作品構想：
${input.brief.trim()}

目前的作品：
${outlineProject(input.project)}

這一段要做：${input.slice.goal}
${input.feedback?.length ? `\n上一次執行時發現：\n${input.feedback.map((line) => `- ${line}`).join('\n')}\n請修正這些問題。\n` : ''}${decisionsText(input.anchors)}
可用的積木寫法：
${renderCards(selectCards(input.slice.features.length ? input.slice.features : input.anchors.features))}

只輸出這一段要新增的角色段落；要改寫既有角色時，在段落名稱後加 (replace) 並寫出該角色完整的新程式。
${outputRules}`

/**
 * Minimal repair prompt: only the failing lines/checks, not the whole spec again.
 * @param reply The model's previous output.
 * @param problems Parse warnings or runtime failures.
 * @returns Prompt text.
 */
export const createRepairPrompt = (
  reply: string,
  problems: readonly string[],
): string => `下面的 Scratch 積木文字有問題，請只修正問題，其他內容保持不變，輸出修正後的完整積木文字。

問題：
${problems.map((problem) => `- ${problem}`).join('\n')}

原本的積木文字：
${reply.trim()}

${outputRules}`
