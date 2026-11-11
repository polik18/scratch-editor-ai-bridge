import { pickBackdrop, pickSound, pickSprite, searchAssets } from '../core/visuals/assets'
import { findLibraryBackdrop, findLibrarySprite } from '../core/visuals/library'
import type { Look, SpecDiagnostic } from '../spec/types'
import { matchBackdropPreset, PRESET_EXAMPLES, SUBTITLE_MAX_CHARS } from './backdrops'
import {
  STORY_LENGTH,
  STORY_TIMING,
  type ActorLook,
  type BackdropSource,
  type StagePoint,
  type StoryAction,
  type StoryActor,
  type StoryResult,
  type StoryScene,
  type TimedAction,
} from './types'

type JsonObject = Record<string, unknown>

const ALIASES = {
  title: ['title', 'name', '標題', '名稱', '作品'],
  hero: ['hero', 'protagonist', 'main', '主角'],
  actors: ['actors', 'characters', 'entities', '角色', '人物'],
  scenes: ['scenes', '場景', '分鏡', '幕'],
  ending: ['ending', 'end', '結尾', '結局', '片尾'],
  sources: ['sources', 'references', '資料來源', '參考資料', '來源'],
  unsupported: ['unsupported', 'cannot', 'limitations', '做不到', '無法做到', '沒做到', '限制'],
  target: ['target', 'targetseconds', 'length', '目標秒數', '目標長度', '總長度', '片長'],
  backdrop: ['backdrop', 'background', '背景', '場景背景'],
  actions: ['actions', 'steps', '動作', '劇情', '內容'],
  narration: ['narration', '旁白'],
  look: ['look', 'costume', 'appearance', '外觀', '造型'],
  size: ['size', '大小'],
} as const

const simplify = (text: string): string => text.toLowerCase().replace(/[\s_-]/g, '')

const pick = (object: JsonObject, key: keyof typeof ALIASES): unknown =>
  Object.entries(object).find(([name]) => ALIASES[key].some((alias) => simplify(alias) === simplify(name)))?.[1]

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : JSON.stringify(value ?? '')

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value])

const PRESET_LOOKS: readonly Look[] = [
  'hero',
  'slime',
  'coin',
  'spike',
  'flag',
  'box',
  'key',
  'star',
  'apple',
  'rock',
  'balloon',
  'bullet',
  'car',
  'mole',
]

/** Named stage spots; y is a little below the middle so characters stand on the ground of most backdrops. */
const SPOTS: Readonly<Record<string, StagePoint>> = {
  左上: { x: -150, y: 100 },
  右上: { x: 150, y: 100 },
  左下: { x: -150, y: -120 },
  右下: { x: 150, y: -120 },
  舞台左外: { x: -300, y: -60 },
  舞台右外: { x: 300, y: -60 },
  左外: { x: -300, y: -60 },
  右外: { x: 300, y: -60 },
  左邊: { x: -150, y: -60 },
  右邊: { x: 150, y: -60 },
  中間: { x: 0, y: -60 },
  中央: { x: 0, y: -60 },
  上方: { x: 0, y: 110 },
  下方: { x: 0, y: -120 },
  天空: { x: 0, y: 120 },
  左: { x: -150, y: -60 },
  右: { x: 150, y: -60 },
  上: { x: 0, y: 110 },
  下: { x: 0, y: -120 },
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/**
 * @param words - A spot name or coordinates such as `(100, -50)` or `100,-50`.
 * @returns The stage point, or undefined when the words name no spot.
 */
export const parsePoint = (words: string): StagePoint | undefined => {
  const numbers = /(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/.exec(words)
  if (numbers) return { x: clamp(Number(numbers[1]), -320, 320), y: clamp(Number(numbers[2]), -200, 200) }
  const cleaned = words.replace(/[的處那裡這裡]/g, '').trim()
  const spot = Object.keys(SPOTS)
    .sort((a, b) => b.length - a.length)
    .find((name) => cleaned.includes(name))
  return spot ? SPOTS[spot] : undefined
}

/**
 * Action lines the parser understands, one example each, in the order the guide lists them. The agent start page
 * and the tests read this list, so a new action shows up there as soon as the parser supports it.
 */
export const STORY_ACTION_EXAMPLES: readonly { readonly name: string; readonly example: string }[] = [
  { name: '出現', example: '小魚 出現 在 左邊' },
  { name: '消失', example: '小魚 消失' },
  { name: '移到', example: '小魚 游到 中間 3秒' },
  { name: '說', example: '小魚 說「你好」' },
  { name: '想', example: '小魚 想「好清澈」' },
  { name: '變大／變小', example: '小魚 變大' },
  { name: '轉身', example: '小魚 轉身' },
  { name: '動起來', example: '小魚 動起來 2秒' },
  { name: '旁白', example: '旁白 很久以前' },
  { name: '等', example: '等 2秒' },
  { name: '播放', example: '播放 Water Drop 1' },
  { name: '同時', example: '同時 小魚 游到 右邊 2秒' },
]

const SECONDS = /\s*(\d+(?:\.\d+)?)\s*(?:秒|s|sec)\s*$/i

/**
 * Seconds written at the end of an action (`… 3秒`), removed from the text.
 * @param words - Action text.
 * @returns The text without the seconds, and the seconds when written.
 */
const takeSeconds = (words: string): { readonly rest: string; readonly seconds?: number } => {
  const match = SECONDS.exec(words)
  return match ? { rest: words.slice(0, match.index).trim(), seconds: Number(match[1]) } : { rest: words.trim() }
}

// Reading time for a speech bubble or subtitle: about five characters a second, between 2 and 8 seconds.
export const readingSeconds = (line: string): number => clamp(Math.round(([...line].length / 5 + 1) * 2) / 2, 2, 8)

const quoted = (words: string): string =>
  words
    .replace(/^[：:\s]+/, '')
    .replace(/^[「『"“]/, '')
    .replace(/[」』"”]$/, '')
    .trim()

/**
 * Parses one action line.
 * @param line - What the author wrote, for example `渡船伯 說「出發囉」3秒`.
 * @param actors - Known character names.
 * @returns The action, or a message and suggestion when the line cannot be read.
 */
export const parseAction = (
  line: string,
  actors: readonly string[],
):
  | { readonly action: StoryAction; readonly note?: string }
  | { readonly message: string; readonly suggestion: string } => {
  const trimmed = line.trim()
  const { rest: body, seconds } = takeSeconds(trimmed)
  if (/^(等|等待|停頓|暫停)\s*$/.test(body) || /^(等|等待|停頓|暫停)$/.test(trimmed.replace(SECONDS, '')))
    return { action: { kind: 'wait', seconds: seconds ?? 1 } }
  const narration = /^旁白[\s：:]*(.+)$/.exec(body)
  if (narration) {
    const words = quoted(narration[1])
    return { action: { kind: 'narrate', text: words, seconds: seconds ?? readingSeconds(words) } }
  }
  const sound = /^(?:播放|音效|播放音效)[\s：:]*(.+)$/.exec(body)
  if (sound) return { action: { kind: 'sound', sound: quoted(sound[1]) } }

  const actor = [...actors].sort((a, b) => b.length - a.length).find((name) => body.startsWith(name))
  if (!actor)
    return {
      message: `看不懂「${trimmed}」：開頭不是角色名稱，也不是「旁白／等／播放」。`,
      suggestion: `用「角色名 動作」的寫法，角色有：${actors.join('、') || '（還沒有角色）'}。`,
    }
  const verb = body.slice(actor.length).trim()
  const say = /^(說|講|喊|問|回答|唱)(.*)$/.exec(verb)
  if (say) {
    const words = quoted(say[2])
    return { action: { kind: 'say', actor, text: words, seconds: seconds ?? readingSeconds(words) } }
  }
  const think = /^(想|心想|思考)(.*)$/.exec(verb)
  if (think) {
    const words = quoted(think[2])
    return { action: { kind: 'think', actor, text: words, seconds: seconds ?? readingSeconds(words) } }
  }
  const move = /^(?:移到|移動到|走到|游到|飛到|跑到|划到|開到|前往|來到|回到)(.*)$/.exec(verb)
  if (move) {
    const to = parsePoint(move[1])
    if (!to)
      return {
        message: `「${trimmed}」沒有寫要移到哪裡。`,
        suggestion: '寫左邊、中間、右邊、左上、右下、舞台左外，或座標 (100, -50)。',
      }
    return { action: { kind: 'move', actor, to, seconds: seconds ?? 2 } }
  }
  const appear = /^(?:出現|登場|進場)(.*)$/.exec(verb)
  if (appear) {
    const at = parsePoint(appear[1])
    return { action: { kind: 'show', actor, ...(at ? { at } : {}) } }
  }
  if (/^(消失|離開|退場|不見)$/.test(verb)) return { action: { kind: 'hide', actor } }
  if (/^(變大|放大)$/.test(verb)) return { action: { kind: 'size', actor, percent: 150 } }
  if (/^(變小|縮小)$/.test(verb)) return { action: { kind: 'size', actor, percent: 60 } }
  const size = /^大小\s*(\d+)/.exec(verb)
  if (size) return { action: { kind: 'size', actor, percent: clamp(Number(size[1]), 10, 400) } }
  if (/^(轉身|轉向|回頭|掉頭)$/.test(verb)) return { action: { kind: 'turn', actor } }
  if (/^(動起來|走動|游動|飛行|擺動|跳舞|揮手)$/.test(verb))
    return { action: { kind: 'animate', actor, seconds: seconds ?? 2 } }
  // An unknown verb (覓食, 攀爬, 揮手致意) still shows the character doing something, and says so.
  return {
    action: { kind: 'animate', actor, seconds: seconds ?? 2 },
    note: `不認得動作「${verb}」，先讓「${actor}」動起來 ${seconds ?? 2} 秒。`,
  }
}

interface LookChoice {
  readonly look: ActorLook
  /** The author left 外觀 out and the tool chose. */
  readonly guessed: boolean
  /** Why a stand-in was chosen, from the asset picker. */
  readonly note?: string
  /** The author wrote a look that does not exist; the closest names to suggest. */
  readonly unknown?: readonly string[]
}

/**
 * The look for a character: a built-in shape, the official sprite the author named, or one picked from the
 * character's name.
 * @param value - What the author wrote for 外觀, if anything.
 * @param name - Character name, used when 外觀 is missing or unknown.
 * @returns The look and how it was chosen.
 */
const lookFor = (value: unknown, name: string): LookChoice => {
  const wanted = value === undefined ? '' : text(value).trim()
  if ((PRESET_LOOKS as readonly string[]).includes(wanted))
    return { look: { kind: 'preset', look: wanted as Look }, guessed: false }
  const exact = wanted ? findLibrarySprite(wanted) : undefined
  if (exact) return { look: { kind: 'library', name: exact.name }, guessed: false }
  const fromWanted = wanted ? pickSprite(wanted) : undefined
  if (fromWanted?.name)
    return {
      look: { kind: 'library', name: fromWanted.name },
      guessed: false,
      ...(fromWanted.note ? { note: fromWanted.note } : {}),
    }
  const fromName = pickSprite(name)
  const look: ActorLook = fromName.name ? { kind: 'library', name: fromName.name } : { kind: 'preset', look: 'hero' }
  const unknown = wanted
    ? [
        ...new Set([
          ...(fromName.name ? [fromName.name] : []),
          ...searchAssets({ kind: 'sprite', query: `${wanted} ${name}`, limit: 3 }).map((entry) => entry.name),
        ]),
      ].slice(0, 3)
    : undefined
  return {
    look,
    guessed: !wanted,
    ...(fromName.note ? { note: fromName.note } : {}),
    ...(unknown ? { unknown } : {}),
  }
}

/** Scratch's default names, which say nothing about what the backdrop shows. */
const PLACEHOLDER_BACKDROP = /^(backdrop|背景|bg|stage|舞台)\s*\d*$/i

/**
 * The backdrop for a scene: an official backdrop named exactly, a built-in drawn scene, or an official backdrop
 * picked from the description (possibly a stand-in, with a note).
 * @param value - What the author wrote for 背景.
 * @returns The backdrop and, for a stand-in, why it was chosen.
 */
const backdropFor = (value: unknown): { readonly source: BackdropSource; readonly note?: string } | undefined => {
  const wanted = text(value).trim()
  if (!wanted || PLACEHOLDER_BACKDROP.test(wanted)) return undefined
  const exact = findLibraryBackdrop(wanted)
  if (exact) return { source: { kind: 'library', name: exact.name } }
  const picked = pickBackdrop(wanted)
  // A named place (河濱公園, 港口) is more specific than the generic water words the built-in scenes match.
  if (picked.name && picked.match === 'approximate')
    return { source: { kind: 'library', name: picked.name }, ...(picked.note ? { note: picked.note } : {}) }
  const preset = matchBackdropPreset(wanted)
  if (preset) return { source: { kind: 'preset', preset } }
  return picked.name
    ? { source: { kind: 'library', name: picked.name }, ...(picked.note ? { note: picked.note } : {}) }
    : undefined
}

const backdropKey = (source: BackdropSource): string =>
  source.kind === 'preset' ? `preset:${source.preset}` : `library:${source.name}`

/**
 * Raw Story Spec → normalized story with timed actions, plus checks against the contest rules: a main character
 * that appears, at least one change of backdrop, and a total length of one to three minutes.
 * @param raw - Parsed JSON.
 * @returns The story and diagnostics in the Game Spec format.
 */
export const normalizeStory = (raw: unknown): StoryResult => {
  const diagnostics: SpecDiagnostic[] = []
  const report = (
    severity: SpecDiagnostic['severity'],
    code: string,
    where: string,
    message: string,
    suggestion?: string,
  ): void => {
    diagnostics.push({ severity, code, where, message, ...(suggestion ? { suggestion } : {}) })
  }
  if (!isObject(raw)) {
    report(
      'error',
      'STORY_NOT_OBJECT',
      '整份描述',
      '動畫描述必須是一個 JSON 物件。',
      '用 { "標題": …, "角色": …, "場景": [ … ] } 的形式。',
    )
    return { diagnostics }
  }
  const title = text(pick(raw, 'title') ?? '我的動畫').trim()

  // ---------- characters ----------
  const actors: StoryActor[] = []
  const addActor = (name: string, value: unknown, where: string): void => {
    const fields = isObject(value) ? value : { 外觀: value }
    const { look, guessed, note, unknown } = lookFor(pick(fields, 'look'), name)
    const sizeValue = Number(pick(fields, 'size'))
    const size =
      Number.isFinite(sizeValue) && sizeValue > 0 ? clamp(sizeValue, 10, 400) : look.kind === 'preset' ? 300 : 100
    actors.push({ name, look, size })
    if (unknown)
      report(
        'warning',
        'UNKNOWN_LOOK',
        `${where}.外觀`,
        `找不到外觀「${text(pick(fields, 'look'))}」，先用${look.kind === 'library' ? `「${look.name}」` : '簡單的人物造型'}。`,
        unknown.length > 0
          ? `改成 ${unknown.join('、')} 之一，或刪掉「外觀」讓工具依名稱挑選。`
          : '刪掉「外觀」讓工具依名稱挑選。',
      )
    else if (note)
      report(
        'fixed',
        'ACTOR_LOOK_APPROXIMATE',
        where,
        `「${name}」用 ${look.kind === 'library' ? look.name : look.look}：${note}。`,
      )
    else if (guessed)
      report(
        'fixed',
        'ACTOR_LOOK_GUESSED',
        where,
        look.kind === 'library'
          ? `「${name}」沒有寫外觀，用 Scratch 內建角色「${look.name}」。`
          : `找不到符合「${name}」的 Scratch 內建角色，先用簡單的人物造型。`,
      )
  }
  const rawActors = pick(raw, 'actors')
  if (isObject(rawActors))
    for (const [name, value] of Object.entries(rawActors)) addActor(name.trim(), value, `角色.${name}`)
  else if (Array.isArray(rawActors))
    for (const item of rawActors)
      if (typeof item === 'string') addActor(item.trim(), undefined, `角色.${item}`)
      else if (isObject(item)) addActor(text(pick(item, 'title') ?? '角色').trim(), item, '角色')
  const names = (): string[] => actors.map((actor) => actor.name)

  let hero = text(pick(raw, 'hero') ?? '').trim()
  if (hero && !names().includes(hero)) addActor(hero, undefined, `主角.${hero}`)

  // ---------- scenes ----------
  const scenes: StoryScene[] = []
  const sounds = new Set<string>()
  const unknownBackdrops: number[] = []
  list(pick(raw, 'scenes')).forEach((item, index) => {
    const where = `場景[${index + 1}]`
    const scene = isObject(item) ? item : {}
    const name = text(pick(scene, 'title') ?? `第 ${index + 1} 幕`).trim()
    const written = pick(scene, 'backdrop')
    const chosen = backdropFor(written)
    if (!chosen) {
      unknownBackdrops.push(index)
      report(
        'error',
        'UNKNOWN_BACKDROP',
        `第 ${index + 1} 幕.背景`,
        written === undefined
          ? '這一幕沒有寫背景。'
          : PLACEHOLDER_BACKDROP.test(text(written).trim())
            ? `「${text(written)}」是 Scratch 的預設名稱，看不出這一幕在哪裡。`
            : `找不到背景「${text(written)}」。`,
        `寫出這一幕的場景，例如「清代淡水港」「河濱公園」「溪流」「水底」；內建背景有 ${PRESET_EXAMPLES.join('、')}，也可以寫 Scratch 背景名稱，例如 "Underwater 1"。`,
      )
    } else if (chosen.note) report('fixed', 'BACKDROP_APPROXIMATE', `第 ${index + 1} 幕.背景`, `${chosen.note}。`)
    // A scene with an unknown backdrop still counts for the main character and length checks, so one wrong name
    // does not also report a missing hero, no scene change and a short animation.
    const backdrop: BackdropSource = chosen?.source ?? { kind: 'preset', preset: 'sky' }
    const lines = [
      ...list(pick(scene, 'narration')).map((line) => `旁白 ${text(line)}`),
      ...list(pick(scene, 'actions')).map(text),
    ]
    const timed: TimedAction[] = []
    let cursor = 0
    let previousStart = 0
    lines.forEach((line, lineIndex) => {
      const together = /^\s*同時[\s：:，,]*/.exec(line)
      const content = together ? line.slice(together[0].length) : line
      let parsed = parseAction(content, names())
      if ('message' in parsed) {
        // A character used in a scene but never declared is added with a library or simple look.
        const guess = /^([^\s說講想移走游飛出消變轉動]{1,8}?)(?=\s|說|講|想|移|走|游|飛|出現|消失|變|轉|動)/.exec(
          content.trim(),
        )?.[1]
        if (guess && !names().includes(guess) && !/^(旁白|等|播放)/.test(guess)) {
          addActor(guess, undefined, `${where}.動作[${lineIndex + 1}]`)
          parsed = parseAction(content, names())
        }
      }
      if ('message' in parsed) {
        report(
          'warning',
          'UNKNOWN_ACTION',
          `${where}.動作[${lineIndex + 1}]`,
          `${parsed.message}已略過。`,
          parsed.suggestion,
        )
        return
      }
      const action = parsed.action
      if (parsed.note)
        report(
          'warning',
          'UNKNOWN_VERB',
          `${where}.動作[${lineIndex + 1}]`,
          parsed.note,
          '可用：出現、消失、移到 位置、說「…」、想「…」、變大、變小、轉身、動起來，後面可加「N秒」。',
        )
      if (action.kind === 'narrate' && [...action.text].length > SUBTITLE_MAX_CHARS)
        report(
          'warning',
          'NARRATION_TOO_LONG',
          `${where}.動作[${lineIndex + 1}]`,
          `旁白超過 ${SUBTITLE_MAX_CHARS} 個字，字幕只放得下前 ${SUBTITLE_MAX_CHARS} 個字。`,
          '拆成兩句旁白。',
        )
      if (action.kind === 'sound') {
        const found = pickSound(action.sound)
        if (!found.name) {
          const closest = searchAssets({ kind: 'sound', query: action.sound, limit: 3 }).map((entry) => entry.name)
          report(
            'warning',
            'UNKNOWN_SOUND',
            `${where}.動作[${lineIndex + 1}]`,
            `找不到音效「${action.sound}」，已略過。`,
            closest.length > 0
              ? `改成 ${closest.join('、')} 之一。`
              : '用 Scratch 音效名稱或中文描述，例如 "Water Drop 1"、"水花"、"鳥叫"。',
          )
          return
        }
        sounds.add(found.name)
        timed.push({
          action: { kind: 'sound', sound: found.name },
          start: together ? previousStart : cursor,
          duration: 0,
        })
        return
      }
      const duration = 'seconds' in action ? action.seconds : 0
      const start = together ? previousStart : cursor
      timed.push({ action, start, duration })
      previousStart = start
      cursor = Math.max(cursor, start + duration)
    })
    if (timed.length === 0)
      report('error', 'EMPTY_SCENE', where, '這一幕沒有任何動作。', '加上角色的動作或旁白，例如 "主角 說「你好」"。')
    const duration = Math.max(1, ...timed.map((item) => item.start + item.duration))
    scenes.push({ name, backdrop, actions: timed, duration })
  })

  if (!hero && actors.length > 0) {
    hero = actors[0].name
    report('fixed', 'HERO_DEFAULTED', '主角', `沒有指定主角，用第一個角色「${hero}」。`)
  }
  if (!hero)
    report('error', 'NO_HERO', '主角', '動畫至少要有一位主角。', '加上 "主角": "角色名稱"，並在場景中讓他出場。')
  else if (
    !scenes.some((scene) => scene.actions.some((item) => 'actor' in item.action && item.action.actor === hero))
  )
    report(
      'error',
      'HERO_NOT_IN_SCENES',
      '主角',
      `主角「${hero}」沒有在任何一幕出場。`,
      `在場景的動作裡加上「${hero} …」。`,
    )

  if (
    scenes.length < 2 ||
    (unknownBackdrops.length === 0 && new Set(scenes.map((scene) => backdropKey(scene.backdrop))).size < 2)
  )
    report(
      'error',
      'NO_SCENE_CHANGE',
      '場景',
      '動畫至少要換一次背景（至少兩幕，而且背景不同）。',
      '再加一幕，並換一個不同的背景。',
    )

  const ending = list(pick(raw, 'ending'))
    .map(text)
    .flatMap((line) => line.split('\n'))
    .map((line) => line.trim())
    .filter(Boolean)
  const sources = list(pick(raw, 'sources'))
    .map(text)
    .map((line) => line.trim())
    .filter(Boolean)
  const unsupported = list(pick(raw, 'unsupported'))
    .map(text)
    .map((line) => line.trim())
    .filter(Boolean)
  for (const line of unsupported) report('fixed', 'UNSUPPORTED_REQUEST', '做不到', `作品沒有做到：${line}`)
  const written = Number(pick(raw, 'target'))
  const target = Number.isFinite(written) && written > 0 ? written : undefined
  const fitted = target === undefined ? undefined : fitToTarget(scenes, target)
  if (fitted?.note) report('fixed', 'LENGTH_FITTED', '目標秒數', fitted.note)
  const story = {
    title,
    hero,
    actors,
    scenes: fitted?.scenes ?? scenes,
    ending: ending.length > 0 ? ending : ['劇終'],
    sources,
    sounds: [...sounds],
    unsupported,
  }

  const total = storySeconds(story)
  // One message with one number: aim for the target when there is one, otherwise just into 60–180 s. Saying both
  // (再加 21 秒 to reach 60, 再加 81 秒 to reach 120) made models take the smaller step.
  const goal =
    target ?? (total < STORY_LENGTH.min ? STORY_LENGTH.min : total > STORY_LENGTH.max ? STORY_LENGTH.max : total)
  const change = Math.ceil(Math.abs(goal - total))
  const howMuch =
    total < goal
      ? `再加約 ${change} 秒，大約再寫 ${Math.max(1, Math.round(change / 3))} 句對白或旁白（每句約 3 秒），或在各幕加「等 N秒」。`
      : `減少約 ${change} 秒：刪掉一些對白，或把「N秒」改短。`
  const outsideRule = total < STORY_LENGTH.min || total > STORY_LENGTH.max
  if (outsideRule)
    report(
      'error',
      'STORY_LENGTH',
      '場景',
      `動畫全長約 ${Math.round(total)} 秒，規定是 ${STORY_LENGTH.min}～${STORY_LENGTH.max} 秒${target ? `，目標是 ${target} 秒` : ''}。`,
      howMuch,
    )
  else if (target !== undefined && Math.abs(total - target) > target * 0.1)
    report(
      'warning',
      'TARGET_LENGTH',
      '目標秒數',
      `動畫全長約 ${Math.round(total)} 秒，目標是 ${target} 秒。`,
      howMuch,
    )
  return { story, diagnostics }
}

/**
 * Total running time: lead-in, title card, every scene, the fades between scenes and the ending card.
 * @param story - Normalized story (scenes and their durations).
 * @param story.scenes - Scenes with durations.
 * @returns Seconds from the green flag to the end of the ending card.
 */
export const storySeconds = (story: { readonly scenes: readonly StoryScene[] }): number =>
  STORY_TIMING.lead +
  STORY_TIMING.title +
  story.scenes.reduce((sum, scene) => sum + scene.duration, 0) +
  STORY_TIMING.transition * (story.scenes.length + 1) +
  STORY_TIMING.ending

/** Slowest speed-up allowed when an animation is too long, so speech bubbles and subtitles stay readable. */
const MIN_PACE = 0.6

const scaleAction = (action: StoryAction, factor: number): StoryAction =>
  'seconds' in action ? { ...action, seconds: Math.round(action.seconds * factor * 10) / 10 } : action

/**
 * Fits an animation to its target length without asking the author to rewrite it. Every action has a known
 * length, so a short animation gets an even pause at the end of each scene and a long one plays faster, down to
 * {@link MIN_PACE} of its speed. Lengths within 10% of the target are left alone.
 * @param scenes - Normalized scenes.
 * @param target - Requested length in seconds.
 * @returns The adjusted scenes and a note for the report, or the scenes unchanged.
 */
export const fitToTarget = (
  scenes: readonly StoryScene[],
  target: number,
): { readonly scenes: readonly StoryScene[]; readonly note?: string } => {
  const total = storySeconds({ scenes })
  if (scenes.length === 0 || Math.abs(total - target) <= target * 0.1) return { scenes }
  const fixedPart = total - scenes.reduce((sum, scene) => sum + scene.duration, 0)
  const content = total - fixedPart
  if (total < target) {
    // Pauses at most double the content, so a nearly empty animation is not stretched into silence; the rest is
    // still reported as too short for the author to fill.
    const added = Math.min(target - total, content)
    const pause = Math.round((added / scenes.length) * 10) / 10
    const fitted = scenes.map((scene) => ({ ...scene, duration: scene.duration + pause }))
    return {
      scenes: fitted,
      note: `動畫約 ${Math.round(total)} 秒，比目標 ${target} 秒短，已在每一幕結尾多停 ${pause} 秒（現在約 ${Math.round(storySeconds({ scenes: fitted }))} 秒）。想要更豐富，可以把停頓換成對白或旁白。`,
    }
  }
  const factor = Math.max(MIN_PACE, (target - fixedPart) / content)
  const fitted = scenes.map((scene) => ({
    ...scene,
    duration: Math.round(scene.duration * factor * 10) / 10,
    actions: scene.actions.map((item) => ({
      action: scaleAction(item.action, factor),
      start: Math.round(item.start * factor * 10) / 10,
      duration: Math.round(item.duration * factor * 10) / 10,
    })),
  }))
  return {
    scenes: fitted,
    note: `動畫約 ${Math.round(total)} 秒，比目標 ${target} 秒長，已把所有動作加快到 ${Math.round(factor * 100)}% 的時間（約 ${Math.round(storySeconds({ scenes: fitted }))} 秒）。`,
  }
}
