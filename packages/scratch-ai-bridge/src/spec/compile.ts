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
  broadcastAndWait,
  divide,
  mouseDown,
  gotoSprite,
  keyPressed,
  moveSteps,
  propertyOf,
  random,
  resetTimer,
  timer,
  whenClicked,
} from './blocks'
import { INSTRUCTION_LINE_CHARS, levelView } from './levels'
import { backdropCostume, bannerCostumes, introCostume, lookCostumes, narratorCostume, wallCostume } from './looks'
import {
  CELL,
  FALL_SPEED,
  FRICTION,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_FALL,
  PATROL_SPEED,
  PROJECTILE_SPEED,
  RUN_ACCELERATION,
  STEP_UP,
  WALK_SPEED,
  cellCenter,
} from './physics'
import type { BehaviorUse, Direction, GameSpec, RuleAction, SpecEntity } from './types'

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
  narrator: '_Narrator',
  tick: 'player tick',
  intro: '_Intro',
  level: '關卡',
  playing: '_playing',
  start: '_start',
  levelStart: '_level-start',
  levelDone: '_level-done',
  clear: '_clear',
  levelStartScore: '_levelStartScore',
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
 * @param spawn - Where the player returns to after losing a life.
 * @param spawn.x - Stage x, usually read from the player's per-level spawn list.
 * @param spawn.y - Stage y.
 * @returns Blocks run every physics tick.
 */
const damageBlocks = (spawn: { x: CanonicalBlock | number; y: CanonicalBlock | number }): CanonicalBlock[] => [
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
  const horizontal = params.axis !== 'vertical'
  const vertical = params.axis !== 'horizontal'
  return [
    ...(horizontal ? [step(['right arrow', 'd'], 'x', speed, 90), step(['left arrow', 'a'], 'x', -speed, -90)] : []),
    ...(vertical ? [step(['up arrow', 'w'], 'y', speed), step(['down arrow', 's'], 'y', -speed)] : []),
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
    case 'time':
      return [changeVar(N.time, action.delta)]
    case 'var':
      return [changeVar(action.name, action.delta)]
    case 'say':
      return [sayFor(action.text, 2)]
    case 'win':
      return [broadcast(N.levelDone)]
    case 'lose':
      return [broadcast(N.lose)]
  }
}

const anyOf = (conditions: CanonicalBlock[]): CanonicalBlock | undefined =>
  conditions.length === 0 ? undefined : conditions.reduce((left, right) => or(left, right))

/**
 * Stage edges a moving copy leaves through, with a little margin so it is out of sight.
 * @param direction - Way the copy travels.
 * @returns Condition that is true once the copy has left.
 */
const leftStage = (direction: Direction): CanonicalBlock =>
  direction === 'down'
    ? lt(yPos(), -170)
    : direction === 'up'
      ? gt(yPos(), 170)
      : direction === 'left'
        ? lt(xPos(), -230)
        : gt(xPos(), 230)

/**
 * Where a falling copy enters: a random point on the edge opposite its direction.
 * @param direction - Way the copy travels.
 * @returns Block that moves the original to the entry point before cloning.
 */
const enterStage = (direction: Direction): CanonicalBlock =>
  direction === 'down'
    ? gotoXY(random(-220, 220), 175)
    : direction === 'up'
      ? gotoXY(random(-220, 220), -175)
      : direction === 'left'
        ? gotoXY(235, random(-160, 160))
        : gotoXY(-235, random(-160, 160))

const step = (direction: Direction, amount: CanonicalBlock | number): CanonicalBlock =>
  direction === 'down'
    ? changeY(mul(amount, -1))
    : direction === 'up'
      ? changeY(amount)
      : direction === 'left'
        ? changeX(mul(amount, -1))
        : changeX(amount)

const DIRECTION_DEGREES: Record<Direction, number> = { up: 0, down: 180, left: -90, right: 90 }

export const compileGameSpec = (spec: GameSpec): CanonicalProject => {
  const player = findPlayer(spec)
  const movement = player ? playerBehavior(player) : undefined
  if (player && !movement) throw new Error(`compileGameSpec: player "${player.name}" has no movement behavior.`)
  const levels = spec.levels
  const multi = levels.length > 1
  const views = levels.map((_, index) => levelView(spec, index))
  // Every entity position over all levels, tagged with its level (1-based), so clones appear only in their level.
  const placed = (name: string): { x: number; y: number; level: number }[] =>
    views.flatMap((view, index) =>
      (entityCells(view).get(name) ?? []).map((cell) => ({
        ...cellCenter(cell.row, cell.column, view.map.length),
        level: index + 1,
      })),
    )
  const spawns = player
    ? views.map((view) => {
        const cell = entityCells(view).get(player.name)?.[0]
        return cell ? cellCenter(cell.row, cell.column, view.map.length) : { x: 0, y: 0 }
      })
    : []
  const spawn = spawns[0] ?? { x: 0, y: 0 }
  const isPlatformer = movement?.name === 'platformer'
  const broadcasts = new Set<string>([
    N.win,
    N.lose,
    N.start,
    N.levelStart,
    N.levelDone,
    N.clear,
    ...(spec.timeLimit === undefined ? [] : [N.timeUp]),
  ])
  const touchRules = new Set(
    levels.flatMap((level) => level.rules.flatMap((rule) => (rule.when.kind === 'touch' ? [rule.when.entity] : []))),
  )
  // Runs `body` only while level `index` (from 0) is being played; a single-level game needs no check.
  const inLevel = (index: number, body: CanonicalBlock[]): CanonicalBlock[] =>
    multi ? [ifThen(eq(variable(N.level), index + 1), ...body)] : body
  const levelSwitch = (make: (index: number) => CanonicalBlock[]): CanonicalBlock[] =>
    multi ? levels.map((_, index) => ifThen(eq(variable(N.level), index + 1), ...make(index))) : make(0)
  const has =
    (name: BehaviorUse['name']) =>
    (entity: SpecEntity): boolean =>
      entity.behaviors.some((item) => item.name === name)
  const projectiles = spec.entities.filter(has('projectile')).map((entity) => entity.name)
  const targets = spec.entities.filter(has('target')).map((entity) => entity.name)

  // ---------- rules live on the player, or on a narrator sprite in games without one ----------
  const ruleScripts: CanonicalScript[] = levels.flatMap((level, index) =>
    level.rules.map((rule) => ruleScript(rule, index)),
  )
  function ruleScript(rule: GameSpec['rules'][number], index: number): CanonicalScript {
    const body = rule.actions.flatMap(actionBlocks)
    const atStart = (...blocks: CanonicalBlock[]): CanonicalScript =>
      script(whenReceive(N.levelStart), ...inLevel(index, [wait(0.1), ...blocks]))
    switch (rule.when.kind) {
      case 'start':
        return atStart(...body)
      case 'score-at-least':
        // In a two-level game each level's target counts the points earned in that level.
        return atStart(
          waitUntil(
            gt(multi ? sub(variable(N.score), variable(N.levelStartScore)) : variable(N.score), rule.when.value - 1),
          ),
          ...body,
        )
      case 'time-up':
        return script(whenReceive(N.timeUp), ...inLevel(index, body))
      case 'every':
        return atStart(forever(wait(rule.when.seconds), ...body))
      case 'compare': {
        const value = variable(rule.when.variable)
        const target = rule.when.value
        const condition =
          rule.when.op === '>='
            ? not(lt(value, target))
            : rule.when.op === '<='
              ? not(gt(value, target))
              : rule.when.op === '>'
                ? gt(value, target)
                : rule.when.op === '<'
                  ? lt(value, target)
                  : eq(value, target)
        return atStart(waitUntil(condition), ...body)
      }
      default: {
        const message = `${rule.when.kind}:${rule.when.entity}`
        broadcasts.add(message)
        return script(whenReceive(message), ...inLevel(index, body))
      }
    }
  }
  // Rules wait on conditions; leaving a level stops them, and the next level start runs its own set again.
  const leaveLevel = script(whenReceive(N.clear), stop('other scripts in sprite'), hide())

  const host: CanonicalSprite =
    player && movement
      ? sprite(player.name, {
          costumes: lookCostumes(player.look, player.color),
          x: spawn.x,
          y: spawn.y,
          rotationStyle: 'left-right',
          visible: false,
          variables: [
            { name: 'vx', value: 0 },
            { name: 'onGround', value: 0 },
            { name: 'invincible', value: 0 },
            { name: '_offset', value: 0 },
            { name: '_adjust', value: 0 },
          ],
          lists: [
            { name: '_sx', value: spawns.map((point) => point.x) },
            { name: '_sy', value: spawns.map((point) => point.y) },
          ],
          procedures: [
            {
              name: N.tick,
              parameters: [],
              warp: true,
              body: [
                ...(movement.name === 'platformer' ? platformerTick(movement.params) : topdownTick(movement.params)),
                setVar(N.playerY, yPos()),
                ...damageBlocks({ x: itemOf(variable(N.level), '_sx'), y: itemOf(variable(N.level), '_sy') }),
              ],
            },
          ],
          scripts: [
            script(whenFlag(), hide()),
            script(
              whenReceive(N.levelStart),
              pointIn(90),
              gotoXY(itemOf(variable(N.level), '_sx'), itemOf(variable(N.level), '_sy')),
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
            leaveLevel,
            ...ruleScripts,
          ],
        })
      : sprite(N.narrator, {
          costumes: [narratorCostume()],
          x: 0,
          y: 150,
          scripts: [script(whenFlag(), gotoXY(0, 150), show()), leaveLevel, ...ruleScripts],
        })

  // ---------- other entities: a hidden original that clones itself onto map cells or stage edges ----------
  const entitySprites = spec.entities
    .filter((entity) => entity !== player)
    .map((entity): CanonicalSprite => {
      const fromEdges = has('faller')(entity) || has('projectile')(entity)
      const popsUp = has('popup')(entity)
      const positions = fromEdges ? [] : placed(entity.name)
      const originalScripts: CanonicalScript[] = []
      const cloneScripts: CanonicalScript[] = []
      const localVariables = [
        { name: '_i', value: 1 },
        { name: '_clone', value: 0 },
      ]
      const touchingPlayer = player ? touching(player.name) : undefined
      for (const use of entity.behaviors) {
        switch (use.name) {
          case 'collectible': {
            const message = `collect:${entity.name}`
            broadcasts.add(message)
            if (touchingPlayer)
              cloneScripts.push(
                script(
                  whenCloned(),
                  waitUntil(touchingPlayer),
                  changeVar(N.score, use.params.points),
                  broadcast(message),
                  deleteClone(),
                ),
              )
            break
          }
          case 'goal':
            if (touchingPlayer)
              cloneScripts.push(script(whenCloned(), waitUntil(touchingPlayer), broadcast(N.levelDone)))
            break
          case 'hazard':
            if (touchingPlayer)
              cloneScripts.push(
                script(whenCloned(), forever(waitUntil(touchingPlayer), setVar(N.hurt, 1), wait(0.1))),
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
                  ...(touchingPlayer ? [ifThen(touchingPlayer, ...onTouch)] : []),
                ),
              ),
            )
            break
          }
          case 'faller': {
            const message = `miss:${entity.name}`
            broadcasts.add(message)
            const base = FALL_SPEED[use.params.speed]
            // Speed grows by the base speed every 30 s of play when accelerating.
            const speed = use.params.accelerate ? mul(base, add(1, divide(timer(), 30))) : base
            originalScripts.push(
              script(
                whenReceive(N.levelStart),
                wait(0.5),
                forever(
                  enterStage(use.params.direction),
                  cloneSelf(),
                  wait(mul(use.params.interval, random(0.6, 1.4))),
                ),
              ),
            )
            cloneScripts.push(
              script(
                whenCloned(),
                repeatUntil(leftStage(use.params.direction), step(use.params.direction, speed)),
                broadcast(message),
                deleteClone(),
              ),
            )
            break
          }
          case 'projectile': {
            if (!player) break
            const direction =
              use.params.direction === 'facing'
                ? propertyOf('direction', player.name)
                : DIRECTION_DEGREES[use.params.direction]
            originalScripts.push(
              script(
                whenReceive(N.levelStart),
                forever(
                  waitUntil(keyPressed(use.params.key)),
                  gotoSprite(player.name),
                  pointIn(direction),
                  cloneSelf(),
                  wait(0.25),
                ),
              ),
            )
            const offStage = or(or(gt(xPos(), 235), lt(xPos(), -235)), or(gt(yPos(), 175), lt(yPos(), -175)))
            const hitTarget = anyOf(targets.map(touching))
            cloneScripts.push(
              script(
                whenCloned(),
                show(),
                repeatUntil(
                  hitTarget ? or(offStage, hitTarget) : offStage,
                  moveSteps(PROJECTILE_SPEED[use.params.speed]),
                ),
                // Stay one more frame so the target also sees the hit.
                wait(0.05),
                deleteClone(),
              ),
            )
            break
          }
          case 'target': {
            const hitBy = anyOf(projectiles.map(touching))
            if (!hitBy) break
            const message = `hit:${entity.name}`
            broadcasts.add(message)
            cloneScripts.push(
              script(
                whenCloned(),
                waitUntil(hitBy),
                changeVar(N.score, use.params.points),
                broadcast(message),
                deleteClone(),
              ),
            )
            break
          }
          case 'clickable': {
            const message = `click:${entity.name}`
            broadcasts.add(message)
            cloneScripts.push(
              script(
                whenClicked(),
                changeVar(N.score, use.params.points),
                broadcast(message),
                popsUp ? hide() : deleteClone(),
              ),
            )
            break
          }
          case 'popup':
            cloneScripts.push(
              script(whenCloned(), hide(), forever(wait(random(0.5, 2.5)), show(), wait(use.params.stay), hide())),
            )
            break
          case 'platformer':
          case 'topdown':
            break
        }
      }
      if (touchingPlayer && touchRules.has(entity.name)) {
        const message = `touch:${entity.name}`
        broadcasts.add(message)
        cloneScripts.push(
          script(
            whenCloned(),
            forever(waitUntil(touchingPlayer), broadcast(message), waitUntil(not(touchingPlayer))),
          ),
        )
      }
      const showsOnClone = !popsUp && !has('projectile')(entity)
      return sprite(entity.name, {
        costumes: lookCostumes(entity.look, entity.color),
        visible: false,
        variables: localVariables,
        lists: [
          { name: '_x', value: positions.map((position) => position.x) },
          { name: '_y', value: positions.map((position) => position.y) },
          { name: '_lv', value: positions.map((position) => position.level) },
        ],
        scripts: [
          script(whenFlag(), hide(), setVar('_clone', 0)),
          script(
            whenReceive(N.levelStart),
            hide(),
            setVar('_i', 1),
            repeat(
              lengthOf('_x'),
              ifThen(
                eq(itemOf(variable('_i'), '_lv'), variable(N.level)),
                gotoXY(itemOf(variable('_i'), '_x'), itemOf(variable('_i'), '_y')),
                cloneSelf(),
              ),
              changeVar('_i', 1),
            ),
          ),
          script(whenCloned(), setVar('_clone', 1)),
          // Leaving a level removes this level's copies and stops the original's spawners.
          script(
            whenReceive(N.clear),
            ifElse(eq(variable('_clone'), 1), [deleteClone()], [stop('other scripts in sprite'), hide()]),
          ),
          ...originalScripts,
          ...(showsOnClone ? [script(whenCloned(), show())] : []),
          ...cloneScripts,
        ],
      })
    })

  const walls = sprite(N.walls, {
    costumes: levels.map((level, index) => ({
      ...wallCostume(level.map, level.wallChars, isPlatformer ? 'ground' : 'stone'),
      name: `level-${index + 1}`,
    })),
    visible: false,
    scripts: [
      script(whenFlag(), hide(), gotoXY(0, 0)),
      script(whenReceive(N.levelStart), ...levelSwitch((index) => [costume(`level-${index + 1}`)]), show()),
    ],
  })
  // Between levels: clear the finished one, show the next level's card, then start it. The last level wins.
  const nextLevel: CanonicalBlock[] = multi
    ? [
        broadcastAndWait(N.clear),
        ...levelSwitch((index) => (index + 1 < levels.length ? [costume(`level-${index + 2}`)] : [])),
        show(),
        toFront(),
        wait(2),
        hide(),
        changeVar(N.level, 1),
        broadcast(N.levelStart),
      ]
    : []
  const banner = sprite(N.banner, {
    costumes: bannerCostumes(levels.map((level) => level.name)),
    visible: false,
    y: 40,
    scripts: [
      script(whenFlag(), hide(), gotoXY(0, 40)),
      script(whenReceive(N.win), costume('win'), show(), toFront(), wait(0.3), stop('all')),
      script(whenReceive(N.lose), costume('lose'), show(), toFront(), wait(0.3), stop('all')),
      script(
        whenReceive(N.levelDone),
        // A goal touched for several frames sends this more than once; only the first one counts.
        ifThen(
          eq(variable(N.playing), 1),
          setVar(N.playing, 0),
          ...(multi
            ? [ifElse(lt(variable(N.level), levels.length), nextLevel, [broadcast(N.win)])]
            : [broadcast(N.win)]),
        ),
      ),
    ],
  })
  const intro = sprite(N.intro, {
    costumes: [introCostume(spec.title, spec.instructions, INSTRUCTION_LINE_CHARS)],
    scripts: [
      script(
        whenFlag(),
        gotoXY(0, 0),
        show(),
        toFront(),
        // Wait for the key or click to be let go first, so the press that started the game is not also a move.
        waitUntil(or(keyPressed('space'), mouseDown())),
        waitUntil(not(or(keyPressed('space'), mouseDown()))),
        hide(),
        broadcast(N.start),
      ),
    ],
  })

  const internals = [N.hurt, N.bounce, N.playerVy, N.playerY, N.playing, N.levelStartScore]
  const shownCounters = [
    N.score,
    N.lives,
    ...(spec.timeLimit === undefined ? [] : [N.time]),
    ...Object.keys(spec.variables),
    ...(multi ? [N.level] : []),
  ]
  const stage: CanonicalStage = {
    kind: 'stage',
    name: 'Stage',
    variables: [
      { name: N.score, value: 0 },
      { name: N.lives, value: spec.lives },
      { name: N.level, value: 1 },
      ...(spec.timeLimit === undefined ? [] : [{ name: N.time, value: spec.timeLimit }]),
      ...Object.entries(spec.variables).map(([name, value]) => ({ name, value })),
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
        setVar(N.level, 1),
        ...(spec.timeLimit === undefined ? [] : [setVar(N.time, spec.timeLimit)]),
        ...internals.map((name) => setVar(name, 0)),
        ...Object.entries(spec.variables).map(([name, value]) => setVar(name, value)),
        // Counters stay hidden behind the opening card and appear when play starts.
        ...shownCounters.map(hideVar),
        ...internals.map(hideVar),
        ...(multi ? [] : [hideVar(N.level)]),
      ),
      script(
        whenReceive(N.start),
        resetTimer(),
        ...shownCounters.map(showVar),
        setVar(N.level, 1),
        broadcast(N.levelStart),
      ),
      script(whenReceive(N.levelStart), setVar(N.levelStartScore, variable(N.score)), setVar(N.playing, 1)),
      ...(spec.timeLimit === undefined
        ? []
        : [
            script(
              whenReceive(N.start),
              setVar(N.time, spec.timeLimit),
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
    sprites: [walls, ...entitySprites, host, banner, intro],
    broadcasts: [...broadcasts].map((name) => ({ name })),
  }
}
