import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../src/core/validator'
import {
  buildStoryFromText,
  createStoryGuide,
  createStoryScenario,
  parseAction,
  STORY_NAMES,
  storySeconds,
  type Story,
} from '../../src/story'
import { matchBackdropPreset } from '../../src/story/backdrops'

const example = readFileSync(new URL('../../src/story/examples/river-story.json', import.meta.url), 'utf-8')

const storyOf = (text: string): Story => {
  const { story } = buildStoryFromText(text)
  if (!story) throw new Error('expected a story')
  return story
}

const codes = (text: string): string[] => buildStoryFromText(text).diagnostics.map((item) => item.code)

// A story whose scenes each wait `seconds`, to test the length rule.
const timed = (seconds: number, backdrops = ['河流', '城市']): string =>
  JSON.stringify({
    標題: '測試',
    主角: '小魚',
    角色: { 小魚: { 外觀: 'Fish' } },
    場景: backdrops.map((backdrop) => ({ 背景: backdrop, 動作: ['小魚 說「你好」2秒', `等 ${seconds}秒`] })),
  })

describe('story actions', () => {
  const actors = ['小魚', '白鷺']
  it('reads plain action lines', () => {
    expect(parseAction('小魚 游到 右邊 3秒', actors)).toEqual({
      action: { kind: 'move', actor: '小魚', to: { x: 150, y: -60 }, seconds: 3 },
    })
    expect(parseAction('白鷺 說「小心！」', actors)).toEqual({
      action: { kind: 'say', actor: '白鷺', text: '小心！', seconds: 2 },
    })
    expect(parseAction('小魚 出現 在 (100, -50)', actors)).toEqual({
      action: { kind: 'show', actor: '小魚', at: { x: 100, y: -50 } },
    })
    expect(parseAction('旁白 很久以前', actors)).toMatchObject({ action: { kind: 'narrate', text: '很久以前' } })
    expect(parseAction('等 4秒', actors)).toEqual({ action: { kind: 'wait', seconds: 4 } })
  })

  it('turns an unknown verb into an animation and says so', () => {
    const result = parseAction('小魚 覓食 3秒', actors)
    expect(result).toMatchObject({ action: { kind: 'animate', actor: '小魚', seconds: 3 } })
    expect('note' in result && result.note).toContain('覓食')
  })

  it('explains a line that names no character', () => {
    const result = parseAction('飛天遁地', actors)
    expect('message' in result && result.suggestion).toContain('角色')
  })

  it('plays 同時 lines together with the line before', () => {
    const story = storyOf(example)
    const last = story.scenes[2].actions
    const together = last.find((item) => item.action.kind === 'animate')
    const before = last[last.indexOf(together ?? last[0]) - 1]
    expect(together?.start).toBe(before.start)
  })

  it('matches backdrop words to the built-in river scenes, longest word first', () => {
    expect(matchBackdropPreset('淡水河邊')).toBe('river')
    expect(matchBackdropPreset('河口濕地')).toBe('estuary')
    expect(matchBackdropPreset('瑠公圳')).toBe('stream')
  })
})

describe('contest rules for animations', () => {
  it('builds the example: 60–180 s, a main character, three scenes', () => {
    const result = buildStoryFromText(example)
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    const seconds = storySeconds(storyOf(example))
    expect(seconds).toBeGreaterThanOrEqual(60)
    expect(seconds).toBeLessThanOrEqual(180)
  })

  it('refuses an animation shorter than a minute or longer than three', () => {
    expect(codes(timed(1))).toContain('STORY_LENGTH')
    expect(codes(timed(100))).toContain('STORY_LENGTH')
    expect(codes(timed(25))).not.toContain('STORY_LENGTH')
  })

  it('needs at least one change of backdrop', () => {
    expect(codes(timed(25, ['河流', '河流']))).toContain('NO_SCENE_CHANGE')
    expect(codes(timed(50, ['河流']))).toContain('NO_SCENE_CHANGE')
  })

  it('needs the main character on stage', () => {
    const story = JSON.parse(timed(25)) as Record<string, unknown>
    story.主角 = '白鷺'
    expect(codes(JSON.stringify(story))).toContain('HERO_NOT_IN_SCENES')
  })
})

describe('compiled animation', () => {
  it('is a valid project with a title card, one backdrop per scene and an ending card', async () => {
    const { project } = buildStoryFromText(example)
    if (!project) throw new Error('expected a project')
    expect(validateCanonicalProject(project).valid).toBe(true)
    expect(validateCanonicalSemantics(project).filter((item) => item.severity === 'error')).toEqual([])
    expect(project.stage.costumes.map((costume) => costume.name)).toEqual([
      STORY_NAMES.title,
      'bg-stream',
      'bg-city',
      'bg-mountain',
      STORY_NAMES.ending,
    ])
    // Library characters are filled in at build time; without data the compiler draws a placeholder.
    expect(project.sprites.find((sprite) => sprite.name === '小魚')?.costumes[0]).toEqual({
      name: 'Fish',
      dataFormat: 'svg',
    })
    expect((await compileCanonicalProjectToSb3(project)).size).toBeGreaterThan(0)
  }, 60_000)

  it('scales every wait by the time-scale variable so playtests can run fast', () => {
    const { project } = buildStoryFromText(example)
    const stageScript = JSON.stringify(project?.stage.scripts[0])
    expect(stageScript).toContain(STORY_NAMES.timeScale)
    expect(stageScript.match(/control_wait/g)?.length).toBeGreaterThan(5)
  })

  it('playtests every scene backdrop and the running time', () => {
    const story = storyOf(example)
    const labels = createStoryScenario(story).steps.flatMap((step) => (step.kind === 'expect' ? [step.label] : []))
    expect(labels).toEqual(expect.arrayContaining(['開頭是片頭標題', '第 3 幕換成自己的背景', '最後播到片尾']))
  })

  it('has a guide that lists every action and the length rule', () => {
    const guide = createStoryGuide()
    for (const word of ['出現', '移到', '說「', '旁白', '同時', '60～180']) expect(guide).toContain(word)
  })
})
