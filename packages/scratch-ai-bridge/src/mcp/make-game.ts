import { mkdir, writeFile } from 'node:fs/promises'
import { gamesRoot, gameTarget, safeName, specTitle, writeProcessFile } from '../cli/output-layout'
import { buildSpecText, type SpecBuildReport } from '../cli/spec-command'
import { runStoryBuild, type StoryBuildReport } from '../cli/story-command'

export interface MakeGameToolResult extends SpecBuildReport {
  readonly next: string
}

/**
 * MCP `make_game`: builds a Game Spec into a new folder `<gamesDir>/<name>/`, never reusing an existing folder.
 * The SB3 and its spec go in the folder; the build report goes in its `_過程` subfolder.
 * @param spec - Game Spec as JSON text or an already parsed object.
 * @param options - Where and how to build.
 * @param options.gamesDir - Parent of the game folders; defaults to `output/games`.
 * @param options.name - Folder and file name; defaults to the spec title.
 * @param options.playtest - Run generated playtest scenarios in the real preview.
 * @returns The spec build report plus where the files went and what to do next.
 */
export const makeGameFromSpec = async (
  spec: string | Record<string, unknown>,
  options: { readonly gamesDir?: string; readonly name?: string; readonly playtest: boolean },
): Promise<MakeGameToolResult> => {
  const specText = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 1)
  const files = await gameTarget(options.gamesDir ?? gamesRoot(), safeName(options.name ?? specTitle(specText)), true)
  await mkdir(files.directory, { recursive: true })
  const built = await buildSpecText(specText, { outputFile: files.sb3, playtest: options.playtest, force: false })
  let result: MakeGameToolResult
  if (built.status !== 'success')
    result = {
      ...built,
      processDirectory: files.processDirectory,
      next: '照 feedback 每一行「→」後面的建議修改 spec，再呼叫一次 make_game。',
    }
  else {
    await writeFile(files.spec, `${specText.trim()}\n`, { flag: 'wx' })
    result = {
      ...built,
      specFile: files.spec,
      processDirectory: files.processDirectory,
      next:
        built.playtestStatus === 'fail'
          ? '遊戲已產生，但自動試玩有項目沒通過；照 feedback 修改 spec 後再呼叫一次 make_game。'
          : built.feedback
            ? '遊戲已產生。feedback 中的「注意」是工具自動處理過的地方，必要時修改 spec 再呼叫一次。'
            : '遊戲已產生，可以把 output 的 .sb3 開在 Scratch 中遊玩。',
    }
  }
  await writeProcessFile(files, 'report.json', `${JSON.stringify(result, null, 2)}\n`)
  return result
}

/**
 * MCP `make_story`: writes the Story Spec into a new folder `<gamesDir>/<name>/` and builds the animation next to it.
 * @param spec - Story Spec as JSON text or an already parsed object.
 * @param options - Where and how to build.
 * @param options.gamesDir - Parent of the animation folders; defaults to `output/games`.
 * @param options.name - Folder and file name; defaults to the title.
 * @param options.playtest - Watch the animation at ten times speed and check scenes and length.
 * @param options.offline - Skip downloading official library artwork.
 * @returns The story build report plus what to do next.
 */
export const makeStoryFromSpec = async (
  spec: string | Record<string, unknown>,
  options: {
    readonly gamesDir?: string
    readonly name?: string
    readonly playtest: boolean
    readonly offline?: boolean
  },
): Promise<StoryBuildReport & { readonly next: string }> => {
  const specText = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 1)
  const gamesDirectory = options.gamesDir ?? gamesRoot()
  const files = await gameTarget(gamesDirectory, safeName(options.name ?? specTitle(specText), 'animation'), true)
  await mkdir(files.directory, { recursive: true })
  await writeFile(files.spec, `${specText.trim()}\n`, { flag: 'wx' })
  const report = await runStoryBuild({
    specPath: files.spec,
    gamesDirectory,
    playtest: options.playtest,
    force: false,
  })
  return {
    ...report,
    next:
      report.status !== 'success'
        ? '照 feedback 每一行「→」後面的建議修改動畫描述，再呼叫一次 make_story。'
        : report.playtestStatus === 'fail'
          ? '動畫已產生，但試看有項目沒通過；照 feedback 修改後再呼叫一次 make_story。'
          : '動畫已產生，可以把 output 的 .sb3 開在 Scratch 中播放。',
  }
}
