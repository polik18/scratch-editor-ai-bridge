import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { importLosslessSb3 } from '../../src/core/archive'
import { normalizeThroughVm } from '../../src/core/decompiler/decompiler'

const commentsFixturePath = fileURLToPath(new URL('../../../scratch-vm/test/fixtures/comments.sb3', import.meta.url))

describe('normalizeThroughVm', () => {
  it('reports seeded unknown project metadata normalized away by the official VM', async () => {
    const sourceBytes = await readFile(commentsFixturePath)
    const zip = await JSZip.loadAsync(sourceBytes)
    const projectEntry = zip.file('project.json')
    if (!projectEntry) throw new Error('official comments fixture has no project.json')
    const originalProject = JSON.parse(await projectEntry.async('string')) as Record<string, unknown>
    const unknownValues: unknown[] = [
      null,
      false,
      42.5,
      'opaque/雪😀',
      ['nested', 7, { escaped: 'vendor/~value' }],
      { seed: 0, nested: { path: 'vendor', values: [true, null, '中😀'] } },
    ]

    for (let sample = 0; sample < 64; sample += 1) {
      const project = structuredClone(originalProject)
      const key = `rootNormalizationProbe/${sample}~`
      const value = structuredClone(unknownValues[sample % unknownValues.length])
      project[key] = value
      zip.file('project.json', JSON.stringify(project))
      const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

      const result = await normalizeThroughVm(source)
      const normalized = await importLosslessSb3(result.archive)
      const path = `/rootNormalizationProbe~1${sample}~0`
      const change = result.report.projectJsonChanges.find(({ path: changedPath }) => changedPath === path)
      const beforeType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

      expect(result.report.format, `seed ${sample}`).toBe('scratch-ai-bridge/vm-normalization-report')
      expect(result.report.version, `seed ${sample}`).toBe(1)
      expect(change, `seed ${sample}`).toMatchObject({
        kind: 'removed',
        beforeType,
        afterType: null,
      })
      expect(result.report.sourceProjectJsonSha256, `seed ${sample}`).not.toBe(
        result.report.normalizedProjectJsonSha256,
      )
      expect(normalized.projectJson).not.toHaveProperty(key)
      expect(result.report.archiveEntryChanges.find(({ name }) => name === 'project.json')?.kind).toBe(
        'content-changed',
      )
      expect(result.report.archiveEntryChanges.some(({ kind }) => kind === 'unchanged')).toBe(true)
    }
  })

  it('reports unknown nested target, block, and costume properties removed by the official VM', async () => {
    const sourceBytes = await readFile(commentsFixturePath)
    const sourceZip = await JSZip.loadAsync(sourceBytes)
    const projectEntry = sourceZip.file('project.json')
    if (!projectEntry) throw new Error('official comments fixture has no project.json')
    interface ProbeTarget {
      isStage?: boolean
      blocks: Record<string, Record<string, unknown>>
      costumes: Record<string, unknown>[]
      [key: string]: unknown
    }
    const originalProject = JSON.parse(await projectEntry.async('string')) as {
      targets: ProbeTarget[]
    }
    const spriteIndex = originalProject.targets.findIndex((target) => target.isStage !== true)
    if (spriteIndex < 0) throw new Error('official comments fixture lacks a sprite for nested normalization checks')
    const originalSprite = originalProject.targets[spriteIndex]
    const blockIds = Object.keys(originalSprite.blocks)
    const costumeCount = originalSprite.costumes.length
    if (blockIds.length === 0 || costumeCount === 0) {
      throw new Error('official comments fixture lacks a sprite, block, or costume for nested normalization checks')
    }
    for (let sample = 0; sample < 32; sample += 1) {
      const project = structuredClone(originalProject)
      const targetIndex = sample % project.targets.length
      const target = project.targets[targetIndex]
      const sprite = project.targets[spriteIndex]
      const blockId = blockIds[sample % blockIds.length]
      const costumeIndex = sample % costumeCount
      const probeKey = `vendor/probe~metadata/${sample}`
      const payload = {
        source: `unknown-field-${sample}`,
        nested: { text: `雪🚀/${sample}~`, values: [sample, sample % 2 === 0, null] },
      }
      target[probeKey] = payload
      sprite.blocks[blockId][probeKey] = payload
      sprite.costumes[costumeIndex][probeKey] = payload
      sourceZip.file('project.json', JSON.stringify(project))

      const source = await sourceZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      const sourceArchive = await importLosslessSb3(source)
      const result = await normalizeThroughVm(source)
      const normalized = await importLosslessSb3(result.archive)
      const escapedKey = probeKey.replaceAll('~', '~0').replaceAll('/', '~1')
      const escapedBlockId = blockId.replaceAll('~', '~0').replaceAll('/', '~1')
      const expectedPaths = [
        `/targets/${targetIndex}/${escapedKey}`,
        `/targets/${spriteIndex}/blocks/${escapedBlockId}/${escapedKey}`,
        `/targets/${spriteIndex}/costumes/${costumeIndex}/${escapedKey}`,
      ]

      for (const pointer of expectedPaths) {
        expect(
          result.report.projectJsonChanges.find(({ path }) => path === pointer),
          `seed ${sample} ${pointer}`,
        ).toMatchObject({
          kind: 'removed',
          beforeType: 'object',
          afterType: null,
        })
      }
      const normalizedProject = normalized.projectJson as { targets: ProbeTarget[] }
      expect(normalizedProject.targets[targetIndex]).not.toHaveProperty(probeKey)
      expect(normalizedProject.targets[spriteIndex]).not.toHaveProperty(probeKey)
      expect(normalizedProject.targets[spriteIndex].blocks[blockId]).not.toHaveProperty(probeKey)
      expect(normalizedProject.targets[spriteIndex].costumes[costumeIndex]).not.toHaveProperty(probeKey)
      const unchangedEntries = result.report.archiveEntryChanges.filter(({ kind }) => kind === 'unchanged')
      expect(unchangedEntries.length, `unchanged archive entries seed ${sample}`).toBeGreaterThan(0)
      for (const entry of unchangedEntries) {
        expect(entry.sourceSha256, `source report hash seed ${sample} / ${entry.name}`).toBe(entry.normalizedSha256)
        expect(sourceArchive.entries.find(({ name }) => name === entry.name)?.sha256).toBe(entry.sourceSha256)
        expect(normalized.entries.find(({ name }) => name === entry.name)?.sha256).toBe(entry.normalizedSha256)
      }
    }
  })
})
