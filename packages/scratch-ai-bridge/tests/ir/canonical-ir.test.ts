import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'

const examplesDirectory = fileURLToPath(new URL('../../src/core/ir/examples/', import.meta.url))

const loadExample = (name: string): unknown => JSON.parse(readFileSync(join(examplesDirectory, name), 'utf8'))

const getMinimalProject = (): Record<string, unknown> =>
  loadExample('01-minimal-project.json') as Record<string, unknown>

describe('Canonical IR schema', () => {
  it('accepts every checked-in example fixture', () => {
    const fixtureNames = readdirSync(examplesDirectory)
      .filter((name) => name.endsWith('.json'))
      .sort()

    expect(fixtureNames).toHaveLength(5)

    for (const fixtureName of fixtureNames) {
      expect(validateCanonicalProject(loadExample(fixtureName)), fixtureName).toMatchObject({
        valid: true,
      })
    }
  })

  it('rejects an unsupported opcode', () => {
    const project = getMinimalProject()
    const stage = project.stage as Record<string, unknown>
    stage.scripts = [{ blocks: [{ opcode: 'motion_teleport' }] }]

    const result = validateCanonicalProject(project)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((error) => error.keyword === 'enum')).toBe(true)
    }
  })

  it('rejects a project with a required field missing', () => {
    const project = getMinimalProject()
    delete project.stage

    const result = validateCanonicalProject(project)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(
        result.errors.some((error) => error.keyword === 'required' && error.params.missingProperty === 'stage'),
      ).toBe(true)
    }
  })

  it('rejects Scratch internal graph fields from canonical blocks', () => {
    const project = getMinimalProject()
    const stage = project.stage as Record<string, unknown>
    stage.scripts = [
      {
        blocks: [
          {
            opcode: 'event_whenflagclicked',
            id: 'scratch-internal-id',
            parent: null,
            next: null,
          },
        ],
      },
    ]

    const result = validateCanonicalProject(project)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true)
    }
  })
})
