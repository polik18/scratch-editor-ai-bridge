import type { RubricCheck } from '../grading/rubric'
import type { IntentAnchors, IntentFeature } from './anchors'

/** One small, on-demand capability: when to use it, the exact lines the translator accepts, and how to verify it. */
export interface CapabilityCard {
  readonly id: string
  readonly title: string
  readonly features: readonly IntentFeature[]
  readonly lines: readonly string[]
  /** Runtime evidence that the capability actually happened. */
  readonly check?: RubricCheck
}

/** Always included: how to lay out targets. Kept short on purpose. */
export const STRUCTURE_CARD: CapabilityCard = {
  id: 'structure',
  title: '角色與舞台段落',
  features: [],
  lines: [
    'sprite 角色名稱 (外觀: 官方造型英文名或中文描述; 音效: 音效名)',
    'stage (背景: 背景名1, 背景名2)',
    'when green flag clicked / when this sprite clicked / when [space v] key pressed / when I receive [訊息 v]',
    '巢狀用 2 個空格；forever、repeat、if 都要用 end 結束',
  ],
}

export const CAPABILITY_CARDS: readonly CapabilityCard[] = [
  {
    id: 'keys',
    title: '按鍵控制',
    features: ['keys'],
    lines: ['forever', '  if <key [right arrow v] pressed?> then', '    change x by (5)', '  end', 'end'],
    check: { kind: 'runtime-control' },
  },
  {
    id: 'click',
    title: '點擊互動',
    features: ['click'],
    lines: ['when this sprite clicked', 'when stage clicked', 'go to [mouse-pointer v]'],
    check: { kind: 'runtime-sprite-changed' },
  },
  {
    id: 'collision',
    title: '碰觸判斷',
    features: ['collision'],
    lines: ['if <touching [角色名 v]?> then', 'if <touching [edge v]?> then', 'wait until <touching [角色名 v]?>'],
    check: { kind: 'runtime-collision' },
  },
  {
    id: 'score',
    title: '分數、生命與計時（變數）',
    features: ['score', 'lives', 'timer', 'levels'],
    lines: [
      'set [分數 v] to (0)',
      'change [分數 v] by (1)',
      'if <(分數) > (9)> then',
      'say (join [分數：] (分數)) for (1) seconds',
      'reset timer / (timer)',
    ],
    check: { kind: 'runtime-variable-changed' },
  },
  {
    id: 'clones',
    title: '分身（很多個、不斷出現）',
    features: ['clones', 'falling'],
    lines: [
      'create clone of [myself v]',
      'when I start as a clone',
      'go to [random position v]',
      'delete this clone',
    ],
    check: { kind: 'runtime-clones' },
  },
  {
    id: 'motion',
    title: '移動與動作',
    features: ['falling', 'animation'],
    lines: [
      'move (10) steps / change y by (-5) / if on edge, bounce',
      'glide (1) secs to x: (0) y: (0)',
      'point towards [mouse-pointer v] / turn right (15)',
    ],
    check: { kind: 'runtime-motion' },
  },
  {
    id: 'sound',
    title: '音效與音樂',
    features: ['sound', 'music'],
    lines: ['play sound [音效名 v]', 'play sound [音效名 v] until done'],
    check: { kind: 'runtime-opcode', opcodes: ['sound_play', 'sound_playuntildone'] },
  },
  {
    id: 'scenes',
    title: '場景切換',
    features: ['scenes'],
    lines: [
      'switch backdrop to [背景名 v]',
      'next backdrop',
      'when backdrop switches to [背景名 v]',
      'broadcast [下一幕 v] / when I receive [下一幕 v]',
    ],
    check: {
      kind: 'runtime-opcode',
      opcodes: ['looks_switchbackdropto', 'looks_switchbackdroptoandwait', 'looks_nextbackdrop'],
    },
  },
  {
    id: 'dialogue',
    title: '對白與旁白',
    features: ['dialogue'],
    lines: ['say [台詞] for (2) seconds', 'think [想法] for (2) seconds', 'broadcast [換你說 v] and wait'],
    check: {
      kind: 'runtime-opcode',
      opcodes: ['looks_say', 'looks_sayforsecs', 'looks_think', 'looks_thinkforsecs'],
    },
  },
  {
    id: 'ask',
    title: '提問與回答',
    features: ['ask'],
    lines: ['ask [問題] and wait', 'if <(answer) = [正確答案]> then', 'say (answer) for (2) seconds'],
    check: { kind: 'runtime-opcode', opcodes: ['sensing_askandwait'] },
  },
  {
    id: 'animation',
    title: '造型動畫',
    features: ['animation'],
    lines: ['sprite 名稱 (外觀: 造型1, 造型2)', 'next costume', 'switch costume to [造型名 v]', 'wait (0.2) seconds'],
    check: { kind: 'runtime-opcode', opcodes: ['looks_nextcostume', 'looks_switchcostumeto'] },
  },
  {
    id: 'ending',
    title: '結束與勝負',
    features: ['ending', 'levels'],
    lines: ['stop [all v]', 'hide / show', 'broadcast [遊戲結束 v]', 'switch backdrop to [結束畫面 v]'],
  },
  {
    id: 'effects',
    title: '特效與大小',
    features: ['effects'],
    lines: [
      'change [ghost v] effect by (10)',
      'set [color v] effect to (50)',
      'clear graphic effects',
      'set size to (120) % / change size by (5)',
    ],
  },
]

/**
 * Pick only the cards a slice needs. Nothing outside the given features is included, so the prompt stays short.
 * @param features Features this step implements.
 * @returns The structure card plus matching capability cards.
 */
export const selectCards = (features: readonly IntentFeature[]): CapabilityCard[] => [
  STRUCTURE_CARD,
  ...CAPABILITY_CARDS.filter((card) => card.features.some((feature) => features.includes(feature))),
]

/**
 * Render cards as compact prompt text.
 * @param cards Selected cards.
 * @returns Text block.
 */
export const renderCards = (cards: readonly CapabilityCard[]): string =>
  cards.map((card) => `【${card.title}】\n${card.lines.join('\n')}`).join('\n\n')

/**
 * Runtime checks proving the given features happened.
 * @param anchors Anchors (only features are used).
 * @param features Subset to verify; defaults to all anchor features.
 * @returns Checks, one per card that has one.
 */
export const featureChecks = (
  anchors: IntentAnchors,
  features: readonly IntentFeature[] = anchors.features,
): { feature: string; check: RubricCheck }[] => {
  const seen = new Set<string>()
  return CAPABILITY_CARDS.flatMap((card) => {
    if (!card.check || seen.has(card.id) || !card.features.some((feature) => features.includes(feature))) return []
    seen.add(card.id)
    return [{ feature: card.title, check: card.check }]
  })
}
