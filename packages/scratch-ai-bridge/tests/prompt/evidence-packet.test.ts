import { describe, expect, it } from 'vitest'
import { analyzeCanonicalProject, createProjectMap } from '../../src/core/analyzer'
import platformerCore from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createAnalysisPrompt } from '../../src/core/prompt'
import { createEvidencePacket, EVIDENCE_PACKET_MAX_CHARS } from '../../src/core/prompt/evidence-packet'

describe('minimal evidence packet', () => {
  it('omits project names and asset bytes while retaining evidence IDs and limits', () => {
    const project = structuredClone(platformerCore as CanonicalProject)
    project.name = 'student-name-private-project'
    const analysis = analyzeCanonicalProject(project)
    const map = createProjectMap(project, analysis)
    const packet = createEvidencePacket(analysis, map, 'How does this game start?')
    const serialized = JSON.stringify(packet)

    expect(packet.format).toBe('scratch-ai-bridge/evidence-packet')
    expect(serialized).not.toContain('student-name-private-project')
    expect(serialized).not.toContain('<svg')
    expect(serialized).not.toContain('data:image')
    expect(serialized).toContain('evidenceIds')
    expect(serialized.length).toBeLessThanOrEqual(EVIDENCE_PACKET_MAX_CHARS)
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
