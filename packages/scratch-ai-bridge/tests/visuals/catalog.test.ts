import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importLosslessSb3 } from '../../src/core/archive'
import { buildScratchProjectArchive, compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { CANONICAL_IR_FORMAT, type CanonicalProject } from '../../src/core/ir/types'
import {
  createAssetLibraryCatalog,
  inspectProjectAssetProvenance,
  queryAssetLibrary,
  resolveVerifiedCatalogAsset,
} from '../../src/core/visuals/catalog'
import { getTargets, loadSb3 } from '../../src/scratch/vm'

const md5Hex = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex')

const makeSilentWavBytes = (): Uint8Array => {
  const bytes = new Uint8Array(46)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, 38, true)
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 22050, true)
  view.setUint32(28, 44100, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  bytes.set(new TextEncoder().encode('data'), 36)
  view.setUint32(40, 2, true)
  return bytes
}

describe('Scratch asset library catalog & provenance adapter (A0/A1)', () => {
  const abbyASvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="62" height="200"><circle cx="31" cy="100" r="20" fill="#ff8800"/></svg>',
  )
  const abbyBSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="62" height="200"><rect x="10" y="50" width="42" height="100" fill="#0088ff"/></svg>',
  )
  const arcticSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#eef8ff"/></svg>',
  )
  const popWav = makeSilentWavBytes()

  const abbyAId = md5Hex(abbyASvg)
  const abbyBId = md5Hex(abbyBSvg)
  const arcticId = md5Hex(arcticSvg)
  const popId = md5Hex(popWav)

  const fixtureCatalog = createAssetLibraryCatalog({
    catalogRevision: 'fixture-catalog-v1',
    costumes: [
      {
        name: 'Abby-a',
        assetId: abbyAId,
        md5ext: `${abbyAId}.svg`,
        dataFormat: 'svg',
        bitmapResolution: 1,
        rotationCenterX: 31,
        rotationCenterY: 100,
        tags: ['people', 'person'],
      },
      {
        name: 'Abby-b',
        assetId: abbyBId,
        md5ext: `${abbyBId}.svg`,
        dataFormat: 'svg',
        bitmapResolution: 1,
        rotationCenterX: 31,
        rotationCenterY: 100,
        tags: ['people', 'person'],
      },
      {
        name: 'Shared-Visual-Alias',
        assetId: abbyAId,
        md5ext: `${abbyAId}.svg`,
        dataFormat: 'svg',
        bitmapResolution: 1,
        rotationCenterX: 31,
        rotationCenterY: 100,
        tags: ['alias'],
      },
      {
        name: 'Duplicate-Costume',
        assetId: abbyAId,
        md5ext: `${abbyAId}.svg`,
        dataFormat: 'svg',
        tags: ['dup'],
      },
      {
        name: 'Duplicate-Costume',
        assetId: abbyBId,
        md5ext: `${abbyBId}.svg`,
        dataFormat: 'svg',
        tags: ['dup'],
      },
    ],
    backdrops: [
      {
        name: 'Arctic',
        assetId: arcticId,
        md5ext: `${arcticId}.svg`,
        dataFormat: 'svg',
        bitmapResolution: 1,
        rotationCenterX: 240,
        rotationCenterY: 180,
        tags: ['outdoors', 'cold', 'ice'],
      },
    ],
    sounds: [
      {
        name: 'Pop',
        assetId: popId,
        md5ext: `${popId}.wav`,
        dataFormat: 'wav',
        rate: 22050,
        sampleCount: 1,
        tags: ['effects'],
      },
    ],
    sprites: [
      {
        name: 'Abby',
        tags: ['people', 'person'],
        costumes: [
          {
            name: 'Abby-a',
            assetId: abbyAId,
            md5ext: `${abbyAId}.svg`,
            dataFormat: 'svg',
            bitmapResolution: 1,
            rotationCenterX: 31,
            rotationCenterY: 100,
            tags: ['people'],
          },
          {
            name: 'Abby-b',
            assetId: abbyBId,
            md5ext: `${abbyBId}.svg`,
            dataFormat: 'svg',
            bitmapResolution: 1,
            rotationCenterX: 31,
            rotationCenterY: 100,
            tags: ['people'],
          },
        ],
        sounds: [
          {
            name: 'Pop',
            assetId: popId,
            md5ext: `${popId}.wav`,
            dataFormat: 'wav',
            rate: 22050,
            sampleCount: 1,
            tags: ['effects'],
          },
        ],
      },
    ],
  })

  const byteMap = new Map<string, Uint8Array>([
    [`${abbyAId}.svg`, abbyASvg],
    [`${abbyBId}.svg`, abbyBSvg],
    [`${arcticId}.svg`, arcticSvg],
    [`${popId}.wav`, popWav],
  ])

  it('paginates catalog queries by kind, query, tag, and md5ext', () => {
    const page1 = queryAssetLibrary(fixtureCatalog, { kind: 'costume', offset: 0, limit: 2 })
    expect(page1.catalogRevision).toBe('fixture-catalog-v1')
    expect(page1.total).toBe(5)
    expect(page1.items).toHaveLength(2)
    expect(page1.nextOffset).toBe(2)

    const byTag = queryAssetLibrary(fixtureCatalog, { kind: 'backdrop', tag: 'cold' })
    expect(byTag.items.map((item) => item.name)).toEqual(['Arctic'])

    const byMd5 = queryAssetLibrary(fixtureCatalog, { kind: 'costume', md5ext: `${abbyAId}.svg` })
    expect(byMd5.items.map((item) => item.name)).toEqual(['Abby-a', 'Shared-Visual-Alias', 'Duplicate-Costume'])
  })

  it('resolves verified multi-costume sprites, backdrops, and sounds, preserves metadata, and reloads offline in Scratch VM', async () => {
    const loadBytes = (md5ext: string): Promise<Uint8Array> => {
      const found = byteMap.get(md5ext)
      if (!found) return Promise.reject(new Error(`Offline: asset ${md5ext} is unavailable`))
      return Promise.resolve(found)
    }

    const resolvedBackdrop = await resolveVerifiedCatalogAsset(
      fixtureCatalog,
      { kind: 'backdrop', name: 'Arctic', md5ext: `${arcticId}.svg` },
      loadBytes,
    )
    expect(resolvedBackdrop.kind).toBe('backdrop')
    if (resolvedBackdrop.kind !== 'backdrop') throw new Error('expected backdrop')
    expect(resolvedBackdrop.assetId).toBe(arcticId)
    expect(resolvedBackdrop.md5ext).toBe(`${arcticId}.svg`)
    expect(resolvedBackdrop.costume).toMatchObject({
      name: 'Arctic',
      rotationCenterX: 240,
      rotationCenterY: 180,
    })

    const resolvedSprite = await resolveVerifiedCatalogAsset(
      fixtureCatalog,
      { kind: 'sprite', name: 'Abby' },
      loadBytes,
    )
    expect(resolvedSprite.kind).toBe('sprite')
    if (resolvedSprite.kind !== 'sprite') throw new Error('expected sprite')
    expect(resolvedSprite.costumes).toHaveLength(2)
    expect(resolvedSprite.sounds).toHaveLength(1)
    expect(resolvedSprite.costumes[0]?.rotationCenterX).toBe(31)
    expect(resolvedSprite.sounds[0]?.rate).toBe(22050)

    const project: CanonicalProject = {
      format: CANONICAL_IR_FORMAT,
      version: 1,
      name: 'Verified Catalog Project',
      stage: {
        kind: 'stage',
        name: 'Stage',
        tempo: 60,
        videoTransparency: 50,
        currentCostume: 0,
        volume: 100,
        costumes: [resolvedBackdrop.costume],
        sounds: [],
        variables: [],
        lists: [],
        scripts: [],
        procedures: [],
      },
      sprites: [
        {
          kind: 'sprite',
          name: resolvedSprite.name,
          x: 0,
          y: 0,
          direction: 90,
          size: 100,
          visible: true,
          draggable: false,
          rotationStyle: 'all around',
          currentCostume: 0,
          volume: 100,
          costumes: [...resolvedSprite.costumes],
          sounds: [...resolvedSprite.sounds],
          variables: [],
          lists: [],
          scripts: [],
          procedures: [],
        },
      ],
      broadcasts: [],
      extensions: [],
      meta: { version: '1.0', scratch: '3.0', language: 'en' },
      monitors: [],
    }

    const sb3Bytes = await buildScratchProjectArchive(project)
    const imported = await importLosslessSb3(sb3Bytes)
    const provenance = inspectProjectAssetProvenance(imported, fixtureCatalog)

    expect(provenance).toHaveLength(4)
    expect(provenance.every((item) => item.provenance === 'scratch-catalog-exact' && item.md5Verified)).toBe(true)
    const abbyAProvenance = provenance.find((item) => item.name === 'Abby-a')
    expect(abbyAProvenance?.catalogMatches).toEqual([
      'costume:Abby-a',
      'costume:Shared-Visual-Alias',
      'costume:Duplicate-Costume',
    ])

    const vm = await loadSb3(sb3Bytes)
    try {
      const targets = getTargets(vm)
      expect(targets.map((t) => t.getName())).toEqual(['Stage', 'Abby'])
    } finally {
      vm.quit()
    }
    expect((await compileCanonicalProjectToSb3(project)).size).toBeGreaterThan(0)
  })

  it('rejects ambiguous duplicate names, stale catalog revisions, corrupted bytes, and offline failures without silent fallback, and succeeds on retry', async () => {
    const loadBytes = (md5ext: string): Promise<Uint8Array> => {
      const found = byteMap.get(md5ext)
      if (!found) return Promise.reject(new Error(`Offline: ${md5ext}`))
      return Promise.resolve(found)
    }

    await expect(
      resolveVerifiedCatalogAsset(fixtureCatalog, { kind: 'costume', name: 'Duplicate-Costume' }, loadBytes),
    ).rejects.toThrow(/ambiguous/)

    const disambiguated = await resolveVerifiedCatalogAsset(
      fixtureCatalog,
      { kind: 'costume', name: 'Duplicate-Costume', md5ext: `${abbyBId}.svg` },
      loadBytes,
    )
    expect(disambiguated.kind === 'costume' && disambiguated.assetId).toBe(abbyBId)

    await expect(
      resolveVerifiedCatalogAsset(
        fixtureCatalog,
        { kind: 'costume', name: 'Abby-a', catalogRevision: 'stale-revision' },
        loadBytes,
      ),
    ).rejects.toThrow(/Catalog revision mismatch/)

    await expect(
      resolveVerifiedCatalogAsset(fixtureCatalog, { kind: 'costume', name: 'Abby-a' }, () =>
        Promise.resolve(new Uint8Array([1, 2, 3])),
      ),
    ).rejects.toThrow(/MD5 mismatch/)

    let attempts = 0
    const flakyLoader = async (md5ext: string): Promise<Uint8Array> => {
      attempts += 1
      if (attempts === 1) throw new Error('Network offline')
      return loadBytes(md5ext)
    }
    await expect(
      resolveVerifiedCatalogAsset(fixtureCatalog, { kind: 'costume', name: 'Abby-a' }, flakyLoader),
    ).rejects.toThrow(/Network offline/)
    const recovered = await resolveVerifiedCatalogAsset(
      fixtureCatalog,
      { kind: 'costume', name: 'Abby-a' },
      flakyLoader,
    )
    expect(recovered.kind === 'costume' && recovered.assetId).toBe(abbyAId)
  })

  it('loads the local Scratch GUI catalog JSON files and verifies Paper Minecraft provenance when present', async () => {
    const guiLibDir = resolve(process.cwd(), '../scratch-gui/src/lib/libraries')
    const [costumesJson, backdropsJson, soundsJson, spritesJson] = await Promise.all([
      readFile(resolve(guiLibDir, 'costumes.json'), 'utf8'),
      readFile(resolve(guiLibDir, 'backdrops.json'), 'utf8'),
      readFile(resolve(guiLibDir, 'sounds.json'), 'utf8'),
      readFile(resolve(guiLibDir, 'sprites.json'), 'utf8'),
    ])
    const guiCatalog = createAssetLibraryCatalog({
      catalogRevision: 'scratch-gui-73ea966d87',
      costumes: JSON.parse(costumesJson) as unknown[],
      backdrops: JSON.parse(backdropsJson) as unknown[],
      sounds: JSON.parse(soundsJson) as unknown[],
      sprites: JSON.parse(spritesJson) as unknown[],
    })
    expect(guiCatalog.costumes).toHaveLength(915)
    expect(guiCatalog.backdrops).toHaveLength(85)
    expect(guiCatalog.sounds).toHaveLength(354)
    expect(guiCatalog.sprites).toHaveLength(343)

    const paperPath = '/Users/huangjianzhe/Desktop/Paper Minecraft v11.7 (Minecraft 2D).sb3'
    if (existsSync(paperPath)) {
      const paperBytes = new Uint8Array(await readFile(paperPath))
      const imported = await importLosslessSb3(paperBytes)
      const provenance = inspectProjectAssetProvenance(imported, guiCatalog)
      const visualItems = provenance.filter((item) => item.kind === 'costume' || item.kind === 'backdrop')
      const soundItems = provenance.filter((item) => item.kind === 'sound')
      expect(visualItems).toHaveLength(748)
      expect(visualItems.filter((item) => item.provenance === 'scratch-catalog-exact')).toHaveLength(0)
      expect(visualItems.filter((item) => item.provenance === 'embedded-non-catalog')).toHaveLength(748)
      expect(soundItems).toHaveLength(90)
      expect(soundItems.filter((item) => item.provenance === 'scratch-catalog-exact')).toHaveLength(25)
      expect(soundItems.filter((item) => item.provenance === 'embedded-non-catalog')).toHaveLength(65)
    }
  })
})
