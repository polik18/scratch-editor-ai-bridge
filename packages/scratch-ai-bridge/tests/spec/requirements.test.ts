import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeGame } from '../../src/cli/make-command'
import { checkRequirements, readRequirements } from '../../src/cli/requirements'
import { buildStoryFromText } from '../../src/story'

const prompt = (lines: string[]): string => lines.join('\n')

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
        標題: '新店溪香魚',
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
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('target length in a story', () => {
  it('warns how many seconds to add when the animation is far from the target', () => {
    const story = JSON.stringify({
      標題: '淡水河',
      主角: '魚',
      角色: { 魚: { 外觀: 'Fish' } },
      目標秒數: 120,
      場景: ['溪流', '城市'].map((背景) => ({ 背景, 動作: ['魚 說「淡水河」', '等 25秒'] })),
    })
    const warning = buildStoryFromText(story).diagnostics.find((item) => item.code === 'TARGET_LENGTH')
    expect(warning?.suggestion).toMatch(/^再加約 \d+ 秒/)
  })
})
