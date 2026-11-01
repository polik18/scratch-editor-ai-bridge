import { describe, expect, it } from 'vitest'
import { analyzeCanonicalProject, createProjectMap, createProjectScore } from '../../src/core/analyzer'
import platformerCore from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createAnalysisPrompt } from '../../src/core/prompt'
import { createEvidencePacket, EVIDENCE_PACKET_MAX_CHARS } from '../../src/core/prompt/evidence-packet'
import { createScoringFeedbackPrompt } from '../../src/core/prompt/scoring-feedback'
import { hideTargetNames, restoreTargetNames } from '../../src/core/prompt/target-placeholders'

describe('minimal evidence packet', () => {
  it('omits project names, asset bytes, and internal evidence IDs while retaining locations and limits', () => {
    const project = structuredClone(platformerCore as CanonicalProject)
    project.name = 'student-name-private-project'
    project.stage.name = 'student-private-stage'
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const packet = createEvidencePacket(analysis, map, 'How does this game start?')
    const serialized = JSON.stringify(packet)

    expect(packet.format).toBe('scratch-ai-bridge/evidence-packet')
    expect(serialized).not.toContain('student-name-private-project')
    expect(serialized).not.toContain('student-private-stage')
    expect(serialized).not.toContain('<svg')
    expect(serialized).not.toContain('data:image')
    expect(serialized).not.toContain('evidenceIds')
    expect(serialized).not.toMatch(/"[FE]\d+"/)
    expect(packet.observations.every((observation) => !('id' in observation))).toBe(true)
    expect(packet.evidence.every((item) => !('id' in item))).toBe(true)
    expect(serialized).toContain('角色 A')
    expect(serialized.length).toBeLessThanOrEqual(EVIDENCE_PACKET_MAX_CHARS)
  })

  it('preserves anonymized target labels in the scoring prompt', () => {
    const project = structuredClone(platformerCore as CanonicalProject)
    project.sprites[0].name = 'private-target-name'
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const prompt = createScoringFeedbackPrompt(createProjectScore(project, analysis, map), map)
    expect(prompt).toContain('角色「角色 1」')
    expect(prompt).not.toContain('private-target-name')
    expect(prompt).not.toContain('角色「作品文字已省略」')
  })

  it('removes free text from numeric slots and reports stable anonymous symbols', () => {
    const project = structuredClone(platformerCore as CanonicalProject)
    project.stage.variables = [{ name: 'secret-variable', value: 0 }]
    project.broadcasts = [{ name: 'secret-message' }]
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'secret-variable' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
          { opcode: 'event_broadcast', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'secret-message' } } },
          { opcode: 'motion_setx', inputs: { X: { type: 'variable', name: 'secret-variable' } } },
          { opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal', value: 'secret-free-text' } } },
        ],
      },
    ]
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const packet = JSON.stringify(createEvidencePacket(analysis, map))
    const prompt = createScoringFeedbackPrompt(createProjectScore(project, analysis, map), map)
    for (const output of [packet, prompt]) {
      for (const secret of ['secret-variable', 'secret-message', 'secret-free-text'])
        expect(output).not.toContain(secret)
      expect(output).toContain('變數 V1')
      expect(output).toContain('由變數提供（變數 V1）')
      expect(output).toContain('訊息 M1')
    }
  })

  it('does not corrupt placeholders when target names overlap or occur inside placeholder text', () => {
    const hidden = hideTargetNames(
      '角色「Sprite1」與角色「Sprite10」和「1」',
      new Map([
        ['Sprite1', '角色 1'],
        ['Sprite10', '角色 10'],
        ['1', '角色 2'],
        ['TARGET', '角色 3'],
      ]),
    )
    expect(restoreTargetNames(hidden.text, hidden.placeholders)).toBe('角色「角色 1」與角色「角色 10」和「角色 2」')
  })

  it('keeps diverse observations for a large project within the packet budget', () => {
    const project = structuredClone(platformerCore as CanonicalProject)
    const template = project.sprites[0]
    project.sprites = Array.from({ length: 30 }, (_, index) => ({
      ...structuredClone(template),
      name: `private sprite ${index}`,
      scripts: Array.from({ length: 8 }, () => structuredClone(template.scripts[0])),
    }))
    const analysis = analyzeCanonicalProject(project)
    const packet = createEvidencePacket(analysis, createProjectMap(project, analysis))
    expect(packet.observations.length).toBeGreaterThanOrEqual(30)
    expect(new Set(packet.evidence.map(({ target }) => target)).size).toBeGreaterThan(10)
    expect(packet.coverage.scripts.length).toBeLessThanOrEqual(12)
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(EVIDENCE_PACKET_MAX_CHARS)
    expect(JSON.stringify(packet)).not.toContain('private sprite')
  })

  it('asks the external model to cite evidence and does not serialize full Canonical IR', () => {
    const project = platformerCore as CanonicalProject
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const prompt = createAnalysisPrompt({ analysis, canonical: project, projectMap: map })

    expect(prompt).toContain('Evidence packet')
    expect(prompt).toContain('evidence ID')
    expect(prompt).not.toContain('Canonical IR:\n')
    expect(prompt).not.toContain('data:image')
    expect(prompt).not.toContain('<svg')
  })

  it('does not export student-controlled unknown opcodes in scoring evidence', () => {
    const project = structuredClone(platformerCore as CanonicalProject)
    const rawGraphs = [
      {
        targetIndex: 0,
        targetName: project.stage.name,
        isStage: true,
        blocks: { 'private-id': { opcode: 'student_private_opcode' } },
        issues: [],
      },
    ]
    const analysis = analyzeCanonicalProject(project, rawGraphs)
    const map = createProjectMap(project, analysis, rawGraphs)
    const unknown = map.evidence.find(({ opcode }) => opcode === 'student_private_opcode')
    const score = createProjectScore(project, analysis, map)
    const withUnknown = { ...score, criteria: [{ ...score.criteria[0], evidenceIds: [unknown?.id ?? 'missing'] }] }
    expect(createScoringFeedbackPrompt(withUnknown, map)).not.toContain('student_private_opcode')
  })

  it('requires specific student directions while forbidding guesses and technical evidence IDs', () => {
    const project = platformerCore as CanonicalProject
    const analysis = analyzeCanonicalProject(project)
    const prompt = createAnalysisPrompt({ analysis, canonical: project, question: '主角為什麼一開始就在右邊？' })

    expect(prompt).toContain('積木上看得到的文字或數字')
    expect(prompt).toContain('說明要觀察什麼結果')
    expect(prompt).toContain('不可猜測根本原因、數字')
    expect(prompt).toContain('未知或擴充積木要合併成一句白話限制')
    expect(prompt).toContain('也不要提「證據編號」')
  })

  it('does not export raw Scratch block IDs, opcode names, or JSON paths', () => {
    const project = platformerCore as CanonicalProject
    const analysis = analyzeCanonicalProject(project)
    const rawGraphs = [
      {
        targetIndex: 0,
        targetName: project.stage.name,
        isStage: true,
        blocks: { 'student-name-private-block-id': { opcode: 'thirdparty_sensor_read' } },
        issues: [],
      },
    ]
    const map = createProjectMap(project, analysis, rawGraphs)
    const serialized = JSON.stringify(createEvidencePacket(analysis, map))

    expect(serialized).not.toContain('student-name-private-block-id')
    expect(serialized).not.toContain('thirdparty_sensor_read')
    expect(serialized).not.toContain('/targets/')
    expect(serialized).toContain('目前無法讀懂')
  })
})
