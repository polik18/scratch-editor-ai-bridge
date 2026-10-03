import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { compareProjectJson } from '../../src/core/compatibility/project-signature'
import { getProjectJson, loadSb3, saveSb3 } from '../../src/scratch/vm'
import { OFFICIAL_FIXTURE_MATRIX } from './fixture-matrix'

const vmFixtures = OFFICIAL_FIXTURE_MATRIX.filter(
  (fixture) => fixture.format === 'sb3' && fixture.expectation === 'vm-normalized',
)

describe('official Scratch compatibility fixture matrix', () => {
  it('contains a reviewed representative baseline of at least 30 fixtures', async () => {
    expect(OFFICIAL_FIXTURE_MATRIX.length).toBeGreaterThanOrEqual(30)
    expect(new Set(OFFICIAL_FIXTURE_MATRIX.map((fixture) => fixture.name)).size).toBe(OFFICIAL_FIXTURE_MATRIX.length)

    await Promise.all(OFFICIAL_FIXTURE_MATRIX.map((fixture) => access(fixture.path)))
  })

  it('classifies each fixture with an explicit expectation and category', () => {
    expect(OFFICIAL_FIXTURE_MATRIX.every((fixture) => fixture.category && fixture.notes)).toBe(true)
    expect(new Set(OFFICIAL_FIXTURE_MATRIX.map((fixture) => fixture.expectation))).toEqual(
      new Set(['parse-only', 'lossless', 'vm-normalized']),
    )
  })

  it('round-trips the VM-normalized baseline through the official serializer', async () => {
    for (const fixture of vmFixtures) {
      const source = await readFile(fixture.path)
      const firstVm = await loadSb3(source)

      try {
        const firstProject = getProjectJson(firstVm)
        const archive = await saveSb3(firstVm)
        const secondVm = await loadSb3(await archive.arrayBuffer())

        try {
          const comparison = compareProjectJson(firstProject, getProjectJson(secondVm))
          // VM-normalized fixtures are allowed to differ in representation. The
          // important Phase 0 contract is that the official serializer can
          // reload the result and that the difference is observable to a later
          // normalization report instead of being silently hidden.
          expect(typeof comparison.equal).toBe('boolean')
          expect(comparison.left).toBeDefined()
          expect(comparison.right).toBeDefined()
        } finally {
          secondVm.quit()
        }
      } finally {
        firstVm.quit()
      }
    }
  })
})
