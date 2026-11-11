import type {
  CanonicalBlock,
  CanonicalCostume,
  CanonicalProject,
  CanonicalScript,
  CanonicalSprite,
  CanonicalStage,
} from '../core/ir/types'
import {
  broadcast,
  costume,
  ghost,
  gotoXY,
  hide,
  input,
  mul,
  pointIn,
  repeat,
  setVar,
  show,
  toFront,
  variable,
  wait,
  whenFlag,
  whenReceive,
} from '../spec/blocks'
import { lookCostumes } from '../spec/looks'
import { cardBackdrop, coverCostume, presetBackdrop, subtitleCostume } from './backdrops'
import { STORY_TIMING, type BackdropSource, type StagePoint, type Story, type StoryAction } from './types'

/** Names shared by the generated scripts and the playtest. */
export const STORY_NAMES = {
  /** Time scale: 1 plays in real time; a playtest sets it lower to watch the whole animation quickly. */
  timeScale: '_t',
  /** Scene number being played: 0 on the title card, 1… for scenes, scene count + 1 on the ending card. */
  scene: '_scene',
  /** 1 once the ending card has been shown for its full time. */
  done: '_done',
  cover: '_Cover',
  subtitles: '_Subtitles',
  ending: 'ending',
  title: 'title',
} as const

const N = STORY_NAMES

const op = (
  opcode: CanonicalBlock['opcode'],
  inputs?: Record<string, CanonicalBlock | number | string>,
  fields?: Record<string, string>,
): CanonicalBlock => ({
  opcode,
  ...(inputs
    ? { inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, input(value)])) }
    : {}),
  ...(fields ? { fields } : {}),
})

// Every timed block waits `seconds × _t`, so a playtest can run the animation faster without changing it.
const scaled = (seconds: number): CanonicalBlock => mul(seconds, variable(N.timeScale))
const pause = (seconds: number): CanonicalBlock[] => (seconds > 0.0001 ? [wait(scaled(seconds))] : [])

const sceneMessage = (index: number): string => `scene-${index + 1}`

const backdropName = (source: BackdropSource): string =>
  source.kind === 'preset' ? `bg-${source.preset}` : source.name

/**
 * Fade to black and back, run by the cover sprite; half the transition goes to each side of the backdrop switch.
 * @returns Blocks that fade the cover in.
 */
const fadeIn = (): CanonicalBlock[] => [
  ghost(100),
  show(),
  toFront(),
  repeat(
    10,
    op('looks_changeeffectby', { CHANGE: -10 }, { EFFECT: 'ghost' }),
    wait(scaled(STORY_TIMING.transition / 10)),
  ),
]
const fadeOut = (): CanonicalBlock[] => [
  repeat(10, op('looks_changeeffectby', { CHANGE: 10 }, { EFFECT: 'ghost' }), wait(scaled(0.05))),
  hide(),
]

/**
 * Story → Canonical IR: a stage script that plays the title card, each scene and the ending card in order, one
 * script per character and scene that follows the timeline, a subtitle sprite for narration and a cover sprite
 * for the fades.
 * @param story - Normalized story.
 * @returns The project.
 */
export const compileStory = (story: Story): CanonicalProject => {
  const scenes = story.scenes
  const broadcasts = [...scenes.map((_, index) => sceneMessage(index)), N.ending, 'fade']

  // ---------- stage ----------
  const backdrops: CanonicalCostume[] = [cardBackdrop(N.title, story.title, ['一部 Scratch 動畫'])]
  const seen = new Set<string>()
  for (const scene of scenes) {
    const name = backdropName(scene.backdrop)
    if (seen.has(name)) continue
    seen.add(name)
    backdrops.push(
      scene.backdrop.kind === 'preset' ? presetBackdrop(name, scene.backdrop.preset) : { name, dataFormat: 'svg' }, // Filled from the official library when the game is built.
    )
  }
  backdrops.push(
    cardBackdrop(N.ending, story.ending[0] ?? '劇終', [
      ...story.ending.slice(1),
      ...(story.sources.length > 0 ? ['資料來源：', ...story.sources.slice(0, 3)] : []),
    ]),
  )

  const sequence: CanonicalBlock[] = [
    setVar(N.timeScale, 1),
    setVar(N.scene, 0),
    setVar(N.done, 0),
    op('looks_switchbackdropto', { BACKDROP: N.title }),
    // The lead-in runs in real time; a playtest sets the time scale during it.
    wait(STORY_TIMING.lead),
    ...pause(STORY_TIMING.title),
  ]
  scenes.forEach((scene, index) => {
    sequence.push(
      broadcast('fade'),
      ...pause(STORY_TIMING.transition),
      op('looks_switchbackdropto', { BACKDROP: backdropName(scene.backdrop) }),
      setVar(N.scene, index + 1),
      broadcast(sceneMessage(index)),
      ...pause(scene.duration),
    )
  })
  sequence.push(
    broadcast('fade'),
    ...pause(STORY_TIMING.transition),
    op('looks_switchbackdropto', { BACKDROP: N.ending }),
    setVar(N.scene, scenes.length + 1),
    broadcast(N.ending),
    ...pause(STORY_TIMING.ending),
    setVar(N.done, 1),
  )
  const soundScripts: CanonicalScript[] = scenes.flatMap((scene, index) => {
    const plays = scene.actions.filter((item) => item.action.kind === 'sound')
    if (plays.length === 0) return []
    const blocks: CanonicalBlock[] = [whenReceive(sceneMessage(index))]
    let cursor = 0
    for (const item of plays) {
      if (item.action.kind !== 'sound') continue
      blocks.push(...pause(item.start - cursor), op('sound_play', { SOUND_MENU: item.action.sound }))
      cursor = item.start
    }
    return [{ blocks }]
  })
  const stage: CanonicalStage = {
    kind: 'stage',
    name: 'Stage',
    variables: [
      { name: N.timeScale, value: 1 },
      { name: N.scene, value: 0 },
      { name: N.done, value: 0 },
    ],
    lists: [],
    costumes: backdrops,
    sounds: story.sounds.map((name) => ({ name, dataFormat: 'wav' })),
    procedures: [],
    scripts: [{ blocks: [whenFlag(), ...sequence] }, ...soundScripts],
  }

  // ---------- characters ----------
  const actorSprites = story.actors.map((actor, actorIndex): CanonicalSprite => {
    const scripts: CanonicalScript[] = [{ blocks: [whenFlag(), hide()] }, { blocks: [whenReceive(N.ending), hide()] }]
    scenes.forEach((scene, index) => {
      const mine = scene.actions.filter((item) => 'actor' in item.action && item.action.actor === actor.name)
      if (mine.length === 0) {
        scripts.push({ blocks: [whenReceive(sceneMessage(index)), hide()] })
        return
      }
      // Where the character stands when the scene starts: its first 出現 spot, or a default spot by order.
      const firstShow = mine.find((item) => item.action.kind === 'show')
      const startsHidden = firstShow !== undefined
      let position: StagePoint =
        (firstShow?.action.kind === 'show' ? firstShow.action.at : undefined) ??
        DEFAULT_SPOTS[actorIndex % DEFAULT_SPOTS.length]
      let facing = 90
      const blocks: CanonicalBlock[] = [
        whenReceive(sceneMessage(index)),
        op('looks_setsizeto', { SIZE: actor.size }),
        pointIn(90),
        gotoXY(position.x, position.y),
        startsHidden ? hide() : show(),
      ]
      let cursor = 0
      for (const item of mine) {
        blocks.push(...pause(item.start - cursor))
        cursor = item.start
        const action = item.action as Exclude<StoryAction, { kind: 'narrate' | 'sound' | 'wait' }>
        switch (action.kind) {
          case 'show':
            if (action.at) {
              position = action.at
              blocks.push(gotoXY(position.x, position.y))
            }
            blocks.push(show(), toFront())
            break
          case 'hide':
            blocks.push(hide())
            break
          case 'move':
            if (action.to.x !== position.x) {
              facing = action.to.x < position.x ? -90 : 90
              blocks.push(pointIn(facing))
            }
            blocks.push(op('motion_glidesecstoxy', { SECS: scaled(action.seconds), X: action.to.x, Y: action.to.y }))
            position = action.to
            cursor += action.seconds
            break
          case 'say':
            blocks.push(op('looks_sayforsecs', { MESSAGE: action.text, SECS: scaled(action.seconds) }))
            cursor += action.seconds
            break
          case 'think':
            blocks.push(op('looks_thinkforsecs', { MESSAGE: action.text, SECS: scaled(action.seconds) }))
            cursor += action.seconds
            break
          case 'size':
            blocks.push(op('looks_setsizeto', { SIZE: action.percent }))
            break
          case 'turn':
            facing = -facing
            blocks.push(pointIn(facing))
            break
          case 'animate': {
            const steps = Math.max(1, Math.round(action.seconds / 0.25))
            blocks.push(repeat(steps, op('looks_nextcostume'), wait(scaled(action.seconds / steps))))
            cursor += action.seconds
            break
          }
        }
      }
      scripts.push({ blocks })
    })
    return sprite(actor.name, {
      costumes:
        actor.look.kind === 'preset' ? lookCostumes(actor.look.look) : [{ name: actor.look.name, dataFormat: 'svg' }], // Filled from the official library when built.
      size: actor.size,
      rotationStyle: 'left-right',
      scripts,
    })
  })

  // ---------- subtitles ----------
  const narrations = scenes.flatMap((scene, sceneIndex) =>
    scene.actions.flatMap((item) =>
      item.action.kind === 'narrate' ? [{ sceneIndex, item, text: item.action.text }] : [],
    ),
  )
  const subtitleScripts: CanonicalScript[] = [
    { blocks: [whenFlag(), hide(), gotoXY(0, -140)] },
    { blocks: [whenReceive(N.ending), hide()] },
  ]
  scenes.forEach((_, sceneIndex) => {
    const mine = narrations.filter((entry) => entry.sceneIndex === sceneIndex)
    const blocks: CanonicalBlock[] = [whenReceive(sceneMessage(sceneIndex)), hide()]
    let cursor = 0
    for (const entry of mine) {
      blocks.push(
        ...pause(entry.item.start - cursor),
        costume(`line-${narrations.indexOf(entry) + 1}`),
        show(),
        toFront(),
        ...pause(entry.item.duration),
        hide(),
      )
      cursor = entry.item.start + entry.item.duration
    }
    subtitleScripts.push({ blocks })
  })
  const subtitles = sprite(N.subtitles, {
    costumes:
      narrations.length > 0
        ? narrations.map((entry, index) => subtitleCostume(`line-${index + 1}`, entry.text))
        : [subtitleCostume('line-1', '')],
    y: -140,
    scripts: subtitleScripts,
  })

  const cover = sprite(N.cover, {
    costumes: [coverCostume()],
    scripts: [
      { blocks: [whenFlag(), hide(), gotoXY(0, 0)] },
      { blocks: [whenReceive('fade'), ...fadeIn()] },
      ...[...scenes.map((_, index) => sceneMessage(index)), N.ending].map((message) => ({
        blocks: [whenReceive(message), ...fadeOut()],
      })),
    ],
  })

  return {
    format: 'scratch-ai-bridge/canonical-ir',
    version: 1,
    name: story.title,
    stage,
    sprites: [...actorSprites, subtitles, cover],
    broadcasts: broadcasts.map((name) => ({ name })),
  }
}

const DEFAULT_SPOTS: readonly StagePoint[] = [
  { x: -120, y: -60 },
  { x: 120, y: -60 },
  { x: 0, y: -60 },
  { x: -200, y: -60 },
  { x: 200, y: -60 },
]

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
  visible: false,
  draggable: false,
  rotationStyle: "don't rotate",
  ...fields,
})
