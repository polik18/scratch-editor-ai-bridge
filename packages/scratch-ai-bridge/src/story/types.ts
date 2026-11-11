import type { SpecDiagnostic } from '../spec/types'
import type { BackdropPreset } from './backdrops'

/**
 * Story Spec: an animation described as characters and scenes. Each scene has a backdrop and a list of plain
 * actions (appear, move, say, narrate, wait…) that play one after another; the compiler turns the timeline into
 * Scratch scripts and adds the title card, scene transitions and the ending card.
 */

export interface StagePoint {
  readonly x: number
  readonly y: number
}

export type StoryAction =
  | { readonly kind: 'show'; readonly actor: string; readonly at?: StagePoint }
  | { readonly kind: 'hide'; readonly actor: string }
  | { readonly kind: 'move'; readonly actor: string; readonly to: StagePoint; readonly seconds: number }
  | { readonly kind: 'say' | 'think'; readonly actor: string; readonly text: string; readonly seconds: number }
  | { readonly kind: 'size'; readonly actor: string; readonly percent: number }
  | { readonly kind: 'turn'; readonly actor: string }
  | { readonly kind: 'animate'; readonly actor: string; readonly seconds: number }
  | { readonly kind: 'narrate'; readonly text: string; readonly seconds: number }
  | { readonly kind: 'sound'; readonly sound: string }
  | { readonly kind: 'wait'; readonly seconds: number }

/** An action placed on the scene's timeline. */
export interface TimedAction {
  readonly action: StoryAction
  /** Seconds from the start of the scene. */
  readonly start: number
  /** Seconds the action takes; 0 for instant ones. */
  readonly duration: number
}

export type BackdropSource =
  { readonly kind: 'preset'; readonly preset: BackdropPreset } | { readonly kind: 'library'; readonly name: string }

export interface StoryScene {
  readonly name: string
  readonly backdrop: BackdropSource
  readonly actions: readonly TimedAction[]
  /** Seconds from the scene start to the end of its last action. */
  readonly duration: number
}

export type ActorLook =
  | { readonly kind: 'preset'; readonly look: import('../spec/types').Look }
  | { readonly kind: 'library'; readonly name: string }

export interface StoryActor {
  readonly name: string
  readonly look: ActorLook
  /** Size in percent. */
  readonly size: number
}

export interface Story {
  readonly title: string
  /** The main character; it must appear in at least one scene. */
  readonly hero: string
  readonly actors: readonly StoryActor[]
  readonly scenes: readonly StoryScene[]
  /** Lines on the ending card. */
  readonly ending: readonly string[]
  /** Where the facts in the story come from; shown on the ending card and kept for the entry form. */
  readonly sources: readonly string[]
  /** Library sounds the story plays. */
  readonly sounds: readonly string[]
  /** Requests the author listed under 做不到; reported, not built. */
  readonly unsupported: readonly string[]
}

/** Fixed parts of every animation, in seconds. They count towards the total length. */
export const STORY_TIMING = {
  /** A short pause before the title, so a playtest can speed the whole animation up. */
  lead: 1,
  title: 3,
  /** Fade to black between scenes; the fade back in overlaps the next scene's start. */
  transition: 0.5,
  ending: 4,
} as const

/** Contest rule: an animation runs from one to three minutes. */
export const STORY_LENGTH = { min: 60, max: 180 } as const

export interface StoryResult {
  readonly story?: Story
  readonly diagnostics: readonly SpecDiagnostic[]
}
