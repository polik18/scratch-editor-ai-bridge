import { describe, expect, it } from 'vitest'
import {
  CANONICAL_BLOCK_CAPABILITIES,
  CANONICAL_OPCODES,
  createAuthoringInstruction,
} from '../../src/core/capabilities'
import schema from '../../src/core/ir/schema.json'

describe('Canonical block capability registry', () => {
  it('is the runtime source of truth for schema and AI authoring instructions', () => {
    const schemaOpcodes = schema.definitions.block.properties.opcode.enum
    expect(schemaOpcodes).toEqual(CANONICAL_OPCODES)

    const instruction = createAuthoringInstruction()
    for (const opcode of CANONICAL_OPCODES) expect(instruction).toContain(opcode)
  })

  it('describes the platform-game authoring slice', () => {
    expect(CANONICAL_BLOCK_CAPABILITIES.event_whenkeypressed.fields.KEY_OPTION.required).toBe(true)
    expect(CANONICAL_BLOCK_CAPABILITIES.motion_gotoxy.inputs).toMatchObject({
      X: { kind: 'number', required: true },
      Y: { kind: 'number', required: true },
    })
    expect(CANONICAL_BLOCK_CAPABILITIES.sensing_touchingobject.inputs.TOUCHINGOBJECTMENU).toMatchObject({
      kind: 'menu',
      required: true,
      shadow: { opcode: 'sensing_touchingobjectmenu', field: 'TOUCHINGOBJECTMENU' },
    })
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_and.shape).toBe('boolean')
    expect(CANONICAL_BLOCK_CAPABILITIES.looks_switchcostumeto.inputs.COSTUME.shadow).toEqual({
      opcode: 'looks_costume',
      field: 'COSTUME',
    })
  })
})
