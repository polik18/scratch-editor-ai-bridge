import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeGame, modelConfigFromEnvironment } from '../../src/cli/make-command'
import { cleanOutput, safeName } from '../../src/cli/output-layout'
import { runSpecBuild } from '../../src/cli/spec-command'
import { makeGameFromSpec, makeStoryFromSpec } from '../../src/mcp/make-game'
import { createGameSpecGuide, createGameSpecInstruction } from '../../src/spec/prompt'

const catchSpec = (): Promise<string> => readFile(path.resolve('src/spec/examples/catch.json'), 'utf-8')
const model = { baseUrl: 'http://127.0.0.1:1/v1', model: 'fake', noThinking: true }

let directory = ''
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'make-game-test-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('Game Spec guide', () => {
  it('is the instruction without the request, so agents and small models read the same contract', () => {
    const guide = createGameSpecGuide()
    const instruction = createGameSpecInstruction('做一個接蘋果遊戲')
    expect(instruction).toContain(guide)
    expect(instruction.endsWith('作品需求：\n做一個接蘋果遊戲')).toBe(true)
    expect(guide).not.toContain('作品需求')
  })
})

describe('make (request → model → spec → SB3)', () => {
  it('builds the game from the model reply and keeps the spec next to it', async () => {
    const prompts: string[] = []
    const report = await makeGame({
      request: '貓咪接蘋果',
      outputFile: path.join(directory, 'apples.sb3'),
      repairRounds: 1,
      playtest: false,
      force: false,
      model,
      complete: async (prompt) => {
        prompts.push(prompt)
        return `好的，這是作品描述：\n\`\`\`json\n${await catchSpec()}\n\`\`\``
      },
    })
    expect(report.status).toBe('success')
    expect(report.attempts).toHaveLength(1)
    expect(prompts[0]).toContain('貓咪接蘋果')
    expect((await readFile(path.join(directory, 'apples.sb3'))).subarray(0, 2).toString()).toBe('PK')
    expect(await readFile(path.join(directory, 'apples.spec.json'), 'utf-8')).toContain('"角色"')
  }, 60_000)

  it('sends the build feedback back to the model and keeps the repaired attempt', async () => {
    const prompts: string[] = []
    const replies = ['{ "標題": "空的", "角色": {} }', await catchSpec()]
    const report = await makeGame({
      request: '接蘋果',
      outputFile: path.join(directory, 'repaired.sb3'),
      repairRounds: 1,
      playtest: false,
      force: false,
      model,
      complete: (prompt) => {
        prompts.push(prompt)
        return Promise.resolve(replies[prompts.length - 1] ?? '')
      },
    })
    expect(report.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'success'])
    expect(prompts[1]).toContain('你上次的作品描述有下面的問題')
    expect(prompts[1]).toContain('[錯誤]')
    expect(report.status).toBe('success')
  }, 60_000)

  it('without --out puts the game, its spec and every reply in output/games/<標題>/', async () => {
    const replies = ['{ "標題": "空的", "角色": {} }', await catchSpec()]
    let call = 0
    const report = await makeGame({
      request: '接蘋果',
      gamesDirectory: directory,
      repairRounds: 1,
      playtest: false,
      force: false,
      model,
      complete: () => Promise.resolve(replies[call++] ?? ''),
    })
    expect(report.status).toBe('success')
    const folder = path.dirname(report.output ?? '')
    expect(path.dirname(folder)).toBe(directory)
    expect(report.specFile).toBe(path.join(folder, `${path.basename(folder)}.spec.json`))
    expect(report.processDirectory).toBe(path.join(folder, '_過程'))
    expect((await readdir(report.processDirectory ?? '')).sort()).toEqual(
      [
        `${path.basename(folder)}.attempt-0.txt`,
        `${path.basename(folder)}.attempt-1.txt`,
        `${path.basename(folder)}.report.json`,
      ].sort(),
    )
  }, 60_000)

  it('saves every raw reply in _過程 when no attempt builds', async () => {
    const report = await makeGame({
      request: '接蘋果',
      outputFile: path.join(directory, 'broken.sb3'),
      repairRounds: 0,
      playtest: false,
      force: false,
      model,
      complete: () => Promise.resolve('我想一想……'),
    })
    expect(report.status).toBe('failed')
    expect(await readFile(path.join(directory, '_過程', 'broken.attempt-0.txt'), 'utf-8')).toBe('我想一想……')
    expect(report.feedback).toContain(path.join(directory, '_過程'))
  })

  it('refuses to overwrite an existing game before calling the model', async () => {
    const outputFile = path.join(directory, 'taken.sb3')
    await writeFile(outputFile, 'keep me')
    let called = false
    const report = await makeGame({
      request: '接蘋果',
      outputFile,
      repairRounds: 0,
      playtest: false,
      force: false,
      model,
      complete: () => {
        called = true
        return Promise.resolve('')
      },
    })
    expect(report.status).toBe('failed')
    expect(called).toBe(false)
    expect(await readFile(outputFile, 'utf-8')).toBe('keep me')
  })

  it('reads model settings from the environment with the oMLX names as fallbacks', () => {
    expect(modelConfigFromEnvironment({ OMLX_ENDPOINT: 'http://h/v1', OMLX_API_KEY: 'k' })).toEqual({
      baseUrl: 'http://h/v1',
      apiKey: 'k',
      noThinking: true,
    })
    expect(modelConfigFromEnvironment({ SCRATCH_BRIDGE_MODEL: 'm' }).baseUrl).toBe('http://127.0.0.1:8000/v1')
  })
})

describe('spec without --out', () => {
  it('builds next to a spec that already lives in a game folder, and keeps the report in _過程', async () => {
    const folder = path.join(directory, 'apples')
    await mkdir(folder)
    const specPath = path.join(folder, 'apples.spec.json')
    await writeFile(specPath, await catchSpec())
    const report = await runSpecBuild({ specPath, gamesDirectory: directory, playtest: false, force: false })
    expect(report.status).toBe('success')
    expect(report.output).toBe(path.join(folder, 'apples.sb3'))
    expect(report.specFile).toBe(specPath)
    expect(JSON.parse(await readFile(path.join(folder, '_過程', 'apples.report.json'), 'utf-8'))).toMatchObject({
      status: 'success',
    })
    const again = await runSpecBuild({ specPath, gamesDirectory: directory, playtest: false, force: false })
    expect(again.feedback).toContain('--force')
  }, 60_000)

  it('keeps the replaced game and the spec it came from when --force overwrites it', async () => {
    const folder = path.join(directory, 'apples')
    await mkdir(folder)
    const specPath = path.join(folder, 'apples.spec.json')
    const original = await catchSpec()
    await writeFile(specPath, original)
    await runSpecBuild({ specPath, gamesDirectory: directory, playtest: false, force: false })
    const firstGame = await readFile(path.join(folder, 'apples.sb3'))
    // Another game's spec written over this one, then forced: the first game must still be recoverable.
    await writeFile(specPath, (await readFile(path.resolve('src/spec/examples/whack.json'), 'utf-8')).trim())
    const forced = await runSpecBuild({ specPath, gamesDirectory: directory, playtest: false, force: true })
    expect(forced.status).toBe('success')
    const backup = forced.previousVersion ?? ''
    expect(path.dirname(path.dirname(backup))).toBe(path.join(folder, '_過程'))
    expect(await readFile(path.join(backup, 'apples.sb3'))).toEqual(firstGame)
    expect(await readFile(path.join(backup, 'apples.spec.json'), 'utf-8')).toBe(original)
  }, 60_000)

  it('names the game folder after 標題 when the spec lives elsewhere', async () => {
    const specPath = path.join(directory, 'draft.json')
    const text = await catchSpec()
    await writeFile(specPath, text)
    const games = path.join(directory, 'games')
    const report = await runSpecBuild({ specPath, gamesDirectory: games, playtest: false, force: false })
    const title = (JSON.parse(text) as { 標題: string }).標題
    const name = safeName(title)
    expect(report.output).toBe(path.join(games, name, `${name}.sb3`))
    expect(await readFile(path.join(games, name, `${name}.spec.json`), 'utf-8')).toBe(text)
  }, 60_000)
})

describe('clean', () => {
  it('removes _過程 folders and tmp, keeps games, and drops folders that held only _過程', async () => {
    await mkdir(path.join(directory, 'games', 'kept', '_過程'), { recursive: true })
    await writeFile(path.join(directory, 'games', 'kept', 'kept.sb3'), 'x')
    await mkdir(path.join(directory, 'games', 'failed', '_過程'), { recursive: true })
    await mkdir(path.join(directory, 'tmp'))
    const removed = await cleanOutput(directory, false)
    expect(removed).toHaveLength(3)
    expect(await readdir(path.join(directory, 'games'))).toEqual(['kept'])
    expect(await readdir(path.join(directory, 'games', 'kept'))).toEqual(['kept.sb3'])
  })
})

describe('MCP make_game', () => {
  it('writes each game into its own new folder and never overwrites an earlier game', async () => {
    const spec = JSON.parse(await catchSpec()) as Record<string, unknown>
    const first = await makeGameFromSpec(spec, { gamesDir: directory, playtest: false })
    const second = await makeGameFromSpec(spec, { gamesDir: directory, playtest: false })
    expect(first.status).toBe('success')
    expect(second.status).toBe('success')
    expect(first.output).not.toBe(second.output)
    expect(path.dirname(path.dirname(first.output ?? ''))).toBe(directory)
    expect(second.output?.endsWith('-2.sb3')).toBe(true)
    expect(first.specFile).toBe(
      path.join(path.dirname(first.output ?? ''), path.basename(first.output ?? '', '.sb3') + '.spec.json'),
    )
  }, 60_000)

  it('keeps file names inside the games directory', async () => {
    const result = await makeGameFromSpec(await catchSpec(), {
      gamesDir: directory,
      name: '../../etc/evil',
      playtest: false,
    })
    expect(path.dirname(path.dirname(result.output ?? ''))).toBe(directory)
  }, 60_000)

  it('returns feedback and a next step when the spec cannot be built', async () => {
    const result = await makeGameFromSpec('{ "角色": {} }', { gamesDir: directory, playtest: false })
    expect(result.status).toBe('failed')
    expect(result.feedback).toContain('→')
    expect(result.next).toContain('make_game')
  })
})

describe('animations through make and MCP', () => {
  const storyText = (): Promise<string> => readFile(path.resolve('src/story/examples/river-story.json'), 'utf-8')

  it('make --story asks for a Story Spec and builds the animation into its own folder', async () => {
    const prompts: string[] = []
    const report = await makeGame({
      request: '小魚回家的動畫',
      kind: 'story',
      offline: true,
      gamesDirectory: directory,
      repairRounds: 0,
      playtest: false,
      force: false,
      model,
      complete: async (prompt) => {
        prompts.push(prompt)
        return storyText()
      },
    })
    expect(prompts[0]).toContain('動畫描述')
    expect(report.status).toBe('success')
    expect(path.basename(report.output ?? '')).toBe('小魚的回家路.sb3')
    expect(report.seconds).toBeGreaterThanOrEqual(60)
  }, 60_000)

  it('make_story writes the spec into a new folder and reports the length', async () => {
    const result = await makeStoryFromSpec(await storyText(), { gamesDir: directory, playtest: false, offline: true })
    expect(result.status).toBe('success')
    expect(result.seconds).toBeGreaterThanOrEqual(60)
    expect(path.dirname(path.dirname(result.output ?? ''))).toBe(directory)
    const again = await makeStoryFromSpec(await storyText(), { gamesDir: directory, playtest: false, offline: true })
    expect(again.output?.endsWith('-2.sb3')).toBe(true)
  }, 60_000)
})
