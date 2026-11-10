import { describe, expect, it } from 'vitest'
import { createStudentProjectInstruction, estimatePromptSize } from '../../src/core/capabilities'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { buildScratchProjectArchive } from '../../src/core/compiler/project-json'
import example from '../../src/core/ir/examples/07-apple-catcher.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../src/core/validator'

const project = example as CanonicalProject

describe('complete authoring example', () => {
  it('uses official library names and compiles as a complete game', async () => {
    expect(validateCanonicalProject(project)).toMatchObject({ valid: true })
    expect(validateCanonicalSemantics(project)).toEqual([])
    expect(project.stage.costumes.map(({ name }) => name)).toContain('Forest')
    expect(project.sprites.flatMap((sprite) => sprite.costumes.map(({ name }) => name))).toEqual(
      expect.arrayContaining(['Cat-a', 'Cat-b', 'Apple']),
    )
    expect(project.sprites.flatMap((sprite) => sprite.sounds.map(({ name }) => name))).toEqual(
      expect.arrayContaining(['Pop', 'Chomp']),
    )

    const archive = await buildScratchProjectArchive(project)
    const sb3 = await compileCanonicalProjectToSb3(project)
    expect(archive.byteLength).toBeGreaterThan(0)
    expect(sb3.size).toBeGreaterThan(0)
  })

  it('keeps the student prompt compact and uses a feature list', () => {
    const prompt = createStudentProjectInstruction('做一個接蘋果遊戲')
    expect(estimatePromptSize(prompt).characters).toBeLessThan(6000)
    expect(prompt).toContain('Apple Catcher')
    expect(prompt).toContain('features')
    expect(prompt).not.toContain('evidencePointers')
  })
})
