import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createStudentProjectInstruction } from '../../src/core/capabilities/registry'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { CANONICAL_IR_FORMAT, type CanonicalProject } from '../../src/core/ir/types'
import {
  createScratchAssetFetcher,
  describeLibraryResolution,
  findLibraryBackdrop,
  findLibrarySound,
  findLibrarySprite,
  resolveLibraryAssets,
  selectLibraryCandidates,
  type LibraryAssetFetcher,
} from '../../src/core/visuals/library'
import { ZH_BACKDROP_KEYWORDS, ZH_SOUND_KEYWORDS, ZH_SPRITE_KEYWORDS } from '../../src/core/visuals/library-zh'
import { getProjectJson, loadSb3 } from '../../src/scratch/vm'

const svgBytes = (label: string): Uint8Array =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><title>${label}</title></svg>`,
  )

const wavBytes = (): Uint8Array => {
  const bytes = new Uint8Array(46)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 38, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 22050, true)
  view.setUint32(28, 44100, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, 2, true)
  return bytes
}

/**
 * Offline stand-in for the Scratch asset server that records which assets were requested.
 * @returns Fetcher with a `requested` log.
 */
const fakeFetcher = (): LibraryAssetFetcher & { requested: string[] } => {
  const requested: string[] = []
  const fetcher = (md5ext: string): Promise<Uint8Array> => {
    requested.push(md5ext)
    return Promise.resolve(md5ext.endsWith('.wav') ? wavBytes() : svgBytes(md5ext))
  }
  return Object.assign(fetcher, { requested })
}

const project = (sprites: CanonicalProject['sprites'], backdrop = 'Underwater 1'): CanonicalProject => ({
  format: CANONICAL_IR_FORMAT,
  version: 1,
  name: 'Library test',
  broadcasts: [],
  stage: {
    kind: 'stage',
    name: 'Stage',
    variables: [],
    lists: [],
    costumes: [{ name: backdrop, dataFormat: 'svg' }],
    sounds: [],
    scripts: [],
    procedures: [],
  },
  sprites,
})

const sprite = (
  name: string,
  costumes: CanonicalProject['sprites'][number]['costumes'],
  sounds: CanonicalProject['sprites'][number]['sounds'] = [],
): CanonicalProject['sprites'][number] => ({
  kind: 'sprite',
  name,
  variables: [],
  lists: [],
  costumes,
  sounds,
  scripts: [],
  procedures: [],
  x: 0,
  y: 0,
  direction: 90,
  size: 100,
  visible: true,
  draggable: false,
  rotationStyle: 'all around',
})

describe('Scratch asset library index', () => {
  it('maps every Chinese keyword to an existing library entry', () => {
    const missing = [
      ...Object.values(ZH_SPRITE_KEYWORDS)
        .flat()
        .filter((name) => !findLibrarySprite(name)),
      ...Object.values(ZH_BACKDROP_KEYWORDS)
        .flat()
        .filter((name) => !findLibraryBackdrop(name)),
      ...Object.values(ZH_SOUND_KEYWORDS)
        .flat()
        .filter((name) => !findLibrarySound(name)),
    ]
    expect(missing).toEqual([])
  })

  it('selects candidates that match the idea and keeps the list short', () => {
    const candidates = selectLibraryCandidates('做一個貓咪在海底接蘋果、躲鯊魚的遊戲，接到加分')
    const names = candidates.sprites.map((entry) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['Cat', 'Apple', 'Shark']))
    expect(names.indexOf('Apple')).toBeLessThan(names.indexOf('Rocks'))
    expect(candidates.backdrops[0]?.name).toMatch(/^Underwater/)
    expect(candidates.sounds).toEqual(expect.arrayContaining(['Coin']))
    expect(candidates.sprites.length).toBeLessThanOrEqual(24)
  })

  it('puts library candidates in the student prompt instead of hand-drawn presets', () => {
    const prompt = createStudentProjectInstruction('貓咪接蘋果')
    expect(prompt).toContain('Apple(Apple)')
    expect(prompt).toContain('Cat(Cat-a/Cat-b)')
    expect(prompt).toContain('自製素材')
    expect(prompt).not.toContain('generic-character')
  })
})

describe('resolveLibraryAssets', () => {
  it('fills named costumes, adds animation frames and the sprite sounds, and finds backdrops', async () => {
    const fetcher = fakeFetcher()
    const input = project([
      sprite('Apple', [{ name: 'Apple', dataFormat: 'svg' }]),
      sprite('小貓', [{ name: 'cat', dataFormat: 'svg' }]),
    ])
    const { project: resolved, report } = await resolveLibraryAssets(input, fetcher)

    expect(input.sprites[0]?.costumes[0]?.data).toBeUndefined()
    expect(resolved.stage.costumes[0]?.data).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(resolved.sprites[0]?.sounds.map(({ name }) => name)).toEqual(['Chomp'])
    const cat = resolved.sprites[1]
    expect(cat.costumes.map(({ name }) => name)).toEqual(['cat', 'Cat-b'])
    expect(cat.costumes[0]?.rotationCenterX).toBe(48)
    expect(cat.sounds.map(({ name }) => name)).toEqual(['Meow'])
    expect(report).toMatchObject({
      libraryCostumes: 3,
      addedAnimationCostumes: 1,
      librarySounds: 2,
      placeholderCostumes: [],
      fetchFailures: [],
    })
  })

  it('matches Chinese sprite names and named sounds', async () => {
    const { project: resolved, report } = await resolveLibraryAssets(
      project([sprite('鯊魚', [{ name: '鯊魚造型', dataFormat: 'svg' }], [{ name: 'Coin', dataFormat: 'wav' }])]),
      fakeFetcher(),
    )
    expect(resolved.sprites[0]?.costumes.map(({ name }) => name)).toEqual(['鯊魚造型', 'Shark-b'])
    expect(resolved.sprites[0]?.sounds[0]?.data).toMatch(/^data:audio\/wav;base64,/)
    expect(report.silentSounds).toEqual([])
  })

  it('leaves unknown names for the placeholder and reports them', async () => {
    const { project: resolved, report } = await resolveLibraryAssets(
      project([sprite('Qwzx', [{ name: 'qwzx', dataFormat: 'svg' }], [{ name: 'Qwzx', dataFormat: 'wav' }])]),
      fakeFetcher(),
    )
    expect(resolved.sprites[0]?.costumes[0]?.data).toBeUndefined()
    expect(report.placeholderCostumes).toEqual(['Qwzx/qwzx'])
    expect(report.silentSounds).toEqual(['Qwzx/Qwzx'])
    expect(describeLibraryResolution(report)).toContain('1 個造型找不到對應素材')
  })

  it('replaces model-drawn SVG only when asked', async () => {
    const drawn = project([
      sprite('Apple', [{ name: 'Apple', dataFormat: 'svg', data: '<svg xmlns="http://www.w3.org/2000/svg"/>' }]),
    ])
    const kept = await resolveLibraryAssets(drawn, fakeFetcher())
    expect(kept.project.sprites[0]?.costumes[0]?.data).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(kept.report.replacedModelSvg).toBe(0)

    const replaced = await resolveLibraryAssets(drawn, fakeFetcher(), { replaceModelSvg: true })
    expect(replaced.project.sprites[0]?.costumes[0]?.data).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(replaced.report.replacedModelSvg).toBe(1)
  })

  it('falls back to the placeholder when the download fails', async () => {
    const { project: resolved, report } = await resolveLibraryAssets(
      project([sprite('Apple', [{ name: 'Apple', dataFormat: 'svg' }])]),
      () => Promise.reject(new Error('offline')),
    )
    expect(resolved.sprites[0]?.costumes[0]?.data).toBeUndefined()
    expect(report.fetchFailures.length).toBeGreaterThan(0)
    expect(describeLibraryResolution(report)).toContain('下載失敗')
  })

  it('produces an SB3 that the Scratch VM loads with the library costumes and sounds', async () => {
    const { project: resolved } = await resolveLibraryAssets(
      project([sprite('Cat', [{ name: 'Cat-a', dataFormat: 'svg' }])]),
      fakeFetcher(),
    )
    const sb3 = await compileCanonicalProjectToSb3(resolved)
    const vm = await loadSb3(sb3)
    const targets = getProjectJson(vm).targets as {
      name: string
      costumes: { name: string }[]
      sounds: { name: string }[]
    }[]
    const cat = targets.find((target) => target.name === 'Cat')
    expect(cat?.costumes.map(({ name }) => name)).toEqual(['Cat-a', 'Cat-b'])
    expect(cat?.sounds.map(({ name }) => name)).toEqual(['Meow'])
    vm.quit()
  })
})

describe('createScratchAssetFetcher', () => {
  const bytes = svgBytes('real')
  const md5ext = `${createHash('md5').update(bytes).digest('hex')}.svg`
  const respond =
    (body: Uint8Array): typeof fetch =>
    () =>
      Promise.resolve(new Response(new Blob([body as Uint8Array<ArrayBuffer>])))

  it('accepts bytes whose MD5 matches the asset name', async () => {
    await expect(createScratchAssetFetcher(respond(bytes))(md5ext)).resolves.toEqual(bytes)
  })

  it('rejects tampered bytes and malformed names', async () => {
    await expect(createScratchAssetFetcher(respond(svgBytes('fake')))(md5ext)).rejects.toThrow(/MD5/)
    await expect(createScratchAssetFetcher(respond(bytes))('../etc/passwd')).rejects.toThrow(/Unexpected/)
  })
})
