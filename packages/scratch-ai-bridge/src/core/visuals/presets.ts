import type { CanonicalProject } from '../ir/types'

export const BUILT_IN_SPRITE_VISUALS = [
  'platform-hero',
  'platform-enemy',
  'coin',
  'platform',
  'goal',
  'cat',
  'ball',
  'spaceship',
  'generic-character',
] as const

export const BUILT_IN_BACKDROP_VISUALS = [
  'platform-day',
  'forest',
  'city',
  'space',
  'underwater',
  'classroom',
] as const

export interface ResolvedVisual {
  readonly data: string
  readonly preset: string
  readonly rotationCenterX: number
  readonly rotationCenterY: number
}

export interface AutomaticVisualSummary {
  readonly backdropCostumes: number
  readonly spriteCostumes: number
  readonly spriteNames: readonly string[]
}

const escapeXml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const containsAny = (value: string, words: readonly string[]): boolean => words.some((word) => value.includes(word))

const hashNumber = (value: string): number => {
  let result = 2166136261
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const genericColor = (name: string): string =>
  ['#4c97ff', '#9966ff', '#ff6680', '#0fbd8c', '#ff8c1a', '#5cb1d6'][hashNumber(name) % 6] ?? '#4c97ff'

const svg = (width: number, height: number, preset: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-sab-preset="${preset}">${body}</svg>`

const backdrop = (preset: string): string => {
  if (preset === 'space') {
    return svg(
      480,
      360,
      preset,
      '<rect width="480" height="360" fill="#101638"/><circle cx="70" cy="54" r="3" fill="#fff"/><circle cx="190" cy="92" r="2" fill="#ffe66d"/><circle cx="330" cy="48" r="3" fill="#fff"/><circle cx="420" cy="120" r="2" fill="#fff"/><circle cx="380" cy="286" r="58" fill="#6c63ce"/><ellipse cx="380" cy="286" rx="88" ry="18" fill="none" stroke="#d8ccff" stroke-width="8"/>',
    )
  }
  if (preset === 'forest') {
    return svg(
      480,
      360,
      preset,
      '<rect width="480" height="360" fill="#bfeaff"/><rect y="250" width="480" height="110" fill="#6bc46d"/><circle cx="80" cy="96" r="54" fill="#43a85b"/><rect x="70" y="125" width="20" height="145" fill="#7a5130"/><circle cx="200" cy="76" r="62" fill="#4db66b"/><rect x="190" y="116" width="20" height="154" fill="#805735"/><circle cx="390" cy="104" r="68" fill="#3f9c52"/><rect x="380" y="150" width="20" height="120" fill="#744725"/><path d="M0 280 Q120 220 240 280 T480 280 V360 H0Z" fill="#4aab58"/>',
    )
  }
  if (preset === 'city') {
    return svg(
      480,
      360,
      preset,
      '<rect width="480" height="360" fill="#bfe4ff"/><circle cx="410" cy="55" r="28" fill="#ffe26d"/><rect x="30" y="145" width="85" height="165" fill="#6f83a3"/><rect x="135" y="95" width="95" height="215" fill="#8d70b8"/><rect x="250" y="130" width="80" height="180" fill="#5f91a8"/><rect x="350" y="75" width="100" height="235" fill="#d07c6c"/><path d="M48 170h18v20H48zm40 0h18v20H88zm65-45h20v22h-20zm40 0h20v22h-20zm75 30h20v22h-20zm45 0h14v22h-14zm58-52h22v24h-22zm42 0h22v24h-22z" fill="#ffeaa7"/><rect y="310" width="480" height="50" fill="#4b5563"/>',
    )
  }
  if (preset === 'underwater') {
    return svg(
      480,
      360,
      preset,
      '<defs><linearGradient id="water" x2="0" y2="1"><stop stop-color="#55d5f2"/><stop offset="1" stop-color="#146fa8"/></linearGradient></defs><rect width="480" height="360" fill="url(#water)"/><circle cx="80" cy="85" r="11" fill="none" stroke="#d7f7ff" stroke-width="4"/><circle cx="125" cy="125" r="6" fill="none" stroke="#d7f7ff" stroke-width="3"/><path d="M0 320 Q120 280 240 320 T480 320 V360 H0Z" fill="#e6c679"/><path d="M70 335q-18-65 8-96q25 38 3 96m310 0q-15-58 10-93q24 42 3 93" fill="none" stroke="#36a269" stroke-width="12"/>',
    )
  }
  if (preset === 'classroom') {
    return svg(
      480,
      360,
      preset,
      '<rect width="480" height="360" fill="#fff3cf"/><rect x="60" y="45" width="360" height="170" rx="6" fill="#296a58" stroke="#6f4d2f" stroke-width="10"/><path d="M130 285h220l35 75H95Z" fill="#c48752"/><rect x="0" y="320" width="480" height="40" fill="#d9a76c"/>',
    )
  }
  return svg(
    480,
    360,
    'platform-day',
    '<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#67c9ff"/><stop offset="1" stop-color="#e9f8ff"/></linearGradient></defs><rect width="480" height="360" fill="url(#sky)"/><circle cx="410" cy="62" r="34" fill="#ffe36e"/><path d="M45 100c8-28 48-28 58-5c23-13 50 5 45 28H35c-7-11-2-20 10-23zm230 45c8-24 40-25 52-5c18-9 42 3 42 23h-103c-5-8-2-15 9-18z" fill="#fff" opacity=".9"/><path d="M0 270L90 180l85 90l80-115l120 115l55-70l50 70v90H0Z" fill="#69b96b"/><rect y="304" width="480" height="56" fill="#805b39"/><rect y="298" width="480" height="18" fill="#48a849"/>',
  )
}

const sprite = (preset: string, name: string, costumeName: string): ResolvedVisual => {
  if (preset === 'platform') {
    return {
      preset,
      data: svg(
        240,
        36,
        preset,
        '<rect x="2" y="2" width="236" height="32" rx="8" fill="#7a5130" stroke="#4b321e" stroke-width="4"/><rect x="2" y="2" width="236" height="12" rx="7" fill="#58c45b"/>',
      ),
      rotationCenterX: 120,
      rotationCenterY: 18,
    }
  }
  if (preset === 'coin') {
    return {
      preset,
      data: svg(
        40,
        40,
        preset,
        '<circle cx="20" cy="20" r="17" fill="#ffd84d" stroke="#d89400" stroke-width="4"/><ellipse cx="16" cy="15" rx="5" ry="8" fill="#fff3a0" opacity=".8"/><path d="M24 9v22" stroke="#e8a900" stroke-width="3"/>',
      ),
      rotationCenterX: 20,
      rotationCenterY: 20,
    }
  }
  if (preset === 'platform-enemy') {
    return {
      preset,
      data: svg(
        56,
        46,
        preset,
        '<path d="M5 39V25C5 10 15 3 28 3s23 7 23 22v14Z" fill="#e2574c" stroke="#87342e" stroke-width="4"/><circle cx="20" cy="21" r="5" fill="#fff"/><circle cx="36" cy="21" r="5" fill="#fff"/><circle cx="21" cy="22" r="2"/><circle cx="35" cy="22" r="2"/><path d="M16 35h24M11 43h12m10 0h12" stroke="#542a29" stroke-width="5" stroke-linecap="round"/>',
      ),
      rotationCenterX: 28,
      rotationCenterY: 23,
    }
  }
  if (preset === 'goal') {
    return {
      preset,
      data: svg(
        64,
        112,
        preset,
        '<path d="M14 6v98" stroke="#6a4a31" stroke-width="6"/><path d="M17 10h40L45 29l12 19H17Z" fill="#ff6680" stroke="#a9344e" stroke-width="3"/><ellipse cx="14" cy="105" rx="13" ry="5" fill="#4a9d55"/>',
      ),
      rotationCenterX: 32,
      rotationCenterY: 56,
    }
  }
  if (preset === 'ball') {
    return {
      preset,
      data: svg(
        52,
        52,
        preset,
        '<circle cx="26" cy="26" r="23" fill="#ff8c1a" stroke="#9c5000" stroke-width="4"/><path d="M6 26h40M26 3c-8 8-8 38 0 46M26 3c8 8 8 38 0 46" fill="none" stroke="#fff" stroke-width="3"/>',
      ),
      rotationCenterX: 26,
      rotationCenterY: 26,
    }
  }
  if (preset === 'spaceship') {
    return {
      preset,
      data: svg(
        92,
        62,
        preset,
        '<path d="M7 34L48 7c17 2 30 13 37 27c-7 14-20 25-37 27Z" fill="#8b7ee8" stroke="#493e9e" stroke-width="4"/><ellipse cx="52" cy="27" rx="14" ry="11" fill="#8ce8ff"/><path d="M12 27L2 18v32l10-9m25 13l-8 8h25l7-11" fill="#ff8c1a"/>',
      ),
      rotationCenterX: 46,
      rotationCenterY: 31,
    }
  }
  if (preset === 'cat') {
    return {
      preset,
      data: svg(
        64,
        72,
        preset,
        '<path d="M12 26L9 5l18 12c4-2 7-2 11 0L55 5l-3 22c7 16-1 36-20 36S5 43 12 26Z" fill="#ff9f43" stroke="#a85d16" stroke-width="4"/><circle cx="24" cy="33" r="4" fill="#fff"/><circle cx="42" cy="33" r="4" fill="#fff"/><circle cx="25" cy="34" r="2"/><circle cx="41" cy="34" r="2"/><path d="M30 42h6l-3 4zm-9 9h24" fill="#7b3f19" stroke="#7b3f19" stroke-width="2"/>',
      ),
      rotationCenterX: 32,
      rotationCenterY: 36,
    }
  }
  if (preset === 'platform-hero') {
    const jumping = containsAny(costumeName.toLowerCase(), ['jump', '跳'])
    return {
      preset,
      data: svg(
        54,
        70,
        preset,
        `<circle cx="27" cy="16" r="12" fill="#ffd1a3" stroke="#804b2c" stroke-width="3"/><path d="M14 15c2-15 26-18 29 0Z" fill="#4c97ff"/><rect x="14" y="28" width="26" height="27" rx="8" fill="#4c97ff" stroke="#2457a6" stroke-width="3"/><circle cx="23" cy="15" r="2"/><circle cx="32" cy="15" r="2"/><path d="M20 55l-${jumping ? 7 : 3} 12m21-12l${jumping ? 7 : 3} 12M14 36L${jumping ? 3 : 8} ${jumping ? 24 : 48}m32-12l${jumping ? 8 : 6} ${jumping ? -12 : 12}" stroke="#263b66" stroke-width="6" stroke-linecap="round"/>`,
      ),
      rotationCenterX: 27,
      rotationCenterY: 35,
    }
  }

  const label = escapeXml(name.trim().slice(0, 10) || '角色')
  const color = genericColor(name)
  return {
    preset: 'generic-character',
    data: svg(
      76,
      76,
      'generic-character',
      `<rect x="4" y="4" width="68" height="68" rx="20" fill="${color}" stroke="#253858" stroke-width="4"/><circle cx="27" cy="30" r="5" fill="#fff"/><circle cx="49" cy="30" r="5" fill="#fff"/><path d="M24 45q14 13 28 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><text x="38" y="68" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#17233c">${label}</text>`,
    ),
    rotationCenterX: 38,
    rotationCenterY: 38,
  }
}

const selectBackdropPreset = (value: string): string => {
  const normalized = value.toLowerCase()
  if (containsAny(normalized, ['space', '星', '太空', '宇宙'])) return 'space'
  if (containsAny(normalized, ['forest', 'wood', '森林', '叢林'])) return 'forest'
  if (containsAny(normalized, ['city', 'town', '城市', '街'])) return 'city'
  if (containsAny(normalized, ['water', 'ocean', 'sea', '海', '水下'])) return 'underwater'
  if (containsAny(normalized, ['class', 'school', '教室', '學校'])) return 'classroom'
  return 'platform-day'
}

const selectSpritePreset = (value: string): string => {
  const normalized = value.toLowerCase()
  const exactPreset = BUILT_IN_SPRITE_VISUALS.find((preset) => normalized.includes(preset))
  if (exactPreset) return exactPreset
  if (containsAny(normalized, ['platform', 'ground', 'floor', '地板', '地面', '平台'])) return 'platform'
  if (containsAny(normalized, ['coin', 'gold', '金幣', '硬幣'])) return 'coin'
  if (containsAny(normalized, ['enemy', 'goomba', 'monster', '敵', '怪物'])) return 'platform-enemy'
  if (containsAny(normalized, ['goal', 'finish', 'flag', '終點', '旗'])) return 'goal'
  if (containsAny(normalized, ['spaceship', 'rocket', '太空船', '飛船', '火箭'])) return 'spaceship'
  if (containsAny(normalized, ['ball', '球'])) return 'ball'
  if (containsAny(normalized, ['cat', '貓'])) return 'cat'
  if (containsAny(normalized, ['player', 'mario', 'hero', '主角', '玩家', '英雄'])) return 'platform-hero'
  return 'generic-character'
}

export const resolveAutomaticVisual = (options: {
  readonly isStage: boolean
  readonly projectName: string
  readonly targetName: string
  readonly costumeName: string
}): ResolvedVisual => {
  if (options.isStage) {
    const preset = selectBackdropPreset(`${options.projectName} ${options.targetName} ${options.costumeName}`)
    return { data: backdrop(preset), preset, rotationCenterX: 240, rotationCenterY: 180 }
  }
  return sprite(
    selectSpritePreset(`${options.targetName} ${options.costumeName}`),
    options.targetName,
    options.costumeName,
  )
}

export const summarizeAutomaticVisuals = (project: CanonicalProject): AutomaticVisualSummary => {
  const missingCount = (costumes: CanonicalProject['stage']['costumes']): number => {
    if (costumes.length === 0) return 1
    return costumes.filter((costume) => typeof costume.data !== 'string' || costume.data.length === 0).length
  }
  const spriteNames = project.sprites
    .filter((target) => missingCount(target.costumes) > 0)
    .map((target) => target.name)
  return {
    backdropCostumes: missingCount(project.stage.costumes),
    spriteCostumes: project.sprites.reduce((sum, target) => sum + missingCount(target.costumes), 0),
    spriteNames,
  }
}
