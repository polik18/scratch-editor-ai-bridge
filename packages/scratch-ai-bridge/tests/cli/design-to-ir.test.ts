import { describe, expect, it } from 'vitest'
import { designToCanonicalIR } from '../../src/cli/design-to-ir.js'

describe('designToCanonicalIR', () => {
  it('recursively converts nested stacks and keeps global data on the Stage', () => {
    const project = designToCanonicalIR({
      id: 'nested-game',
      title: 'Nested Game',
      type: 'arcade',
      sprites: 2,
      blocks: 8,
      difficulty: 'advanced',
      version: '1.0',
      created: '2026-10-30',
      designDoc: '',
      outputSb3: '',
      outputJson: '',
      spritesDef: [{ name: 'Hero' }, { name: 'Enemy' }],
      variables: [
        { name: 'score', value: 0 },
        { name: 'ammo', value: 5, sprite: 'Hero' },
      ],
      lists: [{ name: 'events', values: ['start'] }],
      scripts: [
        {
          target: 'Hero',
          blocks: [
            { opcode: 'event_whenflagclicked' },
            {
              opcode: 'control_forever',
              inputs: {
                SUBSTACK: [
                  { opcode: 'motion_changexby', inputs: { DX: 5 } },
                  {
                    opcode: 'control_if',
                    inputs: {
                      CONDITION: { type: 'block', block: { opcode: 'sensing_mousedown' } },
                      SUBSTACK: [{ opcode: 'looks_say', inputs: { MESSAGE: 'fire' } }],
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          target: 'Enemy',
          blocks: [
            { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'hit' } },
            {
              opcode: 'event_broadcast',
              inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'hit' } },
            },
          ],
        },
      ],
    })

    const forever = project.sprites[0]?.scripts[0]?.blocks[1]
    expect(forever?.inputs?.SUBSTACK).toEqual({
      type: 'stack',
      blocks: [
        { opcode: 'motion_changexby', inputs: { DX: { type: 'literal', value: 5 } } },
        {
          opcode: 'control_if',
          inputs: {
            CONDITION: { type: 'block', block: { opcode: 'sensing_mousedown' } },
            SUBSTACK: {
              type: 'stack',
              blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'fire' } } }],
            },
          },
        },
      ],
    })
    expect(project.stage.variables).toEqual([{ name: 'score', value: 0 }])
    expect(project.stage.lists).toEqual([{ name: 'events', value: ['start'] }])
    expect(project.sprites[0]?.variables).toEqual([{ name: 'ammo', value: 5 }])
    expect(project.broadcasts).toEqual([{ name: 'hit' }])
  })

  it('rejects undeclared targets and malformed input wrappers with a JSON path', () => {
    const base = {
      id: 'bad',
      title: 'Bad',
      type: 'game',
      sprites: 1,
      blocks: 1,
      difficulty: 'easy',
      version: '1',
      created: '2026-10-30',
      designDoc: '',
      outputSb3: '',
      outputJson: '',
      spritesDef: [{ name: 'Hero' }],
      variables: [],
      lists: [],
      scripts: [],
    }
    expect(() =>
      designToCanonicalIR({
        ...base,
        scripts: [{ target: 'Missing', blocks: [{ opcode: 'event_whenflagclicked' }] }],
      }),
    ).toThrow('/scripts/0/target references unknown sprite')
    expect(() =>
      designToCanonicalIR({
        ...base,
        scripts: [
          {
            target: 'Hero',
            blocks: [{ opcode: 'motion_movesteps', inputs: { STEPS: { type: 'reporter', id: 'x' } } }],
          },
        ],
      }),
    ).toThrow('/scripts/0/blocks/0/inputs/STEPS/type uses unsupported input type')
  })

  it('accepts a compact design with Stage logic, visual properties, cloud data, and inferred official extensions', () => {
    const project = designToCanonicalIR({
      title: 'Canvas Rhythm',
      stage: { name: 'Stage', costumes: ['Night', 'Dawn'], currentCostume: 1, tempo: 110 },
      spritesDef: [{ name: 'Painter', size: 75, rotationStyle: 'left-right', currentCostume: 0, volume: 60 }],
      variables: [{ name: 'best', value: 0, cloud: true }],
      scripts: [
        { target: 'Stage', blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'pen_clear' }] },
        {
          target: 'Painter',
          blocks: [
            { opcode: 'event_whenflagclicked' },
            { opcode: 'pen_penDown' },
            { opcode: 'pen_setPenColorToColor', inputs: { COLOR: '#ff00aa' } },
            { opcode: 'music_playNoteForBeats', inputs: { NOTE: 64, BEATS: 0.5 } },
          ],
        },
      ],
    })

    expect(project.stage.scripts).toHaveLength(1)
    expect(project.stage.costumes.map(({ name }) => name)).toEqual(['Night', 'Dawn'])
    expect(project.stage.currentCostume).toBe(1)
    expect(project.stage.variables).toEqual([{ name: 'best', value: 0, cloud: true }])
    expect(project.sprites[0]).toMatchObject({ size: 75, rotationStyle: 'left-right', volume: 60 })
    expect(project.extensions).toEqual(['music', 'pen'])
  })

  it('allows same-named data local to different sprite targets', () => {
    const project = designToCanonicalIR({
      title: 'Local State',
      spritesDef: [{ name: 'Player' }, { name: 'Enemy' }],
      variables: [
        { name: 'state', value: 'ready', sprite: 'Player' },
        { name: 'state', value: 'patrol', sprite: 'Enemy' },
      ],
      lists: [
        { name: 'items', values: ['key'], sprite: 'Player' },
        { name: 'items', values: ['coin'], sprite: 'Enemy' },
      ],
    })

    expect(project.sprites[0]?.variables).toEqual([{ name: 'state', value: 'ready' }])
    expect(project.sprites[1]?.variables).toEqual([{ name: 'state', value: 'patrol' }])
    expect(project.sprites[0]?.lists).toEqual([{ name: 'items', value: ['key'] }])
    expect(project.sprites[1]?.lists).toEqual([{ name: 'items', value: ['coin'] }])
  })
})
