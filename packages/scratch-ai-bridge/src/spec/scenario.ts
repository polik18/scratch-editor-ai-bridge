import { entityCells, findPlayer, playerBehavior, SPEC_NAMES } from './compile'
import { levelView } from './levels'
import { CELL, cellCenter, STAGE_COLUMNS, STAGE_ROWS } from './physics'
import type { GameSpec } from './types'

/**
 * Declarative playtest scenarios derived from a spec. Each behavior knows what it should do, so the scenarios are
 * generated, not written by the author; a runner (see `src/cli/scenario-runner.ts`) drives them in the real
 * Scratch preview and evaluates the expectations.
 */

export type Subject =
  | { readonly sprite: string; readonly field: 'x' | 'y' | 'visible' | 'costume' }
  | { readonly stage: 'backdrop' }
  /** Seconds since the scenario started. */
  | { readonly clock: 'seconds' }
  | { readonly variable: string; readonly target?: string }

export interface Expectation {
  readonly kind: 'expect'
  readonly label: string
  readonly subject: Subject
  readonly op: '>' | '<' | '==' | 'within'
  readonly value?: number
  /** Compare with the subject's value at a mark, plus this offset. */
  readonly from?: { readonly mark: string; readonly plus?: number }
  /** For `within`: allowed absolute distance from the reference. */
  readonly tolerance?: number
  /** Explanation shown when the expectation fails, in author terms. */
  readonly hint: string
}

export interface BotStep {
  readonly kind: 'bot'
  readonly mode: 'platformer' | 'topdown'
  readonly player: string
  readonly goal: { readonly x: number; readonly y: number }
  /** Topdown: cell centres from the player to the goal. */
  readonly path?: readonly { readonly x: number; readonly y: number }[]
  /** Platformer: sprites worth jumping over. */
  readonly threats?: readonly string[]
  /** Platformer: x of columns without any floor. */
  readonly pits?: readonly number[]
  readonly timeoutMs: number
}

export type ScenarioStep =
  | { readonly kind: 'wait'; readonly ms: number }
  | { readonly kind: 'hold'; readonly keys: readonly string[]; readonly ms: number }
  | { readonly kind: 'press' | 'release'; readonly keys: readonly string[] }
  /** Click these stage points, or the visible copies of these entities, in turn until `ms` has passed. */
  | {
      readonly kind: 'clicks'
      readonly points?: readonly { readonly x: number; readonly y: number }[]
      readonly entities?: readonly string[]
      readonly ms: number
    }
  /** Move the player left and right under the lowest visible copy of these entities, holding `fire` if given. */
  | {
      readonly kind: 'chase'
      readonly player: string
      readonly entities: readonly string[]
      readonly ms: number
      readonly fire?: string
    }
  /** Set a stage variable in the running game, to isolate the behavior under test (for example keep lives up). */
  | { readonly kind: 'set'; readonly variable: string; readonly value: number }
  | { readonly kind: 'mark'; readonly name: string }
  /** Wait until the subject reaches a value, for at most `ms`; the expectation that follows reports a miss. */
  | {
      readonly kind: 'until'
      readonly subject: Subject
      readonly op: '>' | '<' | '=='
      readonly value: number
      readonly ms: number
    }
  | Expectation
  | BotStep

export interface SpecScenario {
  readonly name: string
  /** Leave the instructions card up; by default the runner dismisses it before the first step. */
  readonly keepIntro?: boolean
  readonly steps: readonly ScenarioStep[]
}

const KEY = { right: 'ArrowRight', left: 'ArrowLeft', up: 'ArrowUp', down: 'ArrowDown' } as const

const score = { variable: SPEC_NAMES.score } as const
const lives = { variable: SPEC_NAMES.lives } as const

/**
 * Scenarios that check what behaviors do to the score, lives and timer. Copies made by clones are not visible to
 * the state capture, so these check effects rather than positions.
 * @param spec - Normalized spec.
 * @param cells - Map cells per entity.
 * @returns Effect scenarios, possibly empty.
 */
const effectScenarios = (spec: GameSpec, cells: Map<string, { row: number; column: number }[]>): SpecScenario[] => {
  const scenarios: SpecScenario[] = []
  const player = findPlayer(spec)
  const with_ = (...names: string[]) =>
    spec.entities.filter((entity) => names.every((name) => entity.behaviors.some((item) => item.name === name)))
  const sideways = player ? playerBehavior(player) : undefined
  const canSweep = sideways !== undefined && !(sideways.name === 'topdown' && sideways.params.axis === 'vertical')

  const falling = with_('faller', 'collectible')
  if (player && canSweep && falling.length > 0)
    scenarios.push({
      name: '接住掉落物',
      steps: [
        { kind: 'wait', ms: 500 },
        // The bot only chases what it should catch and dodges nothing; keep lives up so the run measures catching
        // rather than how fast the game ends.
        { kind: 'set', variable: SPEC_NAMES.lives, value: 99 },
        { kind: 'mark', name: 'catch' },
        { kind: 'chase', player: player.name, entities: falling.map((entity) => entity.name), ms: 10000 },
        {
          kind: 'expect',
          label: `左右移動能接到「${falling[0].name}」而得分（測試時生命暫設 99）`,
          subject: score,
          op: '>',
          from: { mark: 'catch' },
          hint: `「${falling[0].name}」沒有掉下來，或玩家碰到它也不會得分。`,
        },
      ],
    })

  const shot = with_('target')
  const bullet = spec.entities.find((entity) => entity.behaviors.some((item) => item.name === 'projectile'))
  const fireWith = bullet?.behaviors.find((item) => item.name === 'projectile')
  if (player && canSweep && bullet && fireWith?.name === 'projectile' && shot.length > 0) {
    const fire =
      {
        space: ' ',
        'up arrow': 'ArrowUp',
        'down arrow': 'ArrowDown',
        'left arrow': 'ArrowLeft',
        'right arrow': 'ArrowRight',
      }[fireWith.params.key] ?? fireWith.params.key
    scenarios.push({
      name: '射擊',
      steps: [
        { kind: 'wait', ms: 500 },
        { kind: 'set', variable: SPEC_NAMES.lives, value: 99 },
        { kind: 'mark', name: 'shoot' },
        { kind: 'chase', player: player.name, entities: shot.map((entity) => entity.name), ms: 10000, fire },
        {
          kind: 'expect',
          label: `發射「${bullet.name}」能打中「${shot[0].name}」而得分（測試時生命暫設 99）`,
          subject: score,
          op: '>',
          from: { mark: 'shoot' },
          hint: `按發射鍵沒有打中「${shot[0].name}」：檢查子彈方向是否朝向目標。`,
        },
      ],
    })
  }

  const missRule = spec.rules.find(
    (rule) => rule.when.kind === 'miss' && rule.actions.some((action) => action.kind === 'lives' && action.delta < 0),
  )
  if (missRule?.when.kind === 'miss')
    scenarios.push({
      name: '漏接扣命',
      steps: [
        { kind: 'wait', ms: 300 },
        { kind: 'mark', name: 'miss' },
        { kind: 'wait', ms: 9000 },
        {
          kind: 'expect',
          label: `漏掉「${missRule.when.entity}」會扣命`,
          subject: lives,
          op: '<',
          from: { mark: 'miss' },
          hint: `「${missRule.when.entity}」掉出舞台時沒有扣命。`,
        },
      ],
    })

  const clickable = with_('clickable')
  if (clickable.length > 0) {
    const placed = clickable.flatMap((entity) =>
      (cells.get(entity.name) ?? []).map((cell) => cellCenter(cell.row, cell.column, spec.map.length)),
    )
    scenarios.push({
      name: '點擊得分',
      steps: [
        { kind: 'wait', ms: 500 },
        { kind: 'mark', name: 'click' },
        placed.length > 0
          ? { kind: 'clicks', points: placed, ms: 8000 }
          : { kind: 'clicks', entities: clickable.map((entity) => entity.name), ms: 8000 },
        {
          kind: 'expect',
          label: `點到「${clickable[0].name}」會得分`,
          subject: score,
          op: '>',
          from: { mark: 'click' },
          hint: `點擊「${clickable[0].name}」沒有得分：它可能沒有出現，或出現的時間太短。`,
        },
      ],
    })
  }

  if (spec.timeLimit !== undefined)
    scenarios.push({
      name: '倒數計時',
      steps: [
        { kind: 'wait', ms: 300 },
        { kind: 'mark', name: 'time' },
        { kind: 'wait', ms: 2500 },
        {
          kind: 'expect',
          label: '時間會倒數',
          subject: { variable: SPEC_NAMES.time },
          op: '<',
          from: { mark: 'time' },
          hint: '畫面上的時間沒有減少。',
        },
      ],
    })
  return scenarios
}

export const createSpecScenarios = (spec: GameSpec): SpecScenario[] => [
  ...flowScenarios(spec),
  ...singleLevelScenarios(levelView(spec, 0)),
]

const singleLevelScenarios = (spec: GameSpec): SpecScenario[] => {
  const cells = entityCells(spec)
  const scenarios: SpecScenario[] = [...effectScenarios(spec, cells)]
  const player = findPlayer(spec)
  if (!player) return scenarios
  const movement = playerBehavior(player)
  if (!movement) return scenarios
  const start = cells.get(player.name)?.[0]
  if (!start) return scenarios
  const wall = stageWall(spec)
  const p = player.name
  const x = { sprite: p, field: 'x' } as const
  const y = { sprite: p, field: 'y' } as const

  // ---------- controls ----------
  const controls: ScenarioStep[] = [{ kind: 'wait', ms: 800 }]
  if (movement.name === 'platformer') {
    controls.push({
      kind: 'expect',
      label: '開場站在地面上',
      subject: { variable: 'onGround', target: p },
      op: '==',
      value: 1,
      hint: `「${p}」開場沒有站穩：檢查它下方是否有牆（#），或它是否卡在牆裡。`,
    })
    for (const [direction, dc] of [
      ['right', 1],
      ['left', -1],
    ] as const) {
      if (wall(start.row, start.column + dc)) continue
      // Measured while the key is still held, before the player can walk into an enemy and respawn.
      controls.push(
        { kind: 'mark', name: direction },
        { kind: 'press', keys: [KEY[direction]] },
        { kind: 'wait', ms: 250 },
        {
          kind: 'expect',
          label: `按${direction === 'right' ? '右' : '左'}鍵會移動`,
          subject: x,
          op: dc > 0 ? '>' : '<',
          from: { mark: direction, plus: dc * 10 },
          hint: `按方向鍵時「${p}」沒有移動：旁邊可能是牆，或速度太低。`,
        },
        { kind: 'release', keys: [KEY[direction]] },
        { kind: 'wait', ms: 600 },
      )
    }
    controls.push(
      { kind: 'mark', name: 'jump' },
      { kind: 'hold', keys: [KEY.up], ms: 120 },
      {
        kind: 'expect',
        label: '按上鍵會跳起來',
        subject: y,
        op: '>',
        from: { mark: 'jump', plus: 8 },
        hint: `「${p}」跳不起來：頭上可能緊貼著牆。`,
      },
      { kind: 'wait', ms: 1600 },
      {
        kind: 'expect',
        label: '跳完會落地站穩（不穿過地面）',
        subject: { variable: 'onGround', target: p },
        op: '==',
        value: 1,
        hint: `「${p}」跳起後沒有站回地面：可能掉出地圖或卡在牆裡。`,
      },
    )
  } else {
    const directions = [
      ['right', 0, 1, x, 1],
      ['left', 0, -1, x, -1],
      ['up', -1, 0, y, 1],
      ['down', 1, 0, y, -1],
    ] as const
    const axis = movement.params.axis
    for (const [direction, dr, dc, subject, sign] of directions) {
      if ((axis === 'horizontal' && dr !== 0) || (axis === 'vertical' && dc !== 0)) continue
      const blocked = wall(start.row + dr, start.column + dc)
      controls.push(
        { kind: 'mark', name: direction },
        { kind: 'press', keys: [KEY[direction]] },
        { kind: 'wait', ms: 300 },
        blocked
          ? {
              kind: 'expect',
              label: `往${{ right: '右', left: '左', up: '上', down: '下' }[direction]}是牆，不能穿過`,
              subject,
              op: 'within',
              from: { mark: direction },
              tolerance: CELL / 2,
              hint: `「${p}」穿過了牆。`,
            }
          : {
              kind: 'expect',
              label: `按${{ right: '右', left: '左', up: '上', down: '下' }[direction]}鍵會移動`,
              subject,
              op: sign > 0 ? '>' : '<',
              from: { mark: direction, plus: sign * 8 },
              hint: `按方向鍵時「${p}」沒有移動。`,
            },
        { kind: 'release', keys: [KEY[direction]] },
        // Return toward the start so later directions are measured from the same cell.
        {
          kind: 'hold',
          keys: [KEY[{ right: 'left', left: 'right', up: 'down', down: 'up' }[direction] as keyof typeof KEY]],
          ms: blocked ? 0 : 300,
        },
        { kind: 'wait', ms: 200 },
      )
    }
  }
  scenarios.unshift({ name: '基本操作', steps: controls })

  // ---------- reach the goal ----------
  const reach = reachGoal(spec)
  if (reach)
    scenarios.push({
      name: '通關',
      steps: [
        { kind: 'wait', ms: 600 },
        reach.bot,
        {
          kind: 'expect',
          label: `自動玩家走到「${reach.goal}」並過關`,
          subject: { sprite: SPEC_NAMES.banner, field: 'visible' },
          op: '==',
          value: 1,
          hint: '自動玩家沒有過關：路線可能太難或被擋住（自動玩家很簡單，未過關不一定代表遊戲壞掉，請看軌跡）。',
        },
      ],
    })
  return scenarios
}

/**
 * A bot run from the player's start to the goal of a single-level view: a breadth-first path that avoids
 * hazards in top-down games, jumps over threats and pits in platformers.
 * @param spec - A single-level spec or level view.
 * @returns The bot step and the goal's name, or undefined when the level has no reachable goal.
 */
const reachGoal = (spec: GameSpec): { readonly goal: string; readonly bot: BotStep } | undefined => {
  const player = findPlayer(spec)
  const movement = player ? playerBehavior(player) : undefined
  const cells = entityCells(spec)
  const start = player ? cells.get(player.name)?.[0] : undefined
  const goalEntity = spec.entities.find(
    (entity) => entity.behaviors.some((item) => item.name === 'goal') && cells.has(entity.name),
  )
  const goalCell = goalEntity ? cells.get(goalEntity.name)?.[0] : undefined
  if (!player || !movement || !start || !goalEntity || !goalCell) return undefined
  const rows = spec.map.length
  const columns = [...spec.map[0]].length
  const wall = (row: number, column: number): boolean =>
    row < 0 || row >= rows || column < 0 || column >= columns || spec.wallChars.includes([...spec.map[row]][column])
  const goal = cellCenter(goalCell.row, goalCell.column, rows)
  if (movement.name === 'topdown') {
    const hazards = new Set(
      spec.entities
        .filter((entity) => entity.behaviors.some((item) => item.name === 'hazard'))
        .flatMap((entity) => (cells.get(entity.name) ?? []).map((cell) => `${cell.row},${cell.column}`)),
    )
    const previous = new Map<string, string>()
    const queue = [`${start.row},${start.column}`]
    const seen = new Set(queue)
    // for-of also visits entries pushed during the loop, which makes this a breadth-first search.
    for (const current of queue) {
      const [row, column] = current.split(',').map(Number)
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = `${row + dr},${column + dc}`
        if (wall(row + dr, column + dc) || seen.has(next) || hazards.has(next)) continue
        seen.add(next)
        previous.set(next, current)
        queue.push(next)
      }
    }
    const target = `${goalCell.row},${goalCell.column}`
    if (!seen.has(target)) return undefined
    const path: string[] = [target]
    while (path[0] !== `${start.row},${start.column}`) {
      const before = previous.get(path[0])
      if (!before) throw new Error(`reachGoal: no path step recorded before ${path[0]}`)
      path.unshift(before)
    }
    return {
      goal: goalEntity.name,
      bot: {
        kind: 'bot',
        mode: 'topdown',
        player: player.name,
        goal,
        path: path.map((text) => {
          const [row, column] = text.split(',').map(Number)
          return cellCenter(row, column, rows)
        }),
        timeoutMs: 30_000,
      },
    }
  }
  const threats = spec.entities
    .filter((entity) => entity.behaviors.some((item) => item.name === 'patrol' || item.name === 'hazard'))
    .map((entity) => entity.name)
  const pits: number[] = []
  for (let column = 0; column < columns; column += 1)
    if (!Array.from({ length: rows }, (_, row) => wall(row, column)).some(Boolean))
      pits.push(cellCenter(0, column, rows).x)
  return {
    goal: goalEntity.name,
    bot: { kind: 'bot', mode: 'platformer', player: player.name, goal, threats, pits, timeoutMs: 30_000 },
  }
}

/**
 * Steps that finish one level without playing it, when its win rule is a score or counter target the runner can set.
 * @param view - The level's view.
 * @param scoreBefore - Score at the start of the level; a level's score target counts from it.
 * @returns Steps, or undefined when the level is won another way.
 */
const finishBySetting = (view: GameSpec, scoreBefore = 0): ScenarioStep[] | undefined => {
  for (const rule of view.rules) {
    if (!rule.actions.some((action) => action.kind === 'win')) continue
    if (rule.when.kind === 'score-at-least')
      return [{ kind: 'set', variable: SPEC_NAMES.score, value: scoreBefore + rule.when.value }]
    if (rule.when.kind === 'compare') {
      const { op, value } = rule.when
      const wanted = op === '>' ? value + 1 : op === '<' ? value - 1 : value
      return [{ kind: 'set', variable: rule.when.variable, value: wanted }]
    }
  }
  return undefined
}

/**
 * Scenarios for the game flow around the levels: the opening card holds the game until it is dismissed, and a
 * multi-level game moves from one level to the next and ends on the win card.
 * @param spec - The whole game, with every level.
 * @returns The opening-card scenario, plus the level-change scenario for two-level games.
 */
const flowScenarios = (spec: GameSpec): SpecScenario[] => {
  const player = findPlayer(spec)
  const intro = { sprite: SPEC_NAMES.intro, field: 'visible' } as const
  const scenarios: SpecScenario[] = [
    {
      name: '開場說明',
      keepIntro: true,
      steps: [
        { kind: 'wait', ms: 800 },
        {
          kind: 'expect',
          label: '開場先顯示遊戲說明',
          subject: intro,
          op: '==',
          value: 1,
          hint: '開場說明沒有出現。',
        },
        ...(player
          ? [
              {
                kind: 'expect',
                label: '看說明時遊戲還沒開始',
                subject: { sprite: player.name, field: 'visible' },
                op: '==',
                value: 0,
                hint: '說明還在畫面上時，玩家角色就出現了。',
              } satisfies Expectation,
            ]
          : []),
        { kind: 'hold', keys: [' '], ms: 200 },
        { kind: 'wait', ms: 800 },
        {
          kind: 'expect',
          label: '按空白鍵後說明消失、遊戲開始',
          subject: intro,
          op: '==',
          value: 0,
          hint: '按空白鍵後說明沒有關閉。',
        },
      ],
    },
  ]
  if (spec.levels.length < 2) return scenarios

  // Each level's score target counts from the score the level started with.
  const firstTarget = finishBySetting(levelView(spec, 0))?.find((step) => step.kind === 'set')
  const scoreAfterFirst =
    firstTarget?.kind === 'set' && firstTarget.variable === SPEC_NAMES.score ? firstTarget.value : 0
  const finish = (index: number): ScenarioStep[] | undefined => {
    const view = levelView(spec, index)
    const setting = finishBySetting(view, index === 0 ? 0 : scoreAfterFirst)
    if (setting) return setting
    const reach = reachGoal(view)
    return reach ? [reach.bot] : undefined
  }
  const first = finish(0)
  if (!first) return scenarios
  const second = finish(1)
  const banner = { sprite: SPEC_NAMES.banner, field: 'visible' } as const
  scenarios.push({
    name: '換關',
    steps: [
      { kind: 'wait', ms: 600 },
      { kind: 'set', variable: SPEC_NAMES.lives, value: 99 },
      ...first,
      { kind: 'wait', ms: 3500 },
      {
        kind: 'expect',
        label: '第一關過關後進入第二關',
        subject: { variable: SPEC_NAMES.level },
        op: '==',
        value: 2,
        hint: '第一關過關後沒有進入第二關。',
      },
      {
        kind: 'expect',
        label: '第二關換成第二張地圖',
        subject: { sprite: SPEC_NAMES.walls, field: 'costume' },
        op: '==',
        value: 1,
        hint: '進入第二關後地圖沒有換。',
      },
      ...(second
        ? [
            { kind: 'set', variable: SPEC_NAMES.lives, value: 99 } satisfies ScenarioStep,
            ...second,
            { kind: 'wait', ms: 1000 } satisfies ScenarioStep,
            {
              kind: 'expect',
              label: '第二關過關後出現過關畫面',
              subject: banner,
              op: '==',
              value: 1,
              hint: '第二關過關後沒有出現過關畫面。',
            } satisfies Expectation,
            {
              kind: 'expect',
              label: '最後顯示的是「過關」而不是下一關',
              subject: { sprite: SPEC_NAMES.banner, field: 'costume' },
              op: '==',
              value: 0,
              hint: '最後一關過關後顯示的不是過關畫面。',
            } satisfies Expectation,
          ]
        : []),
    ],
  })
  return scenarios
}

/**
 * Whether the player is stopped at a cell. The map sits against the bottom and left edges of the stage, so cells
 * past those edges always stop the player; above or to the right of a map smaller than the stage is open stage,
 * not wall.
 * @param spec - A single-level view.
 * @returns Wall test by map row and column.
 */
const stageWall = (spec: GameSpec): ((row: number, column: number) => boolean) => {
  const rows = spec.map.length
  const columns = [...spec.map[0]].length
  return (row, column) =>
    row >= rows ||
    column < 0 ||
    (row < 0 && rows >= STAGE_ROWS) ||
    (column >= columns && columns >= STAGE_COLUMNS) ||
    (row >= 0 && column < columns && spec.wallChars.includes([...spec.map[row]][column]))
}
