import { describe, expect, it } from 'vitest'
import { placeholderNames, resolvePlaceholders } from '../../src/cli/make-command'
import { pickSound } from '../../src/core/visuals/assets'
import { buildFromSpecText } from '../../src/spec'
import { buildStoryFromText } from '../../src/story'

// A story whose scenes are long enough to pass the length rule, with backdrops and looks to vary.
const story = (scenes: readonly { 背景: string }[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    標題: '淡水河的故事',
    主角: '渡船伯',
    角色: { 渡船伯: { 外觀: 'Wizard' } },
    場景: scenes.map((scene) => ({ ...scene, 動作: ['渡船伯 說「這裡是淡水河」', '等 25秒'] })),
    ...extra,
  })

const codes = (text: string): string[] => buildStoryFromText(text).diagnostics.map((item) => item.code)

describe('feedback a small model can act on', () => {
  it('maps Scratch default names in the request to their descriptions', () => {
    const names = placeholderNames(
      '主角老渡船伯（Sprite1）、孫子（Sprite2）；背景 Backdrop1（清代淡水港）、Backdrop2（現代淡水河濱公園）',
    )
    expect([...names]).toEqual([
      ['Backdrop1', '清代淡水港'],
      ['Backdrop2', '現代淡水河濱公園'],
      ['Sprite1', '老渡船伯'],
      ['Sprite2', '孫子'],
    ])
    expect(resolvePlaceholders('{"背景": "Backdrop1", "主角": "Sprite1"}', names)).toBe(
      '{"背景": "清代淡水港", "主角": "老渡船伯"}',
    )
  })

  it('says Backdrop1 is a default name, and does not pile up follow-on errors', () => {
    const result = buildStoryFromText(story([{ 背景: 'Backdrop1' }, { 背景: 'Backdrop2' }]))
    const errors = result.diagnostics.filter((item) => item.severity === 'error')
    expect(errors.map((item) => item.code)).toEqual(['UNKNOWN_BACKDROP', 'UNKNOWN_BACKDROP'])
    expect(errors[0]?.message).toContain('預設名稱')
  })

  it('finds official backdrops from scene descriptions, noting stand-ins', () => {
    const result = buildStoryFromText(story([{ 背景: '清代淡水港' }, { 背景: '現代淡水河濱公園' }]))
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.story?.scenes.map((scene) => scene.backdrop)).toEqual([
      { kind: 'library', name: 'Boardwalk' },
      { kind: 'library', name: 'City With Water' },
    ])
    expect(codes(story([{ 背景: '清代淡水港' }, { 背景: '溪流' }]))).toContain('BACKDROP_APPROXIMATE')
  })

  it('warns about a look that does not exist and suggests real names', () => {
    const result = buildStoryFromText(
      story([{ 背景: '溪流' }, { 背景: '城市' }], { 角色: { 渡船伯: { 外觀: 'Xyzzy' } } }),
    )
    const warning = result.diagnostics.find((item) => item.code === 'UNKNOWN_LOOK')
    expect(warning?.severity).toBe('warning')
    expect(warning?.suggestion).toMatch(/改成 .+ 之一/)
  })

  it('reads numbered sound names from their prefix', () => {
    expect(pickSound('Water Drop')).toMatchObject({ name: 'Water Drop 1' })
  })

  it('keeps 做不到 out of feedback in games and stories', () => {
    const game = buildFromSpecText(
      JSON.stringify({ 地圖: ['P..G'], 角色: { P: ['俯視移動'], G: ['終點'] }, 做不到: ['拖曳物件'] }),
    )
    expect(game.diagnostics.find((item) => item.code === 'UNSUPPORTED_REQUEST')?.severity).toBe('fixed')
    const animation = buildStoryFromText(story([{ 背景: '溪流' }, { 背景: '城市' }], { 做不到: ['換成現代裝扮'] }))
    expect(animation.story?.unsupported).toEqual(['換成現代裝扮'])
  })

  it('warns with examples when a game look names no official sprite', () => {
    const result = buildFromSpecText(
      JSON.stringify({ 地圖: ['P..G'], 角色: { P: { 行為: ['俯視移動'], 外觀: 'Zzqx' }, G: ['終點'] } }),
    )
    const warning = result.diagnostics.find((item) => item.code === 'UNKNOWN_LOOK')
    expect(warning?.severity).toBe('warning')
    expect(warning?.suggestion).toContain('Fish')
  })
})
