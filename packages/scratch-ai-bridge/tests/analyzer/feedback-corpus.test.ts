import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeCanonicalProject } from '../../src/core/analyzer'
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
})
