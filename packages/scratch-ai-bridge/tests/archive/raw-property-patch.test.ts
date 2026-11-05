import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { proposeRawLivePatch } from '../../src/core/ai/raw-tool-core'
import {
  patchRawSb3Properties,
  patchRawSb3Variables,
  rawSb3Revision,
} from '../../src/core/archive/raw-property-patch'
import { exportLosslessSb3, importLosslessSb3 } from '../../src/core/archive/sb3-archive'
import { captureScratchTargetProgress, getVariable, loadSb3, runForTicks } from '../../src/scratch/vm'

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

  it('warns when green-flag scripts overwrite initial sprite properties or variables and verifies observable before/after runtime behavior in Scratch VM', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
    const assetFile = 'cd21514d0531fdffb22204e0ec5ed84a.svg'
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          {
            isStage: true,
            name: 'Stage',
            variables: { scoreVar: ['score', 1] },
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [
              {
                name: 'backdrop1',
                dataFormat: 'svg',
                assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
                md5ext: assetFile,
                rotationCenterX: 5,
                rotationCenterY: 5,
              },
            ],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on',
            textToSpeechLanguage: null,
          },
          {
            isStage: false,
            name: 'Cat',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {
              hat: {
                opcode: 'event_whenflagclicked',
                next: 'resetX',
                parent: null,
                inputs: {},
                fields: {},
                shadow: false,
                topLevel: true,
                x: 0,
                y: 0,
              },
              resetX: {
                opcode: 'motion_setx',
                next: 'move',
                parent: 'hat',
                inputs: { X: [1, [4, '0']] },
                fields: {},
                shadow: false,
                topLevel: false,
              },
              move: {
                opcode: 'motion_movesteps',
                next: 'addScore',
                parent: 'resetX',
                inputs: { STEPS: [1, [4, '10']] },
                fields: {},
                shadow: false,
                topLevel: false,
                vendorExtra: { preserve: true },
              },
              addScore: {
                opcode: 'data_changevariableby',
                next: null,
                parent: 'move',
                inputs: { VALUE: [1, [4, '5']] },
                fields: { VARIABLE: ['score', 'scoreVar'] },
                shadow: false,
                topLevel: false,
              },
            },
            comments: {},
            currentCostume: 0,
            costumes: [
              {
                name: 'costume1',
                dataFormat: 'svg',
                assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
                md5ext: assetFile,
                rotationCenterX: 5,
                rotationCenterY: 5,
              },
            ],
            sounds: [],
            volume: 100,
            layerOrder: 1,
            visible: true,
            x: 0,
            y: 0,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around',
          },
        ],
        monitors: [],
        extensions: [],
        meta: { semver: '3.0.0', vm: '0.2.0', agent: 'test' },
      }),
    )
    zip.file(assetFile, svg)
    const originalBytes = await zip.generateAsync({ type: 'uint8array' })
    const original = await importLosslessSb3(originalBytes)
    const revision = rawSb3Revision(original)

    // 1. Property patch on x warns about motion_setx overwrite, and VM execution confirms x is overwritten by resetX(0) + move(10) = 10
    const propProposal = proposeRawLivePatch(
      original,
      JSON.stringify({
        format: 'scratch-ai-bridge/raw-patch',
        version: 1,
        baseRevision: revision,
        summary: '將角色初始 X 設為 120',
        change: { kind: 'property', targetName: 'Cat', property: 'x', expected: 0, value: 120 },
      }),
    )
    expect(propProposal.warnings).toContain(
      '注意：Cat 的腳本含有設定 x 的積木（如綠旗初始化），執行時可能會覆寫此初始屬性。',
    )
    const propBytes = await exportLosslessSb3(propProposal.project)
    const propVm = await loadSb3(propBytes)
    try {
      const beforeRun = captureScratchTargetProgress(propVm).find((t) => t.name === 'Cat')
      expect(beforeRun?.x).toBe(120)
      runForTicks(propVm, 10)
      const afterRun = captureScratchTargetProgress(propVm).find((t) => t.name === 'Cat')
      expect(afterRun?.x).toBe(10)
      expect(getVariable(propVm, 'Stage', 'score')?.value).toBe(6)
    } finally {
      propVm.quit()
    }

    // 2. Block patch changing motion_movesteps from 10 to 45 and data_changevariableby from 5 to 20 produces observable runtime difference
    const blockProposal = proposeRawLivePatch(
      original,
      JSON.stringify({
        format: 'scratch-ai-bridge/raw-patch',
        version: 1,
        baseRevision: revision,
        summary: '將綠旗後的移動距離改為 45、加分改為 20',
        change: {
          kind: 'blocks',
          graphPatch: {
            format: 'scratch-ai-bridge/block-graph-patch',
            version: 1,
            patches: [
              {
                targetIndex: 1,
                targetName: 'Cat',
                isStage: false,
                blocks: {
                  move: { inputs: { STEPS: [1, [4, '45']] } },
                  addScore: { inputs: { VALUE: [1, [4, '20']] } },
                },
              },
            ],
          },
        },
      }),
    )
    expect(blockProposal.requiresVmValidation).toBe(true)
    const patchedBytes = await exportLosslessSb3(blockProposal.project)
    const patchedReloaded = await importLosslessSb3(patchedBytes)
    const patchedTargets = patchedReloaded.projectJson.targets as {
      blocks: Record<string, Record<string, unknown>>
    }[]
    expect(patchedTargets[1]?.blocks.move?.vendorExtra).toEqual({ preserve: true })
    expect(patchedReloaded.entries.find((e) => e.name === assetFile)?.sha256).toBe(
      original.entries.find((e) => e.name === assetFile)?.sha256,
    )

    const patchedVm = await loadSb3(patchedBytes)
    try {
      runForTicks(patchedVm, 10)
      const afterPatchedRun = captureScratchTargetProgress(patchedVm).find((t) => t.name === 'Cat')
      expect(afterPatchedRun?.x).toBe(45)
      expect(getVariable(patchedVm, 'Stage', 'score')?.value).toBe(21)
    } finally {
      patchedVm.quit()
    }
  })
})
