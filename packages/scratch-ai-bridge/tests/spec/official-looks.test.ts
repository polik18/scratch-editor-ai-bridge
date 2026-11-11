import { describe, expect, it } from 'vitest'
import { buildFromSpecText } from '../../src/spec'

const build = (entities: Record<string, unknown>, map = ['P.ab..G']) =>
  buildFromSpecText(
    JSON.stringify({ 標題: '測試', 地圖: map, 圖例: { P: '香魚', a: 'a', b: 'b', G: '終點' }, 角色: entities }),
  )

const official = (result: ReturnType<typeof build>, name: string) =>
  result.spec?.entities.find((entity) => entity.name === name)?.official

describe('official Scratch artwork for Game Spec characters', () => {
  it('picks artwork from a name whose last word is a character', () => {
    const result = build({ 香魚: ['俯視移動'], a: ['收集品'], b: ['危險物'], 終點: ['終點'] })
    expect(official(result, '香魚')).toBe('Fish')
    expect(result.diagnostics.some((item) => item.code === 'OFFICIAL_LOOK' && item.message.includes('Fish'))).toBe(
      true,
    )
  })

  it('does not pick artwork from a word that only describes the character', () => {
    const result = build({ 香魚: ['俯視移動'], 魚道: ['收集品'], 電魚網: ['危險物'], 終點: ['終點'] }, ['P.ab..G'])
    expect(official(result, '魚道')).toBeUndefined()
    expect(official(result, '電魚網')).toBeUndefined()
  })

  it('uses the sprite that 外觀 names, in English or Chinese', () => {
    const result = build({
      香魚: { 行為: ['俯視移動'], 外觀: '螃蟹' },
      a: { 行為: ['收集品'], 外觀: 'Starfish' },
      b: { 行為: ['危險物'], 外觀: 'rock' },
      終點: ['終點'],
    })
    expect(official(result, '香魚')).toBe('Crab')
    expect(official(result, 'a')).toBe('Starfish')
    // A built-in look is kept as it is.
    expect(official(result, 'b')).toBeUndefined()
  })

  it('names the artwork and scales it to one map cell', () => {
    const result = build({ 香魚: ['俯視移動'], a: ['收集品'], b: ['危險物'], 終點: ['終點'] })
    const fish = result.project?.sprites.find((target) => target.name === '香魚')
    expect(fish?.costumes[0]).toMatchObject({ name: 'Fish' })
    expect(fish?.size).toBeGreaterThan(5)
    expect(fish?.size).toBeLessThan(40)
  })
})
