import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { decompileSb3WithBlockGraphs } from '../../src/core/decompiler'
import type { CanonicalProject } from '../../src/core/ir/types'
import { CANONICAL_JSON_MAX_DEPTH, CANONICAL_JSON_MAX_NODES } from '../../src/core/ir/types'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'
import initialV1Baseline from '../fixtures/canonical-ir-v1-baseline.json'

const examplesDirectory = fileURLToPath(new URL('../../src/core/ir/examples/', import.meta.url))

const loadExample = (name: string): unknown => JSON.parse(readFileSync(join(examplesDirectory, name), 'utf8'))

const getMinimalProject = (): Record<string, unknown> =>
  loadExample('01-minimal-project.json') as Record<string, unknown>

describe('Canonical IR schema', () => {
  it('accepts every checked-in example fixture', () => {
    const fixtureNames = readdirSync(examplesDirectory)
      .filter((name) => name.endsWith('.json'))
      .sort()

    expect(fixtureNames).toHaveLength(6)

    for (const fixtureName of fixtureNames) {
      expect(validateCanonicalProject(loadExample(fixtureName)), fixtureName).toMatchObject({
        valid: true,
      })
    }
  })

  it('round-trips the initial published Canonical IR v1 shape through the current Scratch adapters', async () => {
    const source = structuredClone(initialV1Baseline) as CanonicalProject
    expect(validateCanonicalProject(source)).toMatchObject({ valid: true })

    const sb3 = await compileCanonicalProjectToSb3(source)
    const restored = await decompileSb3WithBlockGraphs(sb3, source.name)
    const sourceOpcodes = source.sprites.flatMap((target) =>
      target.scripts.flatMap(({ blocks }) => blocks.map(({ opcode }) => opcode)),
    )
    const restoredOpcodes = restored.canonical.sprites.flatMap((target) =>
      target.scripts.flatMap(({ blocks }) => blocks.map(({ opcode }) => opcode)),
    )

    expect(restored.canonical.version).toBe(source.version)
    expect(restoredOpcodes).toEqual(sourceOpcodes)
  })

  it('accepts unknown opcode strings for graph-preserving workflows', () => {
    const project = getMinimalProject()
    const stage = project.stage as Record<string, unknown>
    stage.scripts = [{ blocks: [{ opcode: 'motion_teleport' }] }]

    const result = validateCanonicalProject(project)

    expect(result.valid).toBe(true)
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

  it('rejects metadata that exceeds the documented JSON depth bound', () => {
    const project = getMinimalProject()
    const meta: Record<string, unknown> = {}
    let current = meta
    for (let level = 0; level <= CANONICAL_JSON_MAX_DEPTH + 1; level += 1) {
      const nested: Record<string, unknown> = {}
      current.child = nested
      current = nested
    }
    project.meta = meta

    const result = validateCanonicalProject(project)
    expect(result).toMatchObject({ valid: false, errors: [{ keyword: 'maxDepth' }] })
  })

  it('rejects cyclic metadata before recursive schema validation', () => {
    const project = getMinimalProject()
    const meta: Record<string, unknown> = {}
    meta.self = meta
    project.meta = meta

    const result = validateCanonicalProject(project)
    expect(result).toMatchObject({ valid: false, errors: [{ keyword: 'acyclic' }] })
  })

  it('rejects metadata that exceeds the value-count bound before schema traversal', () => {
    const project = getMinimalProject()
    project.meta = { values: Array.from({ length: CANONICAL_JSON_MAX_NODES + 1 }, (_, index) => index) }

    const result = validateCanonicalProject(project)
    expect(result).toMatchObject({ valid: false, errors: [{ keyword: 'maxNodes' }] })
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
