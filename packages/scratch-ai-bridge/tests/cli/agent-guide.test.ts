import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMANDS, createAgentStartPage } from '../../src/cli/agent-guide'
import { completion } from '../../src/cli/requirements'
import { BEHAVIOR_ALIASES } from '../../src/spec/normalize'
import { STORY_ACTION_EXAMPLES } from '../../src/story/normalize'

describe('agent start page', () => {
  it('lists every command main.ts handles', async () => {
    const main = await readFile(path.resolve('src/cli/main.ts'), 'utf-8')
    const handled = new Set([...main.matchAll(/command === '([a-z]+)'/g)].map((match) => match[1]))
    expect([...handled].sort()).toEqual(COMMANDS.map((command) => command.name).sort())
  })

  it('names every game behavior and story action the tool accepts', () => {
    const page = createAgentStartPage()
    for (const aliases of Object.values(BEHAVIOR_ALIASES))
      expect(aliases.some((alias) => page.includes(alias))).toBe(true)
    for (const action of STORY_ACTION_EXAMPLES) expect(page).toContain(action.name)
    expect(page).toContain('done')
  })
})

describe('completion', () => {
  it('is done only when built, playtest did not fail and every requirement passed', () => {
    expect(completion({ status: 'success', playtestStatus: 'pass' })).toEqual({ done: true, notDone: [] })
    expect(completion({ status: 'success', playtestStatus: 'not-run' }).done).toBe(true)
    expect(completion({ status: 'failed', playtestStatus: 'not-run' }).notDone).toHaveLength(1)
    expect(completion({ status: 'success', playtestStatus: 'fail' }).done).toBe(false)
    const failed = { label: '關卡數', expected: '2 關', actual: '1 關', pass: false, fix: '' }
    expect(completion({ status: 'success', playtestStatus: 'pass' }, [failed]).notDone).toEqual([
      '關卡數：需求是2 關，目前是 1 關',
    ])
    const blocked = { code: 'GOAL_BLOCKED', where: '第二關.地圖 第 2 列第 5 欄', message: '玩家到不了這個「終點」。' }
    expect(completion({ status: 'success', playtestStatus: 'pass', diagnostics: [blocked] }).notDone).toEqual([
      '無法過關：第二關.地圖 第 2 列第 5 欄：玩家到不了這個「終點」。',
    ])
  })
})
