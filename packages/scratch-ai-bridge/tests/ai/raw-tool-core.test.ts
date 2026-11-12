/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- These tests inspect intentionally raw SB3 JSON. */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { requestOpenAiCompatiblePatch } from '../../src/core/ai/openai-compatible'
import {
  inspectRawBlocks,
  inspectRawProjectForAi,
  inspectRawTargets,
  inspectRawVariables,
  proposeRawLivePatch,
  rawProjectInventory,
} from '../../src/core/ai/raw-tool-core'
import { exportLosslessSb3, importLosslessSb3, rawSb3Revision } from '../../src/core/archive'
import { readProjectForAi } from '../../src/core/reader'

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
      name: `Sprite ${i}`,
      isStage: false,
      x: 0,
      variables: Object.fromEntries(
        Array.from({ length: 30 }, (_, j) => [`v${j}`, [`variable-${j}`, 'x'.repeat(512)]]),
      ),
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
  it('returns a reusable inventory without mutating the project or exposing cloud variables', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          {
            name: 'Cat',
            isStage: false,
            x: 12,
            variables: {
              score: ['score', 3],
              cloud: ['☁ secret', 'hidden', true],
            },
          },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const first = rawProjectInventory(project)
    const second = rawProjectInventory(project)
    expect(first).toEqual(second)
    expect(first[0]?.variables).toEqual([{ id: 'score', name: 'score', value: 3 }])
    expect(JSON.stringify(first)).not.toContain('hidden')
  })

  it('applies line-number set, insert, and delete operations while retaining the graph', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          {
            name: 'Cat',
            isStage: false,
            blocks: {
              hat: {
                opcode: 'event_whenflagclicked',
                next: 'move',
                parent: null,
                inputs: {},
                fields: {},
                topLevel: true,
              },
              move: {
                opcode: 'motion_movesteps',
                next: null,
                parent: 'hat',
                inputs: { STEPS: [1, [4, 10]] },
                fields: {},
                topLevel: false,
              },
            },
          },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const patch = (operations: unknown[]) =>
      JSON.stringify({
        format: 'scratch-ai-bridge/raw-patch',
        version: 1,
        baseRevision: revision,
        summary: 'line edit',
        change: { kind: 'lines', operations },
      })
    const set = proposeRawLivePatch(project, patch([{ op: 'set', line: 'L2', slot: 1, value: 20 }]))
    expect((set.project.projectJson as any).targets[0].blocks.move.inputs.STEPS).toEqual([1, [4, 20]])
    const inserted = proposeRawLivePatch(project, patch([{ op: 'insert_after', line: 'L2', text: '播放音效 [Pop]' }]))
    const insertedBlocks = (inserted.project.projectJson as any).targets[0].blocks
    expect(insertedBlocks.hat.next).toBe('move')
    expect(insertedBlocks.move.next).toMatch(/^sab_line_move/)
    expect(Object.values(insertedBlocks).some((block: any) => block.opcode === 'sound_play')).toBe(true)
    const deleted = proposeRawLivePatch(project, patch([{ op: 'delete', line: 'L2' }]))
    expect((deleted.project.projectJson as any).targets[0].blocks).toEqual({
      hat: expect.objectContaining({ next: null }),
    })
  })

  it('replaces one complete reader script through a validated graph patch', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          {
            name: 'Cat',
            isStage: false,
            variables: { score: ['score', 0] },
            blocks: {
              hat: {
                opcode: 'event_whenflagclicked',
                next: 'move',
                parent: null,
                inputs: {},
                fields: {},
                topLevel: true,
              },
              move: {
                opcode: 'motion_movesteps',
                next: null,
                parent: 'hat',
                inputs: { STEPS: [1, [4, 10]] },
                fields: {},
                topLevel: false,
              },
            },
          },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const proposal = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: revision,
      summary: '把角色移動距離改成 20',
      change: {
        kind: 'script',
        targetName: 'Cat',
        scriptId: 'script:hat',
        text: '### 程式 script:hat\nL1 當綠旗被點擊\nL2 移動 20 點',
      },
    }
    const candidate = proposeRawLivePatch(project, JSON.stringify(proposal))
    const blocks = (candidate.project.projectJson as any).targets[0].blocks
    expect(blocks.hat).toEqual(expect.objectContaining({ opcode: 'event_whenflagclicked', next: 'move' }))
    expect(blocks.move).toEqual(
      expect.objectContaining({
        opcode: 'motion_movesteps',
        parent: 'hat',
        inputs: { STEPS: [1, [4, 20]] },
      }),
    )
    expect(candidate.requiresVmValidation).toBe(true)
  })

  it('preserves reader indentation when replacing a nested complete script', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          {
            name: 'Cat',
            isStage: false,
            blocks: {
              hat: {
                opcode: 'event_whenflagclicked',
                next: 'forever',
                parent: null,
                inputs: {},
                fields: {},
                topLevel: true,
              },
              forever: {
                opcode: 'control_forever',
                next: null,
                parent: 'hat',
                inputs: { SUBSTACK: [2, 'move'] },
                fields: {},
                topLevel: false,
              },
              move: {
                opcode: 'motion_movesteps',
                next: null,
                parent: 'forever',
                inputs: { STEPS: [1, [4, 10]] },
                fields: {},
                topLevel: false,
              },
            },
          },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const readerScript = readProjectForAi(project.projectJson).sections.find((section) => section.id === 'script:hat')
    if (!readerScript) throw new Error('reader script fixture missing')
    const proposal = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: revision,
      summary: '保留巢狀循環並調整移動距離',
      change: {
        kind: 'script',
        targetName: 'Cat',
        scriptId: 'script:hat',
        text: readerScript.text.replace('移動 10 點', '移動 20 點'),
      },
    }
    const candidate = proposeRawLivePatch(project, JSON.stringify(proposal))
    const blocks = (candidate.project.projectJson as any).targets[0].blocks
    expect(blocks.hat.next).toBe('forever')
    expect(blocks.forever.inputs.SUBSTACK).toEqual([2, 'move'])
    expect(blocks.move).toEqual(
      expect.objectContaining({ opcode: 'motion_movesteps', parent: 'forever', inputs: { STEPS: [1, [4, 20]] } }),
    )
  })

  it('edits targets with leftover issues Scratch tolerates, but rejects edits that add new issues', async () => {
    // A parameter reporter left behind after its parameter was removed is common in real projects and still runs.
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          {
            name: 'Cat',
            isStage: false,
            blocks: {
              orphan: {
                opcode: 'argument_reporter_string_number',
                parent: null,
                next: null,
                fields: { VALUE: ['unknown'] },
                inputs: {},
                topLevel: true,
              },
              hat: {
                opcode: 'event_whenflagclicked',
                parent: null,
                next: null,
                fields: {},
                inputs: {},
                topLevel: true,
                x: 0,
                y: 0,
              },
            },
          },
        ],
      }),
    )
    const project = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const revision = rawSb3Revision(project)
    const page = inspectRawBlocks(project, revision, 0)
    expect(page.blocks).toHaveProperty('orphan')
    expect(page.graphIssueCount).toBeGreaterThan(0)
    expect(page.graphEditable).toBe(true)
    const patchWith = (blocks: Record<string, unknown>) =>
      JSON.stringify({
        format: 'scratch-ai-bridge/raw-patch',
        version: 1,
        baseRevision: revision,
        summary: 'edit',
        change: {
          kind: 'blocks',
          graphPatch: {
            format: 'scratch-ai-bridge/block-graph-patch',
            version: 1,
            patches: [{ targetIndex: 0, targetName: 'Cat', isStage: false, blocks }],
          },
        },
      })
    expect(proposeRawLivePatch(project, patchWith({ hat: { x: 40 } })).changes[0]).toContain('"x":40')
    expect(() => proposeRawLivePatch(project, patchWith({ hat: { next: 'missing' } }))).toThrow(/missing/)
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
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
