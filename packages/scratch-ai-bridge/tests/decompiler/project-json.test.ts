import { describe, expect, it } from 'vitest'
import { buildScratchProjectJson } from '../../src/core/compiler/project-json'
import { projectJsonToCanonical } from '../../src/core/decompiler/project-json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import type { CanonicalProject } from '../../src/core/ir/types'

describe('Scratch project JSON decompiler', () => {
  it('restores script order, variables and nested stack structure', () => {
    const source = example as CanonicalProject
    const scratch = buildScratchProjectJson(source)
    const roundTrip = projectJsonToCanonical(scratch, source.name)

    expect(roundTrip.stage.variables[0].name).toBe('score')
    expect(roundTrip.stage.scripts[0].blocks.map((block) => block.opcode)).toEqual([
      'event_whenflagclicked',
      'data_setvariableto',
      'control_repeat',
    ])
    const repeat = roundTrip.stage.scripts[0].blocks[2]
    const repeatInputs = repeat.inputs
    expect(repeatInputs).toBeDefined()
    if (!repeatInputs) throw new Error('repeat block inputs are missing')
    expect(repeatInputs.SUBSTACK.type).toBe('stack')
  })
})
