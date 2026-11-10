import type { CanonicalCostume } from '../core/ir/types'
import { CELL, cellCenter } from './physics'
import type { Look } from './types'

const svg = (
  name: string,
  width: number,
  height: number,
  body: string,
  cx = width / 2,
  cy = height / 2,
): CanonicalCostume => ({
  name,
  dataFormat: 'svg',
  data: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  rotationCenterX: cx,
  rotationCenterY: cy,
})

const escapeXml = (text: string): string =>
  text.replace(
    /[<>&"']/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  )

const safeColor = (color: string | undefined, fallback: string): string =>
  color && /^#[0-9a-f]{3,8}$|^[a-z]{3,20}$/i.test(color) ? color : fallback

/**
 * Cell-sized costumes (≤ 22 px) so every entity fits a map cell and corridors one cell wide.
 * @param look - Preset look.
 * @param color - Optional fill colour (hex or CSS name).
 * @returns Costumes for the sprite.
 */
export const lookCostumes = (look: Look, color?: string): CanonicalCostume[] => {
  switch (look) {
    case 'hero':
      // 18×18 leaves a 3 px margin on each side of a one-cell corridor.
      return [
        svg(
          'hero',
          18,
          18,
          `<ellipse cx="9" cy="10.5" rx="7.8" ry="6.8" fill="${safeColor(color, '#c97b33')}" stroke="#6b3a12" stroke-width="1.4"/>` +
            '<path d="M1.5 7 Q9 -0.5 16.5 7 Z" fill="#6b4a2a" stroke="#3d2610" stroke-width="1.2"/>' +
            '<circle cx="11.5" cy="10" r="2" fill="#fff"/><circle cx="12.2" cy="10" r="1.1" fill="#222"/>',
        ),
      ]
    case 'slime':
      return [
        svg(
          'slime',
          22,
          16,
          `<path d="M1 15 Q1 1 11 1 Q21 1 21 15 Z" fill="${safeColor(color, '#7b5cd6')}" stroke="#3f2a8a" stroke-width="1.5"/>` +
            '<circle cx="7.5" cy="8" r="2" fill="#fff"/><circle cx="14.5" cy="8" r="2" fill="#fff"/>' +
            '<circle cx="7.5" cy="8.5" r="1" fill="#111"/><circle cx="14.5" cy="8.5" r="1" fill="#111"/>',
        ),
      ]
    case 'coin':
      return [
        svg(
          'coin',
          16,
          16,
          `<circle cx="8" cy="8" r="7" fill="${safeColor(color, '#ffd23f')}" stroke="#c48a00" stroke-width="1.5"/><rect x="6.8" y="3.5" width="2.4" height="9" rx="1.2" fill="#fff3b0"/>`,
        ),
      ]
    case 'spike':
      return [
        svg(
          'spike',
          22,
          14,
          `<path d="M1 13 L6 1 L11 13 L16 1 L21 13 Z" fill="${safeColor(color, '#b0b6c0')}" stroke="#555" stroke-width="1.2"/>`,
        ),
      ]
    case 'flag':
      return [
        svg(
          'flag',
          22,
          24,
          `<rect x="3" y="1" width="2.5" height="22" fill="#666"/><path d="M5.5 2 L21 7 L5.5 12 Z" fill="${safeColor(color, '#ff5a5a')}" stroke="#a02020" stroke-width="1"/>`,
        ),
      ]
    case 'key':
      return [
        svg(
          'key',
          20,
          12,
          `<circle cx="5" cy="6" r="4" fill="none" stroke="${safeColor(color, '#e0a800')}" stroke-width="2.5"/><path d="M9 6 H19 M15 6 V10 M18 6 V9" stroke="${safeColor(color, '#e0a800')}" stroke-width="2.5"/>`,
        ),
      ]
    case 'star':
      return [
        svg(
          'star',
          20,
          20,
          `<path d="M10 1 L12.6 7.2 L19 7.6 L14 11.8 L15.6 18.4 L10 14.8 L4.4 18.4 L6 11.8 L1 7.6 L7.4 7.2 Z" fill="${safeColor(color, '#ffcf3f')}" stroke="#c48a00" stroke-width="1.2"/>`,
        ),
      ]
    case 'apple':
      return [
        svg(
          'apple',
          18,
          19,
          `<circle cx="9" cy="11" r="7.5" fill="${safeColor(color, '#e53935')}" stroke="#8e1b18" stroke-width="1.2"/>` +
            '<path d="M9 4 Q9 1 11 0.5" stroke="#5d3a1a" stroke-width="1.5" fill="none"/><ellipse cx="12.5" cy="3" rx="2.5" ry="1.3" fill="#4caf50"/>',
        ),
      ]
    case 'rock':
      return [
        svg(
          'rock',
          22,
          20,
          `<path d="M3 7 L9 1 L17 3 L21 10 L17 18 L7 19 L1 13 Z" fill="${safeColor(color, '#8d8478')}" stroke="#4e4740" stroke-width="1.4"/><circle cx="9" cy="9" r="2" fill="#6e665c"/><circle cx="15" cy="13" r="1.5" fill="#6e665c"/>`,
        ),
      ]
    case 'balloon':
      return [
        svg(
          'balloon',
          16,
          24,
          `<ellipse cx="8" cy="8" rx="7" ry="7.5" fill="${safeColor(color, '#ff5ca8')}" stroke="#a02060" stroke-width="1"/><path d="M8 15.5 Q6 19 8 23" stroke="#555" stroke-width="1" fill="none"/>`,
        ),
      ]
    case 'bullet':
      return [
        svg(
          'bullet',
          4,
          12,
          `<rect x="0.5" y="0.5" width="3" height="11" rx="1.5" fill="${safeColor(color, '#ffeb3b')}" stroke="#f57f17" stroke-width="0.8"/>`,
        ),
      ]
    case 'car':
      return [
        svg(
          'car',
          18,
          24,
          '<rect x="0" y="3" width="3" height="6" fill="#222"/><rect x="15" y="3" width="3" height="6" fill="#222"/><rect x="0" y="15" width="3" height="6" fill="#222"/><rect x="15" y="15" width="3" height="6" fill="#222"/>' +
            `<rect x="2" y="1" width="14" height="22" rx="4" fill="${safeColor(color, '#2196f3')}" stroke="#0d47a1" stroke-width="1.2"/><rect x="4" y="6" width="10" height="5" rx="1.5" fill="#bbdefb"/>`,
        ),
      ]
    case 'mole':
      return [
        svg(
          'mole',
          22,
          18,
          `<path d="M2 17 Q2 2 11 2 Q20 2 20 17 Z" fill="${safeColor(color, '#8d6e63')}" stroke="#4e342e" stroke-width="1.3"/><circle cx="8" cy="8" r="1.6" fill="#111"/><circle cx="14" cy="8" r="1.6" fill="#111"/><ellipse cx="11" cy="12" rx="2.5" ry="1.8" fill="#f48fb1"/>`,
        ),
      ]
    case 'box':
      return [
        svg(
          'box',
          20,
          20,
          `<rect x="1" y="1" width="18" height="18" rx="4" fill="${safeColor(color, '#4c97ff')}" stroke="#24508f" stroke-width="1.5"/>`,
        ),
      ]
  }
}

/**
 * Invisible costume for the sprite that hosts rules and speech in games without a player.
 * @returns A 2×2 transparent costume.
 */
export const narratorCostume = (): CanonicalCostume => svg('narrator', 2, 2, '')

/**
 * One stage-sized costume with every wall cell, merged into horizontal runs.
 * @param map - Normalized map rows.
 * @param wallChars - Characters that are walls.
 * @param style - Platformer ground or top-down stone.
 * @returns A 480×360 costume centred on the stage.
 */
export const wallCostume = (
  map: readonly string[],
  wallChars: readonly string[],
  style: 'ground' | 'stone',
): CanonicalCostume => {
  const isWall = (row: number, column: number): boolean =>
    row >= 0 && row < map.length && wallChars.includes([...map[row]][column] ?? '')
  const parts: string[] = []
  map.forEach((line, row) => {
    const cells = [...line]
    let column = 0
    while (column < cells.length) {
      if (!isWall(row, column)) {
        column += 1
        continue
      }
      const start = column
      while (column < cells.length && isWall(row, column)) column += 1
      const { x, y } = cellCenter(row, start, map.length)
      const left = x + 240 - CELL / 2
      const top = 180 - y - CELL / 2
      const width = (column - start) * CELL
      if (style === 'ground') {
        parts.push(`<rect x="${left}" y="${top}" width="${width}" height="${CELL}" fill="#8b5a2b"/>`)
        for (let cap = start; cap < column; cap += 1)
          if (!isWall(row - 1, cap))
            parts.push(
              `<rect x="${left + (cap - start) * CELL}" y="${top}" width="${CELL}" height="6" fill="#5fbf3f"/>`,
            )
      } else {
        // Inset by half the stroke so the outline stays inside the wall cells.
        parts.push(
          `<rect x="${left + 0.5}" y="${top + 0.5}" width="${width - 1}" height="${CELL - 1}" fill="#7d8796" stroke="#4d5562" stroke-width="1"/>`,
        )
      }
    }
  })
  return svg('walls', 480, 360, parts.join(''), 240, 180)
}

export const backdropCostume = (style: 'sky' | 'grass'): CanonicalCostume =>
  style === 'sky'
    ? svg(
        'sky',
        480,
        360,
        '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fc8ff"/><stop offset="1" stop-color="#dff3ff"/></linearGradient></defs>' +
          '<rect width="480" height="360" fill="url(#s)"/><circle cx="410" cy="60" r="26" fill="#ffe680"/>' +
          '<g fill="#fff" opacity="0.9"><ellipse cx="90" cy="70" rx="38" ry="15"/><ellipse cx="300" cy="100" rx="34" ry="13"/></g>',
        240,
        180,
      )
    : svg(
        'grass',
        480,
        360,
        '<rect width="480" height="360" fill="#a9d98b"/><g fill="#94c977"><circle cx="60" cy="80" r="6"/><circle cx="300" cy="200" r="7"/><circle cx="420" cy="60" r="5"/><circle cx="180" cy="300" r="6"/></g>',
        240,
        180,
      )

export const bannerCostumes = (): CanonicalCostume[] => {
  const banner = (name: string, text: string, color: string): CanonicalCostume =>
    svg(
      name,
      300,
      100,
      `<rect x="2" y="2" width="296" height="96" rx="18" fill="${color}" stroke="#222" stroke-width="4"/>` +
        `<text x="150" y="62" font-size="36" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#fff">${escapeXml(text)}</text>`,
    )
  return [banner('win', '過關！', '#3cb371'), banner('lose', '遊戲結束', '#d9534f')]
}
