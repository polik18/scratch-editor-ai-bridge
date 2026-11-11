import { describe, expect, it } from 'vitest'
import {
  createValueExplanationPrompt,
  isBridgeGame,
  isInternalTarget,
  resetNote,
  usageLines,
  valueItems,
} from '../../src/core/ai/value-guide'

const variable = (name: string, value: unknown) => [name, value]
const project = {
  targets: [
    {
      isStage: true,
      name: 'Stage',
      variables: { lives: variable('生命', 3), hurt: variable('_hurt', 0) },
      costumes: [{ name: 'sky' }],
      currentCostume: 0,
      volume: 100,
      tempo: 60,
      blocks: {
        flag: { opcode: 'event_whenflagclicked', next: 'set', parent: null, topLevel: true, inputs: {}, fields: {} },
        set: {
          opcode: 'data_setvariableto',
          next: null,
          parent: 'flag',
          inputs: { VALUE: [1, [10, '3']] },
          fields: { VARIABLE: ['生命', 'lives'] },
        },
      },
    },
    { isStage: false, name: '_Walls', variables: {}, costumes: [], blocks: {} },
    {
      isStage: false,
      name: '香魚',
      variables: { vx: variable('vx', 0) },
      costumes: [{ name: 'Fish' }, { name: 'fish-b' }],
      x: 0,
      y: 0,
      direction: 90,
      size: 20,
      visible: true,
      currentCostume: 0,
      volume: 100,
      blocks: {
        hit: {
          opcode: 'event_whenbroadcastreceived',
          next: 'lose',
          parent: null,
          topLevel: true,
          inputs: {},
          fields: {},
        },
        lose: {
          opcode: 'data_changevariableby',
          next: null,
          parent: 'hit',
          inputs: { VALUE: [1, [4, '-1']] },
          fields: { VARIABLE: ['生命', 'lives'] },
        },
      },
    },
  ],
}

describe('value guide for hand edits', () => {
  it('names values in Chinese and marks the program bookkeeping of a Bridge game', () => {
    expect(isBridgeGame(project)).toBe(true)
    expect(isInternalTarget('_Walls')).toBe(true)
    const stage = valueItems(project, 'Stage')
    expect(stage.map((item) => [item.label, item.internal])).toEqual([
      ['變數「生命」', false],
      ['變數「_hurt」', true],
      ['背景', false],
      ['音量（%）', false],
      ['節奏（每分鐘拍數）', false],
    ])
    const fish = valueItems(project, '香魚')
    expect(fish.find((item) => item.label === '變數「vx」')?.internal).toBe(true)
    expect(fish.find((item) => item.key === 'currentCostume')).toMatchObject({
      kind: 'costume',
      options: ['Fish', 'fish-b'],
    })
    expect(fish.find((item) => item.key === 'direction')?.hint).toContain('向右')
  })

  it('warns when the green flag sets the value again', () => {
    expect(resetNote(project, 'Stage', 'variable:lives')).toContain('設成 3')
    expect(resetNote(project, '香魚', 'size')).toBeUndefined()
  })

  it('gives the AI the script lines that use a value', () => {
    const lines = usageLines(project, 'Stage', 'variable:lives')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('香魚｜event_whenbroadcastreceived')
    const item = valueItems(project, 'Stage').at(0)
    if (!item) throw new Error('no item')
    expect(createValueExplanationPrompt(item, '舞台', lines, resetNote(project, 'Stage', item.key))).toContain(
      '最多兩句話',
    )
  })
})
