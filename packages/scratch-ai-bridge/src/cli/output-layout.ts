import { access, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractJson } from '../spec/normalize'

/**
 * Where the tools put what they make. Everything lives under one `output/` folder in the package (git-ignored):
 *
 *   output/games/<name>/<name>.sb3          the game
 *   output/games/<name>/<name>.spec.json    the Game Spec it was built from
 *   output/games/<name>/_過程/              reports and model replies from making it
 *   output/reports/<name>/                  batch analysis results
 *   output/bench/<run>/                     benchmark runs
 *   output/tmp/                             scratch space, safe to delete
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Folder next to each game that holds the files produced while making it. */
export const PROCESS_DIRECTORY = '_過程'

/**
 * @param environment - Usually `process.env`; `SCRATCH_BRIDGE_OUTPUT_DIR` moves the whole output folder.
 * @returns Absolute path of the output folder.
 */
export const outputRoot = (environment: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(environment.SCRATCH_BRIDGE_OUTPUT_DIR ?? path.join(PACKAGE_ROOT, 'output'))

/**
 * @param environment - Usually `process.env`.
 * @returns Absolute path of `output/games`.
 */
export const gamesRoot = (environment: NodeJS.ProcessEnv = process.env): string =>
  path.join(outputRoot(environment), 'games')

/**
 * @param text - A title or request; anything that is not a letter, digit, `_` or `-` becomes `-`.
 * @param fallback - Used when nothing is left.
 * @returns A file and folder name of at most 40 characters.
 */
export const safeName = (text: string | undefined, fallback = 'game'): string =>
  (text ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || fallback

/**
 * @param specText - Game Spec JSON, possibly wrapped in prose.
 * @returns The spec's 標題 (or `title`), when it can be read.
 */
export const specTitle = (specText: string): string | undefined => {
  try {
    const value = extractJson(specText).value as Record<string, unknown> | undefined
    const title = value?.['標題'] ?? value?.title
    return typeof title === 'string' ? title : undefined
  } catch {
    return undefined
  }
}

export const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  )

export interface GameFiles {
  readonly directory: string
  readonly name: string
  readonly sb3: string
  readonly spec: string
  readonly processDirectory: string
}

/**
 * @param sb3Path - Where the game's SB3 is (or will be).
 * @returns The game's SB3, spec and process-folder paths, all next to each other.
 */
export const gameFiles = (sb3Path: string): GameFiles => {
  const sb3 = path.resolve(sb3Path)
  const directory = path.dirname(sb3)
  const name = path.basename(sb3).replace(/\.sb3$/i, '')
  return {
    directory,
    name,
    sb3,
    spec: path.join(directory, `${name}.spec.json`),
    processDirectory: path.join(directory, PROCESS_DIRECTORY),
  }
}

/**
 * Picks `<gamesDirectory>/<name>/<name>.sb3`.
 * @param gamesDirectory - Usually {@link gamesRoot}.
 * @param name - Folder and file name (already passed through {@link safeName}).
 * @param unique - Add `-2`, `-3`… instead of reusing a folder that already exists.
 * @returns The chosen game's paths.
 */
export const gameTarget = async (gamesDirectory: string, name: string, unique: boolean): Promise<GameFiles> => {
  let candidate = name
  for (let index = 2; unique && (await exists(path.join(gamesDirectory, candidate))) && index < 1000; index += 1)
    candidate = `${name}-${index}`
  return gameFiles(path.join(gamesDirectory, candidate, `${candidate}.sb3`))
}

/**
 * Writes one file into the game's `_過程` folder.
 * @param files - The game.
 * @param suffix - Appended to the game name, e.g. `report.json` or `attempt-1.txt`.
 * @param content - Text to write, usually JSON or a raw model reply.
 * @returns The written path.
 */
export const writeProcessFile = async (files: GameFiles, suffix: string, content: string): Promise<string> => {
  await mkdir(files.processDirectory, { recursive: true })
  const file = path.join(files.processDirectory, `${files.name}.${suffix}`)
  await writeFile(file, content)
  return file
}

/** Name of the spec copy saved in `_過程` after every successful build: exactly what the current SB3 came from. */
export const BUILT_SPEC_SUFFIX = 'built.spec.json'

/**
 * Before a forced rebuild: copies the current SB3 and the spec it was built from into
 * `_過程/舊版/<time>/`, so overwriting the wrong game can always be undone.
 * @param files - The game about to be rebuilt.
 * @returns The backup folder, or nothing when there was no game yet.
 */
export const backupGame = async (files: GameFiles): Promise<string | undefined> => {
  if (!(await exists(files.sb3))) return undefined
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(files.processDirectory, '舊版', stamp)
  await mkdir(backup, { recursive: true })
  await copyFile(files.sb3, path.join(backup, path.basename(files.sb3)))
  const builtSpec = path.join(files.processDirectory, `${files.name}.${BUILT_SPEC_SUFFIX}`)
  const spec = (await exists(builtSpec)) ? builtSpec : (await exists(files.spec)) ? files.spec : undefined
  if (spec) await copyFile(spec, path.join(backup, `${files.name}.spec.json`))
  return backup
}

/**
 * Removes what is only left over from making games: every game's `_過程` folder and `output/tmp`.
 * With `all`, removes the whole output folder, games included.
 * @param root - Usually {@link outputRoot}.
 * @param all - Also remove games, reports and benchmark runs.
 * @returns The removed paths.
 */
export const cleanOutput = async (root: string, all: boolean): Promise<string[]> => {
  if (all) {
    if (!(await exists(root))) return []
    await rm(root, { recursive: true, force: true })
    return [root]
  }
  const removed: string[] = []
  const games = path.join(root, 'games')
  const folders = (await exists(games)) ? await readdir(games, { withFileTypes: true }) : []
  for (const folder of folders) {
    const target = path.join(games, folder.name, PROCESS_DIRECTORY)
    if (folder.isDirectory() && (await exists(target))) {
      await rm(target, { recursive: true, force: true })
      removed.push(target)
      // A game whose build never succeeded has nothing else in its folder.
      const folderPath = path.join(games, folder.name)
      if ((await readdir(folderPath)).length === 0) await rm(folderPath, { recursive: true })
    }
  }
  const tmp = path.join(root, 'tmp')
  if (await exists(tmp)) {
    await rm(tmp, { recursive: true, force: true })
    removed.push(tmp)
  }
  return removed
}
