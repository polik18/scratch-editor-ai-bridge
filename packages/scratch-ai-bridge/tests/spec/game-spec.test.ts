import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../src/core/validator'
import {
  buildFromSpecText,
  checkGameSpec,
  createSpecScenarios,
  normalizeGameSpec,
  type GameSpec,
  type SpecDiagnostic,
} from '../../src/spec'
import { jumpProfile, jumpReach } from '../../src/spec/physics'

const example = (name: string): string =>
  readFileSync(new URL(`../../src/spec/examples/${name}.json`, import.meta.url), 'utf-8')

const defined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value')
  return value
}

const codes = (diagnostics: readonly SpecDiagnostic[]): string[] => diagnostics.map((item) => item.code)

const normalized = (raw: unknown): GameSpec => {
  const result = normalizeGameSpec(raw)
  expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
  return defined(result.spec)
}

describe('game spec normalization', () => {
  it('accepts Chinese keys, behavior aliases and small typos', () => {
    const result = normalizeGameSpec({
      標題: '測試',
      地圖: ['P.oG', '####'],
      圖例: { P: '主角', o: '金幣', G: '旗子' },
      角色: {
        主角: { 行為: [{ 平台跳躍: { 跳躍: '高', 速度: '快' } }] },
        金幣: { 行為: [{ collectable: { 分數: 5 } }] },
        旗子: { 行為: ['終點'] },
      },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    const spec = defined(result.spec)
    expect(spec.entities.map((entity) => entity.behaviors.map((item) => item.name))).toEqual([
      ['platformer'],
      ['collectible'],
      ['goal'],
    ])
    expect(spec.entities[0].behaviors[0].params).toEqual({ jump: 'high', speed: 'high' })
    expect(spec.entities[1].behaviors[0].params).toEqual({ points: 5 })
    expect(codes(result.diagnostics)).toContain('BEHAVIOR_ALIAS')
  })

  it('infers legend entries from entity initials and pads ragged map rows', () => {
    const spec = normalized({
      map: ['H.....E', '####'],
      entities: { Hero: { behaviors: ['topdown'] }, Exit: ['goal'] },
    })
    expect(spec.legend).toEqual({ H: 'Hero', E: 'Exit' })
    expect(spec.map.every((row) => [...row].length === 7)).toBe(true)
  })

  it('names the map row and offers a fix for an undefined map character', () => {
    const result = normalizeGameSpec({
      map: ['P..', '.?.', '###'],
      legend: { P: 'Hero' },
      entities: { Hero: ['topdown'] },
    })
    const issue = result.diagnostics.find((item) => item.code === 'UNKNOWN_MAP_CHAR')
    expect(issue?.where).toBe('地圖 第 2 列')
    expect(issue?.suggestion).toContain('"?"')
  })

  it('parses rules written as arrows or as objects, resolving entity typos', () => {
    const spec = normalized({
      map: ['PcG', '###'],
      legend: { P: 'Hero', c: 'Coin', G: 'Goal' },
      entities: { Hero: ['platformer'], Coin: ['collectible'], Goal: ['goal'] },
      rules: ['收集 Coin → 分數 +5, 說 好棒', { when: 'score >= 20', do: 'win' }, 'touch Goall -> lives -1'],
    })
    expect(spec.rules).toEqual([
      {
        when: { kind: 'collect', entity: 'Coin' },
        actions: [
          { kind: 'score', delta: 5 },
          { kind: 'say', text: '好棒' },
        ],
      },
      { when: { kind: 'score-at-least', value: 20 }, actions: [{ kind: 'win' }] },
      { when: { kind: 'touch', entity: 'Goal' }, actions: [{ kind: 'lives', delta: -1 }] },
    ])
  })

  it('reports missing players, several players and missing win conditions', () => {
    expect(
      codes(
        normalizeGameSpec({ map: ['c'], legend: { c: 'Coin' }, entities: { Coin: ['collectible'] } }).diagnostics,
      ),
    ).toEqual(expect.arrayContaining(['NO_PLAYER', 'NO_WIN_CONDITION']))
    expect(
      codes(
        normalizeGameSpec({
          map: ['AB'],
          legend: { A: 'A', B: 'B' },
          entities: { A: ['topdown'], B: ['platformer'] },
        }).diagnostics,
      ),
    ).toContain('MULTIPLE_PLAYERS')
  })
})

describe('game spec checks', () => {
  const tower = (jump: string): GameSpec =>
    normalized({
      map: ['....G', '..###', '.....', '.....', '.....', 'P....', '#####'],
      legend: { P: 'Hero', G: 'Goal' },
      entities: { Hero: [{ platformer: { jump } }], Goal: ['goal'] },
    })

  it('uses the generated physics for jump reach', () => {
    expect(jumpProfile('mid').rise).toBeCloseTo(92.4, 1)
    expect(jumpReach('mid', 'mid').up).toBe(3)
    expect(jumpReach('high', 'mid').up).toBe(5)
  })

  it('warns when a goal sits higher than the player can jump, and suggests a higher jump', () => {
    const issues = checkGameSpec(tower('mid'))
    expect(codes(issues)).toEqual(['GOAL_UNREACHABLE'])
    expect(issues[0].where).toBe('地圖 第 1 列第 5 欄')
    expect(issues[0].suggestion).toContain('「高」')
    expect(checkGameSpec(tower('high'))).toEqual([])
  })

  it('treats hazards as blocking in top-down mazes', () => {
    const blocked = normalized({
      map: ['#####', '#P^G#', '#####'],
      legend: { P: 'Hero', '^': 'Spike', G: 'Exit' },
      entities: { Hero: ['topdown'], Spike: ['hazard'], Exit: ['goal'] },
    })
    expect(codes(checkGameSpec(blocked))).toEqual(['GOAL_UNREACHABLE'])
  })

  it('accepts the bundled examples without warnings', () => {
    for (const name of ['platformer', 'maze', 'catch', 'shooter', 'whack']) {
      const result = buildFromSpecText(example(name))
      expect(result.diagnostics.filter((item) => item.severity !== 'fixed')).toEqual([])
    }
  })
})

describe('game spec compilation', () => {
  it.each(['platformer', 'maze'])(
    'compiles %s into Canonical IR that passes schema, semantics and the VM',
    async (name) => {
      const text = example(name)
      const { project } = buildFromSpecText(text)
      expect(project).toBeDefined()
      const schema = validateCanonicalProject(project)
      expect(schema.valid).toBe(true)
      expect(validateCanonicalSemantics(defined(project)).filter((item) => item.severity === 'error')).toEqual([])
      const sb3 = await compileCanonicalProjectToSb3(defined(project))
      expect(sb3.size).toBeGreaterThan(1000)
      // The point of the spec: the author writes a small fraction of what Scratch needs.
      expect(text.length * 5).toBeLessThan(JSON.stringify(project).length)
    },
  )

  it('clones every placed entity from per-sprite position lists', () => {
    const { project } = buildFromSpecText(example('platformer'))
    const coin = defined(defined(project).sprites.find((sprite) => sprite.name === '金幣'))
    expect(coin.lists.find((list) => list.name === '_x')?.value).toHaveLength(8)
    expect(coin.visible).toBe(false)
  })

  it('refuses to compile while errors remain', () => {
    const result = buildFromSpecText('{"map": ["P"], "entities": {"P": ["fly"]}}')
    expect(result.project).toBeUndefined()
    expect(codes(result.diagnostics)).toContain('UNKNOWN_BEHAVIOR')
  })

  it('explains text that is not JSON', () => {
    expect(codes(buildFromSpecText('我想做遊戲').diagnostics)).toEqual(['SPEC_NOT_JSON'])
  })
})

describe('generated scenarios', () => {
  it('derives control checks from the map and a goal run for each example', () => {
    const platformer = createSpecScenarios(defined(buildFromSpecText(example('platformer')).spec))
    expect(platformer.map((scenario) => scenario.name)).toEqual(['基本操作', '通關'])
    const maze = createSpecScenarios(defined(buildFromSpecText(example('maze')).spec))
    const labels = maze[0].steps.flatMap((step) => (step.kind === 'expect' ? [step.label] : []))
    // The maze start has walls to the left and above, open floor to the right and below.
    expect(labels).toEqual(['按右鍵會移動', '往左是牆，不能穿過', '往上是牆，不能穿過', '按下鍵會移動'])
    const bot = maze[1].steps.find((step) => step.kind === 'bot')
    expect(bot?.kind === 'bot' && bot.path?.length).toBeGreaterThan(10)
  })
})

describe('repairs for common small-model mistakes', () => {
  it('rebalances mismatched brackets in otherwise valid JSON', () => {
    const text = `{
  "map": ["P..G", "####"],
  "legend": { "P": "Hero", "G": "Goal" },
  "entities": {
    "Hero": { "behaviors": [{ "platformer": { "jump": "high" }] },
    "Goal": { "behaviors": ["goal"] }
  }
}`
    const result = buildFromSpecText(text)
    expect(result.project).toBeDefined()
    expect(codes(result.diagnostics)).toContain('JSON_REPAIRED')
  })

  it('places a player that is in the legend but missing from the map', () => {
    const platformer = buildFromSpecText(
      JSON.stringify({
        map: ['......', '..o..G', '######'],
        legend: { P: 'Hero', o: 'Coin', G: 'Goal' },
        entities: { Hero: ['platformer'], Coin: ['collectible'], Goal: ['goal'] },
      }),
    )
    expect(platformer.project).toBeDefined()
    expect(defined(platformer.spec).map[1]).toBe('P.o..G')
    expect(codes(platformer.diagnostics)).toContain('PLAYER_AUTO_PLACED')

    const maze = buildFromSpecText(
      JSON.stringify({
        map: ['#####', '#..G#', '#####'],
        legend: { G: 'Exit' },
        entities: { Mouse: ['topdown'], Exit: ['goal'] },
      }),
    )
    expect(defined(maze.spec).map[1]).toBe('#M.G#')
  })

  it('crops empty columns beyond the stage width quietly and warns when content is cut', () => {
    const wide = (last: string): unknown => ({
      map: [`P${'.'.repeat(18)}G${last}`, '#'.repeat(21)],
      legend: { P: 'Hero', G: 'Goal', o: 'Coin' },
      entities: { Hero: ['platformer'], Goal: ['goal'], Coin: ['collectible'] },
    })
    const cropped = normalizeGameSpec(wide('.'))
    expect(codes(cropped.diagnostics)).toContain('MAP_CROPPED')
    expect(defined(cropped.spec).map.every((row) => [...row].length === 20)).toBe(true)
    expect(codes(normalizeGameSpec(wide('o')).diagnostics)).toContain('MAP_CROPPED_CONTENT')
  })

  it('accepts a redundant "lives run out → lose" rule', () => {
    const result = normalizeGameSpec({
      map: ['P.G', '###'],
      legend: { P: 'Hero', G: 'Goal' },
      entities: { Hero: ['platformer'], Goal: ['goal'] },
      rules: ['生命 <= 0 → 失敗'],
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(codes(result.diagnostics)).toContain('RULE_BUILT_IN')
    expect(defined(result.spec).rules).toEqual([])
  })
})

describe('more repairs and the timer', () => {
  it('also repairs a closer written before the one it should follow', () => {
    const text = `{
  "map": ["P.G", "###"],
  "legend": { "P": "Hero", "G": "Goal" },
  "entities": {
    "Hero": { "behaviors": [{ "topdown": { "speed": "high" }] } },
    "Goal": { "behaviors": ["goal"] }
  },
  "rules": ["start -> say hi"]
}`
    const result = buildFromSpecText(text)
    expect(result.project).toBeDefined()
    expect(defined(result.spec).rules).toHaveLength(1)
  })

  it('creates entities that only appear in the legend, guessing behavior from the name', () => {
    const result = normalizeGameSpec({
      map: ['P.*.^.G', '#######'],
      legend: { P: '主角', '*': '星星', '^': '陷阱', G: '旗子' },
      entities: { 主角: ['平台移動'] },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    const spec = defined(result.spec)
    expect(spec.entities.map((entity) => [entity.name, entity.behaviors.map((item) => item.name)])).toEqual([
      ['主角', ['platformer']],
      ['星星', ['collectible']],
      ['陷阱', ['hazard']],
      ['旗子', ['goal']],
    ])
    expect(codes(result.diagnostics)).toContain('ENTITY_INFERRED')
  })

  it('counts down a timer and runs "time up" rules', () => {
    const result = buildFromSpecText(
      JSON.stringify({
        map: ['P.o', '###'],
        legend: { P: 'Hero', o: 'Coin' },
        entities: { Hero: ['topdown'], Coin: ['collectible'] },
        settings: { 時間: 30 },
        rules: ['時間到 → 說 時間到了, 失敗', '分數 >= 10 → 過關'],
      }),
    )
    const spec = defined(result.spec)
    expect(spec.timeLimit).toBe(30)
    expect(spec.rules[0].when).toEqual({ kind: 'time-up' })
    const stage = defined(result.project).stage
    expect(stage.variables.map((item) => item.name)).toContain('時間')
    expect(codes(result.diagnostics)).not.toContain('NO_WIN_CONDITION')
  })
})

describe('falling, shooting and clicking behaviors', () => {
  it('parses the new behaviors, their Chinese parameters and the top-down axis', () => {
    const spec = normalized({
      map: ['....C....'],
      legend: { C: '貓咪' },
      entities: {
        貓咪: [{ 俯視移動: { 方向: '左右' } }],
        蘋果: [{ 掉落物: { 速度: '快', 間隔: 2, 加速: '是' } }, '收集品'],
        雷射: [{ 子彈: { 按鍵: '空白鍵', 方向: '面向' } }],
        外星人: [{ 掉落物: { 方向: '往左' } }, { 可射中: { 分數: 30 } }],
      },
      rules: ['每 2 秒 → 分數 +1', '漏掉 蘋果 → 生命 -1', '射中 外星人 → 時間 +5'],
    })
    const byName = Object.fromEntries(spec.entities.map((entity) => [entity.name, entity]))
    expect(byName.貓咪.behaviors[0].params).toEqual({ speed: 'mid', axis: 'horizontal' })
    expect(byName.蘋果.behaviors[0].params).toEqual({
      speed: 'high',
      interval: 2,
      direction: 'down',
      accelerate: true,
    })
    expect(byName.蘋果.look).toBe('apple')
    expect(byName.雷射.behaviors[0].params).toEqual({ key: 'space', direction: 'facing', speed: 'mid' })
    expect(byName.外星人.behaviors.map((item) => item.name)).toEqual(['faller', 'target'])
    expect(spec.rules.map((rule) => rule.when)).toEqual([
      { kind: 'every', seconds: 2 },
      { kind: 'miss', entity: '蘋果' },
      { kind: 'hit', entity: '外星人' },
    ])
    expect(spec.rules[2].actions).toEqual([{ kind: 'time', delta: 5 }])
    expect(spec.timeLimit).toBe(60)
  })

  it('does not ask for map cells for things that enter from the stage edges', () => {
    const result = normalizeGameSpec({
      map: ['..P..'],
      legend: { P: 'Ship' },
      entities: { Ship: ['topdown'], Rock: ['faller', 'hazard'], Laser: ['projectile'] },
      rules: ['score >= 10 -> win'],
    })
    expect(codes(result.diagnostics)).not.toContain('ENTITY_NOT_PLACED')
  })

  it('allows click games without a player and builds a narrator for their rules', () => {
    const result = buildFromSpecText(example('whack'))
    const sprites = defined(result.project).sprites.map((sprite) => sprite.name)
    expect(sprites).toContain('_Narrator')
    expect(
      codes(
        normalizeGameSpec({ map: ['c'], legend: { c: 'Coin' }, entities: { Coin: ['collectible'] } }).diagnostics,
      ),
    ).toContain('NO_PLAYER')
  })

  it('reports projectiles without a shooter and targets without projectiles', () => {
    expect(
      codes(normalizeGameSpec({ entities: { Ball: ['clickable'], Laser: ['projectile'] } }).diagnostics),
    ).toContain('PROJECTILE_NO_PLAYER')
    expect(
      codes(normalizeGameSpec({ map: ['P'], entities: { P: ['topdown'], Alien: ['faller', 'target'] } }).diagnostics),
    ).toContain('TARGET_NO_PROJECTILE')
  })

  it('reports what the author said the spec could not do', () => {
    const result = normalizeGameSpec({
      map: ['P.G'],
      entities: { P: ['topdown'], G: ['goal'] },
      做不到: ['球碰到球拍會反彈'],
    })
    expect(defined(result.spec).unsupported).toEqual(['球碰到球拍會反彈'])
    expect(result.diagnostics.find((item) => item.code === 'UNSUPPORTED_REQUEST')?.message).toContain('反彈')
  })

  it('generates effect scenarios from the behaviors and rules', () => {
    const names = (name: string): string[] =>
      createSpecScenarios(defined(buildFromSpecText(example(name)).spec)).map((scenario) => scenario.name)
    expect(names('catch')).toEqual(['基本操作', '接住掉落物', '漏接扣命'])
    expect(names('shooter')).toEqual(['基本操作', '射擊'])
    expect(names('whack')).toEqual(['點擊得分', '倒數計時'])
  })
})

describe('fail-soft repairs seen in the second model run', () => {
  it('expands several behaviors written in one object', () => {
    const spec = normalized({
      map: ['..P..'],
      entities: {
        P: [{ 俯視移動: { 方向: '左右' } }],
        蘋果: { 行為: [{ 掉落物: { 速度: '中' }, 收集品: { 分數: 10 } }] },
        石頭: { 行為: [{ 掉落物: {}, 危險物: true }] },
      },
      rules: ['分數 >= 50 → 過關'],
    })
    expect(spec.entities.map((entity) => entity.behaviors.map((item) => item.name))).toEqual([
      ['topdown'],
      ['faller', 'collectible'],
      ['faller', 'hazard'],
    ])
  })

  it('repairs a behavior object opened where a key belongs', () => {
    const text = `{
  "map": ["..P.."],
  "entities": {
    "P": { "behaviors": [{ "topdown": {} }] },
    "Rock": { "behaviors": [{ "faller": { "speed": "mid" }, { "hazard": {} }, { "collectible": { "points": 5 } }] }
  },
  "rules": ["score >= 50 -> win"]
}`
    const result = buildFromSpecText(text)
    expect(result.project).toBeDefined()
    expect(defined(result.spec).entities[1].behaviors.map((item) => item.name)).toEqual([
      'faller',
      'hazard',
      'collectible',
    ])
  })

  it('lays out a platformer whose map was left empty', () => {
    const result = buildFromSpecText(
      JSON.stringify({
        map: Array(20).fill('.'.repeat(56)),
        legend: { P: '主角', '*': '星星', G: '終點', E: '敵人' },
        entities: { 主角: ['平台移動'], 星星: ['收集品'], 終點: ['終點'], 敵人: ['巡邏'] },
      }),
    )
    expect(result.project).toBeDefined()
    const spec = defined(result.spec)
    expect(spec.map).toHaveLength(15)
    expect(spec.map[14]).toBe('#'.repeat(20))
    expect(spec.map[13].startsWith('P')).toBe(true)
    expect(spec.map[13].endsWith('G')).toBe(true)
    expect(spec.map[13]).toContain('E')
    expect(spec.entities.find((entity) => entity.name === '星星')?.behaviors.map((item) => item.name)).toEqual([
      'collectible',
      'faller',
    ])
    expect(codes(result.diagnostics)).toEqual(
      expect.arrayContaining(['GROUND_ADDED', 'ENTITY_AUTO_PLACED', 'FALLER_ADDED']),
    )
  })

  it('crops a wide map with content and warns instead of refusing', () => {
    const result = normalizeGameSpec({
      map: [`P${'.'.repeat(25)}G...o`, '#'.repeat(31)],
      legend: { P: 'Hero', G: 'Goal', o: 'Coin' },
      entities: { Hero: ['platformer'], Goal: ['goal'], Coin: ['collectible'] },
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(codes(result.diagnostics)).toContain('MAP_CROPPED_CONTENT')
    expect(defined(result.spec).map[0].endsWith('G')).toBe(true)
  })

  it('makes pop-ups and rule-clicked entities clickable in games without a player', () => {
    const spec = normalized({
      map: ['.m..m.'],
      legend: { m: '地鼠' },
      entities: { 地鼠: [{ 冒出: { 停留: 1 } }] },
      rules: ['時間到 → 過關'],
      設定: { 時間: 20 },
    })
    expect(spec.entities[0].behaviors.map((item) => item.name)).toEqual(['popup', 'clickable'])
  })

  it('drops unreadable rules with a warning instead of failing', () => {
    const result = normalizeGameSpec({
      map: ['P.G'],
      entities: { P: ['topdown'], G: ['goal'] },
      rules: ['時間到 → 分數 >= 0', '碰到 不存在 → 過關', 'collect G -> say ok'],
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(defined(result.spec).rules).toHaveLength(1)
  })

  it('supports custom counters such as oxygen', () => {
    const result = buildFromSpecText(
      JSON.stringify({
        map: ['P..o'],
        legend: { o: '泡泡' },
        entities: { P: ['topdown'], 泡泡: ['收集品'] },
        rules: ['每秒 → 氧氣 -1', '收集 泡泡 → 氧氣 +3', '氧氣 <= 0 → 失敗', '分數 >= 30 → 過關'],
      }),
    )
    const spec = defined(result.spec)
    expect(spec.variables).toEqual({ 氧氣: 10 })
    expect(spec.rules[2].when).toEqual({ kind: 'compare', variable: '氧氣', op: '<=', value: 0 })
    expect(codes(result.diagnostics)).toContain('VARIABLE_DEFAULTED')
    expect(defined(result.project).stage.variables.map((item) => item.name)).toContain('氧氣')
  })
})

describe('repairs seen in the third model run', () => {
  it('lifts rules and settings written inside the entities object', () => {
    const spec = normalized({
      map: ['....'],
      entities: {
        氣球: { 行為: ['掉落物', '點擊目標'] },
        規則: ['點到 氣球 → 分數 +5'],
        設定: { 時間: 30 },
        做不到: ['音效'],
      },
    })
    expect(spec.entities.map((entity) => entity.name)).toEqual(['氣球'])
    expect(spec.rules).toHaveLength(1)
    expect(spec.timeLimit).toBe(30)
    expect(spec.unsupported).toEqual(['音效'])
  })

  it('moves a platformer player that would fall off the stage at the start', () => {
    const result = normalizeGameSpec({
      map: ['......', '..###.', 'P#####'],
      legend: { P: 'Hero' },
      entities: { Hero: ['platformer'] },
      rules: ['score >= 10 -> win'],
    })
    const spec = defined(result.spec)
    expect(spec.map[2].startsWith('P')).toBe(false)
    expect(spec.map[1]).toBe('.P###.')
    expect(codes(result.diagnostics)).toContain('PLAYER_MOVED')
  })

  it('makes the entity a "hit" rule names shootable', () => {
    const spec = normalized({
      map: ['..P..'],
      entities: { P: [{ topdown: { axis: 'horizontal' } }], Laser: ['projectile'], Alien: ['faller', 'hazard'] },
      rules: ['射中 Alien → 分數 +10'],
    })
    expect(spec.entities[2].behaviors.map((item) => item.name)).toEqual(['faller', 'hazard', 'target'])
  })

  it('places an undrawn left-right player at the bottom centre', () => {
    const spec = normalized({
      map: ['..........', '..........', '..........'],
      entities: { Ship: [{ topdown: { axis: 'horizontal' } }], Rock: ['faller', 'hazard'] },
      rules: ['every 1 s -> score +1'],
    })
    expect(spec.map[2]).toBe('.....S....')
  })
})
