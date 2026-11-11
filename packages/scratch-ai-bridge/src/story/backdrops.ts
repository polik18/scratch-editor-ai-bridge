import type { CanonicalCostume } from '../core/ir/types'

/**
 * Built-in backdrops drawn as SVG, so an animation can change scenes without downloading anything. River and stream
 * scenes come first because the contest theme is Taiwan's rivers; official library backdrops cover everything else.
 */
const W = 480
const H = 360

const sky = (top: string, bottom: string): string =>
  `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sky)"/>`

const hills = (color: string, y: number): string =>
  `<path d="M0 ${y} Q80 ${y - 60} 160 ${y} T320 ${y} T480 ${y} V${H} H0Z" fill="${color}"/>`

const ripples = (y: number, color: string): string =>
  [0, 1, 2, 3]
    .map(
      (index) =>
        `<path d="M${40 + index * 110} ${y + (index % 2) * 18} q20 -8 40 0" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    )
    .join('')

const PRESETS = {
  river: () =>
    sky('#8fd3ff', '#e6f7ff') +
    hills('#7cc36a', 190) +
    `<path d="M0 230 Q240 200 480 235 V300 Q240 270 0 300Z" fill="#4fa3e0"/>` +
    ripples(250, '#d6f0ff') +
    `<rect y="300" width="${W}" height="60" fill="#9bd27f"/>`,
  stream: () =>
    sky('#a8e0ff', '#f0fbff') +
    hills('#4f9d5a', 170) +
    `<path d="M300 170 Q260 240 320 300 Q360 340 300 360 H220 Q280 330 240 290 Q190 230 250 170Z" fill="#6ec1ef"/>` +
    `<g fill="#9a9a9a"><ellipse cx="200" cy="300" rx="22" ry="12"/><ellipse cx="350" cy="250" rx="18" ry="10"/></g>`,
  underwater: () =>
    sky('#2b8cc4', '#0c3d66') +
    `<g fill="#ffffff" opacity="0.35"><circle cx="80" cy="120" r="6"/><circle cx="96" cy="90" r="4"/><circle cx="380" cy="160" r="5"/></g>` +
    `<path d="M0 320 Q120 290 240 320 T480 315 V${H} H0Z" fill="#c9b27c"/>` +
    `<g fill="#3fa05a"><path d="M60 320 q-10 -40 6 -80 q-4 40 6 80Z"/><path d="M420 318 q10 -50 -6 -90 q12 40 16 90Z"/></g>`,
  estuary: () =>
    sky('#ffd9a8', '#fff3e0') +
    `<rect y="200" width="${W}" height="80" fill="#6aa9d8"/>` +
    ripples(225, '#e8f4ff') +
    `<path d="M0 280 Q240 250 480 280 V${H} H0Z" fill="#8b7355"/>` +
    `<g fill="#2f7d3a"><circle cx="70" cy="270" r="22"/><circle cx="110" cy="262" r="18"/><circle cx="420" cy="268" r="24"/></g>`,
  night: () =>
    sky('#0b1d3a', '#29467a') +
    `<circle cx="400" cy="70" r="26" fill="#fff6c8"/>` +
    `<g fill="#fff">${[40, 120, 200, 260, 330, 450].map((x, index) => `<circle cx="${x}" cy="${30 + (index % 3) * 35}" r="2"/>`).join('')}</g>` +
    `<path d="M0 250 Q240 230 480 252 V300 Q240 282 0 300Z" fill="#2a5a8c"/>` +
    `<rect y="300" width="${W}" height="60" fill="#1d3b2a"/>`,
  city: () =>
    sky('#9fd4ff', '#eef8ff') +
    `<g fill="#8796a8">${[20, 90, 150, 230, 300, 370, 420].map((x, index) => `<rect x="${x}" y="${110 + (index % 3) * 30}" width="50" height="${130 - (index % 3) * 30}"/>`).join('')}</g>` +
    `<path d="M0 240 Q240 225 480 242 V290 Q240 275 0 290Z" fill="#4f9bd6"/>` +
    `<rect y="290" width="${W}" height="70" fill="#a7c97f"/>` +
    `<rect y="300" width="${W}" height="10" fill="#d9c49a"/>`,
  mountain: () =>
    sky('#a6dcff', '#f2fbff') +
    `<path d="M0 260 L120 110 L220 240 L320 90 L480 260Z" fill="#6f8f6a"/>` +
    `<path d="M300 112 L320 90 L342 116Z" fill="#fff"/>` +
    hills('#4e8f4a', 280),
  field: () =>
    sky('#9fd8ff', '#f5fcff') +
    `<rect y="200" width="${W}" height="160" fill="#8fcf5b"/>` +
    `<g stroke="#6aa940" stroke-width="3">${[230, 260, 290, 320, 350].map((y) => `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`).join('')}</g>` +
    `<path d="M0 205 L480 225" stroke="#5aa8e0" stroke-width="8"/>`,
  sky: () =>
    sky('#7fc8ff', '#dff3ff') +
    `<circle cx="410" cy="60" r="26" fill="#ffe680"/><g fill="#fff" opacity="0.9"><ellipse cx="90" cy="70" rx="38" ry="15"/><ellipse cx="300" cy="100" rx="34" ry="13"/></g>`,
} as const

export type BackdropPreset = keyof typeof PRESETS

/** Words authors use for each built-in backdrop. Matching is by containment, so 「淡水河邊」 finds 河流. */
const PRESET_WORDS: Readonly<Record<BackdropPreset, readonly string[]>> = {
  river: ['河流', '河', '河邊', '河岸', '河濱', '大河', 'river'],
  stream: ['溪流', '溪', '小溪', '溪邊', '山溪', '水圳', '圳', 'stream', 'creek'],
  underwater: ['水底', '水下', '水中', '河底', '溪底', 'underwater'],
  estuary: ['河口', '出海口', '濕地', '紅樹林', '海邊', 'estuary', 'wetland'],
  night: ['夜晚', '晚上', '夜', '夜空', 'night'],
  city: ['城市', '都市', '街道', '城鎮', 'city'],
  mountain: ['高山', '山', '山林', '峽谷', '源頭', 'mountain'],
  field: ['田野', '稻田', '農田', '田', 'field', 'farm'],
  sky: ['天空', '藍天', 'sky'],
}

/**
 * @param text - What the author wrote for a scene's backdrop.
 * @returns The built-in backdrop it names, if any; longer words win so 「河口」 is not read as 「河」.
 */
export const matchBackdropPreset = (text: string): BackdropPreset | undefined => {
  const wanted = text.trim().toLowerCase()
  let best: { preset: BackdropPreset; length: number } | undefined
  for (const [preset, words] of Object.entries(PRESET_WORDS) as [BackdropPreset, readonly string[]][])
    for (const word of words)
      if (wanted.includes(word.toLowerCase()) && (!best || word.length > best.length))
        best = { preset, length: word.length }
  return best?.preset
}

/** One example word per built-in backdrop, for feedback and the authoring guide. */
export const PRESET_EXAMPLES = Object.values(PRESET_WORDS).map((words) => words[0])

const costume = (name: string, body: string): CanonicalCostume => ({
  name,
  dataFormat: 'svg',
  data: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`,
  rotationCenterX: W / 2,
  rotationCenterY: H / 2,
})

/**
 * @param name - Costume name in the project.
 * @param preset - Built-in backdrop.
 * @returns A stage-sized backdrop costume.
 */
export const presetBackdrop = (name: string, preset: BackdropPreset): CanonicalCostume =>
  costume(name, PRESETS[preset]())

const escapeXml = (text: string): string =>
  text.replace(
    /[<>&"']/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  )

/**
 * Splits text into lines of at most `width` characters.
 * @param text - Text to wrap.
 * @param width - Characters per line.
 * @returns The lines.
 */
export const wrapText = (text: string, width: number): string[] => {
  const chars = [...text.trim()]
  const lines: string[] = []
  for (let index = 0; index < chars.length; index += width) lines.push(chars.slice(index, index + width).join(''))
  return lines
}

/**
 * Title or ending card drawn as a backdrop.
 * @param name - Costume name.
 * @param heading - Large text.
 * @param lines - Smaller lines under it.
 * @returns A stage-sized backdrop costume.
 */
export const cardBackdrop = (name: string, heading: string, lines: readonly string[]): CanonicalCostume => {
  const headingLines = wrapText(heading, 14)
  const headingSize = 34
  const body = lines
    .flatMap((line) => wrapText(line, 22))
    .slice(0, 6)
    .map(
      (line, index) =>
        `<text x="240" y="${190 + headingLines.length * 20 + index * 28}" font-size="20" font-family="sans-serif" text-anchor="middle" fill="#f4f8ff">${escapeXml(line)}</text>`,
    )
    .join('')
  return costume(
    name,
    sky('#16325c', '#2e6aa8') +
      ripples(310, '#5f9fe0') +
      headingLines
        .map(
          (line, index) =>
            `<text x="240" y="${150 + index * 42}" font-size="${headingSize}" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#ffffff">${escapeXml(line)}</text>`,
        )
        .join('') +
      body,
  )
}

/**
 * A subtitle bar for one narration line, shown at the bottom of the stage.
 * @param name - Costume name inside the subtitle sprite, such as `line-1`.
 * @param text - What the narrator says; up to two lines are shown.
 * @returns A costume centred on the bar.
 */
export const subtitleCostume = (name: string, text: string): CanonicalCostume => {
  const lines = wrapText(text, 24).slice(0, 2)
  const height = 22 + lines.length * 24
  return {
    name,
    dataFormat: 'svg',
    data:
      `<svg xmlns="http://www.w3.org/2000/svg" width="470" height="${height}" viewBox="0 0 470 ${height}">` +
      `<rect width="470" height="${height}" rx="12" fill="#000" opacity="0.62"/>` +
      lines
        .map(
          (line, index) =>
            `<text x="235" y="${30 + index * 24}" font-size="18" font-family="sans-serif" text-anchor="middle" fill="#fff">${escapeXml(line)}</text>`,
        )
        .join('') +
      `</svg>`,
    rotationCenterX: 235,
    rotationCenterY: height / 2,
  }
}

/** Characters a subtitle shows; longer narration should be split into several lines. */
export const SUBTITLE_MAX_CHARS = 48

/**
 * A black stage-sized costume used to fade between scenes.
 * @returns A 480×360 black costume named `cover`.
 */
export const coverCostume = (): CanonicalCostume => costume('cover', `<rect width="${W}" height="${H}" fill="#000"/>`)
