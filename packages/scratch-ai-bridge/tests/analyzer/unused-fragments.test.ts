import { describe, expect, it } from 'vitest'
import {
  analyzeCanonicalProject,
  createProjectFeedback,
  createProjectMap,
  createProjectScore,
} from '../../src/core/analyzer'
import type { ScratchTargetBlockGraph } from '../../src/core/graph'
import spriteExample from '../../src/core/ir/examples/02-green-flag-move-say.json'
import example from '../../src/core/ir/examples/04-broadcast-flow.json'
import type { CanonicalProject } from '../../src/core/ir/types'

describe('unused Scratch fragments', () => {
  it('treats unconnected scripts as observations and groups them without treating them as mistakes', () => {
    const project = structuredClone(example) as CanonicalProject
    project.stage.scripts.push({ blocks: [{ opcode: 'looks_say' }] }, { blocks: [{ opcode: 'motion_movesteps' }] })
    const analysis = analyzeCanonicalProject(project)
    const items = analysis.diagnostics.filter(({ code }) => code === 'detached-script')
    expect(items).toHaveLength(2)
    expect(items.every(({ severity }) => severity === 'info')).toBe(true)
    const feedback = createProjectFeedback(analysis, createProjectMap(project, analysis))
    const fragments = feedback.items.filter(({ id }) => id.includes('detached-script'))
    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.severity).toBe('info')
    expect(fragments[0]?.message).toContain('不一定是錯誤')
    expect(fragments[0]?.evidenceIds).toHaveLength(2)
  })

  it('keeps out-of-scope argument reporters on runnable scripts as warnings but treats detached roots as drafts', () => {
    const project = structuredClone(example) as CanonicalProject
    const graphs: ScratchTargetBlockGraph[] = [
      {
        targetIndex: 0,
        targetName: project.stage.name,
        isStage: true,
        blocks: {
          looseRoot: { opcode: 'control_if', topLevel: true, parent: null },
          looseArg: { opcode: 'argument_reporter_boolean', parent: 'looseRoot' },
          standAlone: { opcode: 'argument_reporter_boolean', parent: null, topLevel: true },
          unknownRoot: { opcode: 'vendor_when_ready', parent: null, topLevel: true },
          unknownArg: { opcode: 'argument_reporter_boolean', parent: 'unknownRoot' },
          runnableRoot: { opcode: 'event_whenflagclicked', topLevel: true, parent: null },
          runnableArg: { opcode: 'argument_reporter_boolean', parent: 'runnableRoot' },
        },
        issues: [
          { code: 'invalid-argument-reporter', blockId: 'looseArg', message: 'out of scope' },
          { code: 'invalid-argument-reporter', blockId: 'runnableArg', message: 'out of scope' },
          { code: 'invalid-argument-reporter', blockId: 'standAlone', message: 'out of scope' },
          { code: 'invalid-argument-reporter', blockId: 'unknownArg', message: 'out of scope' },
        ],
      },
    ]
    const analysis = analyzeCanonicalProject(project, graphs)
    const diagnostics = analysis.diagnostics
    expect(diagnostics.find(({ blockId }) => blockId === 'looseArg')).toMatchObject({ severity: 'info' })
    expect(diagnostics.find(({ blockId }) => blockId === 'runnableArg')).toMatchObject({ severity: 'warning' })
    expect(diagnostics.find(({ blockId }) => blockId === 'standAlone')).toMatchObject({ severity: 'info' })
    expect(diagnostics.find(({ blockId }) => blockId === 'unknownArg')).toMatchObject({ severity: 'warning' })
    expect(graphs[0].issues).toHaveLength(4)
    const feedback = createProjectFeedback(analysis, createProjectMap(project, analysis, graphs))
    const graphLimitations = feedback.items.filter(({ id }) => id.includes('graph-issue'))
    expect(graphLimitations).toHaveLength(2)
    expect(graphLimitations.some(({ id }) => id.includes('runnableArg'))).toBe(true)
    expect(graphLimitations.some(({ id }) => id.includes('unknownArg'))).toBe(true)
  })
})

describe('score stability with unused workspace content', () => {
  it('does not deduct points for detached scripts or unused variables', () => {
    const project = structuredClone(example) as CanonicalProject
    const score = () => {
      const analysis = analyzeCanonicalProject(project)
      return createProjectScore(project, analysis, createProjectMap(project, analysis))
    }
    const baseline = score()
    project.stage.scripts.push({ blocks: [{ opcode: 'looks_say' }, { opcode: 'motion_movesteps' }] })
    project.stage.variables.push({ name: 'unused draft', value: 0 })
    const withDrafts = score()
    expect(withDrafts.total).toBe(baseline.total)
    expect(withDrafts.criteria.find(({ id }) => id === 'structure')?.score).toBe(
      baseline.criteria.find(({ id }) => id === 'structure')?.score,
    )
    expect(withDrafts.criteria.find(({ id }) => id === 'integrity')?.score).toBe(
      baseline.criteria.find(({ id }) => id === 'integrity')?.score,
    )
  })
})

it('does not award a normalized perfect score when a small project has no state or interaction evidence', () => {
  const project = structuredClone(example) as CanonicalProject
  project.stage.variables = []
  project.stage.scripts = [
    {
      blocks: [
        { opcode: 'event_whenflagclicked' },
        {
          opcode: 'control_repeat',
          inputs: {
            TIMES: { type: 'literal', value: 2 },
            SUBSTACK: { type: 'stack', blocks: [{ opcode: 'looks_say' }] },
          },
        },
      ],
    },
  ]
  project.sprites = []
  const analysis = analyzeCanonicalProject(project)
  const score = createProjectScore(project, analysis, createProjectMap(project, analysis))
  expect(score.total).toBeNull()
  expect(score.limits.join(' ')).toContain('不足以換算')
})

it('distinguishes a small platformer from projects with reusable and coordinated behavior', async () => {
  const { default: platformer } = await import('../../src/core/ir/examples/06-platformer-core.json')
  const project = platformer as CanonicalProject
  const analysis = analyzeCanonicalProject(project)
  const score = createProjectScore(project, analysis, createProjectMap(project, analysis))
  expect(score.total).not.toBeNull()
  expect(score.total ?? 100).toBeLessThan(100)
  expect(score.limits.join(' ')).toContain('不是作品品質')
})

it('treats a broadcast with no observed receiver as an observation rather than a confirmed error', () => {
  const project = structuredClone(example) as CanonicalProject
  project.stage.scripts = [
    {
      blocks: [
        { opcode: 'event_whenflagclicked' },
        { opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'unused-message' } } },
      ],
    },
  ]
  const analysis = analyzeCanonicalProject(project)
  expect(analysis.diagnostics.find(({ code }) => code === 'broadcast-no-receiver')).toMatchObject({
    severity: 'info',
  })
  const feedback = createProjectFeedback(analysis, createProjectMap(project, analysis))
  expect(feedback.items.find(({ id }) => id.includes('broadcast-no-receiver'))).toMatchObject({ severity: 'info' })
})

it('requires a matching active sender and receiver to recognize coordinated messages', () => {
  const project = structuredClone(example) as CanonicalProject
  project.stage.scripts = [
    {
      blocks: [
        { opcode: 'event_whenflagclicked' },
        { opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'other' } } },
      ],
    },
    {
      blocks: [{ opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'game_over' } } }],
    },
    {
      blocks: [
        { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'game_over' } },
        { opcode: 'looks_say' },
      ],
    },
  ]
  const analysis = analyzeCanonicalProject(project)
  const score = createProjectScore(project, analysis, createProjectMap(project, analysis))
  expect(score.criteria.find(({ id }) => id === 'interaction')?.explanation).toContain('未辨認到訊息發送與接收組合')
})

it('does not count an unresolved call in a different target as a reusable procedure', () => {
  const project = structuredClone(example) as CanonicalProject
  project.stage.procedures = [{ name: 'stage-only', parameters: [], warp: false, body: [] }]
  project.stage.scripts = [
    {
      blocks: [
        { opcode: 'event_whenflagclicked' },
        {
          opcode: 'control_repeat',
          inputs: { TIMES: { type: 'literal', value: 2 }, SUBSTACK: { type: 'stack', blocks: [] } },
        },
      ],
    },
  ]
  project.sprites = structuredClone((spriteExample as CanonicalProject).sprites)
  project.sprites[0].scripts = [
    {
      blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'procedures_call', procedure: { name: 'stage-only' } }],
    },
  ]
  const analysis = analyzeCanonicalProject(project)
  const score = createProjectScore(project, analysis, createProjectMap(project, analysis))
  expect(score.criteria.find(({ id }) => id === 'logic')?.explanation).toContain('自製積木重用未辨認')
})
