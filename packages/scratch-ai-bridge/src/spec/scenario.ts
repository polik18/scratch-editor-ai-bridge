import { entityCells, findPlayer, playerBehavior, SPEC_NAMES } from './compile'
import { CELL, cellCenter } from './physics'
import type { GameSpec } from './types'

/**
 * Declarative playtest scenarios derived from a spec. Each behavior knows what it should do, so the scenarios are
 * generated, not written by the author; a runner (see `src/cli/scenario-runner.ts`) drives them in the real
 * Scratch preview and evaluates the expectations.
 */

export type Subject =
  | { readonly sprite: string; readonly field: 'x' | 'y' | 'visible' | 'costume' }
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
  | { readonly kind: 'mark'; readonly name: string }
  | Expectation
  | BotStep

export interface SpecScenario {
  readonly name: string
  readonly steps: readonly ScenarioStep[]
}

const KEY = { right: 'ArrowRight', left: 'ArrowLeft', up: 'ArrowUp', down: 'ArrowDown' } as const

export const createSpecScenarios = (spec: GameSpec): SpecScenario[] => {
  const player = findPlayer(spec)
  if (!player) return []
  const movement = playerBehavior(player)
  if (!movement) return []
  const cells = entityCells(spec)
  const start = cells.get(player.name)?.[0]
  if (!start) return []
  const rows = spec.map.length
  const columns = [...spec.map[0]].length
  const wall = (row: number, column: number): boolean =>
    row < 0 || row >= rows || column < 0 || column >= columns || spec.wallChars.includes([...spec.map[row]][column])
  const p = player.name
  const x = { sprite: p, field: 'x' } as const
  const y = { sprite: p, field: 'y' } as const
  const scenarios: SpecScenario[] = []

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
    for (const [direction, dr, dc, subject, sign] of directions) {
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
  scenarios.push({ name: '基本操作', steps: controls })

  // ---------- reach the goal ----------
  const goalEntity = spec.entities.find((entity) => entity.behaviors.some((item) => item.name === 'goal'))
  const goalCell = goalEntity ? cells.get(goalEntity.name)?.[0] : undefined
  if (goalEntity && goalCell) {
    const goal = cellCenter(goalCell.row, goalCell.column, rows)
    const expectWin: Expectation = {
      kind: 'expect',
      label: `自動玩家走到「${goalEntity.name}」並過關`,
      subject: { sprite: SPEC_NAMES.banner, field: 'visible' },
      op: '==',
      value: 1,
      hint: '自動玩家沒有過關：路線可能太難或被擋住（自動玩家很簡單，未過關不一定代表遊戲壞掉，請看軌跡）。',
    }
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
      if (seen.has(target)) {
        const path: string[] = [target]
        while (path[0] !== `${start.row},${start.column}`) {
          const before = previous.get(path[0])
          if (!before) throw new Error(`createSpecScenarios: no path step recorded before ${path[0]}`)
          path.unshift(before)
        }
        scenarios.push({
          name: '通關',
          steps: [
            { kind: 'wait', ms: 600 },
            {
              kind: 'bot',
              mode: 'topdown',
              player: p,
              goal,
              path: path.map((text) => {
                const [row, column] = text.split(',').map(Number)
                return cellCenter(row, column, rows)
              }),
              timeoutMs: 30_000,
            },
            expectWin,
          ],
        })
      }
    } else {
      const threats = spec.entities
        .filter((entity) => entity.behaviors.some((item) => item.name === 'patrol' || item.name === 'hazard'))
        .map((entity) => entity.name)
      const pits: number[] = []
      for (let column = 0; column < columns; column += 1)
        if (!Array.from({ length: rows }, (_, row) => wall(row, column)).some(Boolean))
          pits.push(cellCenter(0, column, rows).x)
      scenarios.push({
        name: '通關',
        steps: [
          { kind: 'wait', ms: 600 },
          { kind: 'bot', mode: 'platformer', player: p, goal, threats, pits, timeoutMs: 30_000 },
          expectWin,
        ],
      })
    }
  }
  return scenarios
}
