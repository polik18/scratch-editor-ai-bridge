import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { requestOpenAiCompatiblePatch } from '../../src/core/ai/openai-compatible'
import {
  inspectRawBlocks,
  inspectRawProjectForAi,
  inspectRawTargets,
  inspectRawVariables,
  proposeRawLivePatch,
} from '../../src/core/ai/raw-tool-core'
import { exportLosslessSb3, importLosslessSb3, rawSb3Revision } from '../../src/core/archive'

describe('raw SB3 AI proposal', () => {
  it('validates candidate and rejects stale, cloud and unknown operations', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          { name: 'Cat', isStage: false, x: 0, variables: { cloud: ['☁ cloud', 2, true], score: ['score', 3] } },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const patch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: rawSb3Revision(project),
      summary: '移動角色',
      change: { kind: 'property', targetName: 'Cat', property: 'x', expected: 0, value: 20 },
    }
    expect(inspectRawProjectForAi(project)).toContain('score')
    expect(inspectRawProjectForAi(project)).not.toContain('☁ cloud')
    const candidate = proposeRawLivePatch(project, JSON.stringify(patch))
    expect(candidate.changes[0]).toContain('20')
    expect(() => proposeRawLivePatch(candidate.project, JSON.stringify(patch))).toThrow(/revision/)
    expect(() =>
      proposeRawLivePatch(
        project,
        JSON.stringify({
          ...patch,
          change: { kind: 'variable', targetName: 'Cat', variableId: 'cloud', expected: 2, value: 3 },
        }),
      ),
    ).toThrow(/non-cloud/)
    expect(() =>
      proposeRawLivePatch(project, JSON.stringify({ ...patch, change: { ...patch.change, property: '__proto__' } })),
    ).toThrow(/Unsupported/)
  })
  it('provides a bounded, explicit summary for large projects without cloud values', async () => {
    const zip = new JSZip()
    const targets = Array.from({ length: 30 }, (_, i) => ({
      name: `Sprite ${i}`, isStage: false, x: 0,
      variables: Object.fromEntries(Array.from({ length: 30 }, (_, j) => [`v${j}`, [`variable-${j}`, 'x'.repeat(512)]])),
    }))
    targets[0].variables.cloud = ['☁ secret', 'do-not-disclose', true] as unknown as string[]
    zip.file('project.json', JSON.stringify({ targets }))
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const summary = inspectRawProjectForAi(project)
    expect(new TextEncoder().encode(summary).byteLength).toBeLessThanOrEqual(24000)
    expect(summary).toContain(rawSb3Revision(project))
    expect(summary).toMatch(/省略|截斷/)
    expect(summary).not.toContain('do-not-disclose')
  })

  it('allows read-only inspection of problematic targets while rejecting block edits', async () => {
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify({ targets: [{ name: 'Cat', isStage: false, blocks: {
      orphan: { opcode: 'argument_reporter_string_number', parent: null, next: null,
        fields: { VALUE: ['unknown'] }, inputs: {}, topLevel: true },
    } }] }))
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const page = inspectRawBlocks(project, revision, 0)
    expect(page.blocks).toHaveProperty('orphan')
    expect(page.graphIssueCount).toBeGreaterThan(0)
    const patch = { format: 'scratch-ai-bridge/raw-patch', version: 1, baseRevision: revision,
      summary: 'attempt edit', change: { kind: 'blocks', graphPatch: {
        format: 'scratch-ai-bridge/block-graph-patch', version: 1,
        patches: [{ targetIndex: 0, targetName: 'Cat', isStage: false, blocks: { orphan: { x: 1 } } }],
      } } }
    expect(() => proposeRawLivePatch(project, JSON.stringify(patch))).toThrow(/existing issues/)
  })

  it('pages raw blocks and preserves assets and unrelated graph nodes when proposing edits', async () => {
    const zip = new JSZip()
    const blocks = {
      hat: {
        opcode: 'event_whenflagclicked',
        next: 'move',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      },
      move: {
        opcode: 'motion_movesteps',
        next: null,
        parent: 'hat',
        inputs: { STEPS: [1, [4, '10']] },
        fields: {},
        shadow: false,
        topLevel: false,
        opaque: { keep: true },
      },
    }
    zip.file('project.json', JSON.stringify({ targets: [{ name: 'Cat', isStage: false, blocks }] }))
    zip.file('asset.svg', '<svg/>')
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const selected = inspectRawBlocks(project, revision, 0, 0, 10, { opcode: 'motion_movesteps' })
    expect(Object.keys(selected.blocks)).toEqual(['move'])
    expect(selected.total).toBe(1)
    const byId = inspectRawBlocks(project, revision, 0, 0, 10, { blockId: 'move' })
    expect(Object.keys(byId.blocks)).toEqual(['move'])
    const first = inspectRawBlocks(project, revision, 0, 0, 1)
    expect(first.nextOffset).toBe(1)
    expect(Object.keys(first.blocks)).toEqual(['hat'])
    expect(Object.keys(inspectRawBlocks(project, revision, 0, 1, 1).blocks)).toEqual(['move'])
    expect(() => inspectRawBlocks(project, 'old', 0)).toThrow(/revision/)
    const graphPatch = {
      format: 'scratch-ai-bridge/block-graph-patch',
      version: 1,
      patches: [
        {
          targetIndex: 0,
          targetName: 'Cat',
          isStage: false,
          blocks: { move: { inputs: { STEPS: [1, [4, '20']] } } },
        },
      ],
    }
    const proposal = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: revision,
      summary: '走得更遠',
      change: { kind: 'blocks', graphPatch },
    }
    const candidate = proposeRawLivePatch(project, JSON.stringify(proposal))
    expect(candidate.requiresVmValidation).toBe(true)
    expect(candidate.changes[0]).toContain('20')
    let calls = 0
    const fetchImpl: typeof fetch = (_url, init) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '{}'
      const request = JSON.parse(bodyText) as {
        tools: { function: { name: string } }[]
        messages: { role: string; content?: string }[]
      }
      expect(request.tools.some((tool) => tool.function.name === 'inspect_raw_blocks')).toBe(true)
      calls += 1
      const call =
        calls === 1
          ? {
              id: 'inspect',
              type: 'function',
              function: {
                name: 'inspect_raw_blocks',
                arguments: JSON.stringify({ baseRevision: revision, targetIndex: 0 }),
              },
            }
          : {
              id: 'propose',
              type: 'function',
              function: {
                name: 'propose_live_patch',
                arguments: JSON.stringify({ patchJson: JSON.stringify(proposal) }),
              },
            }
      if (calls === 2)
        expect(
          request.messages.some(
            (message) => message.role === 'tool' && message.content?.includes('motion_movesteps'),
          ),
        ).toBe(true)
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [call] } }] }), {
          status: 200,
        }),
      )
    }
    const output = await requestOpenAiCompatiblePatch({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'mock',
      instruction: inspectRawProjectForAi(project),
      request: '增加移動距離',
      enableRawBlockInspection: true,
      fetchImpl,
      onToolCall: (name, json) => {
        const args = JSON.parse(json) as { baseRevision: string; targetIndex: number; patchJson: string }
        if (name === 'inspect_raw_blocks')
          return { output: JSON.stringify(inspectRawBlocks(project, args.baseRevision, args.targetIndex)) }
        const proposed = proposeRawLivePatch(project, args.patchJson)
        return { output: 'valid', patchJson: proposed.patchJson }
      },
    })
    expect(JSON.parse(output)).toEqual(proposal)
    expect(calls).toBe(2)
    const restored = await importLosslessSb3(await exportLosslessSb3(candidate.project))
    const target = (restored.projectJson.targets as { blocks: typeof blocks }[])[0]
    expect(target.blocks.hat).toEqual(blocks.hat)
    expect(target.blocks.move.opaque).toEqual({ keep: true })
    expect(target.blocks.move.inputs.STEPS).toEqual([1, [4, '20']])
    expect(restored.entries.find((entry) => entry.name === 'asset.svg')?.sha256).toBe(
      project.entries.find((entry) => entry.name === 'asset.svg')?.sha256,
    )
    expect(() => proposeRawLivePatch(candidate.project, JSON.stringify(proposal))).toThrow(/revision/)
    const broken = structuredClone(proposal)
    ;(broken.change.graphPatch.patches[0].blocks as Record<string, unknown>).move = { next: 'missing' }
    expect(() => proposeRawLivePatch(project, JSON.stringify(broken))).toThrow()
  })
  it('discovers targets and non-cloud variables beyond the initial summary', async () => {
    const zip = new JSZip()
    const targets = Array.from({ length: 35 }, (_, index) => ({
      name: `Sprite${index}`,
      isStage: false,
      x: index,
      variables: Object.fromEntries(Array.from({ length: 35 }, (_, id) => [`v${id}`, [`value${id}`, id]])),
    }))
    targets[33].variables.cloud = ['☁ secret', 123, true] as unknown as [string, number]
    zip.file('project.json', JSON.stringify({ targets }))
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const targetPage = inspectRawTargets(project, revision, 30, 5)
    expect(targetPage.targets[3]).toMatchObject({ targetIndex: 33, name: 'Sprite33', fields: { x: 33 } })
    const variables = inspectRawVariables(project, revision, 33, 30, 10)
    expect(variables.variables.map((item) => item.id)).toEqual(['v30', 'v31', 'v32', 'v33', 'v34'])
    expect(JSON.stringify(variables)).not.toContain('☁ secret')
    expect(() => inspectRawTargets(project, 'old')).toThrow(/revision/)
  })

  it('filters duplicate target names and locates broadcast or procedure blocks by query', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          { name: 'Stage', isStage: true, blocks: {} },
          { name: 'Tiles', isStage: false, x: 1, blocks: {} },
          {
            name: 'Tiles',
            isStage: false,
            x: 2,
            blocks: {
              recv: {
                opcode: 'event_whenbroadcastreceived',
                parent: null,
                next: null,
                topLevel: true,
                fields: { BROADCAST_OPTION: ['Update Tiles', 'b1'] },
                inputs: {},
              },
              call: {
                opcode: 'procedures_call',
                parent: null,
                next: null,
                topLevel: false,
                fields: {},
                inputs: {},
                mutation: { proccode: 'Render Tile %s', argumentids: '["a1"]' },
              },
            },
          },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const matchedTargets = inspectRawTargets(project, revision, 0, 10, { query: 'tiles' })
    expect(matchedTargets.total).toBe(2)
    expect(matchedTargets.targets.map((item) => item.targetIndex)).toEqual([1, 2])
    const broadcastBlocks = inspectRawBlocks(project, revision, 2, 0, 10, {
      opcode: 'event_whenbroadcastreceived',
      query: 'Update Tiles',
    })
    expect(Object.keys(broadcastBlocks.blocks)).toEqual(['recv'])
    const procBlocks = inspectRawBlocks(project, revision, 2, 0, 10, { query: 'Render Tile' })
    expect(Object.keys(procBlocks.blocks)).toEqual(['call'])
  })
})
