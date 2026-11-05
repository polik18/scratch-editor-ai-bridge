import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
import { analyzeCanonicalProject, createProjectFeedback, createProjectMap } from '../../src/core/analyzer'
import { exportLosslessSb3, importLosslessSb3, rawSb3Revision } from '../../src/core/archive'
import { decompileSb3WithBlockGraphs } from '../../src/core/decompiler'
import { createVM, loadSb3, runForTicks } from '../../src/scratch/vm'

interface VmTargetLike {
  readonly isStage: boolean
  readonly x: number
  readonly y: number
  getName(): string
  lookupVariableById(id: string): { value: unknown } | undefined
}

interface VmLike {
  readonly runtime: {
    readonly targets: readonly VmTargetLike[]
    readonly threads: readonly unknown[]
  }
  greenFlag(): void
  quit(): void
}

const runGreenFlagTicks = async (archiveBytes: Uint8Array | Blob, ticks = 8) => {
  const vm = await createVM()
  const typedVm = vm as unknown as VmLike
  try {
    await loadSb3(archiveBytes, vm)
    typedVm.greenFlag()
    runForTicks(vm, ticks)
    return typedVm.runtime.targets.map((target) => ({
      name: target.getName(),
      isStage: target.isStage,
      x: target.x,
      y: target.y,
      variables: Object.fromEntries(
        ['v_speed', 'v_coins', 'l_bag']
          .map((id): readonly [string, unknown] => [id, target.lookupVariableById(id)?.value])
          .filter(([, value]) => value !== undefined),
      ),
    }))
  } finally {
    typedVm.quit()
  }
}

const buildSb3Bytes = async (projectJson: Record<string, unknown>): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(projectJson))
  zip.file(
    'cd21514d0531fdffb22204e0ec5ed84a.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
  )
  return zip.generateAsync({ type: 'uint8array' })
}

const baseCostume = {
  assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
  name: 'costume1',
  md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
  dataFormat: 'svg',
  rotationCenterX: 5,
  rotationCenterY: 5,
}

describe('P5 end-to-end AI tool & runtime evaluation', () => {
  it('enforces tool limits, input/output size caps, cancellation, and never auto-applies candidate patches', async () => {
    const sb3Bytes = await buildSb3Bytes({
      targets: [
        { name: 'Stage', isStage: true, variables: {}, lists: {}, blocks: {}, costumes: [baseCostume], sounds: [] },
        {
          name: 'Cat',
          isStage: false,
          x: 0,
          y: 0,
          direction: 90,
          size: 100,
          visible: true,
          currentCostume: 0,
          variables: { v_speed: ['speed', 5] },
          lists: {},
          blocks: {},
          costumes: [baseCostume],
          sounds: [],
        },
      ],
      monitors: [],
      extensions: [],
      meta: { semver: '3.0.0', vm: '0.2.0', agent: 'test' },
    })
    const original = await importLosslessSb3(sb3Bytes)
    const originalRevision = rawSb3Revision(original)

    await expect(
      requestOpenAiCompatiblePatch({
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'fake-model',
        instruction: 'x'.repeat(32_001),
        request: '修改速度',
        onToolCall: () => ({ output: 'unused' }),
      }),
    ).rejects.toThrow(/32 KB/)

    const abortController = new AbortController()
    const abortingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted.')
          abortError.name = 'AbortError'
          reject(abortError)
        })
        abortController.abort()
      })
    await expect(
      requestOpenAiCompatiblePatch({
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'fake-model',
        instruction: inspectRawProjectForAi(original),
        request: '修改速度',
        signal: abortController.signal,
        fetchImpl: abortingFetch,
        onToolCall: () => ({ output: 'unused' }),
      }),
    ).rejects.toThrow(/aborted/i)

    expect(rawSb3Revision(original)).toBe(originalRevision)

    const excessiveToolFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: Array.from({ length: 9 }, (_, i) => ({
                    id: `call_${i}`,
                    type: 'function',
                    function: { name: 'inspect_project', arguments: '{}' },
                  })),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
    await expect(
      requestOpenAiCompatiblePatch({
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'fake-model',
        instruction: inspectRawProjectForAi(original),
        request: '修改速度',
        fetchImpl: excessiveToolFetch,
        onToolCall: () => ({ output: 'ok' }),
      }),
    ).rejects.toThrow(/8 次上限/)
  })

  it('evaluates comprehension, feedback, repair-round proposal, and verified VM effect across 4 project archetypes', async () => {
    // Archetype 1: Simple variable-driven movement
    const simpleBytes = await buildSb3Bytes({
      targets: [
        { name: 'Stage', isStage: true, variables: {}, lists: {}, blocks: {}, costumes: [baseCostume], sounds: [] },
        {
          name: 'Cat',
          isStage: false,
          x: 0,
          y: 0,
          direction: 90,
          size: 100,
          visible: true,
          currentCostume: 0,
          variables: { v_speed: ['speed', 5] },
          lists: {},
          blocks: {
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
              opcode: 'motion_changexby',
              next: null,
              parent: 'hat',
              inputs: { DX: [3, [12, 'speed', 'v_speed'], [4, '5']] },
              fields: {},
              shadow: false,
              topLevel: false,
            },
          },
          costumes: [baseCostume],
          sounds: [],
        },
      ],
      monitors: [],
      extensions: [],
      meta: { semver: '3.0.0', vm: '0.2.0', agent: 'test' },
    })
    const simpleRaw = await importLosslessSb3(simpleBytes)
    const simpleRev = rawSb3Revision(simpleRaw)
    expect(inspectRawVariables(simpleRaw, simpleRev, 1).variables).toEqual([
      { id: 'v_speed', name: 'speed', value: 5 },
    ])
    const simpleDecompiled = await decompileSb3WithBlockGraphs(simpleBytes, 'SimpleCat')
    const simpleAnalysis = analyzeCanonicalProject(simpleDecompiled.canonical, simpleDecompiled.rawBlockGraphs)
    const simpleMap = createProjectMap(
      simpleDecompiled.canonical,
      simpleAnalysis,
      simpleDecompiled.rawBlockGraphs,
      simpleDecompiled.canonicalBlockMappings,
      simpleDecompiled.rawArchive.projectJson,
    )
    const simpleFeedback = createProjectFeedback(simpleAnalysis, simpleMap)
    expect(simpleMap.evidence.some((item) => item.opcode === 'motion_changexby')).toBe(true)
    expect(simpleAnalysis.summary.blocks).toBe(2)
    expect(simpleFeedback.limits.length).toBeGreaterThan(0)

    const simplePatch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: simpleRev,
      summary: '將 Cat 的初始速度改為 15',
      change: { kind: 'variable', targetName: 'Cat', variableId: 'v_speed', expected: 5, value: 15 },
    }
    const simpleCandidate = proposeRawLivePatch(simpleRaw, JSON.stringify(simplePatch))
    expect(rawSb3Revision(simpleRaw)).toBe(simpleRev)
    const simpleBefore = await runGreenFlagTicks(simpleBytes)
    const simpleAfter = await runGreenFlagTicks(await exportLosslessSb3(simpleCandidate.project))
    expect(simpleBefore.find((t) => t.name === 'Cat')?.x).toBe(5)
    expect(simpleAfter.find((t) => t.name === 'Cat')?.x).toBe(15)

    // Archetype 2: Custom Procedure (procedures_definition / procedures_call)
    const procBytes = await buildSb3Bytes({
      targets: [
        { name: 'Stage', isStage: true, variables: {}, lists: {}, blocks: {}, costumes: [baseCostume], sounds: [] },
        {
          name: 'Hero',
          isStage: false,
          x: 0,
          y: 0,
          direction: 90,
          size: 100,
          visible: true,
          currentCostume: 0,
          variables: {},
          lists: {},
          blocks: {
            hat: {
              opcode: 'event_whenflagclicked',
              next: 'call_jump',
              parent: null,
              inputs: {},
              fields: {},
              shadow: false,
              topLevel: true,
              x: 0,
              y: 0,
            },
            call_jump: {
              opcode: 'procedures_call',
              next: null,
              parent: 'hat',
              inputs: { arg_h: [1, [4, '20']] },
              fields: {},
              shadow: false,
              topLevel: false,
              mutation: {
                tagName: 'mutation',
                children: [],
                proccode: 'Jump %n',
                argumentids: '["arg_h"]',
                warp: 'true',
              },
            },
            proc_def: {
              opcode: 'procedures_definition',
              next: 'proc_body',
              parent: null,
              inputs: { custom_block: [1, 'proc_proto'] },
              fields: {},
              shadow: false,
              topLevel: true,
              x: 200,
              y: 0,
            },
            proc_proto: {
              opcode: 'procedures_prototype',
              next: null,
              parent: 'proc_def',
              inputs: { arg_h: [1, 'proc_arg'] },
              fields: {},
              shadow: true,
              topLevel: false,
              mutation: {
                tagName: 'mutation',
                children: [],
                proccode: 'Jump %n',
                argumentids: '["arg_h"]',
                argumentnames: '["height"]',
                argumentdefaults: '[0]',
                warp: 'true',
              },
            },
            proc_arg: {
              opcode: 'argument_reporter_string_number',
              next: null,
              parent: 'proc_proto',
              inputs: {},
              fields: { VALUE: ['height', null] },
              shadow: true,
              topLevel: false,
            },
            proc_body: {
              opcode: 'motion_changeyby',
              next: null,
              parent: 'proc_def',
              inputs: { DY: [3, 'body_arg', [4, '10']] },
              fields: {},
              shadow: false,
              topLevel: false,
            },
            body_arg: {
              opcode: 'argument_reporter_string_number',
              next: null,
              parent: 'proc_body',
              inputs: {},
              fields: { VALUE: ['height', null] },
              shadow: false,
              topLevel: false,
            },
          },
          costumes: [baseCostume],
          sounds: [],
        },
      ],
      monitors: [],
      extensions: [],
      meta: { semver: '3.0.0', vm: '0.2.0', agent: 'test' },
    })
    const procRaw = await importLosslessSb3(procBytes)
    const procRev = rawSb3Revision(procRaw)
    const locatedCall = inspectRawBlocks(procRaw, procRev, 1, 0, 10, { query: 'Jump %n' })
    expect(Object.keys(locatedCall.blocks)).toContain('call_jump')

    const procPatch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: procRev,
      summary: '將 Jump 跳躍高度參數從 20 提升到 45',
      change: {
        kind: 'blocks',
        graphPatch: {
          format: 'scratch-ai-bridge/block-graph-patch',
          version: 1,
          patches: [
            {
              targetIndex: 1,
              targetName: 'Hero',
              isStage: false,
              blocks: { call_jump: { inputs: { arg_h: [1, [4, '45']] } } },
            },
          ],
        },
      },
    }
    const procCandidate = proposeRawLivePatch(procRaw, JSON.stringify(procPatch))
    const procBefore = await runGreenFlagTicks(procBytes)
    const procAfter = await runGreenFlagTicks(await exportLosslessSb3(procCandidate.project))
    expect(procBefore.find((t) => t.name === 'Hero')?.y).toBe(20)
    expect(procAfter.find((t) => t.name === 'Hero')?.y).toBe(45)

    // Archetype 3: List & Broadcast Event Interaction
    const eventBytes = await buildSb3Bytes({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          variables: {},
          lists: {},
          broadcasts: { b_coin: 'collect_coin' },
          blocks: {},
          costumes: [baseCostume],
          sounds: [],
        },
        {
          name: 'Inventory',
          isStage: false,
          x: 0,
          y: 0,
          direction: 90,
          size: 100,
          visible: true,
          currentCostume: 0,
          variables: { v_coins: ['coins', 0] },
          lists: { l_bag: ['bag', []] },
          blocks: {
            hat: {
              opcode: 'event_whenflagclicked',
              next: 'bcast',
              parent: null,
              inputs: {},
              fields: {},
              shadow: false,
              topLevel: true,
              x: 0,
              y: 0,
            },
            bcast: {
              opcode: 'event_broadcast',
              next: null,
              parent: 'hat',
              inputs: { BROADCAST_INPUT: [1, [11, 'collect_coin', 'b_coin']] },
              fields: {},
              shadow: false,
              topLevel: false,
            },
            on_coin: {
              opcode: 'event_whenbroadcastreceived',
              next: 'add_bag',
              parent: null,
              inputs: {},
              fields: { BROADCAST_OPTION: ['collect_coin', 'b_coin'] },
              shadow: false,
              topLevel: true,
              x: 200,
              y: 0,
            },
            add_bag: {
              opcode: 'data_addtolist',
              next: 'add_score',
              parent: 'on_coin',
              inputs: { ITEM: [1, [10, 'gold']] },
              fields: { LIST: ['bag', 'l_bag'] },
              shadow: false,
              topLevel: false,
            },
            add_score: {
              opcode: 'data_changevariableby',
              next: null,
              parent: 'add_bag',
              inputs: { VALUE: [1, [4, '1']] },
              fields: { VARIABLE: ['coins', 'v_coins'] },
              shadow: false,
              topLevel: false,
            },
          },
          costumes: [baseCostume],
          sounds: [],
        },
      ],
      monitors: [],
      extensions: [],
      meta: { semver: '3.0.0', vm: '0.2.0', agent: 'test' },
    })
    const eventRaw = await importLosslessSb3(eventBytes)
    const eventRev = rawSb3Revision(eventRaw)
    const coinReceiver = inspectRawBlocks(eventRaw, eventRev, 1, 0, 10, { query: 'collect_coin' })
    expect(Object.keys(coinReceiver.blocks)).toContain('on_coin')

    const eventPatch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: eventRev,
      summary: '收集金幣時加分從 1 改為 10',
      change: {
        kind: 'blocks',
        graphPatch: {
          format: 'scratch-ai-bridge/block-graph-patch',
          version: 1,
          patches: [
            {
              targetIndex: 1,
              targetName: 'Inventory',
              isStage: false,
              blocks: { add_score: { inputs: { VALUE: [1, [4, '10']] } } },
            },
          ],
        },
      },
    }
    const eventCandidate = proposeRawLivePatch(eventRaw, JSON.stringify(eventPatch))
    const eventBefore = await runGreenFlagTicks(eventBytes)
    const eventAfter = await runGreenFlagTicks(await exportLosslessSb3(eventCandidate.project))
    expect(eventBefore.find((t) => t.name === 'Inventory')?.variables).toEqual({
      v_coins: 1,
      l_bag: ['gold'],
    })
    expect(eventAfter.find((t) => t.name === 'Inventory')?.variables).toEqual({
      v_coins: 10,
      l_bag: ['gold'],
    })

    // Archetype 4: Large multi-target project with duplicate target names and 1 validation repair round
    const largeTargets: Record<string, unknown>[] = [
      { name: 'Stage', isStage: true, variables: {}, lists: {}, blocks: {}, costumes: [baseCostume], sounds: [] },
      ...Array.from({ length: 30 }, (_, idx) => ({
        name: idx === 10 ? 'Tiles' : `Deco_${idx}`,
        isStage: false,
        x: idx,
        y: 0,
        direction: 90,
        size: 100,
        visible: true,
        currentCostume: 0,
        variables: {},
        lists: {},
        blocks: {},
        costumes: [baseCostume],
        sounds: [],
      })),
      {
        name: 'Tiles',
        isStage: false,
        x: 0,
        y: 0,
        direction: 90,
        size: 100,
        visible: true,
        currentCostume: 0,
        variables: {},
        lists: {},
        blocks: {
          hat: {
            opcode: 'event_whenflagclicked',
            next: 'step_tile',
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0,
          },
          step_tile: {
            opcode: 'motion_changexby',
            next: null,
            parent: 'hat',
            inputs: { DX: [1, [4, '12']] },
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
        costumes: [baseCostume],
        sounds: [],
      },
    ]
    const largeBytes = await buildSb3Bytes({
      targets: largeTargets,
      monitors: [],
      extensions: [],
      meta: { semver: '3.0.0', vm: '0.2.0', agent: 'test' },
    })
    const largeRaw = await importLosslessSb3(largeBytes)
    const largeRev = rawSb3Revision(largeRaw)

    let round = 0
    const repairErrors: string[] = []
    const validLargePatch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: largeRev,
      summary: '修正第 31 個目標 Tiles 的位移為 36',
      change: {
        kind: 'blocks',
        graphPatch: {
          format: 'scratch-ai-bridge/block-graph-patch',
          version: 1,
          patches: [
            {
              targetIndex: 31,
              targetName: 'Tiles',
              isStage: false,
              blocks: { step_tile: { inputs: { DX: [1, [4, '36']] } } },
            },
          ],
        },
      },
    }
    const invalidFirstRoundPatch = {
      ...validLargePatch,
      change: {
        kind: 'blocks',
        graphPatch: {
          format: 'scratch-ai-bridge/block-graph-patch',
          version: 1,
          patches: [
            {
              targetIndex: 31,
              targetName: 'Tiles',
              isStage: false,
              blocks: { missing_block_id: { inputs: { DX: [1, [4, '36']] } } },
            },
          ],
        },
      },
    }

    const fakeProviderFetch: typeof fetch = (_url, init) => {
      round += 1
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        messages: { role: string; content?: string }[]
      }
      if (round === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'c1',
                        type: 'function',
                        function: {
                          name: 'inspect_raw_targets',
                          arguments: JSON.stringify({ baseRevision: largeRev, query: 'Tiles' }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      if (round === 2) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'c2',
                        type: 'function',
                        function: {
                          name: 'inspect_raw_blocks',
                          arguments: JSON.stringify({
                            baseRevision: largeRev,
                            targetIndex: 31,
                            opcode: 'motion_changexby',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      if (round === 3) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'c3',
                        type: 'function',
                        function: {
                          name: 'propose_live_patch',
                          arguments: JSON.stringify({ patchJson: JSON.stringify(invalidFirstRoundPatch) }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      expect(body.messages.some((m) => m.role === 'tool' && m.content?.includes('候選未通過驗證'))).toBe(true)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'c4',
                      type: 'function',
                      function: {
                        name: 'propose_live_patch',
                        arguments: JSON.stringify({ patchJson: JSON.stringify(validLargePatch) }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
    }

    const patchOutput = await requestOpenAiCompatiblePatch({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'fake-model',
      instruction: inspectRawProjectForAi(largeRaw),
      request: '將擁有移動積木的 Tiles 角色每步位移改為 36',
      enableRawBlockInspection: true,
      fetchImpl: fakeProviderFetch,
      onToolCall: (name, argsJson) => {
        const args = JSON.parse(argsJson) as {
          baseRevision: string
          targetIndex?: number
          query?: string
          opcode?: string
          patchJson?: string
        }
        if (name === 'inspect_raw_targets') {
          return {
            output: JSON.stringify(inspectRawTargets(largeRaw, args.baseRevision, 0, 10, { query: args.query })),
          }
        }
        if (name === 'inspect_raw_blocks') {
          return {
            output: JSON.stringify(
              inspectRawBlocks(largeRaw, args.baseRevision, args.targetIndex ?? 0, 0, 10, { opcode: args.opcode }),
            ),
          }
        }
        try {
          const candidate = proposeRawLivePatch(largeRaw, args.patchJson ?? '')
          return { output: JSON.stringify({ candidateId: candidate.candidateId }), patchJson: candidate.patchJson }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          repairErrors.push(message)
          return { output: `候選未通過驗證：${message}` }
        }
      },
    })

    expect(round).toBe(4)
    expect(repairErrors).toHaveLength(1)
    const largeCandidate = proposeRawLivePatch(largeRaw, patchOutput)
    const largeBefore = await runGreenFlagTicks(largeBytes)
    const largeAfter = await runGreenFlagTicks(await exportLosslessSb3(largeCandidate.project))
    expect(largeBefore[11]?.x).toBe(10)
    expect(largeBefore[31]?.x).toBe(12)
    expect(largeAfter[11]?.x).toBe(10)
    expect(largeAfter[31]?.x).toBe(36)

    // The local model is a separate, explicitly requested evaluation, not a unit-test dependency.
    if (process.env.SCRATCH_BRIDGE_REAL_MODEL_EVAL !== '1') return
    const settingsPath = join(homedir(), '.omlx/settings.json')
    let apiKey = process.env.OMLX_API_KEY ?? ''
    if (!apiKey && existsSync(settingsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as { auth?: { api_key?: string } }
        apiKey = parsed.auth?.api_key ?? ''
      } catch {
        apiKey = ''
      }
    }
    let modelId = ''
    try {
      const healthResp = await fetch('http://127.0.0.1:8000/health')
      if (healthResp.ok) {
        const health = (await healthResp.json()) as { default_model?: string }
        modelId = health.default_model ?? ''
      }
    } catch {
      modelId = ''
    }

    if (!apiKey || !modelId)
      throw new Error('Real model evaluation requested, but the local model or credentials are unavailable.')
    {
      const runRealModelCase = async (
        id: string,
        rawProject: Awaited<ReturnType<typeof importLosslessSb3>>,
        userRequest: string,
        verifyRuntime: (patched: Awaited<ReturnType<typeof importLosslessSb3>>) => Promise<boolean>,
      ) => {
        const startedAt = Date.now()
        const toolCalls: string[] = []
        const toolErrors: string[] = []
        let repairRounds = 0
        try {
          const patchJson = await requestOpenAiCompatiblePatch({
            baseUrl: 'http://127.0.0.1:8000/v1',
            model: modelId,
            apiKey,
            instruction: inspectRawProjectForAi(rawProject),
            request: userRequest,
            enableRawBlockInspection: true,
            onToolCall: (name, argsJson) => {
              toolCalls.push(name)
              try {
                const args = JSON.parse(argsJson) as {
                  baseRevision?: string
                  targetIndex?: number
                  offset?: number
                  limit?: number
                  blockId?: string
                  opcode?: string
                  query?: string
                  patchJson?: unknown
                }
                const rev = args.baseRevision ?? rawSb3Revision(rawProject)
                if (name === 'inspect_project') return { output: inspectRawProjectForAi(rawProject) }
                if (name === 'inspect_raw_targets') {
                  return {
                    output: JSON.stringify(
                      inspectRawTargets(rawProject, rev, args.offset ?? 0, args.limit ?? 15, {
                        ...(args.query ? { query: args.query } : {}),
                      }),
                    ),
                  }
                }
                if (name === 'inspect_raw_variables') {
                  return {
                    output: JSON.stringify(
                      inspectRawVariables(rawProject, rev, args.targetIndex ?? 0, args.offset ?? 0, args.limit ?? 15),
                    ),
                  }
                }
                if (name === 'inspect_raw_blocks') {
                  return {
                    output: JSON.stringify(
                      inspectRawBlocks(rawProject, rev, args.targetIndex ?? 0, args.offset ?? 0, args.limit ?? 15, {
                        ...(args.blockId ? { blockId: args.blockId } : {}),
                        ...(args.opcode ? { opcode: args.opcode } : {}),
                        ...(args.query ? { query: args.query } : {}),
                      }),
                    ),
                  }
                }
                if (name === 'propose_live_patch') {
                  const rawPatchText =
                    typeof args.patchJson === 'string' ? args.patchJson : JSON.stringify(args.patchJson ?? {})
                  const candidate = proposeRawLivePatch(rawProject, rawPatchText)
                  return {
                    output: JSON.stringify({ candidateId: candidate.candidateId, changes: candidate.changes }),
                    patchJson: candidate.patchJson,
                  }
                }
                return { output: `未知工具：${name}` }
              } catch (err) {
                repairRounds += 1
                const msg = err instanceof Error ? err.message : String(err)
                toolErrors.push(`${name}: ${msg}`)
                return {
                  output: `工具呼叫或候選未通過驗證（目前正確 baseRevision 為 ${rawSb3Revision(rawProject)}）：${msg}`,
                }
              }
            },
          })
          const candidate = proposeRawLivePatch(rawProject, patchJson)
          const runtimePassed = await verifyRuntime(candidate.project)
          return {
            id,
            status: runtimePassed ? 'pass' : 'fail',
            durationMs: Date.now() - startedAt,
            toolCalls,
            toolErrors,
            repairRounds,
            summary: candidate.summary,
            changes: candidate.changes,
            warnings: candidate.warnings,
            runtimePassed,
          }
        } catch (err) {
          return {
            id,
            status: 'fail',
            durationMs: Date.now() - startedAt,
            toolCalls,
            toolErrors,
            repairRounds,
            error: err instanceof Error ? err.message : String(err),
            runtimePassed: false,
          }
        }
      }

      const realResults = []
      realResults.push(
        await runRealModelCase(
          'archetype-1-simple-variable-motion',
          simpleRaw,
          '請把角色 Cat 的變數 speed（ID 為 v_speed）初始值從 5 改成 15，並呼叫 propose_live_patch 提交。',
          async (patched) => {
            const after = await runGreenFlagTicks(await exportLosslessSb3(patched))
            return after.find((t) => t.name === 'Cat')?.x === 15
          },
        ),
      )
      realResults.push(
        await runRealModelCase(
          'archetype-2-custom-procedure-jump',
          procRaw,
          '請先用 inspect_raw_blocks 查看 targetIndex 1（Hero）的積木，找到呼叫 Jump %n 的 procedures_call 積木，把它的 arg_h 輸入從 [1, [4, "20"]] 改為 [1, [4, "45"]]，並呼叫 propose_live_patch 提交。',
          async (patched) => {
            const after = await runGreenFlagTicks(await exportLosslessSb3(patched))
            return after.find((t) => t.name === 'Hero')?.y === 45
          },
        ),
      )
      realResults.push(
        await runRealModelCase(
          'archetype-3-list-and-broadcast-event',
          eventRaw,
          '請用 inspect_raw_blocks 查看 targetIndex 1（Inventory）的積木，將 data_changevariableby 積木（add_score）的 VALUE 輸入從 [1, [4, "1"]] 改為 [1, [4, "10"]]，並呼叫 propose_live_patch 提交。',
          async (patched) => {
            const after = await runGreenFlagTicks(await exportLosslessSb3(patched))
            const inv = after.find((t) => t.name === 'Inventory')
            return inv?.variables.v_coins === 10 && JSON.stringify(inv.variables.l_bag) === JSON.stringify(['gold'])
          },
        ),
      )
      realResults.push(
        await runRealModelCase(
          'archetype-4-large-project-duplicate-target-names',
          largeRaw,
          '這是一個有 32 個 target 的大型專案，裡面有兩個名叫 Tiles 的角色。請先用 inspect_raw_targets（query: "Tiles"）找出有積木的那個 Tiles 的 targetIndex（targetIndex 31），再用 inspect_raw_blocks 查看它的 motion_changexby 積木（step_tile），將其 DX 輸入從 [1, [4, "12"]] 改為 [1, [4, "36"]]，並呼叫 propose_live_patch 提交。',
          async (patched) => {
            const after = await runGreenFlagTicks(await exportLosslessSb3(patched))
            return after[11]?.x === 10 && after[31]?.x === 36
          },
        ),
      )

      const paperPath = '/Users/huangjianzhe/Desktop/Paper Minecraft v11.7 (Minecraft 2D).sb3'
      if (existsSync(paperPath)) {
        const paperRaw = await importLosslessSb3(new Uint8Array(readFileSync(paperPath)))
        realResults.push(
          await runRealModelCase(
            'real-case-5-paper-minecraft-tiles-wait',
            paperRaw,
            '這是 Paper Minecraft 專案。請用 inspect_raw_targets（query: "Tiles"）找到 Tiles 角色（targetIndex 8），再用 inspect_raw_blocks（targetIndex: 8, opcode: "control_wait"）找到等待 0.5 秒的積木，將其 DURATION 輸入從 [1, [5, "0.5"]] 改為 [1, [5, "0.75"]]，並呼叫 propose_live_patch 提交。',
            (patched) => {
              const target8 = (
                patched.projectJson.targets as { blocks: Record<string, { inputs?: { DURATION?: unknown } }> }[]
              )[8]
              return Promise.resolve(
                Object.values(target8.blocks).some(
                  (b) => JSON.stringify(b.inputs?.DURATION) === JSON.stringify([1, [5, '0.75']]),
                ),
              )
            },
          ),
        )
      }

      const reportPath = process.env.SCRATCH_BRIDGE_REAL_MODEL_REPORT
      if (reportPath) {
        writeFileSync(
          reportPath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              environment: {
                node: process.version,
                endpoint: 'http://127.0.0.1:8000/v1',
                model: modelId,
              },
              fakeProviderEvaluation: {
                status: 'pass',
                passed: 4,
                total: 4,
              },
              realModelEvaluation: {
                status: realResults.every((r) => r.status === 'pass') ? 'pass' : 'partial',
                passed: realResults.filter((r) => r.status === 'pass').length,
                total: realResults.length,
                cases: realResults,
              },
            },
            null,
            2,
          ),
        )
      }
      expect(realResults.filter((r) => r.status === 'pass').length).toBeGreaterThanOrEqual(4)
    }
  }, 180_000)
})
