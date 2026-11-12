/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Fixture assertions deliberately cover optional reader sections. */
import { describe, expect, it } from 'vitest'
import { readProjectForAi } from '../../../src/core/reader'

const project = {
  projectName: '測試作品',
  targets: [
    {
      name: 'Stage',
      isStage: true,
      currentCostume: 0,
      costumes: [{ name: 'Blue Sky', md5ext: 'missing.svg', dataFormat: 'svg' }],
      variables: {},
      blocks: {},
    },
    {
      name: '藍色魚',
      isStage: false,
      x: -180,
      y: -100,
      size: 80,
      direction: 90,
      visible: true,
      currentCostume: 0,
      costumes: [{ name: 'costume1', md5ext: 'fish.png', dataFormat: 'png', width: 40, height: 30 }],
      variables: { scoreId: ['分數', 0] },
      comments: { comment: { text: '按空白鍵跳', x: 0, y: 0 } },
      blocks: {
        hat: {
          opcode: 'event_whenflagclicked',
          next: 'move',
          parent: null,
          inputs: {},
          fields: {},
          topLevel: true,
          shadow: false,
        },
        move: {
          opcode: 'motion_movesteps',
          next: 'set',
          parent: 'hat',
          inputs: { STEPS: [1, [4, '10']] },
          fields: {},
          shadow: false,
          topLevel: false,
        },
        set: {
          opcode: 'data_setvariableto',
          next: null,
          parent: 'move',
          inputs: { VALUE: [1, [4, '0']] },
          fields: { VARIABLE: ['分數', 'scoreId'] },
          shadow: false,
          topLevel: false,
        },
      },
    },
  ],
}

describe('readProjectForAi', () => {
  it('writes official block text, target visuals, comments, line map, and coverage', () => {
    const result = readProjectForAi(project)
    expect(result.text).toContain('當綠旗被點擊')
    expect(result.text).toContain('移動 10 點')
    expect(result.text).toContain('變數 分數 設為 0')
    expect(result.text).toContain('位置：x -180、y -100')
    expect(result.text).toContain('左下')
    expect(result.text).toContain('按空白鍵跳')
    expect(result.coverage).toEqual({ blocks: 3, readable: 3, opaque: 0 })
    expect(result.lineMap.get('L2')).toEqual({ targetIndex: 1, blockId: 'move' })
    expect(result.sections.map((section) => section.id)).toEqual([
      'overview',
      'sprite:Stage',
      'sprite:藍色魚',
      'script:hat',
    ])
  })

  it('marks an unknown extension as opaque and keeps the original opcode visible', () => {
    const unknown = structuredClone(project) as unknown as {
      readonly targets: { readonly blocks: Record<string, Record<string, unknown>> }[]
    }
    const target = unknown.targets[1]
    if (!target) throw new Error('test target missing')
    target.blocks.hat.next = 'unknown'
    target.blocks.unknown = {
      opcode: 'custom_unknown_block',
      next: null,
      parent: 'hat',
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
    }
    const result = readProjectForAi(unknown)
    expect(result.text).toContain('⟦未知：custom_unknown_block 積木，只能看⟧')
    expect(result.coverage).toEqual({ blocks: 4, readable: 3, opaque: 1 })
  })

  it('uses the bounded overview for a large project while retaining sections', () => {
    const result = readProjectForAi(project, {}, { maxChars: 120 })
    expect(result.text.length).toBeLessThanOrEqual(120)
    expect(result.sections.some((section) => section.id === 'sprite:藍色魚')).toBe(true)
  })
})
/* eslint-enable @typescript-eslint/no-unnecessary-condition */
