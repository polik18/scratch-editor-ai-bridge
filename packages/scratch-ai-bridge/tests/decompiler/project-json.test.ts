import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProject, compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import { buildScratchProjectJson } from '../../src/core/compiler/project-json'
import { decompileSb3WithBlockGraphs } from '../../src/core/decompiler/decompiler'
import {
  MAX_SCRATCH_BLOCKS,
  MAX_SCRATCH_BLOCK_DEPTH,
  projectJsonToCanonical,
  projectJsonToCanonicalWithReport,
} from '../../src/core/decompiler/project-json'
import { validateScratchBlockGraph } from '../../src/core/graph'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalBlock, CanonicalProject } from '../../src/core/ir/types'
import {
  createVM,
  getVariable,
  loadProjectJson,
  loadSb3,
  runForTicks,
  type ScratchProjectJson,
} from '../../src/scratch'

const collectNestedBlocks = (blocks: readonly CanonicalBlock[]): CanonicalBlock[] =>
  blocks.flatMap((block) => [
    block,
    ...Object.values(block.inputs ?? {}).flatMap((input) =>
      input.type === 'block'
        ? collectNestedBlocks([input.block])
        : input.type === 'stack'
          ? collectNestedBlocks(input.blocks)
          : [],
    ),
  ])

describe('Scratch project JSON decompiler', () => {
  it('executes nested if/else and repeat stacks inside a procedure after SB3 reload', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [
      { name: 'branch result', value: '' },
      { name: 'repeat count', value: 0 },
    ]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'record branch' },
            inputs: { enabled: { type: 'literal', value: true } },
          },
          {
            opcode: 'procedures_call',
            procedure: { name: 'record branch' },
            inputs: { enabled: { type: 'literal', value: false } },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'record branch',
        parameters: [{ name: 'enabled', kind: 'boolean', default: false }],
        warp: false,
        body: [
          {
            opcode: 'control_if_else',
            inputs: {
              CONDITION: {
                type: 'block',
                block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'branch result' },
                    inputs: { VALUE: { type: 'literal', value: 'enabled' } },
                  },
                ],
              },
              SUBSTACK2: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'branch result' },
                    inputs: { VALUE: { type: 'literal', value: 'disabled' } },
                  },
                ],
              },
            },
          },
          {
            opcode: 'control_repeat',
            inputs: {
              TIMES: { type: 'literal', value: 3 },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'repeat count' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const sourceArchive = await compileCanonicalProjectToSb3(source)
    const imported = await decompileSb3WithBlockGraphs(sourceArchive, source.name)
    expect(imported.rawBlockGraphs.flatMap(({ issues }) => issues)).toEqual([])
    expect(imported.canonical.stage.procedures).toEqual(source.stage.procedures)

    const compiled = await compileCanonicalProject(imported.canonical)
    try {
      runForTicks(compiled.vm, 100)
      expect(getVariable(compiled.vm, 'Stage', 'branch result')?.value).toBe('disabled')
      expect(getVariable(compiled.vm, 'Stage', 'repeat count')?.value).toBe(6)
    } finally {
      compiled.vm.quit()
    }

    const reloaded = await loadSb3(await compileCanonicalProjectToSb3(imported.canonical))
    try {
      runForTicks(reloaded, 100)
      expect(getVariable(reloaded, 'Stage', 'branch result')?.value).toBe('disabled')
      expect(getVariable(reloaded, 'Stage', 'repeat count')?.value).toBe(6)
    } finally {
      reloaded.quit()
    }
  })

  it('decompiles valid blocks when legacy array metadata appears in the block map', () => {
    const scratchProject = buildScratchProjectJson(structuredClone(example) as CanonicalProject)
    const rawBlocks = scratchProject.targets[0].blocks as unknown as Record<string, unknown>
    rawBlocks.legacyProcedureMetadata = [13, 'legacy procedure', 'prototype-id', 2562, 85]

    const imported = projectJsonToCanonicalWithReport(scratchProject)
    expect(imported.canonical.stage.scripts.map(({ blocks }) => blocks)).toEqual(
      (example as CanonicalProject).stage.scripts.map(({ blocks }) => blocks),
    )
  })

  it('assigns a compilable fallback name to a Scratch costume with a blank name', () => {
    const scratchProject = buildScratchProjectJson(structuredClone(example) as CanonicalProject)
    scratchProject.targets[0].costumes[0].name = ''

    const imported = projectJsonToCanonicalWithReport(scratchProject)
    expect(imported.canonical.stage.costumes[0].name).toBe('Costume 1')
  })

  it('keeps same-named procedures target-local through SB3 compile and reload', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [{ name: 'result', value: '' }]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'record target' },
            inputs: { enabled: { type: 'literal', value: true } },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'record target',
        parameters: [{ name: 'enabled', kind: 'boolean', default: false }],
        warp: false,
        body: [
          {
            opcode: 'control_if_else',
            inputs: {
              CONDITION: {
                type: 'block',
                block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'result' },
                    inputs: { VALUE: { type: 'literal', value: 'Stage procedure' } },
                  },
                ],
              },
              SUBSTACK2: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'result' },
                    inputs: { VALUE: { type: 'literal', value: 'wrong Stage branch' } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]
    source.sprites = [
      {
        kind: 'sprite',
        name: 'SpriteTarget',
        x: 0,
        y: 0,
        direction: 90,
        size: 100,
        visible: true,
        draggable: false,
        rotationStyle: 'all around',
        variables: [{ name: 'result', value: '' }],
        lists: [],
        costumes: [],
        sounds: [],
        scripts: [
          {
            blocks: [
              { opcode: 'event_whenflagclicked' },
              {
                opcode: 'procedures_call',
                procedure: { name: 'record target' },
                inputs: { message: { type: 'literal', value: 'Sprite procedure' } },
              },
            ],
          },
        ],
        procedures: [
          {
            name: 'record target',
            parameters: [{ name: 'message', kind: 'string-number', default: '' }],
            warp: false,
            body: [
              {
                opcode: 'data_setvariableto',
                fields: { VARIABLE: 'result' },
                inputs: {
                  VALUE: {
                    type: 'block',
                    block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'message' } },
                  },
                },
              },
            ],
          },
        ],
      },
    ]

    const sourceArchive = await compileCanonicalProjectToSb3(source)
    const imported = await decompileSb3WithBlockGraphs(sourceArchive, source.name)
    expect(imported.rawBlockGraphs.flatMap(({ issues }) => issues)).toEqual([])
    expect(imported.canonical.stage.procedures.map(({ name }) => name)).toEqual(['record target'])
    expect(imported.canonical.sprites[0]?.procedures.map(({ name }) => name)).toEqual(['record target'])

    const compiled = await compileCanonicalProject(imported.canonical)
    try {
      runForTicks(compiled.vm, 100)
      expect(getVariable(compiled.vm, 'Stage', 'result')?.value).toBe('Stage procedure')
      expect(getVariable(compiled.vm, 'SpriteTarget', 'result')?.value).toBe('Sprite procedure')
    } finally {
      compiled.vm.quit()
    }

    const reloaded = await loadSb3(await compileCanonicalProjectToSb3(imported.canonical))
    try {
      runForTicks(reloaded, 100)
      expect(getVariable(reloaded, 'Stage', 'result')?.value).toBe('Stage procedure')
      expect(getVariable(reloaded, 'SpriteTarget', 'result')?.value).toBe('Sprite procedure')
    } finally {
      reloaded.quit()
    }
  })

  it('preserves nested JSON metadata values during import', () => {
    const scratch = buildScratchProjectJson(example as CanonicalProject)
    scratch.meta = JSON.parse(
      '{"semver":"3.0.0","nested":{"enabled":true,"labels":["one",null,{"key":4}]},"__proto__":{"safe":true}}',
    ) as typeof scratch.meta

    const canonical = projectJsonToCanonical(scratch, 'metadata')
    expect(canonical.meta?.semver).toBe('3.0.0')
    expect(canonical.meta?.nested).toEqual({ enabled: true, labels: ['one', null, { key: 4 }] })
    expect(Object.hasOwn(canonical.meta ?? {}, '__proto__')).toBe(true)
    expect(canonical.meta?.__proto__).toEqual({ safe: true })
  })

  it('fails explicitly when imported metadata exceeds the safe nesting limit', () => {
    const scratch = buildScratchProjectJson(example as CanonicalProject)
    const meta: Record<string, unknown> = {}
    let current = meta
    for (let level = 0; level < 140; level += 1) {
      const nested: Record<string, unknown> = {}
      current.child = nested
      current = nested
    }
    scratch.meta = meta as typeof scratch.meta

    expect(() => projectJsonToCanonical(scratch, 'deep-metadata')).toThrow(
      'metadata exceeds the Canonical JSON depth',
    )
  })

  it('rejects imported block graphs beyond the safe nesting limit', () => {
    const scratch = buildScratchProjectJson(example as CanonicalProject)
    const stage = scratch.targets.find((target) => target.isStage)
    if (!stage) throw new Error('fixture has no stage')
    const blocks: Record<string, unknown> = {}
    const depth = MAX_SCRATCH_BLOCK_DEPTH + 1
    for (let index = 0; index < depth; index += 1) {
      const id = `nested-${index}`
      const nextId = index + 1 < depth ? `nested-${index + 1}` : null
      blocks[id] = {
        opcode: 'control_if',
        next: null,
        parent: index > 0 ? `nested-${index - 1}` : null,
        inputs: nextId ? { SUBSTACK: [2, nextId] } : {},
        fields: {},
      }
    }
    stage.blocks = blocks as typeof stage.blocks

    expect(() => projectJsonToCanonicalWithReport(scratch, 'deep-block-graph')).toThrow(
      `block nesting exceeds the ${MAX_SCRATCH_BLOCK_DEPTH}-level limit`,
    )
  })

  it('rejects targets exceeding the raw Scratch block count limit', () => {
    const blocks = Object.fromEntries(Array.from({ length: MAX_SCRATCH_BLOCKS + 1 }, (_, index) => [`b${index}`, {}]))
    expect(() => projectJsonToCanonicalWithReport({ targets: [{ isStage: true, name: 'Stage', blocks }] })).toThrow(
      `exceeds the ${MAX_SCRATCH_BLOCKS.toLocaleString()} block limit`,
    )
  })

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

  it('compiles and decompiles procedure definitions with typed parameter metadata', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.procedures = [
      {
        name: 'announce',
        parameters: [
          { name: 'message', kind: 'string-number', default: 'hello' },
          { name: 'enabled', kind: 'boolean', default: false },
          { name: 'count', kind: 'number', default: 3 },
        ],
        warp: true,
        body: [
          {
            opcode: 'looks_say',
            inputs: {
              MESSAGE: {
                type: 'block',
                block: {
                  opcode: 'argument_reporter_string_number',
                  fields: { VALUE: 'message' },
                },
              },
            },
          },
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: {
                  opcode: 'argument_reporter_boolean',
                  fields: { VALUE: 'enabled' },
                },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'procedures_call',
                    procedure: { name: 'announce' },
                    inputs: {
                      message: {
                        type: 'block',
                        block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'message' } },
                      },
                      enabled: {
                        type: 'block',
                        block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
                      },
                      count: {
                        type: 'block',
                        block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'count' } },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ]
    source.stage.scripts.push({
      blocks: [
        {
          opcode: 'procedures_call',
          procedure: { name: 'announce' },
          inputs: {
            message: { type: 'literal', value: 'from script' },
            enabled: { type: 'literal', value: true },
            count: { type: 'literal', value: 42 },
          },
        },
      ],
    })

    const scratch = buildScratchProjectJson(source)
    const blocks = scratch.targets[0].blocks
    expect(validateScratchBlockGraph(blocks)).toEqual([])
    const definition = Object.values(blocks).find(({ opcode }) => opcode === 'procedures_definition')
    expect(definition).toBeDefined()
    if (!definition) return
    const prototypeId = definition.inputs.custom_block[1]
    expect(typeof prototypeId).toBe('string')
    if (typeof prototypeId !== 'string') return
    const argumentIds = JSON.parse(String(blocks[prototypeId].mutation?.argumentids)) as string[]
    expect(blocks[prototypeId].mutation).toMatchObject({
      proccode: 'announce %s %b %n',
      argumentnames: '["message","enabled","count"]',
      argumentdefaults: '["hello",false,3]',
      warp: 'true',
    })
    const call = Object.values(blocks).find(({ opcode }) => opcode === 'procedures_call')
    expect(call?.mutation).toMatchObject({
      proccode: 'announce %s %b %n',
      argumentids: blocks[prototypeId].mutation?.argumentids,
    })
    expect(call?.inputs).toEqual({
      [argumentIds[0]]: [1, [10, 'from script']],
      [argumentIds[1]]: [1, [10, 'true']],
      [argumentIds[2]]: [1, [4, 42]],
    })

    const restored = projectJsonToCanonical(scratch, source.name)
    expect(restored.stage.procedures).toEqual(source.stage.procedures)
    expect(
      restored.stage.scripts.some((script) =>
        script.blocks.some((block) => block.opcode === 'procedures_definition'),
      ),
    ).toBe(false)
    const sb3 = await compileCanonicalProjectToSb3(source)
    const decompiled = await decompileSb3WithBlockGraphs(sb3, source.name)
    expect(decompiled.rawBlockGraphs.every(({ issues }) => issues.length === 0)).toBe(true)
    expect(decompiled.canonical.stage.procedures).toEqual(source.stage.procedures)
    const procedureBodyMapping = decompiled.canonicalBlockMappings.find(
      ({ irPath }) => irPath === '/stage/procedures/0/body/0',
    )
    expect(procedureBodyMapping).toMatchObject({
      opcode: 'looks_say',
      targetIndex: 0,
      targetName: 'Stage',
      isStage: true,
    })
    expect(decompiled.rawBlockGraphs[procedureBodyMapping?.targetIndex ?? -1]?.targetName).toBe(
      procedureBodyMapping?.targetName,
    )
    expect(decompiled.rawBlockGraphs[0]?.blocks[procedureBodyMapping?.blockId ?? '']?.opcode).toBe('looks_say')
    expect(decompiled.canonicalBlockMappings).toContainEqual(
      expect.objectContaining({ irPath: '/stage/procedures/0', opcode: 'procedures_definition' }),
    )
    expect(decompiled.canonicalBlockMappings).toContainEqual(
      expect.objectContaining({ irPath: '/stage/procedures/0/prototype', opcode: 'procedures_prototype' }),
    )
    expect(decompiled.canonical.stage.scripts.flatMap(({ blocks: scriptBlocks }) => scriptBlocks)).toContainEqual(
      source.stage.scripts.at(-1)?.blocks[0],
    )
  })

  it('round-trips seeded procedure names, parameter kinds, defaults, and warp flags', () => {
    let state = 0x0c0b10c5
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const kinds = ['string-number', 'number', 'boolean'] as const

    for (let sample = 0; sample < 32; sample += 1) {
      const source = structuredClone(example) as CanonicalProject
      source.stage.procedures = Array.from({ length: 1 + (nextRandom() % 4) }, (_, procedureIndex) => ({
        name: `procedure/${sample}/~ 雪-${procedureIndex}`,
        parameters: Array.from({ length: 1 + (nextRandom() % 3) }, (_, parameterIndex) => {
          const kind = kinds[nextRandom() % kinds.length]
          return {
            name: `arg/${parameterIndex}/~😀-${nextRandom().toString(16)}`,
            kind,
            default:
              kind === 'boolean'
                ? nextRandom() % 2 === 0
                : kind === 'number'
                  ? (nextRandom() % 101) - 50
                  : `value/${nextRandom().toString(16)}~雪`,
          }
        }),
        warp: nextRandom() % 2 === 0,
        body: [],
      }))

      const roundTrip = projectJsonToCanonical(buildScratchProjectJson(source), source.name)
      expect(roundTrip.stage.procedures, `seed ${sample}`).toEqual(source.stage.procedures)
    }
  })

  it('executes seeded procedure calls with Unicode names and argument values', async () => {
    let state = 0x5eedc0de
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['雪', '🚀', '{', '}', '`', '\\', '"', '/', '~', '中', 'e\u0301']
    const source = structuredClone(example) as CanonicalProject
    const expectedValues: { name: string; value: string }[] = []
    source.stage.variables = []
    source.stage.procedures = []
    const blocks: CanonicalProject['stage']['scripts'][number]['blocks'] = [{ opcode: 'event_whenflagclicked' }]

    for (let sample = 0; sample < 24; sample += 1) {
      const name = `procedure/${sample}/~雪`
      const parameter = `argument/${sample}/~😀`
      const variable = `result-${sample}`
      const value = `run-${sample}-${Array.from({ length: 6 + (nextRandom() % 12) }, () => alphabet[nextRandom() % alphabet.length]).join('')}`
      source.stage.variables.push({ name: variable, value: '' })
      expectedValues.push({ name: variable, value })
      source.stage.procedures.push({
        name,
        parameters: [{ name: parameter, kind: 'string-number', default: `default-${sample}` }],
        warp: nextRandom() % 2 === 0,
        body: [
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: variable },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'argument_reporter_string_number',
                  fields: { VALUE: parameter },
                },
              },
            },
          },
        ],
      })
      blocks.push({
        opcode: 'procedures_call',
        procedure: { name },
        inputs: { [parameter]: { type: 'literal', value } },
      })
    }
    source.stage.scripts = [{ blocks }]

    const { vm } = await compileCanonicalProject(source)
    try {
      runForTicks(vm, 100)
      for (const { name, value } of expectedValues) {
        expect(getVariable(vm, 'Stage', name)?.value, name).toBe(value)
      }
    } finally {
      vm.quit()
    }
  })

  it('executes seeded mixed-type procedure arguments and reporters in Scratch VM', async () => {
    let state = 0x61c88647
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const kinds = ['string-number', 'number', 'boolean'] as const
    const expectedValues: { variableName: string; value: string | number | boolean }[] = []
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = []
    source.stage.procedures = []
    const callBlocks: CanonicalProject['stage']['scripts'][number]['blocks'] = [{ opcode: 'event_whenflagclicked' }]

    for (let sample = 0; sample < 32; sample += 1) {
      const procedureName = `typed procedure/${sample}/~雪`
      const procedure: CanonicalProject['stage']['procedures'][number] = {
        name: procedureName,
        parameters: [],
        warp: nextRandom() % 2 === 0,
        body: [],
      }
      const call: CanonicalProject['stage']['scripts'][number]['blocks'][number] = {
        opcode: 'procedures_call',
        procedure: { name: procedureName },
        inputs: {},
      }
      const callInputs = call.inputs
      if (!callInputs) throw new Error('Generated procedure call has no input map')

      for (let parameterIndex = 0; parameterIndex < 1 + (nextRandom() % 3); parameterIndex += 1) {
        const kind = kinds[(sample + parameterIndex) % kinds.length]
        const parameterName = `argument/${parameterIndex}/~${sample}`
        const variableName = `typed-result-${sample}-${parameterIndex}`
        const value =
          kind === 'boolean'
            ? nextRandom() % 2 === 0
            : kind === 'number'
              ? (sample - 16) * 3 + parameterIndex + 0.25
              : `value-${sample}-${parameterIndex}-雪🚀-${nextRandom().toString(16)}`
        const defaultValue =
          kind === 'boolean'
            ? !value
            : kind === 'number'
              ? -sample - parameterIndex - 0.5
              : `default-${parameterName}`
        const reporterOpcode = kind === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number'

        source.stage.variables.push({ name: variableName, value: 0 })
        procedure.parameters.push({ name: parameterName, kind, default: defaultValue })
        if (kind === 'boolean') {
          procedure.body.push({
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: { opcode: reporterOpcode, fields: { VALUE: parameterName } },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: variableName },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          })
        } else {
          procedure.body.push({
            opcode: 'data_setvariableto',
            fields: { VARIABLE: variableName },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: reporterOpcode, fields: { VALUE: parameterName } },
              },
            },
          })
        }
        callInputs[parameterName] = { type: 'literal', value }
        expectedValues.push({ variableName, value: kind === 'boolean' ? (value ? 1 : 0) : value })
      }

      source.stage.procedures.push(procedure)
      callBlocks.push(call)
    }
    source.stage.scripts = [{ blocks: callBlocks }]

    const { vm } = await compileCanonicalProject(source)
    try {
      runForTicks(vm, 200)
      for (const { variableName, value } of expectedValues) {
        expect(getVariable(vm, 'Stage', variableName)?.value, variableName).toBe(value)
      }
    } finally {
      vm.quit()
    }
  })

  it.each([false, true])('executes a terminating recursive procedure in Scratch VM with warp=%s', async (warp) => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [{ name: 'score', value: 0 }]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'count down' },
            inputs: { remaining: { type: 'literal', value: 5 } },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'count down',
        parameters: [{ name: 'remaining', kind: 'number', default: 0 }],
        warp,
        body: [
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: {
                  opcode: 'operator_gt',
                  inputs: {
                    OPERAND1: {
                      type: 'block',
                      block: {
                        opcode: 'argument_reporter_string_number',
                        fields: { VALUE: 'remaining' },
                      },
                    },
                    OPERAND2: { type: 'literal', value: 0 },
                  },
                },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'score' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                  {
                    opcode: 'procedures_call',
                    procedure: { name: 'count down' },
                    inputs: {
                      remaining: {
                        type: 'block',
                        block: {
                          opcode: 'operator_subtract',
                          inputs: {
                            NUM1: {
                              type: 'block',
                              block: {
                                opcode: 'argument_reporter_string_number',
                                fields: { VALUE: 'remaining' },
                              },
                            },
                            NUM2: { type: 'literal', value: 1 },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const { vm } = await compileCanonicalProject(source)
    try {
      runForTicks(vm, 500)
      expect(getVariable(vm, 'Stage', 'score')?.value).toBe(5)
    } finally {
      vm.quit()
    }
  })

  it('executes string and boolean procedure arguments through a conditional body', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [{ name: 'result', value: '' }]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'capture when enabled' },
            inputs: {
              message: { type: 'literal', value: 'ignored' },
              enabled: { type: 'literal', value: false },
            },
          },
          {
            opcode: 'procedures_call',
            procedure: { name: 'capture when enabled' },
            inputs: {
              message: { type: 'literal', value: 'captured' },
              enabled: { type: 'literal', value: true },
            },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'capture when enabled',
        parameters: [
          { name: 'message', kind: 'string-number', default: '' },
          { name: 'enabled', kind: 'boolean', default: false },
        ],
        warp: false,
        body: [
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: {
                  opcode: 'argument_reporter_boolean',
                  fields: { VALUE: 'enabled' },
                },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'result' },
                    inputs: {
                      VALUE: {
                        type: 'block',
                        block: {
                          opcode: 'argument_reporter_string_number',
                          fields: { VALUE: 'message' },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const { vm } = await compileCanonicalProject(source)
    try {
      runForTicks(vm, 30)
      expect(getVariable(vm, 'Stage', 'result')?.value).toBe('captured')
    } finally {
      vm.quit()
    }
  })

  it('forwards an argument through a nested custom procedure call', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [{ name: 'result', value: '' }]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'forward message' },
            inputs: { message: { type: 'literal', value: 'nested value' } },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'forward message',
        parameters: [{ name: 'message', kind: 'string-number', default: '' }],
        warp: false,
        body: [
          {
            opcode: 'procedures_call',
            procedure: { name: 'store message' },
            inputs: {
              value: {
                type: 'block',
                block: {
                  opcode: 'argument_reporter_string_number',
                  fields: { VALUE: 'message' },
                },
              },
            },
          },
        ],
      },
      {
        name: 'store message',
        parameters: [{ name: 'value', kind: 'string-number', default: '' }],
        warp: false,
        body: [
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'result' },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'argument_reporter_string_number',
                  fields: { VALUE: 'value' },
                },
              },
            },
          },
        ],
      },
    ]

    const { vm } = await compileCanonicalProject(source)
    try {
      runForTicks(vm, 30)
      expect(getVariable(vm, 'Stage', 'result')?.value).toBe('nested value')
    } finally {
      vm.quit()
    }
  })

  it('forwards mixed string, number, and boolean arguments through three procedures', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [
      { name: 'received message', value: '' },
      { name: 'received count', value: 0 },
      { name: 'received enabled', value: 0 },
    ]
    const parameters = [
      { name: 'message', kind: 'string-number' as const, default: '' },
      { name: 'count', kind: 'number' as const, default: 0 },
      { name: 'enabled', kind: 'boolean' as const, default: false },
    ]
    const reporter = (name: string, kind: (typeof parameters)[number]['kind']) => ({
      type: 'block' as const,
      block: {
        opcode: kind === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
        fields: { VALUE: name },
      },
    })
    const forwardInputs = Object.fromEntries(parameters.map(({ name, kind }) => [name, reporter(name, kind)]))
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'forward first' },
            inputs: {
              message: { type: 'literal', value: 'mixed payload' },
              count: { type: 'literal', value: 42 },
              enabled: { type: 'literal', value: true },
            },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'forward first',
        parameters,
        warp: false,
        body: [
          {
            opcode: 'procedures_call',
            procedure: { name: 'forward second' },
            inputs: forwardInputs,
          },
        ],
      },
      {
        name: 'forward second',
        parameters,
        warp: true,
        body: [
          {
            opcode: 'procedures_call',
            procedure: { name: 'store payload' },
            inputs: forwardInputs,
          },
        ],
      },
      {
        name: 'store payload',
        parameters,
        warp: false,
        body: [
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'received message' },
            inputs: { VALUE: reporter('message', 'string-number') },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'received count' },
            inputs: { VALUE: reporter('count', 'number') },
          },
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: reporter('enabled', 'boolean'),
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'received enabled' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const { vm } = await compileCanonicalProject(source)
    try {
      runForTicks(vm, 50)
      expect(getVariable(vm, 'Stage', 'received message')?.value).toBe('mixed payload')
      expect(getVariable(vm, 'Stage', 'received count')?.value).toBe(42)
      expect(getVariable(vm, 'Stage', 'received enabled')?.value).toBe(1)
    } finally {
      vm.quit()
    }
  })

  it('uses prototype defaults when a loaded Scratch call has missing argument inputs', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [{ name: 'result', value: '' }]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'capture default' },
            inputs: {
              message: { type: 'literal', value: 'explicit message' },
              enabled: { type: 'literal', value: false },
            },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'capture default',
        parameters: [
          { name: 'message', kind: 'string-number', default: 'prototype default' },
          { name: 'enabled', kind: 'boolean', default: true },
        ],
        warp: false,
        body: [
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: {
                  opcode: 'argument_reporter_boolean',
                  fields: { VALUE: 'enabled' },
                },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'result' },
                    inputs: {
                      VALUE: {
                        type: 'block',
                        block: {
                          opcode: 'argument_reporter_string_number',
                          fields: { VALUE: 'message' },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const scratchProject = buildScratchProjectJson(source)
    const call = Object.values(scratchProject.targets[0].blocks).find(({ opcode }) => opcode === 'procedures_call')
    expect(call).toBeDefined()
    if (!call) return
    call.inputs = {}

    const imported = projectJsonToCanonical(scratchProject, source.name)
    const importedCall = imported.stage.scripts[0]?.blocks[1]
    expect(importedCall).toMatchObject({
      opcode: 'procedures_call',
      procedure: { name: 'capture default' },
      inputs: {
        message: { type: 'literal', value: 'prototype default' },
        enabled: { type: 'literal', value: true },
      },
    })

    const normalized = await compileCanonicalProject(imported)
    try {
      runForTicks(normalized.vm, 30)
      expect(getVariable(normalized.vm, 'Stage', 'result')?.value).toBe('prototype default')
    } finally {
      normalized.vm.quit()
    }

    const sourceArchive = await compileCanonicalProjectToSb3(source)
    const zip = await JSZip.loadAsync(sourceArchive)
    const projectEntry = zip.file('project.json')
    expect(projectEntry).toBeDefined()
    if (!projectEntry) return
    const archivedProject = JSON.parse(await projectEntry.async('string')) as unknown as {
      targets: { blocks: Record<string, { opcode: string; inputs: Record<string, unknown> }> }[]
    }
    const archivedCall = Object.values(archivedProject.targets[0]?.blocks ?? {}).find(
      ({ opcode }) => opcode === 'procedures_call',
    )
    expect(archivedCall).toBeDefined()
    if (!archivedCall) return
    archivedCall.inputs = {}
    zip.file('project.json', JSON.stringify(archivedProject))

    const archiveImported = await decompileSb3WithBlockGraphs(
      await zip.generateAsync({ type: 'uint8array' }),
      source.name,
    )
    const archiveImportedCall = archiveImported.canonical.stage.scripts[0]?.blocks[1]
    expect(archiveImportedCall).toMatchObject({
      opcode: 'procedures_call',
      procedure: { name: 'capture default' },
      inputs: {
        message: { type: 'literal', value: 'prototype default' },
        enabled: { type: 'literal', value: true },
      },
    })
    expect(archiveImported.rawBlockGraphs.flatMap(({ issues }) => issues)).not.toContainEqual(
      expect.objectContaining({ code: 'invalid-procedure-call-arguments' }),
    )
    const archiveNormalized = await compileCanonicalProject(archiveImported.canonical)
    try {
      runForTicks(archiveNormalized.vm, 30)
      expect(getVariable(archiveNormalized.vm, 'Stage', 'result')?.value).toBe('prototype default')
    } finally {
      archiveNormalized.vm.quit()
    }

    const vm = createVM()
    const renderer = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'createSVGSkin') return () => 1
          if (property === 'getSkinSize') return () => [1, 1]
          if (property === 'getSkinRotationCenter') return () => [0, 0]
          if (property === 'getNativeSize') return () => [480, 360]
          return () => 1
        },
      },
    )
    ;(vm as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
    try {
      await loadProjectJson(scratchProject as unknown as ScratchProjectJson, vm)
      runForTicks(vm, 30)
      expect(getVariable(vm, 'Stage', 'result')?.value).toBe('prototype default')
    } finally {
      vm.quit()
    }
  })

  it('uses string and boolean prototype defaults across a nested procedure call', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [{ name: 'result', value: '' }]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'procedures_call', procedure: { name: 'outer wrapper' }, inputs: {} },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'outer wrapper',
        parameters: [],
        warp: false,
        body: [{ opcode: 'procedures_call', procedure: { name: 'middle wrapper' }, inputs: {} }],
      },
      {
        name: 'middle wrapper',
        parameters: [],
        warp: true,
        body: [
          {
            opcode: 'procedures_call',
            procedure: { name: 'capture nested default' },
            inputs: {
              message: { type: 'literal', value: 'explicit message' },
              enabled: { type: 'literal', value: false },
            },
          },
        ],
      },
      {
        name: 'capture nested default',
        parameters: [
          { name: 'message', kind: 'string-number', default: 'nested prototype default' },
          { name: 'enabled', kind: 'boolean', default: true },
        ],
        warp: false,
        body: [
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'result' },
                    inputs: {
                      VALUE: {
                        type: 'block',
                        block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'message' } },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const scratchProject = buildScratchProjectJson(source)
    const nestedCall = Object.values(scratchProject.targets[0].blocks).find(
      ({ opcode, inputs }) => opcode === 'procedures_call' && Object.keys(inputs).length === 2,
    )
    expect(nestedCall).toBeDefined()
    if (!nestedCall) return
    nestedCall.inputs = {}

    const vm = createVM()
    const renderer = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'createSVGSkin') return () => 1
          if (property === 'getSkinSize') return () => [1, 1]
          if (property === 'getSkinRotationCenter') return () => [0, 0]
          if (property === 'getNativeSize') return () => [480, 360]
          return () => 1
        },
      },
    )
    ;(vm as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
    try {
      await loadProjectJson(scratchProject as unknown as ScratchProjectJson, vm)
      runForTicks(vm, 50)
      expect(getVariable(vm, 'Stage', 'result')?.value).toBe('nested prototype default')
    } finally {
      vm.quit()
    }
  })

  it.each([false, true])(
    'uses a boolean prototype default during recursive procedure calls with warp=%s',
    async (warp) => {
      const source = structuredClone(example) as CanonicalProject
      source.stage.variables = [{ name: 'enabled count', value: 0 }]
      source.stage.scripts = [
        {
          blocks: [
            { opcode: 'event_whenflagclicked' },
            {
              opcode: 'procedures_call',
              procedure: { name: 'count while enabled' },
              inputs: {
                remaining: { type: 'literal', value: 3 },
                enabled: { type: 'literal', value: false },
              },
            },
          ],
        },
      ]
      source.stage.procedures = [
        {
          name: 'count while enabled',
          parameters: [
            { name: 'remaining', kind: 'number', default: 0 },
            { name: 'enabled', kind: 'boolean', default: true },
          ],
          warp,
          body: [
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  type: 'block',
                  block: {
                    opcode: 'operator_gt',
                    inputs: {
                      OPERAND1: {
                        type: 'block',
                        block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'remaining' } },
                      },
                      OPERAND2: { type: 'literal', value: 0 },
                    },
                  },
                },
                SUBSTACK: {
                  type: 'stack',
                  blocks: [
                    {
                      opcode: 'control_if',
                      inputs: {
                        CONDITION: {
                          type: 'block',
                          block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
                        },
                        SUBSTACK: {
                          type: 'stack',
                          blocks: [
                            {
                              opcode: 'data_changevariableby',
                              fields: { VARIABLE: 'enabled count' },
                              inputs: { VALUE: { type: 'literal', value: 1 } },
                            },
                          ],
                        },
                      },
                    },
                    {
                      opcode: 'procedures_call',
                      procedure: { name: 'count while enabled' },
                      inputs: {
                        remaining: {
                          type: 'block',
                          block: {
                            opcode: 'operator_subtract',
                            inputs: {
                              NUM1: {
                                type: 'block',
                                block: {
                                  opcode: 'argument_reporter_string_number',
                                  fields: { VALUE: 'remaining' },
                                },
                              },
                              NUM2: { type: 'literal', value: 1 },
                            },
                          },
                        },
                        enabled: { type: 'literal', value: false },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ]

      const scratchProject = buildScratchProjectJson(source)
      const blocks = scratchProject.targets[0].blocks
      const recursiveCall = Object.values(blocks).find(
        ({ opcode, inputs }) =>
          opcode === 'procedures_call' &&
          Object.values(inputs).some(
            (input) =>
              Array.isArray(input) &&
              input.some(
                (id) =>
                  typeof id === 'string' && Object.hasOwn(blocks, id) && blocks[id].opcode === 'operator_subtract',
              ),
          ),
      )
      expect(recursiveCall).toBeDefined()
      if (!recursiveCall) return
      const countdownArgument = Object.entries(recursiveCall.inputs).find(
        ([, input]) =>
          Array.isArray(input) &&
          input.some(
            (id) => typeof id === 'string' && Object.hasOwn(blocks, id) && blocks[id].opcode === 'operator_subtract',
          ),
      )?.[0]
      expect(countdownArgument).toBeDefined()
      if (!countdownArgument) return
      const booleanArgument = Object.keys(recursiveCall.inputs).find((name) => name !== countdownArgument)
      expect(booleanArgument).toBeDefined()
      if (!booleanArgument) return
      delete recursiveCall.inputs[booleanArgument]

      const vm = createVM()
      const renderer = new Proxy(
        {},
        {
          get: (_target, property) => {
            if (property === 'createSVGSkin') return () => 1
            if (property === 'getSkinSize') return () => [1, 1]
            if (property === 'getSkinRotationCenter') return () => [0, 0]
            if (property === 'getNativeSize') return () => [480, 360]
            return () => 1
          },
        },
      )
      ;(vm as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
      try {
        await loadProjectJson(scratchProject as unknown as ScratchProjectJson, vm)
        runForTicks(vm, 100)
        expect(getVariable(vm, 'Stage', 'enabled count')?.value).toBe(2)
      } finally {
        vm.quit()
      }
    },
  )

  it.each([false, true])('applies a missing boolean default on each recursive call with warp=%s', async (warp) => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [{ name: 'enabled count', value: 0 }]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'count while enabled' },
            inputs: {
              remaining: { type: 'literal', value: 3 },
              enabled: { type: 'literal', value: false },
            },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'count while enabled',
        parameters: [
          { name: 'remaining', kind: 'number', default: 0 },
          { name: 'enabled', kind: 'boolean', default: true },
        ],
        warp,
        body: [
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: {
                  opcode: 'operator_gt',
                  inputs: {
                    OPERAND1: {
                      type: 'block',
                      block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'remaining' } },
                    },
                    OPERAND2: { type: 'literal', value: 0 },
                  },
                },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'control_if',
                    inputs: {
                      CONDITION: {
                        type: 'block',
                        block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
                      },
                      SUBSTACK: {
                        type: 'stack',
                        blocks: [
                          {
                            opcode: 'data_changevariableby',
                            fields: { VARIABLE: 'enabled count' },
                            inputs: { VALUE: { type: 'literal', value: 1 } },
                          },
                        ],
                      },
                    },
                  },
                  {
                    opcode: 'procedures_call',
                    procedure: { name: 'count while enabled' },
                    inputs: {
                      remaining: {
                        type: 'block',
                        block: {
                          opcode: 'operator_subtract',
                          inputs: {
                            NUM1: {
                              type: 'block',
                              block: {
                                opcode: 'argument_reporter_string_number',
                                fields: { VALUE: 'remaining' },
                              },
                            },
                            NUM2: { type: 'literal', value: 1 },
                          },
                        },
                      },
                      enabled: { type: 'literal', value: false },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const scratchProject = buildScratchProjectJson(source)
    const blocks = scratchProject.targets[0].blocks
    const recursiveCall = Object.values(blocks).find(
      ({ opcode, inputs }) =>
        opcode === 'procedures_call' &&
        Object.values(inputs).some(
          (input) =>
            Array.isArray(input) &&
            input.some(
              (id) =>
                typeof id === 'string' && Object.hasOwn(blocks, id) && blocks[id].opcode === 'operator_subtract',
            ),
        ),
    )
    expect(recursiveCall).toBeDefined()
    if (!recursiveCall) return
    const countdownArgument = Object.entries(recursiveCall.inputs).find(
      ([, input]) =>
        Array.isArray(input) &&
        input.some(
          (id) => typeof id === 'string' && Object.hasOwn(blocks, id) && blocks[id].opcode === 'operator_subtract',
        ),
    )?.[0]
    expect(countdownArgument).toBeDefined()
    if (!countdownArgument) return
    const booleanArgument = Object.keys(recursiveCall.inputs).find((name) => name !== countdownArgument)
    expect(booleanArgument).toBeDefined()
    if (!booleanArgument) return
    delete recursiveCall.inputs[booleanArgument]

    const vm = createVM()
    const renderer = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'createSVGSkin') return () => 1
          if (property === 'getSkinSize') return () => [1, 1]
          if (property === 'getSkinRotationCenter') return () => [0, 0]
          if (property === 'getNativeSize') return () => [480, 360]
          return () => 1
        },
      },
    )
    ;(vm as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
    try {
      await loadProjectJson(scratchProject as unknown as ScratchProjectJson, vm)
      runForTicks(vm, 100)
      expect(getVariable(vm, 'Stage', 'enabled count')?.value).toBe(2)
    } finally {
      vm.quit()
    }
  })

  it('executes seeded recursive calls with omitted typed defaults across every parameter order', async () => {
    let state = 0x9e3779b9
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const renderer = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'createSVGSkin') return () => 1
          if (property === 'getSkinSize') return () => [1, 1]
          if (property === 'getSkinRotationCenter') return () => [0, 0]
          if (property === 'getNativeSize') return () => [480, 360]
          return () => 1
        },
      },
    )
    const parameterOrders = [
      ['remaining', 'message', 'enabled'],
      ['remaining', 'enabled', 'message'],
      ['message', 'remaining', 'enabled'],
      ['message', 'enabled', 'remaining'],
      ['enabled', 'remaining', 'message'],
      ['enabled', 'message', 'remaining'],
    ] as const
    const parameterKinds = {
      remaining: 'number',
      message: 'string-number',
      enabled: 'boolean',
    } as const
    const numberDefaults = [-1e12, -3.25, 0, 1e-10, 0.5, 1e10, Number.MAX_SAFE_INTEGER, 2 ** 40]
    const parameterDefaults = (messageDefault: string, enabledDefault: boolean, remainingDefault: number) => ({
      remaining: remainingDefault,
      message: messageDefault,
      enabled: enabledDefault,
    })
    const parameterTokens = { number: '%n', 'string-number': '%s', boolean: '%b' } as const

    for (let sample = 0; sample < 128; sample += 1) {
      const source = structuredClone(example) as CanonicalProject
      const procedureName = `recursive defaults/${sample}/~雪`
      const messageDefault = `default/${sample}/雪🚀/${nextRandom().toString(16)}`
      const enabledDefault = nextRandom() % 2 === 0
      const remainingDefault = numberDefaults[sample % numberDefaults.length] ?? 0
      const warp = nextRandom() % 2 === 0
      const parameterOrder = parameterOrders[sample % parameterOrders.length]
      const defaults = parameterDefaults(messageDefault, enabledDefault, remainingDefault)
      source.stage.variables = [
        { name: 'message seen', value: '' },
        { name: 'enabled count', value: 0 },
        { name: 'remaining seen', value: -1 },
        { name: 'recursion budget', value: 1 },
      ]
      source.stage.scripts = [
        {
          blocks: [
            { opcode: 'event_whenflagclicked' },
            {
              opcode: 'procedures_call',
              procedure: { name: procedureName },
              inputs: {
                remaining: { type: 'literal', value: 2 },
                message: { type: 'literal', value: `root/${sample}` },
                enabled: { type: 'literal', value: false },
              },
            },
          ],
        },
      ]
      source.stage.procedures = [
        {
          name: procedureName,
          parameters: parameterOrder.map((name) => ({ name, kind: parameterKinds[name], default: defaults[name] })),
          warp,
          body: [
            {
              opcode: 'data_changevariableby',
              fields: { VARIABLE: 'recursion budget' },
              inputs: { VALUE: { type: 'literal', value: -1 } },
            },
            {
              opcode: 'data_setvariableto',
              fields: { VARIABLE: 'remaining seen' },
              inputs: {
                VALUE: {
                  type: 'block',
                  block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'remaining' } },
                },
              },
            },
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  type: 'block',
                  block: {
                    opcode: 'operator_gt',
                    inputs: {
                      OPERAND1: {
                        type: 'block',
                        block: { opcode: 'data_variable', fields: { VARIABLE: 'recursion budget' } },
                      },
                      OPERAND2: { type: 'literal', value: -2 },
                    },
                  },
                },
                SUBSTACK: {
                  type: 'stack',
                  blocks: [
                    {
                      opcode: 'data_setvariableto',
                      fields: { VARIABLE: 'message seen' },
                      inputs: {
                        VALUE: {
                          type: 'block',
                          block: {
                            opcode: 'argument_reporter_string_number',
                            fields: { VALUE: 'message' },
                          },
                        },
                      },
                    },
                    {
                      opcode: 'control_if',
                      inputs: {
                        CONDITION: {
                          type: 'block',
                          block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
                        },
                        SUBSTACK: {
                          type: 'stack',
                          blocks: [
                            {
                              opcode: 'data_changevariableby',
                              fields: { VARIABLE: 'enabled count' },
                              inputs: { VALUE: { type: 'literal', value: 1 } },
                            },
                          ],
                        },
                      },
                    },
                    {
                      opcode: 'procedures_call',
                      procedure: { name: procedureName },
                      inputs: {
                        remaining: {
                          type: 'block',
                          block: {
                            opcode: 'operator_subtract',
                            inputs: {
                              NUM1: {
                                type: 'block',
                                block: {
                                  opcode: 'argument_reporter_string_number',
                                  fields: { VALUE: 'remaining' },
                                },
                              },
                              NUM2: { type: 'literal', value: 1 },
                            },
                          },
                        },
                        message: { type: 'literal', value: `recursive explicit/${sample}` },
                        enabled: { type: 'literal', value: false },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ]

      const scratchProject = buildScratchProjectJson(source)
      const blocks = scratchProject.targets[0].blocks
      const prototype = Object.values(blocks).find(
        ({ opcode, mutation }) =>
          opcode === 'procedures_prototype' &&
          mutation?.proccode ===
            `${procedureName} ${parameterOrder.map((name) => parameterTokens[parameterKinds[name]]).join(' ')}`,
      )
      expect(prototype, `prototype seed ${sample}`).toBeDefined()
      if (!prototype) continue
      const argumentIds = JSON.parse(String(prototype.mutation?.argumentids)) as string[]
      const recursiveCall = Object.values(blocks).find(
        ({ opcode, inputs }) =>
          opcode === 'procedures_call' &&
          Object.values(inputs).some(
            (input) =>
              Array.isArray(input) &&
              input.some(
                (id) =>
                  typeof id === 'string' && Object.hasOwn(blocks, id) && blocks[id].opcode === 'operator_subtract',
              ),
          ),
      )
      expect(recursiveCall, `recursive call seed ${sample}`).toBeDefined()
      if (!recursiveCall) continue
      const messageArgumentId = argumentIds[parameterOrder.indexOf('message')]
      const enabledArgumentId = argumentIds[parameterOrder.indexOf('enabled')]
      const remainingArgumentId = argumentIds[parameterOrder.indexOf('remaining')]
      expect(messageArgumentId).toBeDefined()
      expect(enabledArgumentId).toBeDefined()
      expect(remainingArgumentId).toBeDefined()
      if (!messageArgumentId || !enabledArgumentId || !remainingArgumentId) continue
      delete recursiveCall.inputs[messageArgumentId]
      delete recursiveCall.inputs[enabledArgumentId]
      delete recursiveCall.inputs[remainingArgumentId]

      const imported = projectJsonToCanonical(scratchProject, source.name)
      expect(imported.stage.procedures.map(({ name, parameters, warp }) => ({ name, parameters, warp }))).toEqual(
        source.stage.procedures.map(({ name, parameters, warp }) => ({ name, parameters, warp })),
      )
      const importedRecursiveCall = collectNestedBlocks(imported.stage.procedures[0]?.body ?? []).find(
        (block) => block.opcode === 'procedures_call',
      )
      expect(importedRecursiveCall?.inputs).toMatchObject({
        message: { type: 'literal', value: messageDefault },
        enabled: { type: 'literal', value: enabledDefault },
        remaining: { type: 'literal', value: remainingDefault },
      })

      const normalized = await compileCanonicalProject(imported)
      let reloaded: Awaited<ReturnType<typeof loadSb3>> | undefined
      try {
        reloaded = await loadSb3(normalized.sb3)
        ;(reloaded as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
        runForTicks(reloaded, 100)
        expect(getVariable(reloaded, 'Stage', 'message seen')?.value, `Canonical message seed ${sample}`).toBe(
          messageDefault,
        )
        expect(getVariable(reloaded, 'Stage', 'enabled count')?.value, `Canonical boolean seed ${sample}`).toBe(
          enabledDefault ? 1 : 0,
        )
        expect(getVariable(reloaded, 'Stage', 'remaining seen')?.value, `Canonical number seed ${sample}`).toBe(
          remainingDefault,
        )
      } finally {
        reloaded?.quit()
        normalized.vm.quit()
      }

      const vm = createVM()
      ;(vm as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
      try {
        await loadProjectJson(scratchProject as unknown as ScratchProjectJson, vm)
        runForTicks(vm, 100)
        expect(getVariable(vm, 'Stage', 'message seen')?.value, `message seed ${sample}`).toBe(messageDefault)
        expect(getVariable(vm, 'Stage', 'enabled count')?.value, `boolean seed ${sample}`).toBe(
          enabledDefault ? 1 : 0,
        )
        expect(getVariable(vm, 'Stage', 'remaining seen')?.value, `number seed ${sample}`).toBe(remainingDefault)
      } finally {
        vm.quit()
      }
    }
  }, 20_000)

  it.each([
    {
      proccode: 'legacy %s',
      parameterKind: 'string-number',
      reporterOpcode: 'argument_reporter_string_number',
      normalizedKind: 'string-number',
    },
    {
      proccode: 'legacy %n',
      parameterKind: 'number',
      reporterOpcode: 'argument_reporter_string_number',
      normalizedKind: 'number',
    },
    {
      proccode: 'legacy %b',
      parameterKind: 'boolean',
      reporterOpcode: 'argument_reporter_boolean',
      normalizedKind: 'boolean',
    },
  ] as const)('imports legacy shadow prototype $proccode and recompiles its normalized IR', async (procedureCase) => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.procedures = [
      {
        name: 'legacy',
        parameters: [{ name: 'value', kind: procedureCase.parameterKind, default: '' }],
        warp: false,
        body: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'legacy body' } } }],
      },
    ]
    const scratch = buildScratchProjectJson(source)
    const blocks = scratch.targets[0].blocks
    const definition = Object.values(blocks).find(({ opcode }) => opcode === 'procedures_definition')
    expect(definition).toBeDefined()
    if (!definition) return
    const prototypeId = definition.inputs.custom_block[1]
    expect(typeof prototypeId).toBe('string')
    if (typeof prototypeId !== 'string') return
    const prototype = blocks[prototypeId]
    const argumentIds = JSON.parse(String(prototype.mutation?.argumentids)) as string[]
    const reporterId = 'legacy_argument_reporter'
    definition.inputs.custom_block = [1, prototypeId]
    prototype.shadow = true
    prototype.mutation = { ...prototype.mutation, proccode: procedureCase.proccode }
    prototype.inputs = { [argumentIds[0]]: [1, reporterId] }
    blocks[reporterId] = {
      opcode: procedureCase.reporterOpcode,
      next: null,
      parent: prototypeId,
      inputs: {},
      fields: { VALUE: ['value'] },
      shadow: true,
      topLevel: false,
    }

    expect(validateScratchBlockGraph(blocks)).toEqual([])
    const normalized = projectJsonToCanonicalWithReport(scratch, source.name)
    expect(normalized.canonical.stage.procedures).toEqual([
      {
        ...source.stage.procedures[0],
        parameters: [{ ...source.stage.procedures[0].parameters[0], kind: procedureCase.normalizedKind }],
      },
    ])
    expect(normalized.procedureNormalizationReport).toMatchObject({
      format: 'scratch-ai-bridge/procedure-normalization-report',
      items: [{ code: 'legacy-shadow-prototype', outcome: 'normalized', proccode: procedureCase.proccode }],
    })

    const modernSb3 = await compileCanonicalProjectToSb3(normalized.canonical)
    const modernReload = await decompileSb3WithBlockGraphs(modernSb3, source.name)
    expect(modernReload.rawBlockGraphs.every(({ issues }) => issues.length === 0)).toBe(true)
    expect(modernReload.canonical.stage.procedures).toEqual(normalized.canonical.stage.procedures)
  })

  it('executes and normalizes a legacy shadow prototype with mixed string, number, and boolean reporters', async () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.variables = [
      { name: 'legacy text', value: '' },
      { name: 'legacy number', value: 0 },
      { name: 'legacy enabled', value: 0 },
    ]
    source.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'procedures_call',
            procedure: { name: 'legacy multi' },
            inputs: {
              text: { type: 'literal', value: '舊格式/雪😀' },
              count: { type: 'literal', value: 42 },
              enabled: { type: 'literal', value: true },
            },
          },
        ],
      },
    ]
    source.stage.procedures = [
      {
        name: 'legacy multi',
        parameters: [
          { name: 'text', kind: 'string-number', default: '預設' },
          { name: 'count', kind: 'number', default: 3 },
          { name: 'enabled', kind: 'boolean', default: false },
        ],
        warp: true,
        body: [
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'legacy text' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'text' } },
              },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'legacy number' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'argument_reporter_string_number', fields: { VALUE: 'count' } },
              },
            },
          },
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: {
                type: 'block',
                block: { opcode: 'argument_reporter_boolean', fields: { VALUE: 'enabled' } },
              },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'legacy enabled' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const scratch = buildScratchProjectJson(source)
    const blocks = scratch.targets[0].blocks
    const definition = Object.values(blocks).find(({ opcode }) => opcode === 'procedures_definition')
    expect(definition).toBeDefined()
    if (!definition) return
    const prototypeId = definition.inputs.custom_block[1]
    expect(typeof prototypeId).toBe('string')
    if (typeof prototypeId !== 'string') return
    const prototype = blocks[prototypeId]
    const argumentIds = JSON.parse(String(prototype.mutation?.argumentids)) as string[]
    const argumentNames = ['text', 'count', 'enabled']
    const reporterOpcodes = [
      'argument_reporter_string_number',
      'argument_reporter_string_number',
      'argument_reporter_boolean',
    ] as const
    definition.inputs.custom_block = [1, prototypeId]
    prototype.shadow = true
    prototype.inputs = Object.fromEntries(
      argumentIds.map((argumentId, index) => {
        const reporterId = `legacy_multi_reporter_${index}`
        blocks[reporterId] = {
          opcode: reporterOpcodes[index],
          next: null,
          parent: prototypeId,
          inputs: {},
          fields: { VALUE: [argumentNames[index], null] } as unknown as (typeof blocks)[string]['fields'],
          shadow: true,
          topLevel: false,
        }
        return [argumentId, [1, reporterId]]
      }),
    )

    expect(validateScratchBlockGraph(blocks)).toEqual([])
    const normalized = projectJsonToCanonicalWithReport(scratch, source.name)
    expect(normalized.canonical.stage.procedures).toEqual(source.stage.procedures)
    expect(normalized.procedureNormalizationReport.items).toContainEqual(
      expect.objectContaining({
        code: 'legacy-shadow-prototype',
        outcome: 'normalized',
        proccode: 'legacy multi %s %n %b',
      }),
    )

    const renderer = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'createSVGSkin') return () => 1
          if (property === 'getSkinSize') return () => [1, 1]
          if (property === 'getSkinRotationCenter') return () => [0, 0]
          if (property === 'getNativeSize') return () => [480, 360]
          return () => 1
        },
      },
    )
    const executeAndAssert = async (project: typeof scratch): Promise<void> => {
      const vm = createVM()
      ;(vm as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
      try {
        await loadProjectJson(project as unknown as ScratchProjectJson, vm)
        runForTicks(vm, 100)
        expect(getVariable(vm, 'Stage', 'legacy text')?.value).toBe('舊格式/雪😀')
        expect(getVariable(vm, 'Stage', 'legacy number')?.value).toBe(42)
        expect(getVariable(vm, 'Stage', 'legacy enabled')?.value).toBe(1)
      } finally {
        vm.quit()
      }
    }
    await executeAndAssert(scratch)

    const modernSb3 = await compileCanonicalProjectToSb3(normalized.canonical)
    const modernReload = await decompileSb3WithBlockGraphs(modernSb3, source.name)
    expect(modernReload.rawBlockGraphs.every(({ issues }) => issues.length === 0)).toBe(true)
    expect(modernReload.canonical.stage.procedures).toEqual(source.stage.procedures)
    await executeAndAssert(buildScratchProjectJson(modernReload.canonical))
  })

  it.each([
    { property: 'argumentdefaults', value: '[]' },
    { property: 'warp', value: 'sometimes' },
  ])('reports procedure definitions skipped when mutation $property is inconsistent', (invalidMetadata) => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.procedures = [
      {
        name: 'incomplete',
        parameters: [{ name: 'value', kind: 'string-number', default: '' }],
        warp: false,
        body: [],
      },
    ]
    const scratch = buildScratchProjectJson(source)
    const blocks = scratch.targets[0].blocks
    const definition = Object.values(blocks).find(({ opcode }) => opcode === 'procedures_definition')
    expect(definition).toBeDefined()
    if (!definition) return
    const prototypeId = definition.inputs.custom_block[1]
    expect(typeof prototypeId).toBe('string')
    if (typeof prototypeId !== 'string') return
    const mutation = blocks[prototypeId].mutation
    expect(mutation).toBeDefined()
    if (!mutation) return
    mutation[invalidMetadata.property] = invalidMetadata.value

    const normalized = projectJsonToCanonicalWithReport(scratch, source.name)
    expect(normalized.canonical.stage.procedures).toEqual([])
    expect(normalized.procedureNormalizationReport.items).toHaveLength(1)
    expect(normalized.procedureNormalizationReport.items[0]).toMatchObject({
      code: 'invalid-procedure-metadata',
      outcome: 'skipped',
      targetName: 'Stage',
    })
  })

  it('reports duplicate procedure argument names that cannot be represented in Canonical IR', () => {
    const source = structuredClone(example) as CanonicalProject
    source.stage.procedures = [
      {
        name: 'combine',
        parameters: [
          { name: 'first', kind: 'string-number', default: '' },
          { name: 'second', kind: 'number', default: 0 },
        ],
        warp: false,
        body: [],
      },
    ]
    const scratch = buildScratchProjectJson(source)
    const blocks = scratch.targets[0].blocks
    const definition = Object.values(blocks).find(({ opcode }) => opcode === 'procedures_definition')
    expect(definition).toBeDefined()
    if (!definition) return
    const prototypeId = definition.inputs.custom_block[1]
    expect(typeof prototypeId).toBe('string')
    if (typeof prototypeId !== 'string') return
    const mutation = blocks[prototypeId].mutation
    expect(mutation).toBeDefined()
    if (!mutation) return
    mutation.argumentnames = '["same","same"]'

    expect(validateScratchBlockGraph(blocks).map(({ code }) => code)).toContain('invalid-procedure-definition')
    const normalized = projectJsonToCanonicalWithReport(scratch, source.name)
    expect(normalized.canonical.stage.procedures).toEqual([])
    expect(normalized.procedureNormalizationReport.items).toContainEqual(
      expect.objectContaining({ code: 'invalid-procedure-metadata', outcome: 'skipped', proccode: 'combine %s %n' }),
    )
  })

  it('returns source block graphs alongside the VM-derived Canonical IR', async () => {
    const source = example as CanonicalProject
    const sb3 = await compileCanonicalProjectToSb3(source)
    const decompiled = await decompileSb3WithBlockGraphs(sb3, source.name)

    expect(decompiled.canonical.name).toBe(source.name)
    expect(decompiled.rawBlockGraphs).toHaveLength(1)
    expect(decompiled.rawBlockGraphs[0].targetName).toBe('Stage')
    expect(decompiled.rawBlockGraphs[0].blocks).not.toEqual({})
    expect(decompiled.rawBlockGraphs.every(({ issues }) => issues.length === 0)).toBe(true)
    expect(decompiled.archiveWarnings).toEqual([])
  })
})
