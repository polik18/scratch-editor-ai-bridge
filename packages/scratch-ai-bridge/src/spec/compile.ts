import type {
  CanonicalBlock,
  CanonicalProject,
  CanonicalScript,
  CanonicalSprite,
  CanonicalStage,
} from '../core/ir/types'
import {
  and,
  broadcast,
  call,
  changeVar,
  changeX,
  changeY,
  cloneSelf,
  costume,
  deleteClone,
  eq,
  forever,
  ghost,
  gotoXY,
  gt,
  hide,
  hideVar,
  ifElse,
  ifThen,
  itemOf,
  lengthOf,
  lt,
  mod,
  mul,
  not,
  or,
  pointIn,
  repeat,
  repeatUntil,
  sayFor,
  say,
  setVar,
  setX,
  setY,
  show,
  showVar,
  stop,
  sub,
  toFront,
  touching,
  variable,
  wait,
  waitUntil,
  whenCloned,
  whenFlag,
  whenReceive,
  xPos,
  yPos,
  add,
  anyKey,
} from './blocks'
import { backdropCostume, bannerCostumes, lookCostumes, wallCostume } from './looks'
import {
  CELL,
  FRICTION,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_FALL,
  PATROL_SPEED,
  RUN_ACCELERATION,
  STEP_UP,
  WALK_SPEED,
  cellCenter,
} from './physics'
import type { BehaviorUse, GameSpec, RuleAction, SpecEntity } from './types'

/** Names shared by generated scripts. Leading underscores keep them apart from author-chosen names. */
export const SPEC_NAMES = {
  walls: '_Walls',
  banner: '_Banner',
  score: '分數',
  lives: '生命',
  hurt: '_hurt',
  bounce: '_bounce',
  playerVy: '_playerVy',
  playerY: '_playerY',
  win: '_win',
  lose: '_lose',
  time: '時間',
  timeUp: 'time-up',
  tick: 'player tick',
} as const

const N = SPEC_NAMES

export type PlayerBehavior = Extract<BehaviorUse, { name: 'platformer' | 'topdown' }>

const isPlayerBehavior = (item: BehaviorUse): item is PlayerBehavior =>
  item.name === 'platformer' || item.name === 'topdown'

export const playerBehavior = (entity: SpecEntity): PlayerBehavior | undefined =>
  entity.behaviors.find(isPlayerBehavior)

export const findPlayer = (spec: GameSpec): SpecEntity | undefined => spec.entities.find(playerBehavior)

/**
 * Map cells holding each entity, in reading order.
 * @param spec - Normalized spec.
 * @returns Entity name → map cells, in reading order.
 */
export const entityCells = (spec: GameSpec): Map<string, { row: number; column: number }[]> => {
  const cells = new Map<string, { row: number; column: number }[]>()
  spec.map.forEach((line, row) =>
    [...line].forEach((char, column) => {
      const name = spec.legend[char]
      if (!name) return
      cells.set(name, [...(cells.get(name) ?? []), { row, column }])
    }),
  )
  return cells
}

const sprite = (
  name: string,
  fields: Partial<CanonicalSprite> & Pick<CanonicalSprite, 'costumes' | 'scripts'>,
): CanonicalSprite => ({
  kind: 'sprite',
  name,
  variables: [],
  lists: [],
  sounds: [],
  procedures: [],
  x: 0,
  y: 0,
  direction: 90,
  size: 100,
  visible: true,
  draggable: false,
  rotationStyle: "don't rotate",
  ...fields,
})

const script = (...blocks: CanonicalBlock[]): CanonicalScript => ({ blocks })

/**
 * Damage, respawn and blinking, shared by every player movement behavior.
 * @param spawn - Stage position the player returns to after losing a life.
 * @param spawn.x - Stage x.
 * @param spawn.y - Stage y.
 * @returns Blocks run every physics tick.
 */
const damageBlocks = (spawn: { x: number; y: number }): CanonicalBlock[] => [
  ifThen(
    eq(variable(N.hurt), 1),
    setVar(N.hurt, 0),
    ifThen(
      eq(variable('invincible'), 0),
      changeVar(N.lives, -1),
      ifElse(
        lt(variable(N.lives), 1),
        [broadcast(N.lose)],
        [gotoXY(spawn.x, spawn.y), setVar(N.playerVy, 0), setVar('vx', 0), setVar('invincible', 45)],
      ),
    ),
  ),
  ifElse(
    gt(variable('invincible'), 0),
    [changeVar('invincible', -1), ifElse(lt(mod(variable('invincible'), 6), 3), [ghost(70)], [ghost(0)])],
    [ghost(0)],
  ),
]

const platformerTick = (params: Extract<BehaviorUse, { name: 'platformer' }>['params']): CanonicalBlock[] => [
  ifThen(anyKey('right arrow', 'd'), changeVar('vx', RUN_ACCELERATION[params.speed]), pointIn(90)),
  ifThen(anyKey('left arrow', 'a'), changeVar('vx', -RUN_ACCELERATION[params.speed]), pointIn(-90)),
  setVar('vx', mul(variable('vx'), FRICTION)),
  changeX(variable('vx')),
  // Resting contact with the floor reads as touching, so first try stepping up a little (also climbs small
  // ledges); only a real wall undoes the move, before the vertical step could push the player through it.
  ifThen(
    touching(N.walls),
    changeY(STEP_UP),
    ifThen(touching(N.walls), changeY(-STEP_UP), changeX(mul(variable('vx'), -1)), setVar('vx', 0)),
  ),
  ifThen(lt(xPos(), -232), setX(-232)),
  ifThen(gt(xPos(), 232), setX(232)),
  changeVar(N.playerVy, -GRAVITY),
  ifThen(lt(variable(N.playerVy), -MAX_FALL), setVar(N.playerVy, -MAX_FALL)),
  changeY(variable(N.playerVy)),
  setVar('onGround', 0),
  ifThen(
    touching(N.walls),
    ifElse(
      lt(variable(N.playerVy), 0),
      [repeatUntil(not(touching(N.walls)), changeY(1)), setVar('onGround', 1)],
      [repeatUntil(not(touching(N.walls)), changeY(-1))],
    ),
    setVar(N.playerVy, 0),
  ),
  ifThen(
    and(anyKey('up arrow', 'w', 'space'), eq(variable('onGround'), 1)),
    setVar(N.playerVy, JUMP_VELOCITY[params.jump]),
  ),
  ifThen(eq(variable(N.bounce), 1), setVar(N.bounce, 0), setVar(N.playerVy, 10)),
  // Falling off the stage always costs a life, even while blinking.
  ifThen(lt(yPos(), -170), setVar('invincible', 0), setVar(N.hurt, 1)),
]

/** Pixels a blocked top-down move may slide sideways to line up with a corridor. */
const CORNER_ASSIST = 8

const topdownTick = (params: Extract<BehaviorUse, { name: 'topdown' }>['params']): CanonicalBlock[] => {
  const speed = WALK_SPEED[params.speed]
  // Column centres sit at x ≡ CELL/2 - 240 and row centres at y ≡ 0 (mod CELL); see cellCenter.
  const offset = (axis: 'x' | 'y'): CanonicalBlock =>
    axis === 'x' ? mod(add(xPos(), 240 - CELL / 2), CELL) : mod(yPos(), CELL)
  const move = (axis: 'x' | 'y', delta: number): CanonicalBlock => (axis === 'x' ? changeX(delta) : changeY(delta))
  const nudge = (axis: 'x' | 'y', amount: CanonicalBlock | ReturnType<typeof variable>): CanonicalBlock =>
    axis === 'x' ? changeX(amount) : changeY(amount)
  const step = (keys: string[], axis: 'x' | 'y', delta: number, direction?: number): CanonicalBlock => {
    const other = axis === 'x' ? 'y' : 'x'
    return ifThen(
      anyKey(...keys),
      ...(direction === undefined ? [] : [pointIn(direction)]),
      move(axis, delta),
      ifThen(
        touching(N.walls),
        move(axis, -delta),
        // Corner assist: line up with the nearest corridor when only a few pixels off, then retry once.
        setVar('_offset', offset(other)),
        setVar('_adjust', 0),
        ifThen(lt(variable('_offset'), CORNER_ASSIST + 1), setVar('_adjust', mul(variable('_offset'), -1))),
        ifThen(gt(variable('_offset'), CELL - CORNER_ASSIST - 1), setVar('_adjust', sub(CELL, variable('_offset')))),
        nudge(other, variable('_adjust')),
        move(axis, delta),
        ifThen(touching(N.walls), move(axis, -delta), nudge(other, mul(variable('_adjust'), -1))),
      ),
    )
  }
  return [
    step(['right arrow', 'd'], 'x', speed, 90),
    step(['left arrow', 'a'], 'x', -speed, -90),
    step(['up arrow', 'w'], 'y', speed),
    step(['down arrow', 's'], 'y', -speed),
    ifThen(lt(xPos(), -232), setX(-232)),
    ifThen(gt(xPos(), 232), setX(232)),
    ifThen(lt(yPos(), -172), setY(-172)),
    ifThen(gt(yPos(), 172), setY(172)),
    setVar('onGround', 1),
  ]
}

const actionBlocks = (action: RuleAction): CanonicalBlock[] => {
  switch (action.kind) {
    case 'score':
      return [changeVar(N.score, action.delta)]
    case 'lives':
      return [changeVar(N.lives, action.delta), ifThen(lt(variable(N.lives), 1), broadcast(N.lose))]
    case 'say':
      return [sayFor(action.text, 2)]
    case 'win':
      return [broadcast(N.win)]
    case 'lose':
      return [broadcast(N.lose)]
  }
}

export const compileGameSpec = (spec: GameSpec): CanonicalProject => {
  const player = findPlayer(spec)
  if (!player)
    throw new Error('compileGameSpec: spec has no player entity; normalizeGameSpec reports NO_PLAYER first.')
  const movement = playerBehavior(player)
  if (!movement) throw new Error(`compileGameSpec: player "${player.name}" has no movement behavior.`)
  const cells = entityCells(spec)
  const center = (cell: { row: number; column: number }): { x: number; y: number } =>
    cellCenter(cell.row, cell.column, spec.map.length)
  const playerCell = cells.get(player.name)?.[0]
  const spawn = playerCell ? center(playerCell) : { x: 0, y: 0 }
  const isPlatformer = movement.name === 'platformer'
  const broadcasts = new Set<string>([N.win, N.lose, ...(spec.timeLimit === undefined ? [] : [N.timeUp])])
  const touchRules = new Set(spec.rules.flatMap((rule) => (rule.when.kind === 'touch' ? [rule.when.entity] : [])))

  // ---------- player ----------
  const tick = [
    ...(movement.name === 'platformer' ? platformerTick(movement.params) : topdownTick(movement.params)),
    setVar(N.playerY, yPos()),
    ...damageBlocks(spawn),
  ]
  const ruleScripts: CanonicalScript[] = spec.rules.map((rule) => {
    const body = rule.actions.flatMap(actionBlocks)
    switch (rule.when.kind) {
      case 'start':
        return script(whenFlag(), wait(0.1), ...body)
      case 'score-at-least':
        return script(whenFlag(), wait(0.1), waitUntil(gt(variable(N.score), rule.when.value - 1)), ...body)
      case 'time-up':
        return script(whenReceive(N.timeUp), ...body)
      default: {
        const message = `${rule.when.kind}:${rule.when.entity}`
        broadcasts.add(message)
        return script(whenReceive(message), ...body)
      }
    }
  })
  const playerSprite = sprite(player.name, {
    costumes: lookCostumes(player.look, player.color),
    x: spawn.x,
    y: spawn.y,
    rotationStyle: 'left-right',
    variables: [
      { name: 'vx', value: 0 },
      { name: 'onGround', value: 0 },
      { name: 'invincible', value: 0 },
      { name: '_offset', value: 0 },
      { name: '_adjust', value: 0 },
    ],
    procedures: [{ name: N.tick, parameters: [], warp: true, body: tick }],
    scripts: [
      script(
        whenFlag(),
        pointIn(90),
        gotoXY(spawn.x, spawn.y),
        setVar('vx', 0),
        setVar('onGround', 0),
        setVar('invincible', 0),
        ghost(0),
        show(),
        toFront(),
        forever(call(N.tick)),
      ),
      script(whenReceive(N.win), say('過關！'), stop('other scripts in sprite')),
      script(whenReceive(N.lose), say('哎呀…'), stop('other scripts in sprite')),
      ...ruleScripts,
    ],
  })

  // ---------- other entities: one hidden original that clones itself onto every map cell ----------
  const entitySprites = spec.entities
    .filter((entity) => entity !== player)
    .map((entity): CanonicalSprite => {
      const positions = (cells.get(entity.name) ?? []).map(center)
      const cloneScripts: CanonicalScript[] = []
      const localVariables = [{ name: '_i', value: 1 }]
      for (const use of entity.behaviors) {
        switch (use.name) {
          case 'collectible': {
            const message = `collect:${entity.name}`
            broadcasts.add(message)
            cloneScripts.push(
              script(
                whenCloned(),
                waitUntil(touching(player.name)),
                changeVar(N.score, use.params.points),
                broadcast(message),
                deleteClone(),
              ),
            )
            break
          }
          case 'goal':
            cloneScripts.push(script(whenCloned(), waitUntil(touching(player.name)), broadcast(N.win)))
            break
          case 'hazard':
            cloneScripts.push(
              script(whenCloned(), forever(waitUntil(touching(player.name)), setVar(N.hurt, 1), wait(0.1))),
            )
            break
          case 'patrol': {
            localVariables.push({ name: '_dir', value: 1 }, { name: '_home', value: 0 })
            const speed = PATROL_SPEED[use.params.speed]
            const stomp = `stomp:${entity.name}`
            const canStomp = use.params.stompable && isPlatformer
            if (canStomp) broadcasts.add(stomp)
            const onTouch = canStomp
              ? [
                  ifElse(
                    and(lt(variable(N.playerVy), 0), gt(variable(N.playerY), add(yPos(), 8))),
                    [
                      setVar(N.bounce, 1),
                      changeVar(N.score, use.params.points),
                      broadcast(stomp),
                      hide(),
                      deleteClone(),
                    ],
                    [setVar(N.hurt, 1)],
                  ),
                ]
              : [setVar(N.hurt, 1)]
            cloneScripts.push(
              script(
                whenCloned(),
                setVar('_home', xPos()),
                setVar('_dir', 1),
                forever(
                  changeX(mul(variable('_dir'), speed)),
                  ifThen(
                    or(
                      touching(N.walls),
                      gt(mul(sub(xPos(), variable('_home')), variable('_dir')), use.params.range * CELL),
                    ),
                    changeX(mul(variable('_dir'), -speed)),
                    setVar('_dir', mul(variable('_dir'), -1)),
                  ),
                  ifThen(touching(player.name), ...onTouch),
                ),
              ),
            )
            break
          }
          case 'platformer':
          case 'topdown':
            break
        }
      }
      if (touchRules.has(entity.name)) {
        const message = `touch:${entity.name}`
        broadcasts.add(message)
        cloneScripts.push(
          script(
            whenCloned(),
            forever(waitUntil(touching(player.name)), broadcast(message), waitUntil(not(touching(player.name)))),
          ),
        )
      }
      return sprite(entity.name, {
        costumes: lookCostumes(entity.look, entity.color),
        visible: false,
        variables: localVariables,
        lists: [
          { name: '_x', value: positions.map((position) => position.x) },
          { name: '_y', value: positions.map((position) => position.y) },
        ],
        scripts: [
          script(
            whenFlag(),
            hide(),
            setVar('_i', 1),
            repeat(
              lengthOf('_x'),
              gotoXY(itemOf(variable('_i'), '_x'), itemOf(variable('_i'), '_y')),
              cloneSelf(),
              changeVar('_i', 1),
            ),
          ),
          script(whenCloned(), show()),
          ...cloneScripts,
        ],
      })
    })

  const walls = sprite(N.walls, {
    costumes: [wallCostume(spec.map, spec.wallChars, isPlatformer ? 'ground' : 'stone')],
    scripts: [script(whenFlag(), gotoXY(0, 0), show())],
  })
  const banner = sprite(N.banner, {
    costumes: bannerCostumes(),
    visible: false,
    y: 40,
    scripts: [
      script(whenFlag(), hide(), gotoXY(0, 40)),
      script(whenReceive(N.win), costume('win'), show(), toFront(), wait(0.3), stop('all')),
      script(whenReceive(N.lose), costume('lose'), show(), toFront(), wait(0.3), stop('all')),
    ],
  })

  const internals = [N.hurt, N.bounce, N.playerVy, N.playerY]
  const stage: CanonicalStage = {
    kind: 'stage',
    name: 'Stage',
    variables: [
      { name: N.score, value: 0 },
      { name: N.lives, value: spec.lives },
      ...(spec.timeLimit === undefined ? [] : [{ name: N.time, value: spec.timeLimit }]),
      ...internals.map((name) => ({ name, value: 0 })),
    ],
    lists: [],
    costumes: [backdropCostume(isPlatformer ? 'sky' : 'grass')],
    sounds: [],
    procedures: [],
    scripts: [
      script(
        whenFlag(),
        setVar(N.score, 0),
        setVar(N.lives, spec.lives),
        ...internals.map((name) => setVar(name, 0)),
        showVar(N.score),
        showVar(N.lives),
        ...internals.map(hideVar),
      ),
      ...(spec.timeLimit === undefined
        ? []
        : [
            script(
              whenFlag(),
              setVar(N.time, spec.timeLimit),
              showVar(N.time),
              repeatUntil(lt(variable(N.time), 1), wait(1), changeVar(N.time, -1)),
              broadcast(N.timeUp),
            ),
          ]),
    ],
  }

  return {
    format: 'scratch-ai-bridge/canonical-ir',
    version: 1,
    name: spec.title,
    stage,
    sprites: [walls, ...entitySprites, playerSprite, banner],
    broadcasts: [...broadcasts].map((name) => ({ name })),
  }
}
