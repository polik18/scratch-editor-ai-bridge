/**
 * Checks for a Scratch project a student opens from the main page or drops anywhere on the window. Every message is
 * plain Chinese and says what to do next, because the reader is a student, not a developer.
 */

/** The same compressed-size limit the archive reader enforces. */
export const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024

export interface ProjectFileLike {
  readonly name: string
  readonly size: number
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * @param file - The chosen or dropped file.
 * @returns Why it cannot be opened, or undefined when it looks like a Scratch 3 project.
 */
export const projectFileProblem = (file: ProjectFileLike): string | undefined => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.sb2') || name.endsWith('.sb'))
    return '這是舊版 Scratch 2 的作品。請用 Scratch 3 打開它，再選「檔案 → 下載到你的電腦」存成 .sb3。'
  if (!name.endsWith('.sb3'))
    return `「${file.name}」不是 Scratch 作品。請選副檔名是 .sb3 的檔案（在 Scratch 選「檔案 → 下載到你的電腦」就會得到）。`
  if (file.size > MAX_PROJECT_FILE_BYTES)
    return `這個作品有 ${megabytes(file.size)}，超過上限 ${megabytes(MAX_PROJECT_FILE_BYTES)}。可以先在 Scratch 刪掉沒用到的造型或聲音，再下載一次。`
  return undefined
}

/**
 * @param files - Everything that was dropped or chosen.
 * @returns The project to open, plus a note when other files were left out.
 */
export const chooseProjectFile = <T extends ProjectFileLike>(
  files: readonly T[],
): { readonly file?: T; readonly note?: string } => {
  const file = files.find((item) => item.name.toLowerCase().endsWith('.sb3')) ?? files.at(0)
  if (!file) return {}
  return files.length > 1 ? { file, note: `一次只能打開一個作品，先打開「${file.name}」。` } : { file }
}

/**
 * @param message - The error the archive reader or decompiler threw.
 * @returns What the student sees, with the original message kept at the end for a teacher.
 */
export const friendlyOpenError = (message: string): string => {
  if (/\blimit\b/i.test(message))
    return `這個作品太大，打不開。可以先在 Scratch 刪掉沒用到的造型或聲音，再下載一次。（${message}）`
  if (/^SB3 |zip|project\.json|central directory/i.test(message))
    return `這個檔案不是 Scratch 3 作品，或已經損壞。請在 Scratch 重新「下載到你的電腦」一次。（${message}）`
  return `這個作品打不開。（${message}）`
}

/**
 * @param types - `DataTransfer.types` of a drag.
 * @returns Whether the drag carries files, so text, links and images dragged inside the page are left alone.
 */
export const isFileDrag = (types: readonly string[]): boolean => types.includes('Files')
