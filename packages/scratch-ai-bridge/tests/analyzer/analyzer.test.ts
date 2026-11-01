import { describe, expect, it } from 'vitest'
import {
  analyzeCanonicalProject,
  createProjectFeedback,
  createProjectMap,
  createProjectScore,
} from '../../src/core/analyzer'
import { extractProjectBlockGraphs } from '../../src/core/graph'
import moveAndSayExample from '../../src/core/ir/examples/02-green-flag-move-say.json'
import broadcastExample from '../../src/core/ir/examples/04-broadcast-flow.json'
import fullEntitiesExample from '../../src/core/ir/examples/05-full-entities.json'
import type { CanonicalProject } from '../../src/core/ir/types'

describe('analysis IR', () => {
  it('finds empty hats, duplicate event scripts, and next costume with one costume', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const sprite = structuredClone((moveAndSayExample as CanonicalProject).sprites[0])
    sprite.costumes = structuredClone((fullEntitiesExample as CanonicalProject).sprites[0].costumes.slice(0, 1))
    sprite.scripts = [
      { blocks: [{ opcode: 'event_whenflagclicked' }] },
      { blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'looks_nextcostume' }] },
      { blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'looks_nextcostume' }] },
    ]
    project.sprites = [sprite]
    const codes = analyzeCanonicalProject(project).diagnostics.map(({ code }) => code)
    expect(codes).toContain('empty-event-hat')
    expect(codes).toContain('single-costume-nextcostume-loop')
    expect(codes).toContain('duplicate-script-in-target')
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const costume = createProjectFeedback(analysis, map).items.find(({ id }) =>
      id.includes('single-costume-nextcostume-loop'),
    )
    expect(costume?.evidenceIds.map((id) => map.evidence.find((entry) => entry.id === id)?.opcode)).toEqual([
      'looks_nextcostume',
      'asset-costume',
    ])
    sprite.costumes.push({ ...structuredClone(sprite.costumes[0]), name: 'second' })
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'single-costume-nextcostume-loop'),
    ).toBe(false)
    sprite.scripts = [{ blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'looks_show' }] }]
    const clean = analyzeCanonicalProject(project).diagnostics.map(({ code }) => code)
    expect(clean).not.toContain('empty-event-hat')
    expect(clean).not.toContain('single-costume-nextcostume-loop')
    expect(clean).not.toContain('duplicate-script-in-target')
  })

  it('links duplicate scripts and green-flag clone deletion to their actual blocks', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      { blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'looks_show' }] },
      { blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'looks_show' }] },
      { blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'control_delete_this_clone' }] },
      { blocks: [{ opcode: 'control_start_as_clone' }, { opcode: 'control_delete_this_clone' }] },
    ]
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const feedback = createProjectFeedback(analysis, map)
    const duplicate = feedback.items.find(({ id }) => id.includes('duplicate-script-in-target'))
    expect(
      new Set(duplicate?.evidenceIds.map((id) => map.evidence.find((item) => item.id === id)?.scriptIndex)),
    ).toEqual(new Set([0, 1]))
    const clone = feedback.items.find(({ id }) => id.includes('delete-clone-under-non-clone-hat'))
    expect(clone?.evidenceIds.map((id) => map.evidence.find((item) => item.id === id)?.opcode)).toEqual([
      'control_delete_this_clone',
    ])
    expect(analysis.diagnostics.filter(({ code }) => code === 'delete-clone-under-non-clone-hat')).toHaveLength(1)
  })

  it('recognizes duplicate scripts despite field ordering, positions and comments', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        position: { x: 10, y: 10 },
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'looks_seteffectto', fields: { EFFECT: 'COLOR', OTHER: 'value' }, comment: { text: 'first' } },
        ],
      },
      {
        position: { x: 100, y: 20 },
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'looks_seteffectto', fields: { OTHER: 'value', EFFECT: 'COLOR' }, comment: { text: 'second' } },
        ],
      },
    ]
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'duplicate-script-in-target'),
    ).toBe(true)
    project.stage.scripts[1].blocks[1].fields = { EFFECT: 'GHOST', OTHER: 'value' }
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'duplicate-script-in-target'),
    ).toBe(false)
  })

  it('does not ignore an input merely because its name is comment', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'vendor_custom', inputs: { comment: { type: 'literal', value: 'one' } } },
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'vendor_custom', inputs: { comment: { type: 'literal', value: 'two' } } },
        ],
      },
    ]
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'duplicate-script-in-target'),
    ).toBe(false)
  })

  it('places evidence-backed warnings before ordinary observations', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'control_delete_this_clone' },
          { opcode: 'looks_show' },
        ],
      },
    ]
    const analysis = analyzeCanonicalProject(project)
    const feedback = createProjectFeedback(analysis, createProjectMap(project, analysis))
    expect(feedback.items[0]).toMatchObject({ severity: 'warning' })
    expect(feedback.items.some(({ kind }) => kind === 'confirmed-structure')).toBe(true)
  })

  it('flags overlapping comparisons and opposing immediate actions only for the same event', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const condition = (value: string) => ({
      opcode: 'control_if',
      inputs: {
        CONDITION: {
          type: 'block' as const,
          block: {
            opcode: 'operator_lt',
            inputs: {
              OPERAND1: { type: 'variable' as const, name: 'score' },
              OPERAND2: { type: 'literal' as const, value },
            },
          },
        },
        SUBSTACK: { type: 'stack' as const, blocks: [{ opcode: 'looks_switchcostumeto' }] },
      },
    })
    project.stage.scripts = [
      { blocks: [{ opcode: 'event_whenflagclicked' }, condition('3'), condition('2'), condition('1')] },
      { blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'looks_show' }] },
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.1 } } },
          { opcode: 'looks_hide' },
        ],
      },
    ]
    const codes = analyzeCanonicalProject(project).diagnostics.map(({ code }) => code)
    expect(codes).toContain('overlapping-comparison-chain')
    expect(codes).toContain('concurrent-event-state-conflict')
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const comparison = createProjectFeedback(analysis, map).items.find(({ id }) =>
      id.includes('overlapping-comparison-chain'),
    )
    expect(comparison?.evidenceIds.map((id) => map.evidence.find((item) => item.id === id)?.opcode)).toEqual([
      'operator_lt',
      'operator_lt',
      'operator_lt',
    ])
    project.stage.scripts[2].blocks[0] = { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: 'space' } }
    project.stage.scripts[0].blocks.splice(3, 1)
    const clean = analyzeCanonicalProject(project).diagnostics.map(({ code }) => code)
    expect(clean).not.toContain('overlapping-comparison-chain')
    expect(clean).not.toContain('concurrent-event-state-conflict')
  })

  it('finds a shared changed property even after different setup actions', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const conditional = (setup: string, value: number) => ({
      opcode: 'control_if',
      inputs: {
        CONDITION: {
          type: 'block' as const,
          block: {
            opcode: 'operator_lt',
            inputs: {
              OPERAND1: { type: 'variable' as const, name: 'score' },
              OPERAND2: { type: 'literal' as const, value },
            },
          },
        },
        SUBSTACK: { type: 'stack' as const, blocks: [{ opcode: setup }, { opcode: 'looks_switchcostumeto' }] },
      },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          conditional('looks_show', 30),
          conditional('looks_hide', 20),
          conditional('looks_setsizeto', 10),
        ],
      },
    ]
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'overlapping-comparison-chain'),
    ).toBe(true)
  })

  it('does not report a comparison chain that changes different visual effects', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const conditional = (effect: string) => ({
      opcode: 'control_if',
      inputs: {
        CONDITION: {
          type: 'block' as const,
          block: {
            opcode: 'operator_lt',
            inputs: {
              OPERAND1: { type: 'variable' as const, name: 'score' },
              OPERAND2: { type: 'literal' as const, value: 5 },
            },
          },
        },
        SUBSTACK: { type: 'stack' as const, blocks: [{ opcode: 'looks_seteffectto', fields: { EFFECT: effect } }] },
      },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          conditional('COLOR'),
          conditional('GHOST'),
          conditional('PIXELATE'),
        ],
      },
    ]
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'overlapping-comparison-chain'),
    ).toBe(false)
  })

  it('reports competing visibility after non-yielding setup and links both scripts', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const hat = { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'intro' } }
    project.stage.scripts = [
      { blocks: [hat, { opcode: 'looks_seteffectto' }, { opcode: 'looks_setsizeto' }, { opcode: 'looks_hide' }] },
      {
        blocks: [
          hat,
          { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.01 } } },
          { opcode: 'looks_show' },
        ],
      },
    ]
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const item = createProjectFeedback(analysis, map).items.find(({ id }) =>
      id.includes('concurrent-event-state-conflict'),
    )
    expect(item).toBeDefined()
    expect(new Set(item?.evidenceIds.map((id) => map.evidence.find((e) => e.id === id)?.scriptIndex))).toEqual(
      new Set([0, 1]),
    )
    project.stage.scripts[1].blocks[1] = {
      opcode: 'control_wait',
      inputs: { DURATION: { type: 'literal', value: 1 } },
    }
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'concurrent-event-state-conflict'),
    ).toBe(false)
  })

  it('deducts organization points for more than four scripts for the same event', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = Array.from({ length: 5 }, (_, index) => ({
      blocks: [
        { opcode: 'event_whenflagclicked' },
        { opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal' as const, value: index } } },
      ],
    }))
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const criterion = createProjectScore(project, analysis, map).criteria.find(({ id }) => id === 'organization')
    expect(criterion?.score).toBeLessThan(5)
    expect(criterion?.explanation).toContain('同一事件')
    project.stage.scripts.pop()
    const clean = analyzeCanonicalProject(project)
    const cleanMap = createProjectMap(project, clean)
    expect(createProjectScore(project, clean, cleanMap).criteria.find(({ id }) => id === 'organization')?.score).toBe(
      5,
    )
  })

  it('locates a loop condition whose sole write is outside the branch', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.variables = [
      { name: 'ready', value: 0 },
      { name: 'other', value: 0 },
    ]
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'ready' },
            inputs: { VALUE: { type: 'literal', value: 0 } },
          },
          {
            opcode: 'control_forever',
            inputs: {
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'control_if',
                    inputs: {
                      CONDITION: {
                        type: 'block',
                        block: {
                          opcode: 'operator_equals',
                          inputs: {
                            OPERAND1: { type: 'variable', name: 'ready' },
                            OPERAND2: { type: 'literal', value: 1 },
                          },
                        },
                      },
                      SUBSTACK: {
                        type: 'stack',
                        blocks: [
                          {
                            opcode: 'data_setvariableto',
                            fields: { VARIABLE: 'other' },
                            inputs: { VALUE: { type: 'literal', value: 1 } },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ]
    const analysis = analyzeCanonicalProject(project)
    const diagnostic = analysis.diagnostics.find(({ code }) => code === 'condition-variable-mismatch-in-loop')
    expect(diagnostic).toMatchObject({ target: project.stage.name, script: 1 })
    const map = createProjectMap(project, analysis)
    const item = createProjectFeedback(analysis, map).items.find(({ id }) =>
      id.includes('condition-variable-mismatch-in-loop'),
    )
    expect(item?.evidenceIds.map((id) => map.evidence.find((entry) => entry.id === id)?.path)).toEqual(
      diagnostic?.evidencePaths?.slice(0, 2),
    )
    project.stage.scripts[0].blocks.push({ opcode: 'data_changevariableby', fields: { VARIABLE: 'ready' } })
    expect(
      analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'condition-variable-mismatch-in-loop'),
    ).toBe(false)
  })

  it('calibrates state and integrity scores from observable structural differences', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.variables = [{ name: 'used', value: 0 }]
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'used' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
        ],
      },
    ]
    const score = () => {
      const analysis = analyzeCanonicalProject(project)
      return createProjectScore(project, analysis, createProjectMap(project, analysis))
    }
    const clean = score()
    project.stage.variables.push({ name: 'unused', value: 0 })
    const unused = score()
    expect(unused.criteria.find(({ id }) => id === 'state')?.score).toBe(
      (clean.criteria.find(({ id }) => id === 'state')?.score ?? 0) - 2,
    )
    expect(unused.criteria.find(({ id }) => id === 'state')?.explanation).toContain('1 個宣告變數未見讀寫')
    project.stage.scripts.push(structuredClone(project.stage.scripts[0]))
    const duplicated = score()
    expect(duplicated.criteria.find(({ id }) => id === 'integrity')?.score).toBeLessThan(
      unused.criteria.find(({ id }) => id === 'integrity')?.score ?? 0,
    )
    expect(duplicated.criteria.find(({ id }) => id === 'organization')?.score).toBeLessThan(
      unused.criteria.find(({ id }) => id === 'organization')?.score ?? 0,
    )
  })

  it('treats a declared but unused variable as state evidence even without data blocks', () => {
    const project = structuredClone(moveAndSayExample as CanonicalProject)
    project.stage.variables = [{ name: 'unused-private', value: 0 }]
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const criterion = createProjectScore(project, analysis, map).criteria.find(({ id }) => id === 'state')
    expect(criterion).toMatchObject({ applicability: 'applicable', score: 13 })
    expect(
      criterion?.evidenceIds.some((id) => map.evidence.find((item) => item.id === id)?.path === '/stage/variables/0'),
    ).toBe(true)
  })

  it('counts monitored variables as used and scores a missing variable monitor', () => {
    const project = structuredClone(moveAndSayExample as CanonicalProject)
    project.stage.variables = [{ name: 'score', value: 0 }]
    project.monitors = [
      {
        id: 'monitor',
        opcode: 'data_variable',
        params: { VARIABLE: 'score' },
        spriteName: null,
        mode: 'default',
        value: 0,
        visible: true,
      },
    ]
    const calculate = () => {
      const analysis = analyzeCanonicalProject(project)
      return createProjectScore(project, analysis, createProjectMap(project, analysis))
    }
    const state = calculate().criteria.find(({ id }) => id === 'state')
    expect(state).toMatchObject({ applicability: 'applicable', score: 15 })
    expect(state?.explanation).toContain('0 個宣告變數未見讀寫')
    project.monitors[0].params.VARIABLE = 'missing'
    const missing = calculate().criteria.find(({ id }) => id === 'state')
    expect(missing?.score).toBeLessThan(15)
    expect(missing?.explanation).toContain('1 項變數監視器')
  })

  it('creates grounded project facts with stable raw block evidence and separate coverage', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const rawGraphs = [
      {
        targetIndex: 0,
        targetName: 'Stage',
        isStage: true,
        blocks: {
          green: { opcode: 'event_whenflagclicked', shadow: false },
          unknown: { opcode: 'thirdparty_sensor_read', shadow: false },
        },
        issues: [{ code: 'missing-block' as const, blockId: 'unknown', message: 'missing link' }],
      },
    ]
    const mappings = [
      {
        irPath: '/stage/scripts/0/blocks/0',
        blockId: 'green',
        opcode: 'event_whenflagclicked',
        targetIndex: 0,
        targetName: 'Stage',
        isStage: true,
      },
    ]

    const result = createProjectMap(project, analyzeCanonicalProject(project, rawGraphs), rawGraphs, mappings)

    expect(result.format).toBe('scratch-ai-bridge/project-map')
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        kind: 'trigger',
        claim: '按下綠旗時，角色「Stage」開始執行這段程式。',
        evidence: [expect.objectContaining({ blockId: 'green', opcode: 'event_whenflagclicked' })],
      }),
    )
    expect(result.facts.some(({ claim }) => claim.includes('來自額外擴充、Bridge 暫時看不懂作用'))).toBe(true)
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ blockId: 'unknown', opcode: 'thirdparty_sensor_read', scriptIndex: null }),
    )
    expect(result.facts.map(({ claim }) => claim).join(' ')).not.toContain('unknown')
    expect(result.facts.some(({ claim }) => claim.includes('積木的資料需要確認'))).toBe(true)
    expect(result.coverage).toMatchObject({
      roundTrip: 'not-run',
      importedBlocks: 2,
      opaqueBlocks: 1,
      malformedGraphIssues: 1,
    })
    expect(result.facts.every(({ confidence, evidence }) => confidence === 'limited' || evidence.length > 0)).toBe(
      true,
    )
  })

  it('summarizes known extension inputs while keeping free text private', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const rawGraphs = [
      {
        targetIndex: 0,
        targetName: 'Stage',
        isStage: true,
        blocks: {
          camera: {
            opcode: 'videoSensing_videoToggle',
            inputs: { VIDEO_STATE: [1, 'camera-state', 'camera-state'] },
          },
          'camera-state': { opcode: 'videoSensing_menu_VIDEO_STATE', fields: { VIDEO_STATE: ['on'] }, shadow: true },
          speech: {
            opcode: 'text2speech_speakAndWait',
            inputs: { WORDS: [1, [10, 'student-private-name']] },
          },
        },
        issues: [],
      },
    ]

    const map = createProjectMap(project, analyzeCanonicalProject(project, rawGraphs), rawGraphs)
    const camera = map.evidence.find(({ blockId }) => blockId === 'camera')
    const speech = map.evidence.find(({ blockId }) => blockId === 'speech')

    expect(camera?.studentLabel).toContain('攝影機狀態為「on」')
    expect(speech?.studentLabel).toContain('朗讀文字已設定（文字內容隱去）')
    expect(JSON.stringify(map)).not.toContain('student-private-name')
    expect(map.coverage.extensions).toEqual([
      expect.objectContaining({ extensionId: 'text2speech', recognizedBlocks: 1, opaqueBlocks: 0 }),
      expect.objectContaining({ extensionId: 'videoSensing', recognizedBlocks: 1, opaqueBlocks: 0 }),
    ])
    expect(map.coverage.extensions.map(({ extensionName }) => extensionName)).not.toContain('thirdparty_sensor_read')
  })

  it('summarizes scripts and broadcast dependencies', () => {
    const result = analyzeCanonicalProject(broadcastExample as CanonicalProject)
    expect(result.summary.scripts).toBe(2)
    expect(result.summary.broadcasts).toBe(1)
    expect(result.dependencies.broadcasts[0]).toMatchObject({
      name: 'game_over',
      senders: ['Stage#1'],
      receivers: ['Stage#2'],
    })
  })

  it('does not lower the score just because an extension opcode is opaque', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    const baseAnalysis = analyzeCanonicalProject(project)
    const baseMap = createProjectMap(project, baseAnalysis)
    const baseScore = createProjectScore(project, baseAnalysis, baseMap)
    project.extensions = ['vendor']
    project.stage.scripts[0].blocks.push({ opcode: 'vendor_sensor_read' })
    const extensionAnalysis = analyzeCanonicalProject(project)
    const extensionMap = createProjectMap(project, extensionAnalysis, [
      {
        targetIndex: 0,
        targetName: project.stage.name,
        isStage: true,
        blocks: { vendor: { opcode: 'vendor_sensor_read' } },
        issues: [],
      },
    ])
    const extensionScore = createProjectScore(project, extensionAnalysis, extensionMap)

    expect(extensionMap.coverage.opaqueBlocks).toBeGreaterThan(0)
    expect(extensionScore.total).toBe(baseScore.total)
    expect(extensionScore.limits.some((item) => item.includes('未能完整辨識'))).toBe(true)
  })

  it('marks unused optional dimensions not applicable and normalizes over applicable weights', () => {
    const project = moveAndSayExample as CanonicalProject
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const score = createProjectScore(project, analysis, map)

    expect(score.rubric).toBe('sb3-static-v2')
    expect(score.criteria.find(({ id }) => id === 'state')).toMatchObject({
      score: null,
      applicability: 'not-applicable',
    })
    expect(score.criteria.find(({ id }) => id === 'interaction')).toMatchObject({
      score: null,
      applicability: 'not-applicable',
    })
    expect(score.total).toBe(90)
  })

  it('withholds a total when the SB3 has no readable evidence', () => {
    const project = structuredClone(moveAndSayExample as CanonicalProject)
    const firstSprite = project.sprites[0]
    firstSprite.scripts = []
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const score = createProjectScore(project, analysis, map)

    expect(score.total).toBeNull()
    expect(score.limits).toContain('目前沒有足夠的積木證據可供評分。')
  })

  it('recognizes registry event hats and gives a located next step for a detached known script', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whentouchingobject', fields: { TOUCHINGOBJECTMENU: '_edge_' } },
          { opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal', value: 10 } } },
        ],
      },
      {
        blocks: [
          { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'Hello' } } },
          { opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal', value: 10 } } },
        ],
      },
    ]

    const analysis = analyzeCanonicalProject(project)
    const detached = analysis.diagnostics.find(({ code }) => code === 'detached-script')
    const map = createProjectMap(project, analysis)
    const feedback = createProjectFeedback(analysis, map)
    const actionable = feedback.items.find(({ id }) => id.includes('detached-script'))
    const firstBlock = map.evidence.find(
      ({ targetName, scriptIndex, path }) =>
        targetName === project.stage.name && scriptIndex === 1 && path.endsWith('/scripts/1/blocks/0'),
    )

    expect(analysis.diagnostics.some(({ code, script }) => code === 'detached-script' && script === 1)).toBe(false)
    expect(detached).toMatchObject({ severity: 'warning', target: project.stage.name, script: 2 })
    expect(actionable?.title).toBe('這段程式可能少了開始積木')
    expect(actionable?.message).toContain('顯示對話')
    expect(actionable?.nextStep).toContain('當綠旗被點擊')
    expect(actionable?.evidenceIds).toEqual([firstBlock?.id])
  })

  it('does not call an unrecognized extension script entry a missing event hat', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [{ blocks: [{ opcode: 'vendor_when_ready' }, { opcode: 'motion_movesteps' }] }]

    const diagnostic = analyzeCanonicalProject(project).diagnostics.find(
      ({ code }) => code === 'unclassified-script-entry',
    )

    expect(diagnostic).toMatchObject({ severity: 'info', target: project.stage.name, script: 1 })
    expect(analyzeCanonicalProject(project).diagnostics.some(({ code }) => code === 'detached-script')).toBe(false)
  })

  it('warns for offline cloud variables without changing their declarations', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.stage.variables = [
      { name: 'cloud score', value: 12, cloud: true },
      { name: 'local score', value: 7, cloud: false },
    ]
    const before = structuredClone(project.stage.variables)

    const result = analyzeCanonicalProject(project)

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'cloud-variable-offline',
        target: 'Stage',
        variable: 'cloud score',
      }),
    )
    const cloudWarnings = result.diagnostics.filter(({ code }) => code === 'cloud-variable-offline')
    expect(cloudWarnings).toHaveLength(1)
    expect(cloudWarnings[0].message).toContain('不會同步到 Scratch 雲端')
    expect(project.stage.variables).toEqual(before)
  })

  it('does not treat a forever loop without an explicit wait as a busy loop', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_forever',
            inputs: { SUBSTACK: { type: 'stack', blocks: [{ opcode: 'motion_movesteps' }] } },
          },
          { opcode: 'control_wait' },
        ],
      },
    ]

    expect(analyzeCanonicalProject(project).diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'forever-without-yield', script: 1 }),
    )

    project.stage.scripts[0].blocks = [
      { opcode: 'event_whenflagclicked' },
      {
        opcode: 'control_forever',
        inputs: { SUBSTACK: { type: 'stack', blocks: [{ opcode: 'control_wait' }] } },
      },
      { opcode: 'control_wait' },
    ]
    expect(analyzeCanonicalProject(project).diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'forever-without-yield', script: 1 }),
    )

    expect(analyzeCanonicalProject(project).diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'forever-without-yield', script: 1 }),
    )
  })

  it('explains that variable assignments in forever may be intentional state updates', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_forever',
            inputs: {
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'dy' },
                    inputs: { VALUE: { type: 'literal', value: -6 } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const diagnostic = analyzeCanonicalProject(project).diagnostics.find(
      ({ code }) => code === 'forever-reinitialize',
    )
    expect(diagnostic?.message).toContain('dy')
    expect(diagnostic?.message).toContain('碰撞反彈、計分或狀態更新通常是預期行為')
    expect(diagnostic?.message).toContain('只需執行一次')
  })

  it('includes raw graph preservation and structural diagnostics', () => {
    const canonical = broadcastExample as CanonicalProject
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            reporter: {
              opcode: 'thirdparty_reporter',
              next: null,
              parent: null,
              topLevel: true,
              inputs: {},
              mutation: { extension: 'kept' },
            },
            broken: { opcode: 'control_repeat', next: 'missing', parent: null, inputs: {} },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(canonical, graphs)

    const preserved = result.diagnostics.find(({ code }) => code === 'raw-block-graph-preserved')
    const unmodeled = result.diagnostics.find(({ code }) => code === 'raw-block-graph-unmodeled-opcodes')
    const broken = result.diagnostics.find(({ code }) => code === 'block-graph-missing-block')

    expect(preserved?.message).toContain('2 個積木')
    expect(unmodeled?.message).toContain('thirdparty_reporter')
    expect(broken).toMatchObject({ severity: 'warning', target: 'Stage' })
  })

  it('tracks variable and list reads and writes from Scratch reporter fields', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_changevariableby',
            fields: { VARIABLE: 'score' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
          {
            opcode: 'data_addtolist',
            fields: { LIST: 'items' },
            inputs: { ITEM: { type: 'literal', value: 'coin' } },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'total' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'data_variable', fields: { VARIABLE: 'score' } },
              },
            },
          },
          {
            opcode: 'operator_join',
            inputs: {
              STRING1: { type: 'variable', name: 'externalScore' },
              STRING2: { type: 'list', name: 'externalItems' },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'total' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'data_lengthoflist', fields: { LIST: 'items' } },
              },
            },
          },
        ],
      },
    ]

    const result = analyzeCanonicalProject(project)
    expect(result.targets[0].scripts[0]).toMatchObject({
      reads: ['score', 'externalScore'],
      writes: ['score', 'total'],
      listReads: ['externalItems', 'items'],
      listWrites: ['items'],
    })
    expect(result.targets[0].scripts[0].reads).toContain('externalScore')
  })

  it('counts procedure bodies and reports procedure call dependencies', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.stage.procedures[0].body = [
      { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'inside procedure' } } },
      { opcode: 'data_changevariableby', fields: { VARIABLE: 'score' } },
      { opcode: 'data_lengthoflist', fields: { LIST: 'items' } },
      { opcode: 'procedures_call', procedure: { name: 'helper' } },
    ]
    project.stage.procedures.push({
      name: 'helper',
      parameters: [],
      warp: false,
      body: [
        {
          opcode: 'data_setvariableto',
          fields: { VARIABLE: 'score' },
          inputs: {
            VALUE: { type: 'variable', name: 'externalScore' },
            EXTRA: { type: 'list', name: 'externalItems' },
          },
        },
        { opcode: 'data_setvariableto', fields: { VARIABLE: 'helperScore' } },
        { opcode: 'data_addtolist', fields: { LIST: 'items' } },
        { opcode: 'procedures_call', procedure: { name: 'announce' } },
      ],
    })
    project.stage.scripts[0].blocks.push({ opcode: 'procedures_call', procedure: { name: 'announce' } })
    project.stage.scripts[0].blocks.push({ opcode: 'procedures_call', procedure: { name: 'missing' } })

    const result = analyzeCanonicalProject(project)
    expect(result.summary.procedures).toBe(2)
    expect(result.targets[0].procedures).toEqual([
      {
        name: 'announce',
        blockCount: 4,
        calls: ['helper'],
        broadcasts: [],
        reads: ['score', 'externalScore'],
        writes: ['score', 'helperScore'],
        listReads: ['items', 'externalItems'],
        listWrites: ['items'],
      },
      {
        name: 'helper',
        blockCount: 4,
        calls: ['announce'],
        broadcasts: [],
        reads: ['externalScore', 'score'],
        writes: ['score', 'helperScore'],
        listReads: ['externalItems', 'items'],
        listWrites: ['items'],
      },
    ])
    expect(result.dependencies.procedures).toEqual([
      { target: 'Stage', name: 'announce', callees: ['helper'] },
      { target: 'Stage', name: 'helper', callees: ['announce'] },
    ])
    expect(result.targets[0].scripts[0]).toMatchObject({
      reads: ['score', 'externalScore'],
      writes: ['score', 'helperScore'],
      listReads: ['items', 'externalItems'],
      listWrites: ['items'],
    })
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'procedure-no-definition', target: 'Stage' }),
    )
    expect(result.summary.blocks).toBeGreaterThan(result.targets.reduce((sum, target) => sum + target.blockCount, 0))
  })

  it('tracks broadcasts emitted directly and transitively by custom procedures', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.stage.procedures = [
      {
        name: 'sendNotice',
        parameters: [],
        warp: false,
        body: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'notice' } } }],
      },
      {
        name: 'relay',
        parameters: [],
        warp: false,
        body: [{ opcode: 'procedures_call', procedure: { name: 'sendNotice' } }],
      },
    ]
    project.stage.scripts.push({
      blocks: [{ opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'notice' } }],
    })

    const result = analyzeCanonicalProject(project)
    expect(result.targets[0].procedures.map(({ name, broadcasts }) => ({ name, broadcasts }))).toEqual([
      { name: 'sendNotice', broadcasts: ['notice'] },
      { name: 'relay', broadcasts: ['notice'] },
    ])
    expect(result.dependencies.broadcasts.find(({ name }) => name === 'notice')?.senders).toEqual([
      'Stage::procedure:sendNotice',
      'Stage::procedure:relay',
    ])
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'broadcast-no-receiver', message: '廣播「notice」有送出者，但沒有接收腳本。' }),
    )
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: 'receiver-no-sender',
        message: '「當收到 notice」存在，但專案內找不到明顯的 broadcast 發送者。',
      }),
    )
  })

  it('propagates effects through long procedure chains without recursion', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    const procedureCount = 1_024
    project.stage.procedures = Array.from({ length: procedureCount }, (_, index) => ({
      name: `chain-${index}`,
      parameters: [],
      warp: false,
      body:
        index + 1 < procedureCount
          ? [{ opcode: 'procedures_call', procedure: { name: `chain-${index + 1}` } }]
          : [{ opcode: 'data_setvariableto', fields: { VARIABLE: 'terminalValue' } }],
    }))
    project.stage.scripts = [
      {
        blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'procedures_call', procedure: { name: 'chain-0' } }],
      },
    ]

    const result = analyzeCanonicalProject(project)
    expect(result.targets[0].procedures[0].writes).toEqual(['terminalValue'])
    expect(result.targets[0].scripts[0].writes).toEqual(['terminalValue'])
  })

  it('reports monitor, asset, and extension dependencies from semantic and raw project data', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.extensions = ['pen']
    project.stage.costumes[0].assetIssue = 'missing-archive-entry'
    project.stage.sounds[0].assetIssue = 'checksum-mismatch'
    project.monitors = [
      {
        id: 'score-monitor',
        opcode: 'data_variable',
        params: { VARIABLE: 'missing-score' },
        spriteName: null,
        mode: 'default',
        value: 0,
        visible: true,
      },
      {
        id: 'items-monitor',
        opcode: 'data_listcontents',
        params: { LIST: 'items' },
        spriteName: null,
        mode: 'list',
        value: [],
        visible: true,
      },
    ]
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            penBlock: { opcode: 'pen_penDown', next: null, parent: null, topLevel: true },
            penBlock2: { opcode: 'pen_penDown', next: null, parent: null, topLevel: true },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(project, graphs)
    expect(result.dependencies.monitors).toEqual([
      { id: 'score-monitor', opcode: 'data_variable', target: null, variable: 'missing-score' },
      { id: 'items-monitor', opcode: 'data_listcontents', target: null, list: 'items' },
    ])
    expect(result.dependencies.assets).toEqual([
      { target: 'Stage', kind: 'costume', name: project.stage.costumes[0].name, issue: 'missing-archive-entry' },
      { target: 'Stage', kind: 'sound', name: project.stage.sounds[0].name, issue: 'checksum-mismatch' },
    ])
    expect(result.dependencies.extensions).toEqual([
      { id: 'pen', declared: true, blockCount: 2, opcodes: ['pen_penDown'] },
    ])
    expect(result.diagnostics.map(({ code }) => code)).toContain('monitor-variable-missing')
    expect(result.diagnostics.map(({ code }) => code)).toContain('asset-checksum-mismatch')
  })

  it('links non-script warnings to the actual variable, monitor and asset evidence', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.stage.variables.push({ name: 'cloud-private', value: 0, cloud: true })
    project.stage.costumes[0].assetIssue = 'missing-archive-entry'
    project.monitors = [
      {
        id: 'private-monitor-id',
        opcode: 'data_variable',
        params: { VARIABLE: 'missing-var' },
        spriteName: null,
        mode: 'default',
        value: 0,
        visible: true,
      },
    ]
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const feedback = createProjectFeedback(analysis, map)
    for (const [code, path] of [
      ['cloud-variable-offline', '/stage/variables/'],
      ['monitor-variable-missing', '/monitors/'],
      ['asset-missing-archive-entry', '/stage/costumes/'],
    ]) {
      const item = feedback.items.find(({ id }) => id.includes(code))
      expect(item?.evidenceIds.length).toBeGreaterThan(0)
      expect(
        item?.evidenceIds.every((id) => map.evidence.find((source) => source.id === id)?.path.startsWith(path)),
      ).toBe(true)
    }
  })

  it('keeps distinct warning identities for multiple cloud variables', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.stage.variables.push(
      { name: 'first-cloud', value: 0, cloud: true },
      { name: 'second-cloud', value: 0, cloud: true },
    )
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const warnings = createProjectFeedback(analysis, map).items.filter(({ id }) =>
      id.includes('cloud-variable-offline'),
    )
    expect(warnings).toHaveLength(2)
    expect(new Set(warnings.map(({ id }) => id)).size).toBe(2)
    expect(new Set(warnings.flatMap(({ evidenceIds }) => evidenceIds)).size).toBe(2)
  })

  it('links missing procedures, broadcasts, graph issues and extension warnings to relevant sources', () => {
    const project = structuredClone(broadcastExample as CanonicalProject)
    project.extensions = ['vendor-private']
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'procedures_call', procedure: { name: 'missing-private' } },
          { opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'notice-private' } } },
        ],
      },
    ]
    const graphs = [
      {
        targetIndex: 0,
        targetName: project.stage.name,
        isStage: true,
        blocks: {},
        issues: [{ code: 'missing-block' as const, blockId: 'private-block-id', message: 'missing block' }],
      },
    ]
    const analysis = analyzeCanonicalProject(project, graphs)
    const map = createProjectMap(project, analysis, graphs)
    const feedback = createProjectFeedback(analysis, map)
    for (const [code, predicate] of [
      ['procedure-no-definition', (source: (typeof map.evidence)[number]) => source.opcode === 'procedures_call'],
      ['broadcast-no-receiver', (source: (typeof map.evidence)[number]) => source.opcode === 'event_broadcast'],
      ['block-graph-missing-block', (source: (typeof map.evidence)[number]) => source.blockId === 'private-block-id'],
      [
        'extension-runtime-unavailable',
        (source: (typeof map.evidence)[number]) => source.reference?.kind === 'extension',
      ],
    ] as const) {
      const item = feedback.items.find(({ id }) => id.includes(code))
      expect(item?.evidenceIds.length).toBeGreaterThan(0)
      expect(
        item?.evidenceIds.every((id) => {
          const source = map.evidence.find((entry) => entry.id === id)
          return source && predicate(source)
        }),
      ).toBe(true)
    }
  })

  it('explains whether extensions can execute in this Bridge runtime', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.extensions = ['wedo2', 'microbit', 'ev3', 'boost', 'gdxfor', 'faceSensing', 'videoSensing']
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            vendorBlock: { opcode: 'vendor_custom', next: null, parent: null, topLevel: true },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(project, graphs)

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'extension-runtime-unavailable' }),
    )
    expect(result.diagnostics.find(({ code }) => code === 'extension-runtime-unavailable')?.message).toContain(
      'vendor',
    )
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'info', code: 'extension-runtime-unverified' }),
    )
    expect(
      result.diagnostics
        .filter(({ code }) => code === 'extension-runtime-unverified')
        .some(({ message }) => message.includes('wedo2')),
    ).toBe(true)
    const hardwarePreviewMessages = result.diagnostics
      .filter(({ code }) => code === 'extension-hardware-unverified')
      .map(({ message }) => message)
    expect(hardwarePreviewMessages).toHaveLength(5)
    expect(hardwarePreviewMessages.every((message) => message.includes('Scratch Link 搜尋與配對入口'))).toBe(true)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'extension-runtime-disabled' }),
    )
    const disabledMessages = result.diagnostics
      .filter(({ code }) => code === 'extension-runtime-disabled')
      .map(({ message }) => message)
    expect(disabledMessages).toHaveLength(2)
    expect(disabledMessages.find((message) => message.includes('faceSensing'))).toContain('MediaPipe')
    expect(disabledMessages.find((message) => message.includes('videoSensing'))).toContain('自動啟用攝影機')
  })

  it('warns that Text to Speech sends spoken text to the Scratch service', () => {
    const project = structuredClone(fullEntitiesExample as CanonicalProject)
    project.extensions = ['text2speech']
    const graphs = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            speechBlock: { opcode: 'text2speech_speakAndWait', next: null, parent: null, topLevel: true },
          },
        },
      ],
    })

    const result = analyzeCanonicalProject(project, graphs)
    const warning = result.diagnostics.find(({ code }) => code === 'extension-data-egress')

    expect(warning?.severity).toBe('warning')
    expect(warning?.message).toContain('最多 128 個字元')
    expect(warning?.message).toContain('Scratch 合成服務')
    expect(warning?.message).toContain('個人或敏感資料')
  })
})
