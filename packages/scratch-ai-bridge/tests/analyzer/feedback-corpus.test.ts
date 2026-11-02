import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeCanonicalProject, createProjectFeedback, createProjectMap } from '../../src/core/analyzer'
import type { ScratchTargetBlockGraph } from '../../src/core/graph'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'

const catalogPath = fileURLToPath(new URL('../fixtures/feedback-corpus/cases.json', import.meta.url))

describe('feedback corpus governance', () => {
  it('contains at least twenty synthetic scenarios and does not imply human approval', () => {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      format: string
      version: number
      privacy: string
      cases: { id: string; category: string; source: string; review: string }[]
    }

    expect(catalog).toMatchObject({ format: 'scratch-ai-bridge/feedback-corpus', version: 1 })
    expect(catalog.privacy).toContain('synthetic-only')
    expect(catalog.cases.length).toBeGreaterThanOrEqual(20)
    expect(new Set(catalog.cases.map(({ id }) => id)).size).toBe(catalog.cases.length)
    expect(catalog.cases.every(({ source, review }) => source === 'generated' && review === 'pending')).toBe(true)
  })

  it('ships valid executable Canonical IR projects for every scenario', () => {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      cases: { id: string; projectFile: string; rawGraphFile?: string }[]
    }

    for (const entry of catalog.cases) {
      const projectPath = fileURLToPath(new URL(`../fixtures/feedback-corpus/${entry.projectFile}`, import.meta.url))
      const project = JSON.parse(readFileSync(projectPath, 'utf8')) as unknown
      const validation = validateCanonicalProject(project)
      expect(validation, `${entry.id} should satisfy Canonical IR`).toMatchObject({ valid: true })
      if (validation.valid) expect(analyzeCanonicalProject(validation.data).diagnostics).toBeDefined()

      if (entry.rawGraphFile) {
        const graphPath = fileURLToPath(new URL(`../fixtures/feedback-corpus/${entry.rawGraphFile}`, import.meta.url))
        const graphs = JSON.parse(readFileSync(graphPath, 'utf8')) as unknown[]
        expect(graphs.length, `${entry.id} raw graph fixture`).toBeGreaterThan(0)
      }
    }
  })

  it('produces traceable evidence, consolidates repeated detached-script warnings per target, and separates confirmed facts from inferences and limitations', () => {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      cases: {
        id: string
        category: string
        projectFile: string
        rawGraphFile?: string
        expected: string[]
        'must-not-claim': string[]
      }[]
    }

    let totalFeedbackItems = 0
    let verifiedCount = 0
    let falsePositiveCount = 0
    let unknownOrLimitationCount = 0

    for (const entry of catalog.cases) {
      const projectPath = fileURLToPath(new URL(`../fixtures/feedback-corpus/${entry.projectFile}`, import.meta.url))
      const project = validateCanonicalProject(JSON.parse(readFileSync(projectPath, 'utf8')) as unknown)
      expect(project.valid).toBe(true)
      if (!project.valid) continue
      const graphs = entry.rawGraphFile
        ? (JSON.parse(
            readFileSync(fileURLToPath(new URL(`../fixtures/feedback-corpus/${entry.rawGraphFile}`, import.meta.url)), 'utf8'),
          ) as ScratchTargetBlockGraph[])
        : undefined
      const analysis = analyzeCanonicalProject(project.data, graphs)
      const map = createProjectMap(project.data, analysis, graphs)
      const feedback = createProjectFeedback(analysis, map)
      const evidenceIds = new Set(map.evidence.map(({ id }) => id))

      for (const item of feedback.items) {
        totalFeedbackItems += 1
        expect(item.evidenceIds.length, `${entry.id}:${item.id}`).toBeGreaterThan(0)
        expect(item.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true)
        if (item.kind === 'unsupported-feature') {
          unknownOrLimitationCount += 1
        } else {
          verifiedCount += 1
        }
      }

      if (entry.id === 'synthetic-forever-state-update') {
        const reinitWarnings = feedback.items.filter(
          (item) => item.id.includes('forever-reinitialize') && item.severity === 'warning',
        )
        if (reinitWarnings.length > 0) falsePositiveCount += reinitWarnings.length
      }
      if (entry.id === 'synthetic-custom-procedure') {
        const procWarnings = feedback.items.filter(
          (item) => item.id.includes('procedure') && item.severity === 'warning',
        )
        if (procWarnings.length > 0) falsePositiveCount += procWarnings.length
      }
    }

    expect(totalFeedbackItems).toBeGreaterThanOrEqual(20)
    expect(verifiedCount).toBeGreaterThan(0)
    expect(unknownOrLimitationCount).toBeGreaterThan(0)
    expect(falsePositiveCount).toBe(0)

    const basePath = fileURLToPath(
      new URL('../fixtures/feedback-corpus/projects/synthetic-motion-green-flag.json', import.meta.url),
    )
    const validated = validateCanonicalProject(JSON.parse(readFileSync(basePath, 'utf8')) as unknown)
    expect(validated.valid).toBe(true)
    if (!validated.valid) return
    const draftProject = structuredClone(validated.data)
    draftProject.sprites[0].scripts.push(
      { blocks: [{ opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal', value: 5 } } }] },
      { blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'draft 2' } } }] },
    )
    const draftAnalysis = analyzeCanonicalProject(draftProject)
    const draftMap = createProjectMap(draftProject, draftAnalysis)
    const draftFeedback = createProjectFeedback(draftAnalysis, draftMap)
    const detachedItems = draftFeedback.items.filter((item) => item.id.includes('detached-script'))
    expect(draftAnalysis.diagnostics.filter((d) => d.code === 'detached-script')).toHaveLength(2)
    expect(detachedItems).toHaveLength(1)
    expect(detachedItems[0]?.message).toContain('同一角色共有 2 段')
    expect(detachedItems[0]?.message).toContain('草稿')
    expect(detachedItems[0]?.evidenceIds).toHaveLength(2)
  })
})
