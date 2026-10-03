import { describe, expect, it } from 'vitest'
import {
  CANONICAL_BLOCK_CAPABILITIES,
  CANONICAL_OPCODES,
  createAuthoringInstruction,
  createStudentProjectInstruction,
} from '../../src/core/capabilities'
import schema from '../../src/core/ir/schema.json'

describe('Canonical block capability registry', () => {
  it('is the runtime source of truth for schema and AI authoring instructions', () => {
    const schemaOpcodes = schema.definitions.block.properties.opcode.enum
    expect(schemaOpcodes).toEqual(CANONICAL_OPCODES)

    const instruction = createAuthoringInstruction()
    for (const opcode of CANONICAL_OPCODES) expect(instruction).toContain(opcode)
    expect(instruction).toContain('不要執行 Python')
    expect(instruction).toContain('{"KEY_OPTION":"right arrow"}')
    expect(instruction).toContain('每個 costume 至少要有 name 與 dataFormat')
    expect(instruction).toContain('platform-hero')
    expect(instruction).toContain('platform-day')
    expect(instruction).toContain('Bridge 會安全加入圖像')
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

  it('combines a student idea with the complete authoring contract', () => {
    const instruction = createStudentProjectInstruction('  做一個可以收集金幣的平台遊戲  ')

    expect(instruction).toContain('作品需求：\n做一個可以收集金幣的平台遊戲')
    expect(instruction).toContain('只輸出一個最終 JSON 根物件')
    expect(instruction).toContain('event_whenkeypressed')
    expect(instruction).not.toContain('  做一個')
  })
})
