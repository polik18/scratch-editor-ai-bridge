/**
 * Game Spec: a small, forgiving description of a Scratch project. Authors (often small models) describe entities,
 * the behaviors attached to them, "when … → do …" rules and an optional text map; the spec compiler produces the
 * Canonical IR. Normalized types below are what the compiler consumes after aliases and typos are resolved.
 */

export type Level = 'low' | 'mid' | 'high'

export type BehaviorName =
  | 'platformer'
  | 'topdown'
  | 'patrol'
  | 'collectible'
  | 'hazard'
  | 'goal'
  | 'faller'
  | 'projectile'
  | 'target'
  | 'clickable'
  | 'popup'

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface PlatformerParams {
  readonly jump: Level
  readonly speed: Level
}
export interface TopdownParams {
  readonly speed: Level
  /** Which arrow keys move the player; `horizontal` suits catch-and-dodge games. */
  readonly axis: 'both' | 'horizontal' | 'vertical'
}
export interface PatrolParams {
  readonly speed: Level
  /** Cells travelled to each side of the spawn point. */
  readonly range: number
  readonly stompable: boolean
  readonly points: number
}
export interface CollectibleParams {
  readonly points: number
}
export interface FallerParams {
  readonly speed: Level
  /** Average seconds between new copies. */
  readonly interval: number
  /** Copies enter from the opposite edge and travel this way. */
  readonly direction: Direction
  /** Get faster as the game goes on. */
  readonly accelerate: boolean
}
export interface ProjectileParams {
  /** Scratch key name that fires. */
  readonly key: string
  readonly direction: Direction | 'facing'
  readonly speed: Level
}
export interface PointsParams {
  readonly points: number
}
export interface PopupParams {
  /** Seconds each copy stays visible when it pops up. */
  readonly stay: number
}

export type BehaviorUse =
  | { readonly name: 'platformer'; readonly params: PlatformerParams }
  | { readonly name: 'topdown'; readonly params: TopdownParams }
  | { readonly name: 'patrol'; readonly params: PatrolParams }
  | { readonly name: 'collectible'; readonly params: CollectibleParams }
  | { readonly name: 'hazard'; readonly params: Record<string, never> }
  | { readonly name: 'goal'; readonly params: Record<string, never> }
  | { readonly name: 'faller'; readonly params: FallerParams }
  | { readonly name: 'projectile'; readonly params: ProjectileParams }
  | { readonly name: 'target'; readonly params: PointsParams }
  | { readonly name: 'clickable'; readonly params: PointsParams }
  | { readonly name: 'popup'; readonly params: PopupParams }

export type Look =
  | 'hero'
  | 'slime'
  | 'coin'
  | 'spike'
  | 'flag'
  | 'box'
  | 'key'
  | 'star'
  | 'apple'
  | 'rock'
  | 'balloon'
  | 'bullet'
  | 'car'
  | 'mole'

export interface SpecEntity {
  readonly name: string
  readonly behaviors: readonly BehaviorUse[]
  readonly look: Look
  readonly color?: string
}

export type RuleTrigger =
  | { readonly kind: 'start' }
  | { readonly kind: 'collect' | 'touch' | 'stomp' | 'miss' | 'hit' | 'click'; readonly entity: string }
  | { readonly kind: 'every'; readonly seconds: number }
  /** Compare a stage variable (score, lives, time or a custom counter) with a number. */
  | {
      readonly kind: 'compare'
      readonly variable: string
      readonly op: '>=' | '<=' | '>' | '<' | '='
      readonly value: number
    }
  | { readonly kind: 'score-at-least'; readonly value: number }
  | { readonly kind: 'time-up' }

export type RuleAction =
  | { readonly kind: 'score' | 'lives' | 'time'; readonly delta: number }
  | { readonly kind: 'var'; readonly name: string; readonly delta: number }
  | { readonly kind: 'say'; readonly text: string }
  | { readonly kind: 'win' | 'lose' }

export interface SpecRule {
  readonly when: RuleTrigger
  readonly actions: readonly RuleAction[]
}

/** One level of a game: its own map and the rules that apply while it is being played. */
export interface SpecLevel {
  /** Shown on the card between levels; empty for a single-level game. */
  readonly name: string
  readonly map: readonly string[]
  readonly legend: Readonly<Record<string, string>>
  readonly wallChars: readonly string[]
  /** Every rule active in this level, game-wide ones included. */
  readonly rules: readonly SpecRule[]
}

/** At most this many levels: enough for the contest format and small enough for small models to write. */
export const MAX_LEVELS = 2

export interface GameSpec {
  readonly title: string
  /** Lines on the opening card shown before play starts. */
  readonly instructions: readonly string[]
  /** One or two levels; the top-level map, legend, wall characters and rules are the first level's. */
  readonly levels: readonly SpecLevel[]
  /** Map rows, top to bottom; every row has the same width after normalization. */
  readonly map: readonly string[]
  /** Map character → entity name. Wall characters are kept separately. */
  readonly legend: Readonly<Record<string, string>>
  readonly wallChars: readonly string[]
  readonly entities: readonly SpecEntity[]
  readonly rules: readonly SpecRule[]
  readonly lives: number
  /** Seconds on the countdown shown on stage; absent when the game has no timer. */
  readonly timeLimit?: number
  /** Requests the author said the spec could not express; reported back so substitutions are visible. */
  readonly unsupported: readonly string[]
  /** Custom counters (for example 氧氣) and their starting values. */
  readonly variables: Readonly<Record<string, number>>
}

export interface SpecDiagnostic {
  readonly severity: 'error' | 'warning' | 'fixed'
  readonly code: string
  /** Where in the spec the problem is, in author terms (e.g. `角色.Coin.行為[0]`, `地圖 第 3 列`). */
  readonly where: string
  readonly message: string
  /** A concrete change the author can make; present whenever one is known. */
  readonly suggestion?: string
}
