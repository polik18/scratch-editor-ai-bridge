import type { Level } from './types'

/**
 * Shared numbers between the generated Scratch scripts and the static checks, so "can the player reach this
 * platform?" is answered with the same physics the game will run.
 */

export const CELL = 24
export const STAGE_COLUMNS = 20
export const STAGE_ROWS = 15
export const GRAVITY = 1.2
export const MAX_FALL = 12
export const FRICTION = 0.8
/** Pixels the platformer player may step up when a horizontal move touches the floor. */
export const STEP_UP = 4

export const JUMP_VELOCITY: Record<Level, number> = { low: 12, mid: 15.5, high: 18 }
export const RUN_ACCELERATION: Record<Level, number> = { low: 1, mid: 1.6, high: 2.2 }
export const WALK_SPEED: Record<Level, number> = { low: 3, mid: 4, high: 6 }
export const PATROL_SPEED: Record<Level, number> = { low: 1, mid: 1.5, high: 2.5 }
export const FALL_SPEED: Record<Level, number> = { low: 2, mid: 3.5, high: 5 }
export const PROJECTILE_SPEED: Record<Level, number> = { low: 6, mid: 9, high: 13 }

/**
 * Steady horizontal speed reached by `vx = (vx + a) * FRICTION` each frame.
 * @param level - How quickly the player accelerates.
 * @returns Pixels per frame.
 */
export const runSpeed = (level: Level): number => (RUN_ACCELERATION[level] * FRICTION) / (1 - FRICTION)

/**
 * Simulates the generated jump: velocity is reduced by gravity before each move, as in the physics tick.
 * @param level - How hard the player jumps.
 * @returns Highest rise in pixels and frames until landing at the take-off height.
 */
export const jumpProfile = (level: Level): { readonly rise: number; readonly framesToLand: number } => {
  let velocity = JUMP_VELOCITY[level]
  let height = 0
  let rise = 0
  let frames = 0
  do {
    velocity = Math.max(velocity - GRAVITY, -MAX_FALL)
    height += velocity
    rise = Math.max(rise, height)
    frames += 1
  } while (height > 0)
  return { rise, framesToLand: frames }
}

/**
 * Whole cells the player's feet can rise and the cells it can cross while doing so (with a safety margin).
 * @param jump - Jump level.
 * @param speed - Speed level.
 * @returns Cells up and across one jump can cover.
 */
export const jumpReach = (jump: Level, speed: Level): { readonly up: number; readonly across: number } => {
  const profile = jumpProfile(jump)
  return {
    up: Math.floor(profile.rise / CELL),
    across: Math.max(1, Math.floor((profile.framesToLand * runSpeed(speed) * 0.75) / CELL)),
  }
}

/**
 * Stage coordinates of a map cell centre. Maps shorter than the stage sit at the bottom so the floor is visible.
 * @param row - Map row.
 * @param column - Map column.
 * @param rows - Number of map rows.
 * @returns Stage x and y.
 */
export const cellCenter = (row: number, column: number, rows: number): { readonly x: number; readonly y: number } => {
  const offset = STAGE_ROWS - rows
  return { x: -240 + CELL / 2 + column * CELL, y: 180 - CELL / 2 - (row + offset) * CELL }
}
