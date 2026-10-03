import { describe, expect, it } from 'vitest'
import { buildScratchProjectJson } from '../../src/core/compiler/project-json'
import { projectJsonToCanonical } from '../../src/core/decompiler/project-json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
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

  it('restores platform menu shadows as AI-facing literal inputs', () => {
    const source = platformer as CanonicalProject
    const roundTrip = projectJsonToCanonical(buildScratchProjectJson(source), source.name)
    const player = roundTrip.sprites.find((sprite) => sprite.name === 'Player')
    expect(player).toBeDefined()
    if (!player) return

    const greenFlagScript = player.scripts.find((script) => script.blocks[0]?.opcode === 'event_whenflagclicked')
    const touching = greenFlagScript?.blocks[3]?.inputs?.SUBSTACK
    expect(touching?.type).toBe('stack')
    if (touching?.type !== 'stack') return
    const condition = touching.blocks[2]?.inputs?.CONDITION
    expect(condition?.type).toBe('block')
    if (condition?.type !== 'block') return
    expect(condition.block.inputs?.TOUCHINGOBJECTMENU).toEqual({ type: 'literal', value: 'Platform' })
  })
})
