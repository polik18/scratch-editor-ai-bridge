import { describe, expect, it } from 'vitest'
import { buildFromSpecText, extractJson } from '../../src/spec'

const codes = (text: string): string[] => buildFromSpecText(text).diagnostics.map((item) => item.code)

describe('mistakes the local model made on the contest prompts', () => {
  it('keeps the first of two controlled characters as the player instead of failing', () => {
    const result = buildFromSpecText(
      JSON.stringify({
        地圖: ['P.W.G'],
        圖例: { P: '竹筏', W: '擺渡人', G: '對岸' },
        角色: { 竹筏: ['俯視移動'], 擺渡人: ['俯視移動'], 對岸: ['終點'] },
      }),
    )
    expect(result.project).toBeDefined()
    const warning = result.diagnostics.find((item) => item.code === 'MULTIPLE_PLAYERS')
    expect(warning?.severity).toBe('warning')
    expect(warning?.message).toContain('擺渡人')
    expect(result.spec?.entities.find((entity) => entity.name === '擺渡人')?.behaviors).toEqual([])
  })

  it('crops a wide map around its characters, so the goal at the far end stays', () => {
    const row = `${'#'.repeat(10)}P.....a.....a.....G#`
    const result = buildFromSpecText(
      JSON.stringify({ 地圖: [row], 角色: { P: ['俯視移動'], a: ['收集品'], G: ['終點'] } }),
    )
    expect(result.spec?.map[0]).toHaveLength(20)
    expect(result.spec?.map[0]).toMatch(/P.*G/)
    expect(codes(JSON.stringify({ 地圖: [row], 角色: { P: ['俯視移動'], a: ['收集品'], G: ['終點'] } }))).toContain(
      'MAP_CROPPED',
    )
  })

  it('moves seconds written after a closing quote back inside it', () => {
    const { value, repaired } = extractJson('{ "動作": [ "偶偶 說「希望之河！」" 5秒, "等 2秒" ] }')
    expect(repaired).toBe(true)
    expect(value).toEqual({ 動作: ['偶偶 說「希望之河！」 5秒', '等 2秒'] })
  })

  it('points a JSON error that cannot be repaired at its line', () => {
    expect(() => extractJson('{\n  "標題": "x",\n  "地圖": ["P" "G"] : 3\n}')).toThrow(/第 3 行/)
  })
})
