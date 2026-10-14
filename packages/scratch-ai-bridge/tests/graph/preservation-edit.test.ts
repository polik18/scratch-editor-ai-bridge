import { describe, expect, it } from 'vitest'
import type { ScratchTargetBlockGraph } from '../../src/core/graph'
import {
  createPreservationEditPrompt,
  mergeScratchBlockGraph,
  parsePreservationEditPatch,
} from '../../src/core/graph'

const sourceTargets: ScratchTargetBlockGraph[] = [
  {
    targetIndex: 0,
    targetName: 'Stage',
    isStage: true,
    blocks: {
      root: {
        opcode: 'vendor_hat',
        next: null,
        parent: null,
        topLevel: true,
        inputs: {},
        mutation: { extension: 'preserved' },
        opaqueData: { version: 3 },
      },
    },
    issues: [],
  },
]

describe('preservation edit patch contract', () => {
  it('creates a scoped prompt with the source raw graph and patch-only rules', () => {
    const prompt = createPreservationEditPrompt(sourceTargets, '修正玩家移動腳本')
    expect(prompt).toContain('scratch-ai-bridge/block-graph-patch')
    expect(prompt).toContain('root')
    expect(prompt).toContain('opaqueData')
    expect(prompt).toContain('未列出的 target、block 與欄位必須保持原樣')
    expect(prompt).toContain('removeProperties')
    expect(prompt).toContain('修正玩家移動腳本')
  })

  it('parses partial edits bound to original target identity', () => {
    const result = parsePreservationEditPatch(
      JSON.stringify({
        format: 'scratch-ai-bridge/block-graph-patch',
        version: 1,
        patches: [
          {
            targetIndex: 0,
            targetName: 'Stage',
            isStage: true,
            blocks: { root: { fields: { MODE: ['safe', null] } } },
          },
        ],
      }),
      sourceTargets,
    )
    expect(result).toEqual([
      {
        targetIndex: 0,
        targetName: 'Stage',
        isStage: true,
        blocks: { root: { fields: { MODE: ['safe', null] } } },
      },
    ])
  })

  it('rejects target identity changes and duplicate target patches', () => {
    const patch = {
      targetIndex: 0,
      targetName: 'Stage',
      isStage: true,
      blocks: { root: { fields: { MODE: ['safe', null] } } },
    }
    const encode = (patches: unknown[]) =>
      JSON.stringify({ format: 'scratch-ai-bridge/block-graph-patch', version: 1, patches })
    const twoTargets = [
      ...sourceTargets,
      { ...sourceTargets[0], targetIndex: 1, targetName: 'Sprite1', isStage: false },
    ]

    expect(() => parsePreservationEditPatch(encode([{ ...patch, targetName: 'Sprite1' }]), sourceTargets)).toThrow(
      '與上傳專案不符',
    )
    expect(() => parsePreservationEditPatch(encode([patch, patch]), twoTargets)).toThrow('重複')
  })

  it('accepts explicit property removal operations on selected blocks', () => {
    const result = parsePreservationEditPatch(
      JSON.stringify({
        format: 'scratch-ai-bridge/block-graph-patch',
        version: 1,
        patches: [
          {
            targetIndex: 0,
            targetName: 'Stage',
            isStage: true,
            blocks: { root: { removeProperties: ['mutation'] } },
          },
        ],
      }),
      sourceTargets,
    )
    expect(result[0].blocks.root).toEqual({ removeProperties: ['mutation'] })
    const duplicateProperties = JSON.stringify({
      format: 'scratch-ai-bridge/block-graph-patch',
      version: 1,
      patches: [
        {
          targetIndex: 0,
          targetName: 'Stage',
          isStage: true,
          blocks: { root: { removeProperties: ['mutation', 'mutation'] } },
        },
      ],
    })
    expect(() => parsePreservationEditPatch(duplicateProperties, sourceTargets)).toThrow('唯一、非空')
    const conflictingProperties = JSON.stringify({
      format: 'scratch-ai-bridge/block-graph-patch',
      version: 1,
      patches: [
        {
          targetIndex: 0,
          targetName: 'Stage',
          isStage: true,
          blocks: { root: { mutation: {}, removeProperties: ['mutation'] } },
        },
      ],
    })
    expect(() => parsePreservationEditPatch(conflictingProperties, sourceTargets)).toThrow('唯一、非空')
    const emptyProperties = JSON.stringify({
      format: 'scratch-ai-bridge/block-graph-patch',
      version: 1,
      patches: [{ targetIndex: 0, targetName: 'Stage', isStage: true, blocks: { root: { removeProperties: [] } } }],
    })
    expect(() => parsePreservationEditPatch(emptyProperties, sourceTargets)).toThrow('唯一、非空')
  })

  it('rejects deletion of a block ID that is absent from the source graph', () => {
    expect(() => mergeScratchBlockGraph(sourceTargets[0].blocks, { missing: null })).toThrow(
      'cannot delete a missing block',
    )
  })

  it('accepts nested path edits while keeping opaque sibling values intact', () => {
    const nestedTargets = structuredClone(sourceTargets)
    nestedTargets[0].blocks.root.mutation = {
      argumentids: '["old"]',
      argumentnames: '["keep"]',
      vendorMetadata: { revision: 4 },
    }
    const [patch] = parsePreservationEditPatch(
      JSON.stringify({
        format: 'scratch-ai-bridge/block-graph-patch',
        version: 1,
        patches: [
          {
            targetIndex: 0,
            targetName: 'Stage',
            isStage: true,
            blocks: {
              root: {
                setPaths: [{ path: '/mutation/argumentids', value: '["new"]' }],
                removePaths: ['/mutation/argumentnames'],
              },
            },
          },
        ],
      }),
      nestedTargets,
    )
    const merged = mergeScratchBlockGraph(nestedTargets[0].blocks, patch.blocks)
    expect(merged.root.mutation).toEqual({ argumentids: '["new"]', vendorMetadata: { revision: 4 } })
    expect(nestedTargets[0].blocks.root.mutation).toEqual({
      argumentids: '["old"]',
      argumentnames: '["keep"]',
      vendorMetadata: { revision: 4 },
    })
  })

  it('rejects unsafe or conflicting nested path edits', () => {
    const encode = (block: unknown) =>
      JSON.stringify({
        format: 'scratch-ai-bridge/block-graph-patch',
        version: 1,
        patches: [{ targetIndex: 0, targetName: 'Stage', isStage: true, blocks: { root: block } }],
      })
    for (const block of [
      { setPaths: [{ path: '/mutation/__proto__/polluted', value: true }] },
      { setPaths: [{ path: '/mutation/vendor', value: true }], mutation: {} },
      { removePaths: ['/mutation/vendor', '/mutation/vendor'] },
      {
        setPaths: [
          { path: '/mutation/vendorMetadata', value: { revision: 2 } },
          { path: '/mutation/vendorMetadata/revision', value: 3 },
        ],
      },
      {
        setPaths: [{ path: '/mutation/vendorMetadata/revision', value: 3 }],
        removePaths: ['/mutation/vendorMetadata'],
      },
      { setPaths: [{ path: 'mutation/vendor', value: true }] },
    ])
      expect(() => parsePreservationEditPatch(encode(block), sourceTargets)).toThrow()
  })

  it('rejects ancestor and descendant edits at the raw graph merge boundary', () => {
    const base = structuredClone(sourceTargets[0].blocks)
    base.root.mutation = { vendorMetadata: { revision: 1, opaque: true } }
    expect(() =>
      mergeScratchBlockGraph(base, {
        root: {
          setPaths: [
            { path: '/mutation/vendorMetadata', value: { revision: 2, opaque: true } },
            { path: '/mutation/vendorMetadata/revision', value: 3 },
          ],
        },
      }),
    ).toThrow('overlapping paths')
  })

  it('round-trips generated JSON Pointer segments containing slash and tilde escapes', () => {
    const targets = structuredClone(sourceTargets)
    const nested = Object.fromEntries(
      Array.from({ length: 128 }, (_, index) => [`vendor/${index}~opaque`, { revision: index, keep: true }]),
    )
    targets[0].blocks.root.mutation = nested
    const setPaths = Object.keys(nested).map((key, index) => ({
      path: `/mutation/${key.replaceAll('~', '~0').replaceAll('/', '~1')}/revision`,
      value: index + 1,
    }))
    const [patch] = parsePreservationEditPatch(
      JSON.stringify({
        format: 'scratch-ai-bridge/block-graph-patch',
        version: 1,
        patches: [{ targetIndex: 0, targetName: 'Stage', isStage: true, blocks: { root: { setPaths } } }],
      }),
      targets,
    )
    const merged = mergeScratchBlockGraph(targets[0].blocks, patch.blocks)

    for (const [index, key] of Object.keys(nested).entries()) {
      expect(merged.root.mutation).toHaveProperty(`${key}.revision`, index + 1)
      expect(merged.root.mutation).toHaveProperty(`${key}.keep`, true)
    }
    expect(targets[0].blocks.root.mutation).toEqual(nested)
  })

  it('rejects invalid envelopes, malformed block nodes, and oversized input', () => {
    expect(() => parsePreservationEditPatch('{}', sourceTargets)).toThrow('格式或版本')
    const invalidBlock = JSON.stringify({
      format: 'scratch-ai-bridge/block-graph-patch',
      version: 1,
      patches: [{ targetIndex: 0, targetName: 'Stage', isStage: true, blocks: { added: 7 } }],
    })
    expect(() => parsePreservationEditPatch(invalidBlock, sourceTargets)).toThrow('必須是物件或 null')
    expect(() => parsePreservationEditPatch('x'.repeat(1_000_001), sourceTargets)).toThrow('1,000,000')
  })

  it('rejects an empty request before exposing a source graph to the AI', () => {
    expect(() => createPreservationEditPrompt(sourceTargets, '  ')).toThrow('希望 AI 修改')
    expect(() => createPreservationEditPrompt(sourceTargets, 'x'.repeat(2_001))).toThrow('2,000')
  })
})
