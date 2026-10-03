import { describe, expect, it } from 'vitest'
import { buildScratchProjectJson } from '../../src/core/compiler/project-json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
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

  it('creates official menu shadows for platformer collision and costume blocks', () => {
    const result = buildScratchProjectJson(platformer as CanonicalProject)
    const player = result.targets.find((target) => target.name === 'Player')
    expect(player).toBeDefined()
    if (!player) return

    const blocks = Object.values(player.blocks)
    const keyHat = blocks.find((block) => block.opcode === 'event_whenkeypressed')
    expect(keyHat?.fields.KEY_OPTION).toEqual(['right arrow'])

    const touching = blocks.find((block) => block.opcode === 'sensing_touchingobject')
    const touchingInput = touching?.inputs.TOUCHINGOBJECTMENU
    expect(touchingInput?.[0]).toBe(1)
    const touchingShadowId = touchingInput?.[1]
    expect(typeof touchingShadowId).toBe('string')
    if (typeof touchingShadowId !== 'string') return
    expect(player.blocks[touchingShadowId]).toMatchObject({
      opcode: 'sensing_touchingobjectmenu',
      fields: { TOUCHINGOBJECTMENU: ['Platform'] },
      shadow: true,
      topLevel: false,
    })

    const costume = blocks.find((block) => block.opcode === 'looks_switchcostumeto')
    const costumeShadowId = costume?.inputs.COSTUME[1]
    expect(typeof costumeShadowId).toBe('string')
    if (typeof costumeShadowId !== 'string') return
    expect(player.blocks[costumeShadowId]).toMatchObject({
      opcode: 'looks_costume',
      fields: { COSTUME: ['player'] },
      shadow: true,
    })
  })
})
