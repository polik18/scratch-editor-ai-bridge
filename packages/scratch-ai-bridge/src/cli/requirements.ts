import { buildFromSpecText } from '../spec'
import { buildStoryFromText, storySeconds } from '../story'

/**
 * What a request asks for that the build itself cannot see: how many levels, how long the animation runs and which
 * names must appear. `make` checks a built attempt against these and sends what is missing back to the model, so a
 * one-level game or a one-minute animation no longer counts as done when two levels or two minutes were asked for.
 */
export interface Requirements {
  /** Levels the request describes (a 第二關 means 2). */
  readonly levels?: number
  /** Animation length in seconds. */
  readonly seconds?: number
  /** Names that must appear somewhere in the work; each entry lists acceptable spellings, longest first. */
  readonly mustAppear: readonly (readonly string[])[]
}

export interface RequirementCheck {
  readonly label: string
  readonly expected: string
  readonly actual: string
  readonly pass: boolean
  /** What to change, in the feedback's 「→」 form. */
  readonly fix: string
}

/** Share of the requested length an animation may differ by. */
const LENGTH_TOLERANCE = 0.1

const WATER_SUFFIX = /[溪河圳川]/

/** Place names that come before a river name in a phrase such as 「桃園老街溪開蓋」. */
const PLACE_PREFIXES = [
  '台北市',
  '新北市',
  '桃園市',
  '台中市',
  '台南市',
  '高雄市',
  '屏東市',
  '台灣',
  '臺灣',
  '台北',
  '新北',
  '基隆',
  '桃園',
  '新竹',
  '苗栗',
  '台中',
  '彰化',
  '南投',
  '雲林',
  '嘉義',
  '台南',
  '高雄',
  '屏東',
  '宜蘭',
  '花蓮',
  '台東',
  '金門',
  '澎湖',
  '上游',
  '中游',
  '下游',
]

/** Words that end like a river name but name no river. */
const GENERIC = /(界河|古圳|水圳|之河|大河|小溪|溪流|河川|河流|河道)$/

/**
 * River, stream and canal names in a quoted theme phrase, such as 瑠公圳 in 「台北市歷史水圳：瑠公圳」.
 * @param phrase - Text inside 「」.
 * @returns The names, in order.
 */
const riverNames = (phrase: string): string[] => {
  const names: string[] = []
  for (const part of phrase.split(/[：:、，,／/\s與和及的]/)) {
    let rest = part
    while (rest) {
      // 基隆河 and 花蓮溪 are named after their places, so a place directly followed by 溪/河 is kept.
      const prefix = PLACE_PREFIXES.find(
        (place) => rest.startsWith(place) && !WATER_SUFFIX.test(rest.charAt(place.length)),
      )
      if (prefix) {
        rest = rest.slice(prefix.length)
        continue
      }
      const end = [...rest].findIndex(
        (char, index, chars) => WATER_SUFFIX.test(char) && !WATER_SUFFIX.test(chars[index + 1] ?? ''),
      )
      if (end < 0) break
      const name = [...rest].slice(0, end + 1).join('')
      if (name.length >= 2 && name.length <= 5 && !GENERIC.test(name)) names.push(name)
      rest = [...rest].slice(end + 1).join('')
    }
  }
  return names
}

/**
 * Reads the requirements from a request written in Chinese, such as the contest prompts.
 * @param request - What was asked.
 * @param kind - Game or animation.
 * @returns The requirements found; empty when the request says nothing checkable.
 */
export const readRequirements = (request: string, kind: 'game' | 'story'): Requirements => {
  const mustAppear: string[][] = []
  // Names the request quotes on its theme line, e.g. 【主題與河流名稱】必須在對話與背景標題中明確出現「淡水河」。
  const themeLine = request
    .split('\n')
    .find((line) => /主題|名稱|必須|標題|標示|標明|顯示|點出/.test(line) && line.includes('「'))
  for (const quoted of themeLine?.matchAll(/「([^」]{1,30})」/g) ?? [])
    for (const name of riverNames(quoted[1]))
      if (!mustAppear.some((known) => known[0] === name)) mustAppear.push([name])
  const seconds = /(?:總長度|總時長|長度)(?:控制在)?\s*(\d{2,3})\s*秒/.exec(request)?.[1]
  return {
    ...(kind === 'game' && /第二關|第\s*2\s*關/.test(request) ? { levels: 2 } : {}),
    ...(kind === 'story' && seconds ? { seconds: Number(seconds) } : {}),
    mustAppear,
  }
}

/**
 * Checks a model reply against the requirements.
 * @param text - The spec the model wrote.
 * @param requirements - From {@link readRequirements}.
 * @returns One check per requirement; empty when there were none.
 */
export const checkRequirements = (text: string, requirements: Requirements): RequirementCheck[] => {
  const checks: RequirementCheck[] = []
  if (requirements.levels !== undefined) {
    const levels = buildFromSpecText(text).spec?.levels.length ?? 0
    checks.push({
      label: '關卡數',
      expected: `${requirements.levels} 關`,
      actual: `${levels} 關`,
      pass: levels === requirements.levels,
      fix: `需求要 ${requirements.levels} 關：把「地圖」換成 "關卡": [ { "名稱", "地圖", "過關" }, { "名稱", "地圖", "過關" } ]，每關都要能過關。`,
    })
  }
  if (requirements.seconds !== undefined) {
    const story = buildStoryFromText(text).story
    if (story) {
      const seconds = Math.round(storySeconds(story))
      const difference = seconds - requirements.seconds
      checks.push({
        label: '動畫長度',
        expected: `約 ${requirements.seconds} 秒`,
        actual: `${seconds} 秒`,
        pass: Math.abs(difference) <= requirements.seconds * LENGTH_TOLERANCE,
        fix:
          difference < 0
            ? `再加約 ${-difference} 秒：多寫幾句對白或旁白，或在各幕加「等 N秒」。`
            : `減少約 ${difference} 秒：刪掉一些對白，或把「等 N秒」改短。`,
      })
    }
  }
  for (const options of requirements.mustAppear) {
    const found = options.find((name) => text.includes(name))
    checks.push({
      label: `出現「${options[0]}」`,
      expected: '標題、說明或對白中至少出現一次',
      actual: found ? `有（${found}）` : '沒有',
      pass: found !== undefined,
      fix: `在標題、說明或對白裡寫出「${options[0]}」。`,
    })
  }
  return checks
}

/**
 * @param checks - From {@link checkRequirements}.
 * @returns Feedback lines for the checks that failed.
 */
export const requirementFeedback = (checks: readonly RequirementCheck[]): string =>
  checks
    .filter((check) => !check.pass)
    .map((check) => `[需求未達成] ${check.label}：需求是${check.expected}，目前是 ${check.actual} → ${check.fix}`)
    .join('\n')
