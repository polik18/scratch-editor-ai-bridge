import { describe, expect, it } from 'vitest'
import { buildScratchProjectJson } from '../../src/core/compiler/project-json'
import { projectJsonToCanonical } from '../../src/core/decompiler/project-json'
import example from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'

const structuralSignature = (project: CanonicalProject) => ({
  stageScripts: project.stage.scripts.map((script) => script.blocks.map((block) => block.opcode)),
  sprites: project.sprites.map((sprite) => ({
    name: sprite.name,
    scripts: sprite.scripts.map((script) => script.blocks.map((block) => block.opcode)),
    variables: sprite.variables.map((variable) => variable.name),
    lists: sprite.lists.map((list) => list.name),
  })),
  broadcasts: project.broadcasts.map((broadcast) => broadcast.name),
})

describe('Canonical IR project-json round trip', () => {
  it('preserves the supported structural signature', () => {
    const source = example as CanonicalProject
    const decoded = projectJsonToCanonical(buildScratchProjectJson(source), source.name)
    expect(structuralSignature(decoded)).toEqual(structuralSignature(source))
  })
})
