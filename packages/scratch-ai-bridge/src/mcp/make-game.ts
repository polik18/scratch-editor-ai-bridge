import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildSpecText, type SpecBuildReport } from '../cli/spec-command'
import { extractJson } from '../spec/normalize'

export interface MakeGameToolResult extends SpecBuildReport {
  readonly specFile?: string
  readonly next: string
}

const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  )

const baseName = (name: string | undefined, specText: string): string => {
  let title = name
  if (!title)
    try {
      const value = extractJson(specText).value as Record<string, unknown> | undefined
      const candidate = value?.['標題'] ?? value?.title
      if (typeof candidate === 'string') title = candidate
    } catch {
      // The build reports the JSON problem; the file name falls back below.
    }
  const cleaned = (title ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || 'game'
}

/**
 * MCP `make_game`: builds a Game Spec into a new SB3 inside `gamesDir`, never overwriting an existing file.
 * @param spec - Game Spec as JSON text or an already parsed object.
 * @param options - Where and how to build.
 * @param options.gamesDir - Directory the SB3 and its spec are written to.
 * @param options.name - File name without extension; defaults to the spec title.
 * @param options.playtest - Run generated playtest scenarios in the real preview.
 * @returns The spec build report plus where the files went and what to do next.
 */
export const makeGameFromSpec = async (
  spec: string | Record<string, unknown>,
  options: { readonly gamesDir: string; readonly name?: string; readonly playtest: boolean },
): Promise<MakeGameToolResult> => {
  const specText = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 1)
  const directory = path.resolve(options.gamesDir)
  await mkdir(directory, { recursive: true })
  const stem = baseName(options.name, specText)
  let candidate = stem
  for (let index = 2; (await exists(path.join(directory, `${candidate}.sb3`))) && index < 1000; index += 1)
    candidate = `${stem}-${index}`
  const outputFile = path.join(directory, `${candidate}.sb3`)
  const report = await buildSpecText(specText, { outputFile, playtest: options.playtest, force: false })
  if (report.status !== 'success')
    return {
      ...report,
      next: '照 feedback 每一行「→」後面的建議修改 spec，再呼叫一次 make_game。',
    }
  const specFile = path.join(directory, `${candidate}.spec.json`)
  await writeFile(specFile, `${specText.trim()}\n`, { flag: 'wx' })
  return {
    ...report,
    specFile,
    next:
      report.playtestStatus === 'fail'
        ? '遊戲已產生，但自動試玩有項目沒通過；照 feedback 修改 spec 後再呼叫一次 make_game。'
        : report.feedback
          ? '遊戲已產生。feedback 中的「注意」是工具自動處理過的地方，必要時修改 spec 再呼叫一次。'
          : '遊戲已產生，可以把 output 的 .sb3 開在 Scratch 中遊玩。',
  }
}
