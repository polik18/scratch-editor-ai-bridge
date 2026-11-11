import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../src/core/validator'
import { buildFromSpecText, createSpecScenarios, SPEC_NAMES, type SpecDiagnostic } from '../../src/spec'

const example = (name: string): string =>
  readFileSync(new URL(`../../src/spec/examples/${name}.json`, import.meta.url), 'utf-8')

const codes = (diagnostics: readonly SpecDiagnostic[]): string[] => diagnostics.map((item) => item.code)

const twoLevels = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    標題: '測試',
    角色: { 魚: { 行為: [{ 俯視移動: {} }] }, 藻: { 行為: [{ 收集品: { 分數: 10 } }] }, 出口: { 行為: ['終點'] } },
    圖例: { P: '魚', a: '藻', G: '出口' },
    關卡: [
      { 名稱: '第一關', 地圖: ['P..a..a'], 過關: '分數 >= 20' },
      { 名稱: '第二關', 地圖: ['P....aG'] },
    ],
    ...overrides,
  })

describe('opening card', () => {
  it('writes how to play when the author gave no instructions', () => {
    const { spec } = buildFromSpecText(example('platformer'))
    expect(spec?.levels).toHaveLength(1)
    expect(spec?.instructions.join('\n')).toContain('← → 移動，↑ 跳')
    expect(spec?.instructions.join('\n')).toContain('就過關')
  })

  it('keeps written instructions and warns when they do not fit', () => {
    const lines = ['一', '二', '三', '四', '五', '六', '七']
    const result = buildFromSpecText(twoLevels({ 說明: lines }))
    expect(result.spec?.instructions).toEqual(lines)
    expect(codes(result.diagnostics)).toContain('INSTRUCTIONS_TOO_LONG')
  })

  it('compiles to a card that holds the game until space or a click', () => {
    const { project } = buildFromSpecText(example('catch'))
    const intro = project?.sprites.find((sprite) => sprite.name === SPEC_NAMES.intro)
    expect(intro?.costumes[0]?.data).toContain('按空白鍵或點一下開始')
    const opcodes = JSON.stringify(intro?.scripts)
    expect(opcodes).toContain('sensing_mousedown')
    expect(opcodes).toContain(SPEC_NAMES.start)
  })
})

describe('two levels', () => {
  it('builds the example into a valid project with one wall costume per level', async () => {
    const result = buildFromSpecText(example('two-levels'))
    expect(result.diagnostics.filter((item) => item.severity !== 'fixed')).toEqual([])
    const project = result.project
    if (!project) throw new Error('expected a project')
    expect(validateCanonicalProject(project).valid).toBe(true)
    expect(validateCanonicalSemantics(project).filter((item) => item.severity === 'error')).toEqual([])
    const walls = project.sprites.find((sprite) => sprite.name === SPEC_NAMES.walls)
    expect(walls?.costumes.map((costume) => costume.name)).toEqual(['level-1', 'level-2'])
    const banner = project.sprites.find((sprite) => sprite.name === SPEC_NAMES.banner)
    expect(banner?.costumes.map((costume) => costume.name)).toEqual(['win', 'lose', 'level-2'])
    expect((await compileCanonicalProjectToSb3(project)).size).toBeGreaterThan(0)
  }, 60_000)

  it('places each entity only on the levels whose map draws it', () => {
    const { spec, project } = buildFromSpecText(example('two-levels'))
    expect(spec?.levels[0]?.map.join('')).not.toContain('G')
    const exit = project?.sprites.find((sprite) => sprite.name === '出口')
    expect(exit?.lists.find((list) => list.name === '_lv')?.value).toEqual([2])
    const trap = spec?.entities.find((entity) => entity.name === '毒魚陷阱')
    expect(trap?.behaviors.map((use) => use.name)).toEqual(['hazard'])
  })

  it('refuses more than two levels', () => {
    const three = JSON.parse(twoLevels()) as { 關卡: unknown[] }
    three.關卡.push({ 地圖: ['P.G'] })
    expect(codes(buildFromSpecText(JSON.stringify(three)).diagnostics)).toContain('TOO_MANY_LEVELS')
  })

  it('needs a way to win on every level, judged by what that level draws', () => {
    const result = buildFromSpecText(twoLevels({ 關卡: [{ 地圖: ['P..aG'] }, { 地圖: ['P..a'] }] }))
    const missing = result.diagnostics.find((item) => item.code === 'NO_WIN_CONDITION')
    expect(missing?.severity).toBe('error')
    expect(missing?.where).toBe('第二關')
    expect(result.project).toBeUndefined()
  })

  it('counts each level score target from the score the level started with', () => {
    const result = buildFromSpecText(
      twoLevels({
        關卡: [
          { 地圖: ['P..a..a'], 過關: '分數 >= 20' },
          { 地圖: ['P..a..a'], 過關: '分數 >= 20' },
        ],
      }),
    )
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(JSON.stringify(result.project)).toContain(SPEC_NAMES.levelStartScore)
    if (!result.spec) throw new Error('expected a spec')
    const change = createSpecScenarios(result.spec).find((scenario) => scenario.name === '換關')
    expect(change?.steps.filter((step) => step.kind === 'set' && step.variable === SPEC_NAMES.score)).toEqual([
      { kind: 'set', variable: SPEC_NAMES.score, value: 20 },
      { kind: 'set', variable: SPEC_NAMES.score, value: 40 },
    ])
  })

  it('applies outer rules on every level and level rules only on their own', () => {
    const { spec } = buildFromSpecText(
      twoLevels({
        規則: ['收集 藻 → 說 好吃'],
        關卡: [{ 地圖: ['P..a..a'], 過關: '分數 >= 20', 規則: ['開始 → 說 第一關'] }, { 地圖: ['P....aG'] }],
      }),
    )
    const said = (index: number): string[] =>
      (spec?.levels[index]?.rules ?? []).flatMap((rule) =>
        rule.actions.flatMap((action) => (action.kind === 'say' ? [action.text] : [])),
      )
    expect(said(0)).toEqual(['好吃', '第一關'])
    expect(said(1)).toEqual(['好吃'])
  })

  it('playtests the opening card and the move to the second level', () => {
    const { spec } = buildFromSpecText(example('two-levels'))
    if (!spec) throw new Error('expected a spec')
    const scenarios = createSpecScenarios(spec)
    expect(scenarios.map((scenario) => scenario.name)).toEqual(
      expect.arrayContaining(['開場說明', '換關', '基本操作']),
    )
    expect(scenarios.find((scenario) => scenario.name === '開場說明')?.keepIntro).toBe(true)
    const change = scenarios.find((scenario) => scenario.name === '換關')
    expect(change?.steps).toContainEqual({ kind: 'set', variable: SPEC_NAMES.score, value: 50 })
    expect(change?.steps.some((step) => step.kind === 'bot')).toBe(true)
  })

  it('accepts characters written inside each level, as small models often do', () => {
    const spec = JSON.parse(twoLevels()) as Record<string, unknown> & {
      角色: unknown
      關卡: Record<string, unknown>[]
    }
    const characters = spec.角色
    delete (spec as Record<string, unknown>).角色
    spec.關卡[0].角色 = characters
    spec.關卡[1].角色 = { 出口: { 行為: ['終點'] } }
    const result = buildFromSpecText(JSON.stringify(spec))
    expect(codes(result.diagnostics)).toContain('LEVEL_FIELD_LIFTED')
    expect(result.project).toBeDefined()
    expect(result.spec?.entities.map((entity) => entity.name)).toEqual(['魚', '藻', '出口'])
  })

  it('reads a level list written under 地圖 instead of 關卡', () => {
    const spec = JSON.parse(twoLevels()) as Record<string, unknown>
    spec.地圖 = spec.關卡
    delete spec.關卡
    const result = buildFromSpecText(JSON.stringify(spec))
    expect(result.spec?.levels).toHaveLength(2)
    expect(result.project).toBeDefined()
  })
})
