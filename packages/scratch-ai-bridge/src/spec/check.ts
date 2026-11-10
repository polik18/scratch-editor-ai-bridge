import { entityCells, findPlayer, playerBehavior } from './compile'
import { jumpReach } from './physics'
import type { GameSpec, SpecDiagnostic } from './types'

interface Cell {
  readonly row: number
  readonly column: number
}

const key = (cell: Cell): string => `${cell.row},${cell.column}`
const where = (cell: Cell): string => `地圖 第 ${cell.row + 1} 列第 ${cell.column + 1} 欄`

/**
 * Game-level checks that compile-time validation cannot see: can the player actually reach the goal and the
 * collectibles? Platformer reachability is an estimate (it ignores ceilings and moving enemies), so its findings
 * are warnings that name the cell and the parameter to change.
 * @param spec - Normalized spec.
 * @returns Warnings and errors that name a map cell and a concrete fix.
 */
export const checkGameSpec = (spec: GameSpec): SpecDiagnostic[] => {
  const diagnostics: SpecDiagnostic[] = []
  const player = findPlayer(spec)
  if (!player) return diagnostics
  const cells = entityCells(spec)
  const playerCells = cells.get(player.name) ?? []
  if (playerCells.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'PLAYER_NOT_PLACED',
      where: `角色.${player.name}`,
      message: `玩家「${player.name}」沒有畫在地圖上。`,
      suggestion: '在地圖上放一個代表玩家的符號。',
    })
    return diagnostics
  }
  if (playerCells.length > 1)
    diagnostics.push({
      severity: 'warning',
      code: 'PLAYER_PLACED_TWICE',
      where: where(playerCells[1]),
      message: `玩家「${player.name}」在地圖上出現 ${playerCells.length} 次，只會使用第一個位置。`,
      suggestion: '只留一個玩家符號。',
    })

  const rows = spec.map.length
  const columns = [...(spec.map[0] ?? '')].length
  const wall = (row: number, column: number): boolean =>
    row >= 0 && row < rows && column >= 0 && column < columns && spec.wallChars.includes([...spec.map[row]][column])
  const open = (row: number, column: number): boolean =>
    row >= 0 && row < rows && column >= 0 && column < columns && !wall(row, column)
  const movement = playerBehavior(player)
  if (!movement) return diagnostics
  const hazardNames = new Set(
    spec.entities
      .filter((entity) => entity.behaviors.some((item) => item.name === 'hazard'))
      .map((entity) => entity.name),
  )
  const hazardCells = new Set(
    [...cells.entries()].filter(([name]) => hazardNames.has(name)).flatMap(([, list]) => list.map(key)),
  )

  const reachable = new Set<string>()
  let reaches: (target: Cell) => boolean
  let advice: string

  if (movement.name === 'topdown') {
    const queue: Cell[] = [playerCells[0]]
    reachable.add(key(playerCells[0]))
    // for-of also visits entries pushed during the loop, which makes this a breadth-first search.
    for (const cell of queue) {
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = { row: cell.row + dr, column: cell.column + dc }
        if (!open(next.row, next.column) || reachable.has(key(next)) || hazardCells.has(key(next))) continue
        reachable.add(key(next))
        queue.push(next)
      }
    }
    reaches = (target) => reachable.has(key(target))
    advice = '打通牆壁，或移開擋路的危險物。'
  } else {
    const { jump, speed } = movement.params
    const reach = jumpReach(jump, speed)
    const standing = (row: number, column: number): boolean => open(row, column) && wall(row + 1, column)
    /**
     * Where the player ends up after stepping into (row, column): falls until it stands, or undefined if it falls off.
     * @param row - Row the player steps into.
     * @param column - Column the player steps into.
     * @returns The standing cell reached, or undefined when the player falls off the map.
     */
    const land = (row: number, column: number): Cell | undefined => {
      for (let r = row; r < rows; r += 1) {
        if (!open(r, column)) return undefined
        if (standing(r, column)) return { row: r, column }
      }
      return undefined
    }
    const start = land(playerCells[0].row, playerCells[0].column)
    const queue: Cell[] = start ? [start] : []
    if (start) reachable.add(key(start))
    // for-of also visits entries pushed during the loop, which makes this a breadth-first search.
    for (const cell of queue) {
      const candidates: Cell[] = []
      for (const dc of [-1, 1]) {
        if (open(cell.row, cell.column + dc)) {
          const landed = land(cell.row, cell.column + dc)
          if (landed) candidates.push(landed)
        }
      }
      for (let row = cell.row - reach.up; row < rows; row += 1) {
        const across = reach.across + Math.max(0, row - cell.row)
        for (let column = cell.column - across; column <= cell.column + across; column += 1)
          if (standing(row, column)) candidates.push({ row, column })
      }
      for (const next of candidates) {
        if (reachable.has(key(next)) || hazardCells.has(key(next))) continue
        reachable.add(key(next))
        queue.push(next)
      }
    }
    reaches = (target) =>
      [...reachable].some((text) => {
        const [row, column] = text.split(',').map(Number)
        return target.row <= row && row - target.row <= reach.up && Math.abs(target.column - column) <= reach.across
      })
    advice =
      jump === 'high'
        ? '降低平台或在中間加一層踏板（每次最多往上跳 ' + reach.up + ' 格）。'
        : `把「${player.name}」的跳躍改成「高」，或降低平台／加踏板（目前每次最多往上跳 ${reach.up} 格）。`
  }

  for (const entity of spec.entities) {
    const important = entity.behaviors.some((item) => item.name === 'goal' || item.name === 'collectible')
    if (!important) continue
    for (const cell of cells.get(entity.name) ?? []) {
      if (reaches(cell)) continue
      const isGoal = entity.behaviors.some((item) => item.name === 'goal')
      diagnostics.push({
        severity: 'warning',
        code: isGoal ? 'GOAL_UNREACHABLE' : 'ITEM_UNREACHABLE',
        where: where(cell),
        message: `玩家可能到不了這個「${entity.name}」${isGoal ? '，遊戲會無法過關' : ''}。`,
        suggestion: advice,
      })
    }
  }
  return diagnostics
}
