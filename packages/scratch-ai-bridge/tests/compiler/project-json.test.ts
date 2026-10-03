import { describe, expect, it } from 'vitest'
import { buildScratchProjectJson } from '../../src/core/compiler/project-json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import type { CanonicalProject } from '../../src/core/ir/types'

describe('Scratch project JSON compiler', () => {
  it('creates deterministic block graph, symbols and nested substacks', () => {
    const result = buildScratchProjectJson(example as CanonicalProject)
    const stage = result.targets[0]
    expect(stage.isStage).toBe(true)
    expect(Object.keys(stage.variables)).toHaveLength(1)

    const blocks = Object.values(stage.blocks)
    expect(blocks.some((block) => block.opcode === 'event_whenflagclicked')).toBe(true)
    expect(blocks.some((block) => block.opcode === 'control_repeat')).toBe(true)
    expect(blocks.some((block) => block.opcode === 'data_changevariableby')).toBe(true)
  })
})
