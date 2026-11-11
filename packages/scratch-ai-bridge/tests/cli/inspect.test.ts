import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { inspectSb3Bytes, inspectionToMarkdown, inspectionToStudentMarkdown } from '../../src/cli/inspect'
import { analyzeCanonicalProject, createProjectMap, createProjectScore } from '../../src/core/analyzer'
import { importLosslessSb3 } from '../../src/core/archive'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { projectJsonToCanonicalWithReport } from '../../src/core/decompiler/project-json'
import { extractProjectBlockGraphs } from '../../src/core/graph'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createEvidencePacket } from '../../src/core/prompt/evidence-packet'
import { createScoringFeedbackPrompt } from '../../src/core/prompt/scoring-feedback'

describe('static CLI inspection', () => {
  it('exposes JSON, teacher Markdown and student Markdown through the CLI', () => {
    const fixture = '../scratch-vm/test/fixtures/edge-triggered-hat.sb3'
    for (const [format, expected] of [
      ['json', 'scratch-ai-bridge/inspection'],
      ['markdown', 'Scratch 教師檢視報告'],
      ['student-markdown', '給學生看的作品小提醒'],
    ]) {
      const result = spawnSync(
        process.execPath,
        ['bin/scratch-ai-bridge.mjs', 'inspect', fixture, '--format', format],
        { encoding: 'utf8', timeout: 20_000 },
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(expected)
    }
  }, 20_000)

  it('analyzes raw SB3 structure without exposing sprite names or block IDs', async () => {
    const project = structuredClone(example02) as CanonicalProject
    project.sprites[0].name = 'Private Student Name'
    const archive = await compileCanonicalProjectToSb3(project)
    const result = await inspectSb3Bytes(new Uint8Array(await archive.arrayBuffer()))
    const json = JSON.stringify(result)

    expect(result).toMatchObject({
      format: 'scratch-ai-bridge/inspection',
      version: 1,
      analysisMode: 'static-raw-sb3',
      runtimeVerified: false,
      status: 'ok',
    })
    expect(result.summary.sprites).toBe(1)
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence[0]?.id).toMatch(/^E\d+$/)
    const evidenceIds = new Set(result.evidence.map(({ id }) => id))
    for (const reference of [
      ...result.feedback.items.flatMap(({ evidenceIds: ids }) => ids),
      ...result.score.criteria.flatMap(({ evidenceIds: ids }) => ids),
    ]) {
      expect(evidenceIds.has(reference)).toBe(true)
    }
    expect(json).not.toContain('Private Student Name')
    expect(json).toContain('角色 1')
    expect(json).not.toContain('blockId')
    expect(inspectionToMarkdown(result)).toContain('沒有執行作品')
    const studentReport = inspectionToStudentMarkdown(result)
    expect(studentReport).toContain('給學生看的作品小提醒')
    expect(studentReport).toContain('沒有實際執行你的作品')
    expect(studentReport).not.toContain('SB3 結構參考分')
    expect(studentReport).not.toMatch(/[EF]\d+/)
  })

  it('keeps scoped variables and messages distinct without exporting student text or names', async () => {
    const project = structuredClone(example02) as CanonicalProject
    project.stage.variables = [{ name: 'secret-same-name', value: 0 }]
    project.sprites[0].variables = [
      { name: 'secret-same-name', value: 0 },
      { name: 'secret-other-name', value: 0 },
    ]
    project.broadcasts = [{ name: 'private-message-one' }, { name: 'private-message-two' }]
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'secret-same-name' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
          {
            opcode: 'event_broadcast',
            inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'private-message-one' } },
          },
        ],
      },
    ]
    project.sprites[0].scripts = [
      {
        blocks: [
          { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'private-message-one' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'secret-same-name' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'private-message-two' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'secret-other-name' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal', value: 'free-text-private-value' } } },
        ],
      },
    ]
    const archive = await compileCanonicalProjectToSb3(project)
    const result = await inspectSb3Bytes(new Uint8Array(await archive.arrayBuffer()))
    const reports = [JSON.stringify(result), inspectionToMarkdown(result), inspectionToStudentMarkdown(result)]
    for (const report of reports) {
      for (const secret of [
        'secret-same-name',
        'secret-other-name',
        'private-message-one',
        'private-message-two',
        'free-text-private-value',
      ])
        expect(report).not.toContain(secret)
    }
    expect(reports[0]).toContain('變數 V1')
    expect(reports[0]).toContain('變數 V2')
    expect(reports[0]).toContain('訊息 M1')
    expect(reports[0]).toContain('訊息 M2')
    const zip = await JSZip.loadAsync(await archive.arrayBuffer())
    const projectEntry = zip.file('project.json')
    if (!projectEntry) throw new Error('fixture project.json missing')
    const projectJson = JSON.parse(await projectEntry.async('string')) as {
      targets: {
        isStage: boolean
        variables: Record<string, [string, unknown]>
        blocks: Record<string, { opcode: string; fields?: Record<string, [string, string]> }>
      }[]
    }
    const stage = projectJson.targets.find(({ isStage }) => isStage)
    const sprite = projectJson.targets.find(({ isStage }) => !isStage)
    if (!stage || !sprite) throw new Error('fixture must contain a stage and sprite')
    const globalId = Object.entries(stage.variables).find(([, value]) => value[0] === 'secret-same-name')?.[0]
    const localId = Object.entries(sprite.variables).find(([, value]) => value[0] === 'secret-same-name')?.[0]
    const setters = Object.values(sprite.blocks).filter(({ opcode }) => opcode === 'data_setvariableto')
    if (!globalId || !localId || setters.length < 2) throw new Error('fixture variables or setter blocks missing')
    setters[0].fields = { VARIABLE: ['secret-same-name', globalId] }
    setters[1].fields = { VARIABLE: ['secret-same-name', localId] }
    zip.file('project.json', JSON.stringify(projectJson))
    const scopedBytes = await zip.generateAsync({ type: 'uint8array' })
    const scoped = await inspectSb3Bytes(scopedBytes)
    const spriteLabels = scoped.evidence
      .filter(({ target, opcode }) => target === '角色 1' && opcode === 'data_setvariableto')
      .map(({ label }) => label)
    expect(spriteLabels.some((label) => label.includes('變數 V1'))).toBe(true)
    expect(spriteLabels.some((label) => label.includes('變數 V2'))).toBe(true)
    projectJson.targets.reverse()
    zip.file('project.json', JSON.stringify(projectJson))
    const reorderedBytes = await zip.generateAsync({ type: 'uint8array' })
    const reordered = await inspectSb3Bytes(reorderedBytes)
    const reorderedLabels = reordered.evidence
      .filter(({ target, opcode }) => target === '角色 1' && opcode === 'data_setvariableto')
      .map(({ label }) => label)
    expect(reorderedLabels.some((label) => label.includes('變數 V1'))).toBe(true)
    expect(reorderedLabels.some((label) => label.includes('變數 V2'))).toBe(true)
    const reorderedArchive = await importLosslessSb3(reorderedBytes)
    const reorderedConversion = projectJsonToCanonicalWithReport(reorderedArchive.projectJson, 'fixture')
    const reorderedGraphs = extractProjectBlockGraphs(reorderedArchive.projectJson)
    const reorderedAnalysis = analyzeCanonicalProject(reorderedConversion.canonical, reorderedGraphs)
    const reorderedMap = createProjectMap(
      reorderedConversion.canonical,
      reorderedAnalysis,
      reorderedGraphs,
      reorderedConversion.canonicalBlockMappings,
      reorderedArchive.projectJson,
    )
    const reorderedPrompt = createScoringFeedbackPrompt(
      createProjectScore(reorderedConversion.canonical, reorderedAnalysis, reorderedMap),
      reorderedMap,
    )
    expect(reorderedPrompt).toContain('變數 V1')
    expect(reorderedPrompt).toContain('變數 V2')
    const imported = await importLosslessSb3(scopedBytes)
    const conversion = projectJsonToCanonicalWithReport(imported.projectJson, 'fixture')
    const graphs = extractProjectBlockGraphs(imported.projectJson)
    const analysis = analyzeCanonicalProject(conversion.canonical, graphs)
    const map = createProjectMap(
      conversion.canonical,
      analysis,
      graphs,
      conversion.canonicalBlockMappings,
      imported.projectJson,
    )
    const prompt = createScoringFeedbackPrompt(createProjectScore(conversion.canonical, analysis, map), map)
    const packet = JSON.stringify(createEvidencePacket(analysis, map))
    for (const output of [prompt, packet]) {
      expect(output).toContain('變數 V1')
      expect(output).toContain('變數 V2')
      expect(output).not.toContain('secret-same-name')
    }
  })

  it('does not expose unknown opcode strings or raw block ids in any report', async () => {
    const project = structuredClone(example02) as CanonicalProject
    const archive = await compileCanonicalProjectToSb3(project)
    const zip = await JSZip.loadAsync(await archive.arrayBuffer())
    const entry = zip.file('project.json')
    if (!entry) throw new Error('fixture project.json missing')
    const json = JSON.parse(await entry.async('string')) as { targets: { blocks: Record<string, unknown> }[] }
    json.targets[1].blocks['student-secret-block-id'] = {
      opcode: 'studentsecret_opcode',
      next: null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 10,
      y: 10,
    }
    zip.file('project.json', JSON.stringify(json))
    const result = await inspectSb3Bytes(await zip.generateAsync({ type: 'uint8array' }))
    for (const output of [
      JSON.stringify(result),
      inspectionToMarkdown(result),
      inspectionToStudentMarkdown(result),
    ]) {
      expect(output).not.toContain('studentsecret')
      expect(output).not.toContain('student-secret-block-id')
    }
  })

  it('exposes locatable evidence for monitor and cloud warnings', async () => {
    const project = structuredClone(example02) as CanonicalProject
    const archive = await compileCanonicalProjectToSb3(project)
    const zip = await JSZip.loadAsync(await archive.arrayBuffer())
    const entry = zip.file('project.json')
    if (!entry) throw new Error('fixture project.json missing')
    const json = JSON.parse(await entry.async('string')) as {
      targets: { isStage: boolean; variables: Record<string, unknown>; costumes: { md5ext: string }[] }[]
      monitors: unknown[]
    }
    const stage = json.targets.find(({ isStage }) => isStage)
    if (!stage) throw new Error('fixture stage missing')
    stage.variables['private-variable-id'] = ['private-cloud-name', 0, true]
    json.monitors = [
      {
        id: 'private-monitor-id',
        opcode: 'data_variable',
        params: { VARIABLE: 'missing-private-variable' },
        spriteName: null,
        mode: 'default',
        value: 0,
        visible: true,
      },
    ]
    zip.file('project.json', JSON.stringify(json))
    const result = await inspectSb3Bytes(await zip.generateAsync({ type: 'uint8array' }))
    for (const [code, path] of [
      ['cloud-variable-offline', '/stage/variables/'],
      ['monitor-variable-missing', '/monitors/'],
    ]) {
      const diagnostic = result.diagnostics.find((entry) => entry.code === code)
      expect(diagnostic?.evidenceIds?.length ?? 0, code).toBeGreaterThan(0)
      for (const id of diagnostic?.evidenceIds ?? [])
        expect(result.evidence.find((item) => item.id === id)?.path.startsWith(path)).toBe(true)
    }
    for (const secret of [
      'private-variable-id',
      'private-cloud-name',
      'private-monitor-id',
      'missing-private-variable',
    ])
      expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('writes a short student report with a concrete location for a detached script', async () => {
    const project = structuredClone(example02) as CanonicalProject
    project.sprites[0]?.scripts[0]?.blocks.shift()
    const archive = await compileCanonicalProjectToSb3(project)
    const result = await inspectSb3Bytes(new Uint8Array(await archive.arrayBuffer()))
    const studentReport = inspectionToStudentMarkdown(result)

    expect(result.diagnostics.some(({ code }) => code === 'detached-script')).toBe(true)
    expect(studentReport).toContain('檢查這段程式怎麼開始')
    expect(studentReport).toContain('角色 A（Scratch 角色清單第 1 個）・第 1 段程式')
    expect(studentReport).toContain('移動 10 步')
    expect(studentReport).toContain('當綠旗被點擊')
    expect(studentReport).not.toContain('detached-script')
    expect(studentReport).not.toMatch(/[EF]\d+/)
  })
})
