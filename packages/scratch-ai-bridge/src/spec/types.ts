/**
 * Game Spec: a small, forgiving description of a Scratch project. Authors (often small models) describe entities,
 * the behaviors attached to them, "when … → do …" rules and an optional text map; the spec compiler produces the
 * Canonical IR. Normalized types below are what the compiler consumes after aliases and typos are resolved.
 */

export type Level = 'low' | 'mid' | 'high'

export type BehaviorName = 'platformer' | 'topdown' | 'patrol' | 'collectible' | 'hazard' | 'goal'

export interface PlatformerParams {
  readonly jump: Level
  readonly speed: Level
}
export interface TopdownParams {
  readonly speed: Level
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

export type BehaviorUse =
  | { readonly name: 'platformer'; readonly params: PlatformerParams }
  | { readonly name: 'topdown'; readonly params: TopdownParams }
  | { readonly name: 'patrol'; readonly params: PatrolParams }
  | { readonly name: 'collectible'; readonly params: CollectibleParams }
  | { readonly name: 'hazard'; readonly params: Record<string, never> }
  | { readonly name: 'goal'; readonly params: Record<string, never> }

export type Look = 'hero' | 'slime' | 'coin' | 'spike' | 'flag' | 'box' | 'key' | 'star'

export interface SpecEntity {
  readonly name: string
  readonly behaviors: readonly BehaviorUse[]
  readonly look: Look
  readonly color?: string
}

export type RuleTrigger =
  | { readonly kind: 'start' }
  | { readonly kind: 'collect' | 'touch' | 'stomp'; readonly entity: string }
  | { readonly kind: 'score-at-least'; readonly value: number }
  | { readonly kind: 'time-up' }

export type RuleAction =
  | { readonly kind: 'score' | 'lives'; readonly delta: number }
  | { readonly kind: 'say'; readonly text: string }
  | { readonly kind: 'win' | 'lose' }

export interface SpecRule {
  readonly when: RuleTrigger
  readonly actions: readonly RuleAction[]
}

export interface GameSpec {
  readonly title: string
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
