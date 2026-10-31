import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  patchRawSb3Properties,
  patchRawSb3Variables,
  rawSb3Revision,
} from '../../src/core/archive/raw-property-patch'
import { exportLosslessSb3, importLosslessSb3 } from '../../src/core/archive/sb3-archive'

const fixture = async (duplicate = false) => {
  const zip = new JSZip()
  const sprite = { name: 'Cat', isStage: false, x: 0, visible: true, costumes: [{}], custom: { keep: true } }
  zip.file(
    'project.json',
    JSON.stringify({ targets: [sprite, ...(duplicate ? [sprite] : [])], unknown: { keep: 1 } }),
  )
  zip.file('asset.svg', '<svg/>')
  return importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
}

describe('raw SB3 property patches', () => {
  it('preserves assets and unrelated data through export and import', async () => {
    const original = await fixture()
    const changed = patchRawSb3Properties(original, rawSb3Revision(original), [
      { targetName: 'Cat', property: 'x', expected: 0, value: 24 },
    ])
    expect(rawSb3Revision(changed)).not.toBe(rawSb3Revision(original))
    const restored = await importLosslessSb3(await exportLosslessSb3(changed))
    expect(rawSb3Revision(restored)).toBe(rawSb3Revision(changed))
    expect(restored.projectJson.unknown).toEqual({ keep: 1 })
    expect(restored.projectJson.targets).toEqual([
      { name: 'Cat', isStage: false, x: 24, visible: true, costumes: [{}], custom: { keep: true } },
    ])
    expect(restored.entries.find((entry) => entry.name === 'asset.svg')?.sha256).toBe(
      original.entries.find((entry) => entry.name === 'asset.svg')?.sha256,
    )
    expect((original.projectJson.targets as { x: number }[])[0].x).toBe(0)
  })
  it('rejects stale revisions, ambiguous targets and invalid changes without mutating the source', async () => {
    const original = await fixture()
    const change = { targetName: 'Cat', property: 'x' as const, expected: 0, value: 2 }
    expect(() => patchRawSb3Properties(original, 'old', [change])).toThrow(/revision/)
    expect(() => patchRawSb3Properties(original, rawSb3Revision(original), [{ ...change, expected: 9 }])).toThrow(
      /old value/,
    )
    expect(() => patchRawSb3Properties(original, rawSb3Revision(original), [{ ...change, value: NaN }])).toThrow(
      /Invalid value/,
    )
    const duplicate = await fixture(true)
    expect(() => patchRawSb3Properties(duplicate, rawSb3Revision(duplicate), [change])).toThrow(/ambiguous/)
    expect((original.projectJson.targets as { x: number }[])[0].x).toBe(0)
  })
  it('updates only the identified non-cloud scalar variable and preserves other data', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          { name: 'Stage', isStage: true, variables: { a: ['score', 1], b: ['☁ cloud', 2, true] }, unknown: 7 },
        ],
      }),
    )
    const original = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(original)
    const changed = patchRawSb3Variables(original, revision, [
      { targetName: 'Stage', variableId: 'a', expected: 1, value: 42 },
    ])
    const restored = await importLosslessSb3(await exportLosslessSb3(changed))
    expect(restored.projectJson.targets).toEqual([
      { name: 'Stage', isStage: true, variables: { a: ['score', 42], b: ['☁ cloud', 2, true] }, unknown: 7 },
    ])
    expect(() =>
      patchRawSb3Variables(original, revision, [{ targetName: 'Stage', variableId: 'b', expected: 2, value: 3 }]),
    ).toThrow(/non-cloud/)
    expect(() =>
      patchRawSb3Variables(changed, revision, [{ targetName: 'Stage', variableId: 'a', expected: 42, value: 3 }]),
    ).toThrow(/revision/)
  })
})
