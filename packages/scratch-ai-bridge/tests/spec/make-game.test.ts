import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeGame, modelConfigFromEnvironment } from '../../src/cli/make-command'
import { makeGameFromSpec } from '../../src/mcp/make-game'
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

  it('saves the last raw reply when no attempt builds', async () => {
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
    expect(await readFile(path.join(directory, 'broken.failed-reply.txt'), 'utf-8')).toBe('我想一想……')
    expect(report.feedback).toContain('broken.failed-reply.txt')
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

describe('MCP make_game', () => {
  it('writes a new file named after the title and never overwrites an earlier game', async () => {
    const spec = JSON.parse(await catchSpec()) as Record<string, unknown>
    const first = await makeGameFromSpec(spec, { gamesDir: directory, playtest: false })
    const second = await makeGameFromSpec(spec, { gamesDir: directory, playtest: false })
    expect(first.status).toBe('success')
    expect(second.status).toBe('success')
    expect(first.output).not.toBe(second.output)
    expect(path.dirname(first.output ?? '')).toBe(directory)
    expect(second.output?.endsWith('-2.sb3')).toBe(true)
    expect(first.specFile).toBeDefined()
  }, 60_000)

  it('keeps file names inside the games directory', async () => {
    const result = await makeGameFromSpec(await catchSpec(), {
      gamesDir: directory,
      name: '../../etc/evil',
      playtest: false,
    })
    expect(path.dirname(result.output ?? '')).toBe(directory)
  }, 60_000)

  it('returns feedback and a next step when the spec cannot be built', async () => {
    const result = await makeGameFromSpec('{ "角色": {} }', { gamesDir: directory, playtest: false })
    expect(result.status).toBe('failed')
    expect(result.feedback).toContain('→')
    expect(result.next).toContain('make_game')
  })
})
