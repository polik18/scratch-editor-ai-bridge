import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeGame } from '../../src/cli/make-command'
import { checkRequirements, readRequirements } from '../../src/cli/requirements'
import { buildStoryFromText, storySeconds } from '../../src/story'

const prompt = (lines: string[]): string => lines.join('\n')

const defined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value')
  return value
}

describe('requirements read from a request', () => {
  it('finds levels, length and river names in contest prompts', () => {
    expect(
      readRequirements(
        prompt([
          '【主題與河流名稱】遊戲封面與規則介面必須標明「台北市歷史水圳：瑠公圳」。',
          '- 第一關（清代開墾）…',
          '- 第二關（現代暗渠）…',
        ]),
        'game',
      ),
    ).toEqual({ levels: 2, mustAppear: [['瑠公圳']] })
    expect(
      readRequirements(
        prompt(['【主題與河流名稱】對話與字卡必須出現「基隆河特有地形：壺穴」。', '【競賽規範】總時長 90 秒']),
        'story',
      ),
    ).toEqual({ seconds: 90, mustAppear: [['基隆河']] })
    expect(readRequirements('畫面必須明確標示「台灣母親之河：濁水溪」', 'story').mustAppear).toEqual([['濁水溪']])
    expect(readRequirements('做一個接蘋果的遊戲', 'game')).toEqual({ mustAppear: [] })
  })

  it('reports what a reply is missing', () => {
    const checks = checkRequirements(
      '{ "標題": "香魚", "地圖": ["P..G"], "角色": { "P": ["俯視移動"], "G": ["終點"] } }',
      {
        levels: 2,
        mustAppear: [['新店溪']],
      },
    )
    expect(checks.map((check) => [check.label, check.pass])).toEqual([
      ['關卡數', false],
      ['出現「新店溪」', false],
    ])
  })
})

describe('make keeps repairing until the request is met', () => {
  it('sends a one-level game back when two levels were asked for', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'requirements-'))
    try {
      const one = JSON.stringify({
        標題: '新店溪香魚',
        地圖: ['P..aG'],
        角色: { 香魚: ['俯視移動'], a: ['收集品'], G: ['終點'] },
        圖例: { P: '香魚' },
      })
      const two = JSON.stringify({
        標題: '香魚回家',
        圖例: { P: '香魚', a: '藻', G: '出口' },
        角色: { 香魚: ['俯視移動'], 藻: [{ 收集品: { 分數: 10 } }], 出口: ['終點'] },
        關卡: [
          { 名稱: '中下游', 地圖: ['P..a..a'], 過關: '分數 >= 20' },
          { 名稱: '魚道', 地圖: ['P....aG'] },
        ],
      })
      const prompts: string[] = []
      const report = await makeGame({
        request: '【主題與河流名稱】遊戲開場標題必須顯示「新店溪香魚逆流回游」。\n- 第一關：…\n- 第二關：…',
        gamesDirectory: directory,
        repairRounds: 1,
        playtest: false,
        force: false,
        model: { baseUrl: 'http://127.0.0.1:1/v1', model: 'fake', noThinking: true },
        complete: (text) => {
          prompts.push(text)
          return Promise.resolve(prompts.length === 1 ? one : two)
        },
      })
      expect(report.attempts.map((attempt) => attempt.unmet ?? 0)).toEqual([1, 0])
      expect(prompts[1]).toContain('[需求未達成] 關卡數')
      expect(report.requirements?.every((check) => check.pass)).toBe(true)
      expect(await readFile(report.specFile ?? '', 'utf-8')).toContain('關卡')
      // The first reply never named the river; the tool added it to the title.
      expect(report.autoFixes).toEqual(['標題加上「新店溪」（需求要求出現這個名稱）'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('target length in a story', () => {
  const story = (wait: number, target: number): string =>
    JSON.stringify({
      標題: '淡水河',
      主角: '魚',
      角色: { 魚: { 外觀: 'Fish' } },
      目標秒數: target,
      場景: ['溪流', '城市'].map((背景) => ({ 背景, 動作: ['魚 說「淡水河」', `等 ${wait}秒`] })),
    })

  it('pads a short animation to its target with pauses, and says so', () => {
    const result = buildStoryFromText(story(25, 110))
    expect(result.diagnostics.find((item) => item.code === 'LENGTH_FITTED')?.message).toContain('多停')
    expect(Math.abs(storySeconds(defined(result.story)) - 110)).toBeLessThanOrEqual(11)
  })

  it('speeds up a long animation, but not past readable', () => {
    const result = buildStoryFromText(story(60, 100))
    expect(result.diagnostics.find((item) => item.code === 'LENGTH_FITTED')?.message).toContain('加快')
    expect(Math.abs(storySeconds(defined(result.story)) - 100)).toBeLessThanOrEqual(10)
  })

  it('still asks for more content when pauses would more than double it', () => {
    const result = buildStoryFromText(story(5, 120))
    expect(
      result.diagnostics.find((item) => item.code === 'TARGET_LENGTH' || item.code === 'STORY_LENGTH'),
    ).toBeDefined()
  })
})
