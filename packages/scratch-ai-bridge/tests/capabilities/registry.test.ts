import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import validateProject from 'scratch-parser'
import { describe, expect, it, vi } from 'vitest'
import {
  CANONICAL_BLOCK_CAPABILITIES,
  CANONICAL_OPCODES,
  CORE_INTERNAL_MENU_OPCODES,
  CORE_PRESERVED_LEGACY_OPCODES,
  CORE_PROCEDURE_GRAPH_OPCODES,
  createAuthoringInstruction,
  createStudentProjectInstruction,
} from '../../src/core/capabilities'
import type { CanonicalBlockCapability } from '../../src/core/capabilities/registry'
import { buildScratchProjectArchive, buildScratchProjectJson } from '../../src/core/compiler/project-json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import schema from '../../src/core/ir/schema.json'
import type { CanonicalBlock, CanonicalInput, CanonicalProject } from '../../src/core/ir/types'
import {
  createVM,
  getBlocks,
  getProjectJson,
  getTargets,
  getVariable,
  loadSb3,
  runForTicks,
  runForTicksAsync,
  saveSb3,
} from '../../src/scratch/vm'

const createHeadlessVM = (
  penCalls?: { clears: number; points: number; lines: number },
  effectCalls?: { name: string; value: number }[],
  layerCalls?: { order: number; isRelative?: boolean }[],
  touchingCalls?: { targetId: number; candidateIds: number[] }[],
  bubbleCalls?: { type: string; text: string }[],
  pickDrawable?: () => number,
  destroyedDrawableCalls?: number[],
  boundsProvider?: (drawableId: number) => { left: number; right: number; top: number; bottom: number } | null,
  colorCalls?: { drawableId: number; targetColor: number[]; maskColor?: number[] }[],
  penDetails?: {
    points: { diameter: number; color4f: number[]; x: number; y: number }[]
    lines: { diameter: number; color4f: number[]; x1: number; y1: number; x2: number; y2: number }[]
    stamps: number[]
  },
) => {
  let nextId = 1
  const renderer = {
    setLayerGroupOrdering: () => undefined,
    createSVGSkin: () => Promise.resolve(nextId++),
    createTextSkin: (type: string, text: string) => {
      bubbleCalls?.push({ type, text })
      return nextId++
    },
    createPenSkin: () => nextId++,
    getSkinSize: () => [1, 1],
    getBounds: (drawableId: number) => boundsProvider?.(drawableId) ?? null,
    getCurrentSkinSize: () => [76, 76],
    getNativeSize: () => [480, 360],
    getSkinRotationCenter: () => [0.5, 0.5],
    getFencedPositionOfDrawable: (_drawableId: number, position: number[]) => position,
    createDrawable: () => nextId++,
    updateDrawablePosition: () => undefined,
    updateDrawableDirectionScale: () => undefined,
    updateDrawableVisible: () => undefined,
    updateDrawableSkinId: () => undefined,
    updateTextSkin: (_skinId: number, type: string, text: string) => {
      bubbleCalls?.push({ type, text })
    },
    updateDrawableEffect: (_drawableId: number, name: string, value: number) => {
      effectCalls?.push({ name, value })
    },
    setDrawableOrder: (_drawableId: number, order: number, _group: number, isRelative?: boolean) => {
      layerCalls?.push({ order, isRelative })
      return 0
    },
    isTouchingDrawables: (targetId: number, candidateIds: number[]) => {
      touchingCalls?.push({ targetId, candidateIds })
      return true
    },
    isTouchingColor: (drawableId: number, targetColor: number[], maskColor?: number[]) => {
      colorCalls?.push({ drawableId, targetColor, ...(maskColor ? { maskColor } : {}) })
      return Promise.resolve(Boolean(maskColor))
    },
    pick: () => pickDrawable?.() ?? -1,
    getDrawableOrder: (drawableId: number) => drawableId,
    destroyDrawable: (drawableId: number) => {
      destroyedDrawableCalls?.push(drawableId)
    },
    destroySkin: () => undefined,
    penClear: () => {
      if (penCalls) penCalls.clears += 1
    },
    penStamp: (_skinId: number, drawableId: number) => {
      penDetails?.stamps.push(drawableId)
    },
    penPoint: (_skinId: number, attributes: { diameter: number; color4f: number[] }, x: number, y: number) => {
      if (penCalls) penCalls.points += 1
      penDetails?.points.push({ diameter: attributes.diameter, color4f: [...attributes.color4f], x, y })
    },
    penLine: (
      _skinId: number,
      attributes: { diameter: number; color4f: number[] },
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ) => {
      if (penCalls) penCalls.lines += 1
      penDetails?.lines.push({ diameter: attributes.diameter, color4f: [...attributes.color4f], x1, y1, x2, y2 })
    },
    draw: () => undefined,
  }
  const vm = createVM()
  const runtime = (
    vm as unknown as {
      runtime: {
        _primitives: Record<string, (...args: unknown[]) => unknown>
        startHats(opcode: string, ...args: unknown[]): unknown
      }
    }
  ).runtime
  for (const [opcode, primitive] of Object.entries(runtime._primitives)) {
    runtime._primitives[opcode] = (...args) => {
      executedRuntimeOpcodes.add(opcode)
      return primitive(...args)
    }
  }
  const startHats = runtime.startHats.bind(runtime)
  runtime.startHats = (opcode, ...args) => {
    executedRuntimeOpcodes.add(opcode)
    return startHats(opcode, ...args)
  }
  ;(vm as unknown as { attachRenderer(value: typeof renderer): void }).attachRenderer(renderer)
  return vm
}

const executedRuntimeOpcodes = new Set<string>()

describe('Canonical block capability registry', () => {
  it('keeps the schema open to opcode strings and lists known opcodes in AI authoring instructions', () => {
    expect(schema.definitions.block.properties.opcode).toEqual({ type: 'string', minLength: 1 })

    const instruction = createAuthoringInstruction()
    for (const opcode of CANONICAL_OPCODES) expect(instruction).toContain(opcode)
    expect(instruction).toContain('不要執行 Python')
    expect(instruction).toContain('{"KEY_OPTION":"right arrow"}')
    expect(instruction).toContain('每個 costume 至少要有 name 與 dataFormat')
    expect(instruction).toContain('platform-hero')
    expect(instruction).toContain('platform-day')
    expect(instruction).toContain('Bridge 會安全加入圖像')
    expect(instruction).toContain('Canonical IR block 禁止輸出 shape 欄位')
    expect(instruction).not.toContain('shape=boolean 的 reporter')
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
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_subtract).toMatchObject({
      shape: 'reporter',
      inputs: { NUM1: { kind: 'number', required: true }, NUM2: { kind: 'number', required: true } },
    })
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_mathop.fields.OPERATOR.values).toContain('sqrt')
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_contains.shape).toBe('boolean')
    expect(CANONICAL_BLOCK_CAPABILITIES.operator_letter_of.inputs).toMatchObject({
      LETTER: { kind: 'number', required: true },
      STRING: { kind: 'string', required: true },
    })
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

  it('classifies every primitive in the pinned Scratch VM core block packages', async () => {
    const blockDirectory = fileURLToPath(new URL('../../../scratch-vm/src/blocks/', import.meta.url))
    const files = (await readdir(blockDirectory)).filter((name) => /^scratch3_.*\.js$/.test(name))
    const primitiveOpcodes = new Set<string>()
    for (const file of files) {
      const source = await readFile(`${blockDirectory}/${file}`, 'utf8')
      const primitiveTable = /getPrimitives\s*\(\)\s*\{\s*return\s*\{([\s\S]*?)\n\s*\};/.exec(source)?.[1]
      if (!primitiveTable) continue
      for (const [, opcode] of primitiveTable.matchAll(/^\s{12}([A-Za-z0-9_]+)\s*:/gm)) {
        primitiveOpcodes.add(opcode)
      }
    }

    const classifications = new Set<string>([
      ...CANONICAL_OPCODES,
      ...CORE_PRESERVED_LEGACY_OPCODES,
      ...CORE_INTERNAL_MENU_OPCODES,
      ...CORE_PROCEDURE_GRAPH_OPCODES,
    ])
    expect(primitiveOpcodes.size).toBeGreaterThan(100)
    expect([...primitiveOpcodes].filter((opcode) => !classifications.has(opcode))).toEqual([])
    for (const opcode of [...CORE_PRESERVED_LEGACY_OPCODES, ...CORE_INTERNAL_MENU_OPCODES]) {
      expect(CANONICAL_OPCODES).not.toContain(opcode)
    }
    expect(CORE_PRESERVED_LEGACY_OPCODES).toContain('sensing_userid')
  })

  it('compiles and VM round-trips every strict capability', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    project.stage.lists.push({ name: 'items', value: [] })
    project.broadcasts.push({ name: 'finish' })

    const inputValue = (opcode: string, inputName: string, kind: string): CanonicalInput => {
      if (kind === 'stack') {
        return {
          type: 'stack',
          blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'fixture' } } }],
        }
      }
      if (kind === 'boolean') {
        return {
          type: 'block',
          block: {
            opcode: 'operator_equals',
            inputs: { OPERAND1: { type: 'literal', value: 1 }, OPERAND2: { type: 'literal', value: 1 } },
          },
        }
      }
      if (kind === 'broadcast') return { type: 'broadcast', name: 'finish' }
      let value: string | number | boolean = kind === 'number' ? 1 : 'fixture'
      if (kind === 'menu') {
        if (inputName === 'TO' || inputName === 'TOWARDS' || inputName === 'DISTANCETOMENU') value = '_mouse_'
        else if (inputName === 'CLONE_OPTION') value = '_myself_'
        else if (inputName === 'OBJECT') value = '_stage_'
        else value = 'fixture'
      }
      if (opcode.startsWith('data_') && inputName === 'INDEX') value = 1
      return { type: 'literal', value }
    }

    const makeBlock = (opcode: string): CanonicalBlock => {
      const capability: CanonicalBlockCapability =
        CANONICAL_BLOCK_CAPABILITIES[opcode as keyof typeof CANONICAL_BLOCK_CAPABILITIES]
      const fields = Object.fromEntries(
        Object.entries(capability.fields ?? {}).map(([name, field]) => [
          name,
          name === 'VARIABLE'
            ? 'score'
            : name === 'LIST'
              ? 'items'
              : name === 'BROADCAST_OPTION'
                ? 'finish'
                : name === 'BACKDROP'
                  ? 'platform-day'
                  : name === 'TOUCHINGOBJECTMENU'
                    ? '_mouse_'
                    : name === 'PROPERTY'
                      ? 'x position'
                      : (field.values?.[0] ?? 'fixture'),
        ]),
      )
      const inputs = Object.fromEntries(
        Object.entries(capability.inputs ?? {}).map(([name, input]) => [name, inputValue(opcode, name, input.kind)]),
      )
      return {
        opcode,
        ...(Object.keys(fields).length ? { fields } : {}),
        ...(Object.keys(inputs).length ? { inputs } : {}),
      }
    }

    for (const opcode of CANONICAL_OPCODES) {
      const capability = CANONICAL_BLOCK_CAPABILITIES[opcode]
      const block = makeBlock(opcode)
      const root =
        capability.shape === 'reporter' || capability.shape === 'boolean'
          ? { opcode: 'looks_say', inputs: { MESSAGE: { type: 'block' as const, block } } }
          : block
      const target =
        capability.targets.length === 1 && capability.targets[0] === 'sprite' ? project.sprites[0] : project.stage
      target.scripts.push({ blocks: [root] })
    }

    const compiled = buildScratchProjectJson(project)
    const outputOpcodes = new Set(
      compiled.targets.flatMap((target) => Object.values(target.blocks).map(({ opcode }) => opcode)),
    )
    expect(CANONICAL_OPCODES.filter((opcode) => !outputOpcodes.has(opcode))).toEqual([])

    await new Promise<void>((resolve, reject) => {
      validateProject(JSON.stringify(compiled), false, (error: unknown) =>
        error ? reject(new Error(JSON.stringify(error))) : resolve(),
      )
    })

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      const archive = await saveSb3(vm)
      const reloadedVM = createHeadlessVM()
      try {
        await loadSb3(await archive.arrayBuffer(), reloadedVM)
        const persistedOpcodes = new Set(
          getTargets(reloadedVM).flatMap((target) => getBlocks(target).map(({ opcode }) => opcode)),
        )
        expect(CANONICAL_OPCODES.filter((opcode) => !persistedOpcodes.has(opcode))).toEqual([])
      } finally {
        reloadedVM.quit()
      }
    } finally {
      vm.quit()
    }
  })

  it('executes an event, variable assignment, and arithmetic reporter in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'observedScore', value: 0 })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'score' },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'operator_add',
                  inputs: {
                    NUM1: { type: 'literal', value: 20 },
                    NUM2: { type: 'literal', value: 22 },
                  },
                },
              },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'observedScore' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'data_variable', fields: { VARIABLE: 'score' } } } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 5)
      expect(getVariable(vm, 'Stage', 'score')?.value).toBe(42)
      expect(getVariable(vm, 'Stage', 'observedScore')?.value).toBe(42)
    } finally {
      vm.quit()
    }
  })

  it('executes arithmetic, math, and string reporters in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    const values = [
      { name: 'product', value: 0 },
      { name: 'quotient', value: 0 },
      { name: 'remainder', value: 0 },
      { name: 'rounded', value: 0 },
      { name: 'root', value: 0 },
      { name: 'letter', value: '' },
      { name: 'found', value: false },
      { name: 'foundUnicodeCaseInsensitive', value: false },
      { name: 'foundEmptyNeedle', value: false },
      { name: 'foundNumericString', value: false },
      { name: 'difference', value: 0 },
      { name: 'greater', value: false },
      { name: 'less', value: false },
      { name: 'both', value: false },
      { name: 'either', value: false },
      { name: 'negated', value: false },
      { name: 'randomInteger', value: 0 },
    ]
    project.stage.variables.push(...values)
    const literal = (value: string | number | boolean) => ({ type: 'literal' as const, value })
    const reporter = (
      opcode: string,
      inputs: Record<string, CanonicalInput>,
      fields?: Record<string, string>,
    ): CanonicalInput => ({
      type: 'block' as const,
      block: { opcode, inputs, ...(fields ? { fields } : {}) },
    })
    const assign = (name: string, value: CanonicalInput): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: { VALUE: value },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          assign('product', reporter('operator_multiply', { NUM1: literal(6), NUM2: literal(7) })),
          assign('quotient', reporter('operator_divide', { NUM1: literal(20), NUM2: literal(4) })),
          assign('remainder', reporter('operator_mod', { NUM1: literal(17), NUM2: literal(5) })),
          assign('difference', reporter('operator_subtract', { NUM1: literal(10), NUM2: literal(3) })),
          assign('greater', reporter('operator_gt', { OPERAND1: literal(7), OPERAND2: literal(2) })),
          assign('less', reporter('operator_lt', { OPERAND1: literal(2), OPERAND2: literal(7) })),
          assign('both', reporter('operator_and', { OPERAND1: literal(true), OPERAND2: literal(true) })),
          assign('either', reporter('operator_or', { OPERAND1: literal(false), OPERAND2: literal(true) })),
          assign('negated', reporter('operator_not', { OPERAND: literal(false) })),
          assign('randomInteger', reporter('operator_random', { FROM: literal(4), TO: literal(9) })),
          assign('rounded', reporter('operator_round', { NUM: literal(3.6) })),
          assign('root', reporter('operator_mathop', { NUM: literal(81) }, { OPERATOR: 'sqrt' })),
          assign('letter', reporter('operator_letter_of', { LETTER: literal(3), STRING: literal('Scratch') })),
          assign(
            'found',
            reporter('operator_contains', { STRING1: literal('Scratch Blocks'), STRING2: literal('blocks') }),
          ),
          assign(
            'foundUnicodeCaseInsensitive',
            reporter('operator_contains', { STRING1: literal('ÉCOLE'), STRING2: literal('éco') }),
          ),
          assign(
            'foundEmptyNeedle',
            reporter('operator_contains', { STRING1: literal('Scratch'), STRING2: literal('') }),
          ),
          assign(
            'foundNumericString',
            reporter('operator_contains', { STRING1: literal(2026), STRING2: literal('02') }),
          ),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      expect(getVariable(vm, 'Stage', 'product')?.value).toBe(42)
      expect(getVariable(vm, 'Stage', 'quotient')?.value).toBe(5)
      expect(getVariable(vm, 'Stage', 'remainder')?.value).toBe(2)
      expect(getVariable(vm, 'Stage', 'difference')?.value).toBe(7)
      expect(getVariable(vm, 'Stage', 'greater')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'less')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'both')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'either')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'negated')?.value).toBe(true)
      const randomInteger = getVariable(vm, 'Stage', 'randomInteger')?.value
      expect(randomInteger).toBeGreaterThanOrEqual(4)
      expect(randomInteger).toBeLessThanOrEqual(9)
      expect(Number.isInteger(randomInteger)).toBe(true)
      expect(getVariable(vm, 'Stage', 'rounded')?.value).toBe(4)
      expect(getVariable(vm, 'Stage', 'root')?.value).toBe(9)
      expect(getVariable(vm, 'Stage', 'letter')?.value).toBe('r')
      expect(getVariable(vm, 'Stage', 'found')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'foundUnicodeCaseInsensitive')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'foundEmptyNeedle')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'foundNumericString')?.value).toBe(true)
    } finally {
      vm.quit()
    }
  })

  it('matches Scratch VM edge behavior for division, modulo, reversed random bounds, and Unicode strings', async () => {
    const project = structuredClone(example as CanonicalProject)
    const cases: { name: string; opcode: string; inputs: Record<string, string | number> }[] = [
      { name: 'divideByZero', opcode: 'operator_divide', inputs: { NUM1: 5, NUM2: 0 } },
      { name: 'negativeNumeratorModulo', opcode: 'operator_mod', inputs: { NUM1: -17, NUM2: 5 } },
      { name: 'negativeDivisorModulo', opcode: 'operator_mod', inputs: { NUM1: 17, NUM2: -5 } },
      { name: 'reversedRandomBounds', opcode: 'operator_random', inputs: { FROM: 4, TO: 1 } },
      { name: 'equalRandomBounds', opcode: 'operator_random', inputs: { FROM: 7, TO: 7 } },
      { name: 'negativeHalfRound', opcode: 'operator_round', inputs: { NUM: -1.5 } },
      { name: 'unicodeLength', opcode: 'operator_length', inputs: { STRING: '😀' } },
    ]
    project.stage.variables.push(...cases.map(({ name }) => ({ name, value: 0 })))
    const literal = (value: string | number) => ({ type: 'literal' as const, value })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          ...cases.map(({ name, opcode, inputs }) => ({
            opcode: 'data_setvariableto',
            fields: { VARIABLE: name },
            inputs: {
              VALUE: {
                type: 'block' as const,
                block: {
                  opcode,
                  inputs: Object.fromEntries(
                    Object.keys(inputs).map((inputName) => [inputName, literal(inputs[inputName] ?? '')]),
                  ),
                },
              },
            },
          })),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      expect(getVariable(vm, 'Stage', 'divideByZero')?.value).toBe(Infinity)
      expect(getVariable(vm, 'Stage', 'negativeNumeratorModulo')?.value).toBe(3)
      expect(getVariable(vm, 'Stage', 'negativeDivisorModulo')?.value).toBe(-3)
      const reversedRandom = getVariable(vm, 'Stage', 'reversedRandomBounds')?.value
      expect(reversedRandom).toBeGreaterThanOrEqual(1)
      expect(reversedRandom).toBeLessThanOrEqual(4)
      expect(Number.isInteger(reversedRandom)).toBe(true)
      expect(getVariable(vm, 'Stage', 'equalRandomBounds')?.value).toBe(7)
      expect(getVariable(vm, 'Stage', 'negativeHalfRound')?.value).toBe(-1)
      expect(getVariable(vm, 'Stage', 'unicodeLength')?.value).toBe(2)
    } finally {
      vm.quit()
    }
  })

  it('uses Scratch numeric coercion and case-insensitive string comparison for equality reporters', async () => {
    const project = structuredClone(example as CanonicalProject)
    const cases = [
      { name: 'numericStringEquals', opcode: 'operator_equals', inputs: ['01', 1] },
      { name: 'caseInsensitiveEquals', opcode: 'operator_equals', inputs: ['Scratch', 'scratch'] },
      { name: 'whitespaceDiffersFromZero', opcode: 'operator_equals', inputs: [' ', 0] },
      { name: 'caseInsensitiveOrdering', opcode: 'operator_lt', inputs: ['apple', 'Banana'] },
    ] as const
    project.stage.variables.push(...cases.map(({ name }) => ({ name, value: false })))
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          ...cases.map(({ name, opcode, inputs }) => ({
            opcode: 'data_setvariableto',
            fields: { VARIABLE: name },
            inputs: {
              VALUE: {
                type: 'block' as const,
                block: {
                  opcode,
                  inputs: {
                    OPERAND1: { type: 'literal' as const, value: inputs[0] },
                    OPERAND2: { type: 'literal' as const, value: inputs[1] },
                  },
                },
              },
            },
          })),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      expect(getVariable(vm, 'Stage', 'numericStringEquals')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'caseInsensitiveEquals')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'whitespaceDiffersFromZero')?.value).toBe(false)
      expect(getVariable(vm, 'Stage', 'caseInsensitiveOrdering')?.value).toBe(true)
    } finally {
      vm.quit()
    }
  })

  it('executes every remaining operator math function in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    const cases = [
      { name: 'absolute', operator: 'abs', input: -3.5, expected: 3.5 },
      { name: 'floorValue', operator: 'floor', input: 3.7, expected: 3 },
      { name: 'ceilingValue', operator: 'ceiling', input: 3.2, expected: 4 },
      { name: 'sine', operator: 'sin', input: 30, expected: 0.5 },
      { name: 'cosine', operator: 'cos', input: 60, expected: 0.5 },
      { name: 'tangent', operator: 'tan', input: 45, expected: 1 },
      { name: 'arcSine', operator: 'asin', input: 0.5, expected: 30 },
      { name: 'arcCosine', operator: 'acos', input: 0.5, expected: 60 },
      { name: 'arcTangent', operator: 'atan', input: 1, expected: 45 },
      { name: 'naturalLog', operator: 'ln', input: Math.E, expected: 1 },
      { name: 'baseTenLog', operator: 'log', input: 100, expected: 2 },
      { name: 'exponential', operator: 'e ^', input: 2, expected: Math.E ** 2 },
      { name: 'powerOfTen', operator: '10 ^', input: 2, expected: 100 },
    ]
    project.stage.variables.push(...cases.map(({ name }) => ({ name, value: 0 })))
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          ...cases.map(({ name, operator, input }) => ({
            opcode: 'data_setvariableto',
            fields: { VARIABLE: name },
            inputs: {
              VALUE: {
                type: 'block' as const,
                block: {
                  opcode: 'operator_mathop',
                  fields: { OPERATOR: operator },
                  inputs: { NUM: { type: 'literal' as const, value: input } },
                },
              },
            },
          })),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      for (const { name, expected } of cases) {
        expect(Number(getVariable(vm, 'Stage', name)?.value), name).toBeCloseTo(expected, 8)
      }
    } finally {
      vm.quit()
    }
  })

  it('preserves Scratch VM math function behavior at numeric boundaries', async () => {
    const project = structuredClone(example as CanonicalProject)
    const cases: { name: string; operator: string; input: number; expected: number | 'NaN' | '-0' }[] = [
      { name: 'absoluteNegativeZero', operator: 'abs', input: -0, expected: 0 },
      { name: 'floorNegativeFraction', operator: 'floor', input: -0.2, expected: -1 },
      { name: 'ceilingNegativeFraction', operator: 'ceiling', input: -0.2, expected: '-0' },
      { name: 'sqrtNegative', operator: 'sqrt', input: -1, expected: 'NaN' },
      { name: 'sineHalfTurn', operator: 'sin', input: 180, expected: 0 },
      { name: 'cosineQuarterTurn', operator: 'cos', input: 90, expected: 0 },
      { name: 'tangentQuarterTurn', operator: 'tan', input: 90, expected: Infinity },
      { name: 'arcSineOutsideDomain', operator: 'asin', input: 2, expected: 'NaN' },
      { name: 'arcCosineOutsideDomain', operator: 'acos', input: -2, expected: 'NaN' },
      { name: 'arcTangentLarge', operator: 'atan', input: 1e308, expected: 90 },
      { name: 'naturalLogZero', operator: 'ln', input: 0, expected: -Infinity },
      { name: 'baseTenLogNegative', operator: 'log', input: -1, expected: 'NaN' },
      { name: 'exponentialOverflow', operator: 'e ^', input: 1000, expected: Infinity },
      { name: 'powerOfTenUnderflow', operator: '10 ^', input: -324, expected: 0 },
    ]
    project.stage.variables.push(...cases.map(({ name }) => ({ name, value: 0 })))
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          ...cases.map(({ name, operator, input }) => ({
            opcode: 'data_setvariableto',
            fields: { VARIABLE: name },
            inputs: {
              VALUE: {
                type: 'block' as const,
                block: {
                  opcode: 'operator_mathop',
                  fields: { OPERATOR: operator },
                  inputs: { NUM: { type: 'literal' as const, value: input } },
                },
              },
            },
          })),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      for (const { name, expected } of cases) {
        const actual = Number(getVariable(vm, 'Stage', name)?.value)
        if (expected === 'NaN') expect(actual, name).toBeNaN()
        else if (expected === '-0') expect(actual, name).toBe(-0)
        else expect(actual, name).toBe(expected)
      }
    } finally {
      vm.quit()
    }
  })

  it('executes repeat-until and conditional branches in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    const variable = { type: 'variable' as const, name: 'score' }
    const equalsThree = () => ({
      type: 'block' as const,
      block: {
        opcode: 'operator_equals',
        inputs: { OPERAND1: variable, OPERAND2: { type: 'literal' as const, value: 3 } },
      },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_repeat_until',
            inputs: {
              CONDITION: equalsThree(),
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'score' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          },
          {
            opcode: 'control_if_else',
            inputs: {
              CONDITION: equalsThree(),
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'score' },
                    inputs: { VALUE: { type: 'literal', value: 10 } },
                  },
                ],
              },
              SUBSTACK2: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'score' },
                    inputs: { VALUE: { type: 'literal', value: -10 } },
                  },
                ],
              },
            },
          },
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: { type: 'literal', value: true },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'score' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          },
          {
            opcode: 'control_if',
            inputs: {
              CONDITION: { type: 'literal', value: false },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'score' },
                    inputs: { VALUE: { type: 'literal', value: 100 } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 30)
      expect(getVariable(vm, 'Stage', 'score')?.value).toBe(11)
    } finally {
      vm.quit()
    }
  })

  it('executes list writes and nested text reporters in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.lists = [{ name: 'items', value: [] }]
    project.stage.variables.push({ name: 'listContentsText', value: '' })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_repeat',
            inputs: {
              TIMES: { type: 'literal', value: 2 },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_addtolist',
                    fields: { LIST: 'items' },
                    inputs: { ITEM: { type: 'literal', value: 'coin' } },
                  },
                ],
              },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'score' },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'operator_add',
                  inputs: {
                    NUM1: {
                      type: 'block',
                      block: { opcode: 'data_lengthoflist', fields: { LIST: 'items' } },
                    },
                    NUM2: {
                      type: 'block',
                      block: {
                        opcode: 'operator_length',
                        inputs: {
                          STRING: {
                            type: 'block',
                            block: {
                              opcode: 'operator_join',
                              inputs: {
                                STRING1: { type: 'literal', value: 'cat' },
                                STRING2: { type: 'literal', value: 's' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'listContentsText' },
            inputs: {
              VALUE: { type: 'block', block: { opcode: 'data_listcontents', fields: { LIST: 'items' } } },
            },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 30)
      const result = getProjectJson(vm) as {
        targets: { name: string; lists: Record<string, [string, unknown[]]> }[]
      }
      expect(Object.values(result.targets.find(({ name }) => name === 'Stage')?.lists ?? {})).toContainEqual([
        'items',
        ['coin', 'coin'],
      ])
      expect(getVariable(vm, 'Stage', 'score')?.value).toBe(6)
      expect(getVariable(vm, 'Stage', 'listContentsText')?.value).toBe('coin coin')
    } finally {
      vm.quit()
    }
  })

  it('executes list insert, replace, lookup, delete, and clear operations in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.lists = [{ name: 'items', value: [] }]
    project.stage.variables.push(
      { name: 'middleItem', value: '' },
      { name: 'bIndex', value: 0 },
      { name: 'containsD', value: false },
      { name: 'lengthBeforeClear', value: 0 },
    )
    const literal = (value: string | number) => ({ type: 'literal' as const, value })
    const capture = (name: string, opcode: string, inputs: CanonicalBlock['inputs'] = {}): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: {
        VALUE: {
          type: 'block',
          block: { opcode, fields: { LIST: 'items' }, inputs },
        },
      },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'data_addtolist', fields: { LIST: 'items' }, inputs: { ITEM: literal('a') } },
          { opcode: 'data_addtolist', fields: { LIST: 'items' }, inputs: { ITEM: literal('c') } },
          {
            opcode: 'data_insertatlist',
            fields: { LIST: 'items' },
            inputs: { INDEX: literal(2), ITEM: literal('b') },
          },
          {
            opcode: 'data_replaceitemoflist',
            fields: { LIST: 'items' },
            inputs: { INDEX: literal(3), ITEM: literal('d') },
          },
          capture('middleItem', 'data_itemoflist', { INDEX: literal(2) }),
          capture('bIndex', 'data_itemnumoflist', { ITEM: literal('b') }),
          capture('containsD', 'data_listcontainsitem', { ITEM: literal('d') }),
          capture('lengthBeforeClear', 'data_lengthoflist'),
          { opcode: 'data_deleteoflist', fields: { LIST: 'items' }, inputs: { INDEX: literal(1) } },
          { opcode: 'data_deletealloflist', fields: { LIST: 'items' } },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 40)
      expect(getVariable(vm, 'Stage', 'middleItem')?.value).toBe('b')
      expect(getVariable(vm, 'Stage', 'bIndex')?.value).toBe(2)
      expect(getVariable(vm, 'Stage', 'containsD')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'lengthBeforeClear')?.value).toBe(3)
      const result = getProjectJson(vm) as { targets: { name: string; lists: Record<string, [string, unknown[]]> }[] }
      expect(Object.values(result.targets.find(({ name }) => name === 'Stage')?.lists ?? {})).toContainEqual([
        'items',
        [],
      ])
    } finally {
      vm.quit()
    }
  })

  it('executes a broadcast sender and receiver in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.broadcasts = [{ name: 'finish' }]
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'event_broadcast',
            inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'finish' } },
          },
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'finish' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'score' },
            inputs: { VALUE: { type: 'literal', value: 7 } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      expect(getVariable(vm, 'Stage', 'score')?.value).toBe(7)
    } finally {
      vm.quit()
    }
  })

  it('waits for broadcast receiver scripts before resuming the sender', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.broadcasts = [{ name: 'finish' }]
    project.stage.variables.push(
      { name: 'receiverFinished', value: false },
      { name: 'observedAfterWait', value: false },
    )
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'event_broadcastandwait',
            inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'finish' } },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'observedAfterWait' },
            inputs: { VALUE: { type: 'variable', name: 'receiverFinished' } },
          },
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'finish' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'receiverFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      await runForTicksAsync(vm, 20)
      expect(getVariable(vm, 'Stage', 'receiverFinished')?.value).toBe('true')
      expect(getVariable(vm, 'Stage', 'observedAfterWait')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('executes sprite collision sensing through the renderer adapter', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites = [
      structuredClone((platformer as CanonicalProject).sprites[0]),
      structuredClone((platformer as CanonicalProject).sprites[1]),
    ]
    const player = project.sprites[0]
    const platform = project.sprites[1]
    player.variables.push({ name: 'touchingPlatform', value: false })
    player.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'touchingPlatform' },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'sensing_touchingobject',
                  inputs: { TOUCHINGOBJECTMENU: { type: 'literal', value: platform.name } },
                },
              },
            },
          },
        ],
      },
    ]
    platform.scripts = []

    const touchingCalls: { targetId: number; candidateIds: number[] }[] = []
    const vm = createHeadlessVM(undefined, undefined, undefined, touchingCalls)
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 15)
      expect(getVariable(vm, player.name, 'touchingPlatform')?.value).toBe(true)
      expect(touchingCalls).toHaveLength(1)
      expect(touchingCalls[0].candidateIds).toHaveLength(1)
    } finally {
      vm.quit()
    }
  })

  it('fires the touching-object event hat on the false-to-true contact edge', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites = [
      structuredClone((platformer as CanonicalProject).sprites[0]),
      structuredClone((platformer as CanonicalProject).sprites[1]),
    ]
    const sprite = project.sprites[0]
    const otherSprite = project.sprites[1]
    sprite.variables.push({ name: 'touchingHatFired', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whentouchingobject', fields: { TOUCHINGOBJECTMENU: otherSprite.name } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'touchingHatFired' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]
    otherSprite.scripts = []

    const touchingCalls: { targetId: number; candidateIds: number[] }[] = []
    const vm = createHeadlessVM(undefined, undefined, undefined, touchingCalls)
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      await runForTicksAsync(vm, 20)
      expect(getVariable(vm, sprite.name, 'touchingHatFired')?.value).toBe('true')
      expect(touchingCalls.length).toBeGreaterThan(0)
      expect(touchingCalls.some(({ candidateIds }) => candidateIds.length === 1)).toBe(true)
    } finally {
      vm.quit()
    }
  })

  it('routes touching-color reporters to the renderer with Scratch RGB argument order', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'touchingRed', value: true }, { name: 'greenOnRed', value: false })
    const literal = (value: string) => ({ type: 'literal' as const, value })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'touchingRed' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'sensing_touchingcolor', inputs: { COLOR: literal('#ff0000') } },
              },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'greenOnRed' },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'sensing_coloristouchingcolor',
                  inputs: { COLOR: literal('#ff0000'), COLOR2: literal('#00ff00') },
                },
              },
            },
          },
        ],
      },
    ]

    const colorCalls: { drawableId: number; targetColor: number[]; maskColor?: number[] }[] = []
    const vm = createHeadlessVM(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      colorCalls,
    )
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      await runForTicksAsync(vm, 12)
      expect(getVariable(vm, sprite.name, 'touchingRed')?.value).toBe(false)
      expect(getVariable(vm, sprite.name, 'greenOnRed')?.value).toBe(true)
      expect(colorCalls).toHaveLength(2)
      expect(colorCalls[0].targetColor).toEqual([255, 0, 0])
      expect(colorCalls[1]).toMatchObject({ targetColor: [0, 255, 0], maskColor: [255, 0, 0] })
    } finally {
      vm.quit()
    }
  })

  it('executes clone creation, clone-start hats, and clone deletion in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_create_clone_of',
            inputs: { CLONE_OPTION: { type: 'literal', value: '_myself_' } },
          },
        ],
      },
      {
        blocks: [
          { opcode: 'control_start_as_clone' },
          {
            opcode: 'data_changevariableby',
            fields: { VARIABLE: 'score' },
            inputs: { VALUE: { type: 'literal', value: 1 } },
          },
          { opcode: 'control_delete_this_clone' },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      expect(getVariable(vm, 'Stage', 'score')?.value).toBe(1)
      expect(getTargets(vm).map((target) => target.getName())).toEqual(['Stage', sprite.name])
    } finally {
      vm.quit()
    }
  })

  it('executes sprite position and visibility commands in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'motion_gotoxy',
            inputs: { X: { type: 'literal', value: 40 }, Y: { type: 'literal', value: -20 } },
          },
          { opcode: 'motion_changexby', inputs: { DX: { type: 'literal', value: 2 } } },
          { opcode: 'motion_changeyby', inputs: { DY: { type: 'literal', value: 5 } } },
          { opcode: 'motion_movesteps', inputs: { STEPS: { type: 'literal', value: 10 } } },
          { opcode: 'looks_hide' },
          { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.02 } } },
          { opcode: 'looks_show' },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      const hiddenTargets = getProjectJson(vm) as {
        targets: { name: string; x?: number; y?: number; visible?: boolean }[]
      }
      expect(hiddenTargets.targets.find(({ name }) => name === sprite.name)).toMatchObject({
        x: 52,
        y: -15,
        visible: false,
      })
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      const visibleTargets = getProjectJson(vm) as { targets: { name: string; visible?: boolean }[] }
      expect(visibleTargets.targets.find(({ name }) => name === sprite.name)?.visible).toBe(true)
    } finally {
      vm.quit()
    }
  })

  it('bounces a sprite away from a touched stage edge', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'directionAfterBounce', value: 0 })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'motion_gotoxy',
            inputs: { X: { type: 'literal', value: 220 }, Y: { type: 'literal', value: 0 } },
          },
          { opcode: 'motion_pointindirection', inputs: { DIRECTION: { type: 'literal', value: 90 } } },
          { opcode: 'motion_ifonedgebounce' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'directionAfterBounce' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'motion_direction' } } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM(undefined, undefined, undefined, undefined, undefined, undefined, undefined, () => ({
      left: 182,
      right: 258,
      top: 38,
      bottom: -38,
    }))
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      const direction = getVariable(vm, sprite.name, 'directionAfterBounce')?.value
      expect(direction).not.toBe(90)
      expect(Math.cos(((90 - Number(direction)) * Math.PI) / 180)).toBeLessThan(0)
      const targets = getProjectJson(vm) as { targets: { name: string; x?: number; y?: number }[] }
      expect(targets.targets.find(({ name }) => name === sprite.name)).toMatchObject({ x: 202, y: 0 })
    } finally {
      vm.quit()
    }
  })

  it('moves a sprite to the mouse pointer through the motion goto menu', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'motion_goto', inputs: { TO: { type: 'literal', value: '_mouse_' } } },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as { postIOData(device: string, data: unknown): void }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.postIOData('mouse', {
        x: 300,
        y: 150,
        canvasWidth: 480,
        canvasHeight: 360,
        isDown: false,
      })
      runForTicks(vm, 10)
      const targets = getProjectJson(vm) as { targets: { name: string; x?: number; y?: number }[] }
      expect(targets.targets.find(({ name }) => name === sprite.name)).toMatchObject({ x: 60, y: 30 })
    } finally {
      vm.quit()
    }
  })

  it('glides to another sprite and waits for arrival before resuming', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites = [
      structuredClone((platformer as CanonicalProject).sprites[0]),
      structuredClone((platformer as CanonicalProject).sprites[1]),
    ]
    const sprite = project.sprites[0]
    const targetSprite = project.sprites[1]
    sprite.x = 0
    sprite.y = 0
    targetSprite.x = 30
    targetSprite.y = 40
    sprite.variables.push({ name: 'glideToFinished', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'motion_glideto',
            inputs: {
              SECS: { type: 'literal', value: 0.02 },
              TO: { type: 'literal', value: targetSprite.name },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'glideToFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]
    targetSprite.scripts = []

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'glideToFinished')?.value).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'glideToFinished')?.value).toBe('true')
      const targets = getProjectJson(vm) as { targets: { name: string; x?: number; y?: number }[] }
      expect(targets.targets.find(({ name }) => name === sprite.name)).toMatchObject({ x: 30, y: 40 })
    } finally {
      vm.quit()
    }
  })

  it('points a sprite towards another sprite and reports the computed direction', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites = [
      structuredClone((platformer as CanonicalProject).sprites[0]),
      structuredClone((platformer as CanonicalProject).sprites[1]),
    ]
    const sprite = project.sprites[0]
    const targetSprite = project.sprites[1]
    sprite.x = 0
    sprite.y = 0
    targetSprite.x = 60
    targetSprite.y = 30
    sprite.variables.push({ name: 'pointTowardsDirection', value: 0 })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'motion_pointtowards', inputs: { TOWARDS: { type: 'literal', value: targetSprite.name } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'pointTowardsDirection' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'motion_direction' } } },
          },
        ],
      },
    ]
    targetSprite.scripts = []

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      expect(getVariable(vm, sprite.name, 'pointTowardsDirection')?.value).toBeCloseTo(63.4349, 3)
      const targets = getProjectJson(vm) as { targets: { name: string; direction?: number }[] }
      expect(targets.targets.find(({ name }) => name === sprite.name)?.direction).toBeCloseTo(63.4349, 3)
    } finally {
      vm.quit()
    }
  })

  it('glides to a position over time and resumes only after arrival', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.x = 0
    sprite.y = 0
    sprite.variables.push({ name: 'glideFinished', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'motion_glidesecstoxy',
            inputs: {
              SECS: { type: 'literal', value: 0.02 },
              X: { type: 'literal', value: 30 },
              Y: { type: 'literal', value: 40 },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'glideFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'glideFinished')?.value).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'glideFinished')?.value).toBe('true')
      const targets = getProjectJson(vm) as { targets: { name: string; x?: number; y?: number }[] }
      expect(targets.targets.find(({ name }) => name === sprite.name)).toMatchObject({ x: 30, y: 40 })
    } finally {
      vm.quit()
    }
  })

  it('waits for the requested duration before resuming a Scratch script', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'waitFinished', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.02 } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'waitFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'waitFinished')?.value).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'waitFinished')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('runs all-at-once as a normal substack and preserves inner wait yielding', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'allAtOnceFinished', value: false })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_all_at_once',
            inputs: {
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.02 } } },
                  {
                    opcode: 'data_setvariableto',
                    fields: { VARIABLE: 'allAtOnceFinished' },
                    inputs: { VALUE: { type: 'literal', value: true } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(getVariable(vm, 'Stage', 'allAtOnceFinished')?.value).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, 'Stage', 'allAtOnceFinished')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('waits until a Scratch Boolean condition becomes true before resuming', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'conditionWaitFinished', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_wait_until',
            inputs: {
              CONDITION: { type: 'block', block: { opcode: 'sensing_mousedown' } },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'conditionWaitFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
      postIOData(device: string, data: unknown): void
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'conditionWaitFinished')?.value).toBe(false)
      runtime.postIOData('mouse', {
        x: 240,
        y: 180,
        canvasWidth: 480,
        canvasHeight: 360,
        isDown: true,
      })
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'conditionWaitFinished')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('repeats a Scratch while substack until its condition becomes false', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'whileIterations', value: 0 }, { name: 'whileFinished', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_while',
            inputs: {
              CONDITION: { type: 'block', block: { opcode: 'sensing_mousedown' } },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'whileIterations' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'whileFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
      postIOData(device: string, data: unknown): void
    }
    const mouseData = (isDown: boolean) => ({
      x: 240,
      y: 180,
      canvasWidth: 480,
      canvasHeight: 360,
      isDown,
    })
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.postIOData('mouse', mouseData(true))
      for (let tick = 0; tick < 6; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'whileIterations')?.value).toBeGreaterThan(0)
      expect(getVariable(vm, sprite.name, 'whileFinished')?.value).toBe(false)
      runtime.postIOData('mouse', mouseData(false))
      for (let tick = 0; tick < 6; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'whileFinished')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('stops the current Scratch script before its next block', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'afterStop', value: false })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'control_stop', fields: { STOP_OPTION: 'this script' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'afterStop' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      expect(getVariable(vm, 'Stage', 'afterStop')?.value).toBe(false)
    } finally {
      vm.quit()
    }
  })

  it('stops every running Scratch script for the all option', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'afterStopAll', value: false })
    project.stage.scripts = [
      { blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'control_stop', fields: { STOP_OPTION: 'all' } }] },
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.02 } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'afterStopAll' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 2)
      await new Promise((resolve) => setTimeout(resolve, 30))
      runForTicks(vm, 8)
      expect(getVariable(vm, 'Stage', 'afterStopAll')?.value).toBe(false)
    } finally {
      vm.quit()
    }
  })

  it('stops only sibling scripts on the same sprite for other-scripts option', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'stopSiblingContinued', value: false }, { name: 'siblingWasStopped', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'control_stop', fields: { STOP_OPTION: 'other scripts in sprite' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'stopSiblingContinued' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'siblingWasStopped' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 12)
      expect(getVariable(vm, sprite.name, 'stopSiblingContinued')?.value).toBe('true')
      expect(getVariable(vm, sprite.name, 'siblingWasStopped')?.value).toBe(false)
    } finally {
      vm.quit()
    }
  })

  it('runs the Scratch for-each substack once per requested iteration', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'forEachIterations', value: 0 })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_for_each',
            fields: { VARIABLE: 'item' },
            inputs: {
              VALUE: { type: 'literal', value: 3 },
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'forEachIterations' },
                    inputs: { VALUE: { type: 'literal', value: 1 } },
                  },
                ],
              },
            },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      expect(getVariable(vm, 'Stage', 'forEachIterations')?.value).toBe(3)
    } finally {
      vm.quit()
    }
  })

  it('executes sprite rotation commands and reports the resulting motion state', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push(
      { name: 'observedX', value: 0 },
      { name: 'observedY', value: 0 },
      { name: 'observedDirection', value: 0 },
    )
    const literal = (value: number) => ({ type: 'literal' as const, value })
    const capture = (name: string, opcode: string): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: { VALUE: { type: 'block', block: { opcode } } },
    })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'motion_setx', inputs: { X: literal(40) } },
          { opcode: 'motion_sety', inputs: { Y: literal(-20) } },
          { opcode: 'motion_pointindirection', inputs: { DIRECTION: literal(30) } },
          { opcode: 'motion_turnright', inputs: { DEGREES: literal(15) } },
          { opcode: 'motion_turnleft', inputs: { DEGREES: literal(30) } },
          { opcode: 'motion_setrotationstyle', fields: { STYLE: 'left-right' } },
          capture('observedX', 'motion_xposition'),
          capture('observedY', 'motion_yposition'),
          capture('observedDirection', 'motion_direction'),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 30)
      expect(getVariable(vm, sprite.name, 'observedX')?.value).toBe(40)
      expect(getVariable(vm, sprite.name, 'observedY')?.value).toBe(-20)
      expect(getVariable(vm, sprite.name, 'observedDirection')?.value).toBe(15)
      const targets = getProjectJson(vm) as {
        targets: { name: string; x?: number; y?: number; direction?: number; rotationStyle?: string }[]
      }
      expect(targets.targets.find(({ name }) => name === sprite.name)).toMatchObject({
        x: 40,
        y: -20,
        direction: 15,
        rotationStyle: 'left-right',
      })
    } finally {
      vm.quit()
    }
  })

  it('executes graphic effects and clears them through the renderer adapter', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    const effectNames = ['color', 'fisheye', 'whirl', 'pixelate', 'mosaic', 'brightness', 'ghost']
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          ...effectNames.flatMap((effect): CanonicalBlock[] => [
            {
              opcode: 'looks_seteffectto',
              fields: { EFFECT: effect },
              inputs: { VALUE: { type: 'literal', value: 25 } },
            },
            {
              opcode: 'looks_changeeffectby',
              fields: { EFFECT: effect },
              inputs: { CHANGE: { type: 'literal', value: 10 } },
            },
          ]),
          { opcode: 'looks_cleargraphiceffects' },
        ],
      },
    ]

    const effects: { name: string; value: number }[] = []
    const vm = createHeadlessVM(undefined, effects)
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      for (const name of effectNames) {
        expect(
          effects
            .filter((effect) => effect.name === name)
            .map(({ value }) => value)
            .slice(-3),
          name,
        ).toEqual([25, 35, 0])
      }
    } finally {
      vm.quit()
    }
  })

  it('executes front/back and relative layer commands through the renderer adapter', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'looks_gotofrontback', fields: { FRONT_BACK: 'front' } },
          {
            opcode: 'looks_goforwardbackwardlayers',
            fields: { FORWARD_BACKWARD: 'forward' },
            inputs: { NUM: { type: 'literal', value: 2 } },
          },
          {
            opcode: 'looks_goforwardbackwardlayers',
            fields: { FORWARD_BACKWARD: 'backward' },
            inputs: { NUM: { type: 'literal', value: 1 } },
          },
        ],
      },
    ]

    const layerOrders: { order: number; isRelative?: boolean }[] = []
    const vm = createHeadlessVM(undefined, undefined, layerOrders)
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 20)
      expect(layerOrders.slice(-3)).toEqual([
        { order: Infinity, isRelative: undefined },
        { order: 2, isRelative: true },
        { order: -1, isRelative: true },
      ])
    } finally {
      vm.quit()
    }
  })

  it('executes timer reset and timer reporter in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'elapsedAfterReset', value: 0 })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'sensing_resettimer' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'elapsedAfterReset' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'sensing_timer' } } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      await runForTicksAsync(vm, 10)
      const elapsed = getVariable(vm, 'Stage', 'elapsedAfterReset')?.value
      expect(typeof elapsed).toBe('number')
      expect(elapsed).toBeGreaterThanOrEqual(0)
      expect(elapsed).toBeLessThan(1)
    } finally {
      vm.quit()
    }
  })

  it('fires the timer greater-than event hat only after its threshold is crossed', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'timerHatFired', value: false })
    project.stage.scripts = [
      {
        blocks: [
          {
            opcode: 'event_whengreaterthan',
            fields: { WHENGREATERTHANMENU: 'TIMER' },
            inputs: { VALUE: { type: 'literal', value: 5 } },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'timerHatFired' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    let projectSeconds = 0
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void; ioDevices: { clock: { projectTimer(): number } } }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.runtime.ioDevices.clock.projectTimer = () => projectSeconds
      runtime.start()
      runtime.greenFlag()
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, 'Stage', 'timerHatFired')?.value).toBe(false)
      projectSeconds = 6
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, 'Stage', 'timerHatFired')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('fires keyboard hats and reads pressed/any-key state through the Scratch keyboard I/O device', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push(
      { name: 'spacePressed', value: false },
      { name: 'anyPressed', value: false },
      { name: 'spaceHatFired', value: false },
    )
    const captureKeyState = (name: string, key: string): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: {
        VALUE: { type: 'block', block: { opcode: 'sensing_keypressed', fields: { KEY_OPTION: key } } },
      },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_forever',
            inputs: {
              SUBSTACK: {
                type: 'stack',
                blocks: [captureKeyState('spacePressed', 'space'), captureKeyState('anyPressed', 'any')],
              },
            },
          },
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: 'space' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'spaceHatFired' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    const stepRuntime = (ticks: number): void => {
      for (let tick = 0; tick < ticks; tick += 1) runtime.runtime._step()
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      ;(vm as unknown as { postIOData(device: string, data: unknown): void }).postIOData('keyboard', {
        key: ' ',
        isDown: true,
      })
      stepRuntime(10)
      expect(getVariable(vm, 'Stage', 'spacePressed')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'anyPressed')?.value).toBe(true)
      expect(getVariable(vm, 'Stage', 'spaceHatFired')?.value).toBe('true')
      ;(vm as unknown as { postIOData(device: string, data: unknown): void }).postIOData('keyboard', {
        key: ' ',
        isDown: false,
      })
      stepRuntime(10)
      expect(getVariable(vm, 'Stage', 'spacePressed')?.value).toBe(false)
      expect(getVariable(vm, 'Stage', 'anyPressed')?.value).toBe(false)
    } finally {
      vm.quit()
    }
  })

  it('reads mouse coordinates and button state through the Scratch mouse I/O device', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push(
      { name: 'mouseXValue', value: 0 },
      { name: 'mouseYValue', value: 0 },
      { name: 'mouseDownValue', value: false },
    )
    const captureMouseValue = (name: string, opcode: string): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: { VALUE: { type: 'block', block: { opcode } } },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          captureMouseValue('mouseXValue', 'sensing_mousex'),
          captureMouseValue('mouseYValue', 'sensing_mousey'),
          captureMouseValue('mouseDownValue', 'sensing_mousedown'),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      ;(vm as unknown as { postIOData(device: string, data: unknown): void }).postIOData('mouse', {
        x: 300,
        y: 150,
        canvasWidth: 480,
        canvasHeight: 360,
        isDown: true,
      })
      runForTicks(vm, 10)
      expect(getVariable(vm, 'Stage', 'mouseXValue')?.value).toBe(60)
      expect(getVariable(vm, 'Stage', 'mouseYValue')?.value).toBe(30)
      expect(getVariable(vm, 'Stage', 'mouseDownValue')?.value).toBe(true)
    } finally {
      vm.quit()
    }
  })

  it('fires the Stage-click hat when the renderer picks the stage', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'stageClickFired', value: false })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenstageclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'stageClickFired' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
      postIOData(device: string, data: unknown): void
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.postIOData('mouse', {
        x: 240,
        y: 180,
        canvasWidth: 480,
        canvasHeight: 360,
        isDown: true,
      })
      for (let tick = 0; tick < 10; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, 'Stage', 'stageClickFired')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('fires the sprite-click hat when the renderer picks a sprite drawable', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'spriteClickFired', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenthisspriteclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'spriteClickFired' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    let pickedDrawable = -1
    const vm = createHeadlessVM(undefined, undefined, undefined, undefined, undefined, () => pickedDrawable)
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: {
        _step(): void
        targets: { getName(): string; drawableID?: number }[]
      }
      postIOData(device: string, data: unknown): void
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      const target = runtime.runtime.targets.find((candidate) => candidate.getName() === sprite.name)
      if (!target || typeof target.drawableID !== 'number') throw new Error(`Missing drawable for ${sprite.name}`)
      pickedDrawable = target.drawableID
      runtime.start()
      runtime.greenFlag()
      runtime.postIOData('mouse', {
        x: 240,
        y: 180,
        canvasWidth: 480,
        canvasHeight: 360,
        isDown: true,
      })
      for (let tick = 0; tick < 10; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'spriteClickFired')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('changes sprite drag mode and serializes each resulting state', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'sensing_setdragmode', fields: { DRAG_MODE: 'draggable' } },
          { opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.02 } } },
          { opcode: 'sensing_setdragmode', fields: { DRAG_MODE: 'not draggable' } },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    const draggableState = () => {
      const projectJson = getProjectJson(vm) as { targets: { name: string; draggable?: boolean }[] }
      return projectJson.targets.find(({ name }) => name === sprite.name)?.draggable
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(draggableState()).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(draggableState()).toBe(false)
    } finally {
      vm.quit()
    }
  })

  it('reports distance to another sprite and the mouse pointer', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites = [
      structuredClone((platformer as CanonicalProject).sprites[0]),
      structuredClone((platformer as CanonicalProject).sprites[1]),
    ]
    const player = project.sprites[0]
    const platform = project.sprites[1]
    player.x = 0
    player.y = 0
    player.variables.push({ name: 'distanceToPlatform', value: 0 }, { name: 'distanceToMouse', value: 0 })
    player.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'distanceToPlatform' },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'sensing_distanceto',
                  inputs: { DISTANCETOMENU: { type: 'literal', value: platform.name } },
                },
              },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'distanceToMouse' },
            inputs: {
              VALUE: {
                type: 'block',
                block: {
                  opcode: 'sensing_distanceto',
                  inputs: { DISTANCETOMENU: { type: 'literal', value: '_mouse_' } },
                },
              },
            },
          },
        ],
      },
    ]
    platform.x = 3
    platform.y = 4
    platform.scripts = []

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      ;(vm as unknown as { postIOData(device: string, data: unknown): void }).postIOData('mouse', {
        x: 246,
        y: 172,
        canvasWidth: 480,
        canvasHeight: 360,
      })
      runForTicks(vm, 10)
      expect(getVariable(vm, player.name, 'distanceToPlatform')?.value).toBe(5)
      expect(getVariable(vm, player.name, 'distanceToMouse')?.value).toBe(10)
    } finally {
      vm.quit()
    }
  })

  it('reads the current username from Scratch user-data I/O', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'observedUsername', value: '' })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'observedUsername' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'sensing_username' } } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      ;(vm as unknown as { postIOData(device: string, data: unknown): void }).postIOData('userData', {
        username: 'ScratchStudent',
      })
      runForTicks(vm, 10)
      expect(getVariable(vm, 'Stage', 'observedUsername')?.value).toBe('ScratchStudent')
    } finally {
      vm.quit()
    }
  })

  it('reads sprite and Stage attributes and target variables through the sensing-of reporter', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.x = 37
    sprite.y = -22
    sprite.size = 135
    sprite.scripts = []
    const velocity = sprite.variables.find(({ name }) => name === 'y velocity')
    if (!velocity) throw new Error('Platformer fixture has no y velocity variable')
    velocity.value = 4
    project.stage.costumes = structuredClone(sprite.costumes)
    project.stage.currentCostume = 0
    project.stage.volume = 72
    project.stage.variables.push(
      { name: 'playerX', value: 0 },
      { name: 'playerSize', value: 0 },
      { name: 'playerVelocity', value: 0 },
      { name: 'stageVolume', value: 0 },
      { name: 'backdropNumber', value: 0 },
      { name: 'backdropName', value: '' },
    )
    const captureAttribute = (name: string, property: string, object = sprite.name): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: {
        VALUE: {
          type: 'block',
          block: {
            opcode: 'sensing_of',
            fields: { PROPERTY: property },
            inputs: { OBJECT: { type: 'literal', value: object } },
          },
        },
      },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          captureAttribute('playerX', 'x position'),
          captureAttribute('playerSize', 'size'),
          captureAttribute('playerVelocity', 'y velocity'),
          captureAttribute('stageVolume', 'volume', '_stage_'),
          captureAttribute('backdropNumber', 'backdrop #', '_stage_'),
          captureAttribute('backdropName', 'backdrop name', '_stage_'),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      expect(getVariable(vm, 'Stage', 'playerX')?.value).toBe(37)
      expect(getVariable(vm, 'Stage', 'playerSize')?.value).toBe(135)
      expect(getVariable(vm, 'Stage', 'playerVelocity')?.value).toBe(4)
      expect(getVariable(vm, 'Stage', 'stageVolume')?.value).toBe(72)
      expect(getVariable(vm, 'Stage', 'backdropNumber')?.value).toBe(1)
      expect(getVariable(vm, 'Stage', 'backdropName')?.value).toBe(sprite.costumes[0].name)
    } finally {
      vm.quit()
    }
  })

  it('waits for a Scratch answer before reading the answer reporter', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'studentAnswer', value: '' })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'sensing_askandwait', inputs: { QUESTION: { type: 'literal', value: 'What is your name?' } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'studentAnswer' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'sensing_answer' } } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: {
        _step(): void
        emit(event: string, value: unknown): void
        on(event: string, listener: (value: unknown) => void): void
      }
    }
    const questions: unknown[] = []
    runtime.runtime.on('QUESTION', (question) => questions.push(question))
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      for (let tick = 0; tick < 10; tick += 1) {
        runtime.runtime._step()
        await Promise.resolve()
      }
      expect(questions).toContain('What is your name?')
      expect(getVariable(vm, 'Stage', 'studentAnswer')?.value).toBe('')
      runtime.runtime.emit('ANSWER', 'Ada')
      for (let tick = 0; tick < 10; tick += 1) {
        runtime.runtime._step()
        await Promise.resolve()
      }
      expect(getVariable(vm, 'Stage', 'studentAnswer')?.value).toBe('Ada')
    } finally {
      vm.quit()
    }
  })

  it('switches Stage backdrops and reads the resulting backdrop name and number', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const costumes = structuredClone(project.sprites[0].costumes[0])
    project.stage.costumes = [
      costumes,
      { ...structuredClone(costumes), name: 'night backdrop' },
      { ...structuredClone(costumes), name: 'morning backdrop' },
    ]
    project.stage.currentCostume = 0
    project.stage.variables.push(
      { name: 'backdropNameAfterNamedSwitch', value: '' },
      { name: 'backdropNameAfterNext', value: '' },
      { name: 'backdropNumberAfterNext', value: 0 },
      { name: 'backdropHatFired', value: false },
    )
    const captureBackdrop = (name: string, mode: 'name' | 'number'): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: {
        VALUE: {
          type: 'block',
          block: { opcode: 'looks_backdropnumbername', fields: { NUMBER_NAME: mode } },
        },
      },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'looks_switchbackdropto',
            inputs: { BACKDROP: { type: 'literal', value: 'night backdrop' } },
          },
          captureBackdrop('backdropNameAfterNamedSwitch', 'name'),
          { opcode: 'looks_nextbackdrop' },
          captureBackdrop('backdropNameAfterNext', 'name'),
          captureBackdrop('backdropNumberAfterNext', 'number'),
        ],
      },
      {
        blocks: [
          { opcode: 'event_whenbackdropswitchesto', fields: { BACKDROP: 'night backdrop' } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'backdropHatFired' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      const targets = getProjectJson(vm) as { targets: { name: string; currentCostume?: number }[] }
      expect(targets.targets.find(({ name }) => name === 'Stage')?.currentCostume).toBe(2)
      expect(getVariable(vm, 'Stage', 'backdropNameAfterNamedSwitch')?.value).toBe('night backdrop')
      expect(getVariable(vm, 'Stage', 'backdropNameAfterNext')?.value).toBe('morning backdrop')
      expect(getVariable(vm, 'Stage', 'backdropNumberAfterNext')?.value).toBe(3)
      expect(getVariable(vm, 'Stage', 'backdropHatFired')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('handles backdrop-and-wait when the runtime has no registered backdrop hat', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const backdropName = 'event backdrop'
    project.stage.costumes = [{ ...structuredClone(project.sprites[0].costumes[0]), name: backdropName }]
    project.stage.variables.push({ name: 'resumedAfterBackdropWait', value: false })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'looks_switchbackdroptoandwait',
            inputs: { BACKDROP: { type: 'literal', value: backdropName } },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'resumedAfterBackdropWait' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      delete (vm as unknown as { runtime: { _hats: Record<string, unknown> } }).runtime._hats
        .event_whenbackdropswitchesto
      await runForTicksAsync(vm, 20)
      expect(getVariable(vm, 'Stage', 'resumedAfterBackdropWait')?.value).toBe('true')
      const targets = getProjectJson(vm) as { targets: { name: string; currentCostume?: number }[] }
      expect(targets.targets.find(({ name }) => name === 'Stage')?.currentCostume).toBe(0)
    } finally {
      vm.quit()
    }
  })

  it('executes variable and list monitor show/hide commands in Scratch VM', async () => {
    const runVisibilityCase = async (
      opcodes: readonly [string, string],
      initialVisible: boolean,
    ): Promise<boolean[]> => {
      const project = structuredClone(example as CanonicalProject)
      project.stage.lists.push({ name: 'items', value: ['first'] })
      project.stage.scripts = [
        {
          blocks: [
            { opcode: 'event_whenflagclicked' },
            {
              opcode: opcodes[0],
              fields: {
                [opcodes[0].includes('variable') ? 'VARIABLE' : 'LIST']: opcodes[0].includes('variable')
                  ? 'score'
                  : 'items',
              },
            },
            {
              opcode: opcodes[1],
              fields: {
                [opcodes[1].includes('variable') ? 'VARIABLE' : 'LIST']: opcodes[1].includes('variable')
                  ? 'score'
                  : 'items',
              },
            },
          ],
        },
      ]
      project.monitors = [
        {
          id: 'score-monitor',
          opcode: 'data_variable',
          params: { VARIABLE: 'score' },
          spriteName: null,
          mode: 'default',
          value: 0,
          visible: initialVisible,
        },
        {
          id: 'items-monitor',
          opcode: 'data_listcontents',
          params: { LIST: 'items' },
          spriteName: null,
          mode: 'list',
          value: ['first'],
          visible: initialVisible,
        },
      ]

      const vm = createHeadlessVM()
      try {
        await loadSb3(await buildScratchProjectArchive(project), vm)
        const runtime = (
          vm as unknown as {
            runtime: {
              getMonitorState: () => {
                toJS: () => Record<string, { opcode: string; params: Record<string, unknown>; visible: boolean }>
              }
              monitorBlocks: { createBlock: (block: Record<string, unknown>) => void }
            }
          }
        ).runtime
        for (const [id, monitor] of Object.entries(runtime.getMonitorState().toJS())) {
          runtime.monitorBlocks.createBlock({
            id,
            opcode: monitor.opcode,
            fields: Object.fromEntries(
              Object.entries(monitor.params).map(([name, value]) => [name, { name, value, id }]),
            ),
            inputs: {},
            next: null,
            parent: null,
            shadow: false,
            topLevel: true,
            isMonitored: initialVisible,
          })
        }
        await runForTicksAsync(vm, 8)
        return Object.values(runtime.getMonitorState().toJS()).map(({ visible }) => visible)
      } finally {
        vm.quit()
      }
    }

    expect(await runVisibilityCase(['data_showvariable', 'data_showlist'], false)).toEqual([true, true])
    expect(await runVisibilityCase(['data_hidevariable', 'data_hidelist'], true)).toEqual([false, false])
  })

  it('executes calendar and audio-level sensing reporters in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push(
      { name: 'observedYear', value: 0 },
      { name: 'observedMonth', value: 0 },
      { name: 'observedDate', value: 0 },
      { name: 'observedDayOfWeek', value: 0 },
      { name: 'observedHour', value: 0 },
      { name: 'observedMinute', value: 0 },
      { name: 'observedSecond', value: 0 },
      { name: 'daysFrom2000', value: 0 },
      { name: 'observedLoudness', value: 0 },
      { name: 'isLoud', value: true },
      { name: 'online', value: false },
    )
    const capture = (name: string, reporter: CanonicalBlock): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: { VALUE: { type: 'block', block: reporter } },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          capture('observedYear', { opcode: 'sensing_current', fields: { CURRENTMENU: 'year' } }),
          capture('observedMonth', { opcode: 'sensing_current', fields: { CURRENTMENU: 'month' } }),
          capture('observedDate', { opcode: 'sensing_current', fields: { CURRENTMENU: 'date' } }),
          capture('observedDayOfWeek', { opcode: 'sensing_current', fields: { CURRENTMENU: 'dayofweek' } }),
          capture('observedHour', { opcode: 'sensing_current', fields: { CURRENTMENU: 'hour' } }),
          capture('observedMinute', { opcode: 'sensing_current', fields: { CURRENTMENU: 'minute' } }),
          capture('observedSecond', { opcode: 'sensing_current', fields: { CURRENTMENU: 'second' } }),
          capture('daysFrom2000', { opcode: 'sensing_dayssince2000' }),
          capture('observedLoudness', { opcode: 'sensing_loudness' }),
          capture('isLoud', { opcode: 'sensing_loud' }),
          capture('online', { opcode: 'sensing_online' }),
        ],
      },
    ]

    const vm = createHeadlessVM()
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const fixedDate = new Date(2024, 1, 29, 23, 58, 57)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { navigator: { onLine: true } } })
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      vi.useFakeTimers()
      vi.setSystemTime(fixedDate)
      runForTicks(vm, 12)
      expect(getVariable(vm, 'Stage', 'observedYear')?.value).toBe(fixedDate.getFullYear())
      expect(getVariable(vm, 'Stage', 'observedMonth')?.value).toBe(fixedDate.getMonth() + 1)
      expect(getVariable(vm, 'Stage', 'observedDate')?.value).toBe(fixedDate.getDate())
      expect(getVariable(vm, 'Stage', 'observedDayOfWeek')?.value).toBe(fixedDate.getDay() + 1)
      expect(getVariable(vm, 'Stage', 'observedHour')?.value).toBe(fixedDate.getHours())
      expect(getVariable(vm, 'Stage', 'observedMinute')?.value).toBe(fixedDate.getMinutes())
      expect(getVariable(vm, 'Stage', 'observedSecond')?.value).toBe(fixedDate.getSeconds())
      const daysFrom2000 =
        (fixedDate.valueOf() - new Date(2000, 0, 1).valueOf() + new Date(2000, 0, 1).getTimezoneOffset() * 60_000) /
        (24 * 60 * 60 * 1000)
      expect(Number(getVariable(vm, 'Stage', 'daysFrom2000')?.value)).toBeCloseTo(daysFrom2000, 8)
      expect(getVariable(vm, 'Stage', 'observedLoudness')?.value).toBe(-1)
      expect(getVariable(vm, 'Stage', 'isLoud')?.value).toBe(false)
      expect(getVariable(vm, 'Stage', 'online')?.value).toBe(true)
    } finally {
      vm.quit()
      vi.useRealTimers()
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })

  it('executes Scratch VM control counter increment, read, and clear commands', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'counterBeforeClear', value: 0 }, { name: 'counterAfterClear', value: 0 })
    const captureCounter = (name: string): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: { VALUE: { type: 'block', block: { opcode: 'control_get_counter' } } },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'control_clear_counter' },
          { opcode: 'control_incr_counter' },
          captureCounter('counterBeforeClear'),
          { opcode: 'control_clear_counter' },
          captureCounter('counterAfterClear'),
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 15)
      expect(getVariable(vm, 'Stage', 'counterBeforeClear')?.value).toBe(1)
      expect(getVariable(vm, 'Stage', 'counterAfterClear')?.value).toBe(0)
    } finally {
      vm.quit()
    }
  })

  it('executes costume changes, costume name reporter, and size changes in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'observedCostumeName', value: '' }, { name: 'observedSize', value: 0 })
    const firstCostume = sprite.costumes[0]
    sprite.costumes = [firstCostume, { ...structuredClone(firstCostume), name: 'second costume' }]
    sprite.currentCostume = 0
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'looks_nextcostume' },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'observedCostumeName' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'looks_costumenumbername', fields: { NUMBER_NAME: 'name' } },
              },
            },
          },
          {
            opcode: 'looks_switchcostumeto',
            inputs: { COSTUME: { type: 'literal', value: firstCostume.name } },
          },
          { opcode: 'looks_setsizeto', inputs: { SIZE: { type: 'literal', value: 125 } } },
          { opcode: 'looks_changesizeby', inputs: { CHANGE: { type: 'literal', value: 25 } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'observedSize' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'looks_size' } } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      const targets = getProjectJson(vm) as { targets: { name: string; currentCostume?: number; size?: number }[] }
      expect(targets.targets.find(({ name }) => name === sprite.name)).toMatchObject({ currentCostume: 0, size: 150 })
      expect(getVariable(vm, sprite.name, 'observedCostumeName')?.value).toBe('second costume')
      expect(getVariable(vm, sprite.name, 'observedSize')?.value).toBe(150)
    } finally {
      vm.quit()
    }
  })

  it('emits say and think text events for Scratch target bubbles', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'Hello from Scratch' } } },
          { opcode: 'looks_think', inputs: { MESSAGE: { type: 'literal', value: 'Thinking now' } } },
        ],
      },
    ]

    const bubbleCalls: { type: string; text: string }[] = []
    const vm = createHeadlessVM(undefined, undefined, undefined, undefined, bubbleCalls)
    const bubbleEvents: { target: string; type: string; text: string }[] = []
    const runtime = (
      vm as unknown as {
        runtime: {
          on(event: string, listener: (target: { getName(): string }, type: string, text: string) => void): void
        }
      }
    ).runtime
    runtime.on('SAY', (target, type, text) => bubbleEvents.push({ target: target.getName(), type, text }))
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 10)
      expect(bubbleEvents).toEqual([
        { target: sprite.name, type: 'say', text: 'Hello from Scratch' },
        { target: sprite.name, type: 'think', text: 'Thinking now' },
      ])
      expect(bubbleCalls).toEqual([
        { type: 'say', text: 'Hello from Scratch' },
        { type: 'think', text: 'Thinking now' },
      ])
    } finally {
      vm.quit()
    }
  })

  it('clears a timed say bubble and resumes its Scratch script after the duration', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'timedSayFinished', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'looks_sayforsecs',
            inputs: {
              MESSAGE: { type: 'literal', value: 'Temporary message' },
              SECS: { type: 'literal', value: 0.02 },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'timedSayFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const bubbleCalls: { type: string; text: string }[] = []
    const destroyedDrawableCalls: number[] = []
    const vm = createHeadlessVM(
      undefined,
      undefined,
      undefined,
      undefined,
      bubbleCalls,
      undefined,
      destroyedDrawableCalls,
    )
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'timedSayFinished')?.value).toBe(false)
      expect(bubbleCalls).toContainEqual({ type: 'say', text: 'Temporary message' })
      const destroyedBeforeTimeout = destroyedDrawableCalls.length
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'timedSayFinished')?.value).toBe('true')
      expect(destroyedDrawableCalls.length).toBeGreaterThan(destroyedBeforeTimeout)
    } finally {
      vm.quit()
    }
  })

  it('clears a timed think bubble and resumes its Scratch script after the duration', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'timedThinkFinished', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'looks_thinkforsecs',
            inputs: {
              MESSAGE: { type: 'literal', value: 'Temporary thought' },
              SECS: { type: 'literal', value: 0.02 },
            },
          },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'timedThinkFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const bubbleCalls: { type: string; text: string }[] = []
    const destroyedDrawableCalls: number[] = []
    const vm = createHeadlessVM(
      undefined,
      undefined,
      undefined,
      undefined,
      bubbleCalls,
      undefined,
      destroyedDrawableCalls,
    )
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'timedThinkFinished')?.value).toBe(false)
      expect(bubbleCalls).toContainEqual({ type: 'think', text: 'Temporary thought' })
      const destroyedBeforeTimeout = destroyedDrawableCalls.length
      await new Promise((resolve) => setTimeout(resolve, 30))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(getVariable(vm, sprite.name, 'timedThinkFinished')?.value).toBe('true')
      expect(destroyedDrawableCalls.length).toBeGreaterThan(destroyedBeforeTimeout)
    } finally {
      vm.quit()
    }
  })

  it('executes sound volume commands and reporter in Scratch VM', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.variables.push({ name: 'observedVolume', value: 0 })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'sound_setvolumeto', inputs: { VOLUME: { type: 'literal', value: 80 } } },
          { opcode: 'sound_changevolumeby', inputs: { VOLUME: { type: 'literal', value: -15 } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'observedVolume' },
            inputs: { VALUE: { type: 'block', block: { opcode: 'sound_volume' } } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      await runForTicksAsync(vm, 15)
      const targets = getProjectJson(vm) as { targets: { name: string; volume?: number }[] }
      expect(targets.targets.find(({ name }) => name === sprite.name)?.volume).toBe(65)
      expect(getVariable(vm, sprite.name, 'observedVolume')?.value).toBe(65)
    } finally {
      vm.quit()
    }
  })

  it('clamps and clears pitch/pan sound effects through the target sound bank', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'sound_seteffectto',
            fields: { EFFECT: 'pitch' },
            inputs: { VALUE: { type: 'literal', value: 500 } },
          },
          {
            opcode: 'sound_changeeffectby',
            fields: { EFFECT: 'pitch' },
            inputs: { VALUE: { type: 'literal', value: -30 } },
          },
          {
            opcode: 'sound_seteffectto',
            fields: { EFFECT: 'pan' },
            inputs: { VALUE: { type: 'literal', value: -120 } },
          },
          { opcode: 'sound_cleareffects' },
        ],
      },
    ]

    const effectSnapshots: { pitch: number; pan: number }[] = []
    const vm = createHeadlessVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: {
        _step(): void
        targets: {
          getName(): string
          sprite: {
            soundBank?: {
              setEffects(target: { soundEffects: { pitch: number; pan: number } }): void
              stopAllSounds(): void
            }
          }
        }[]
      }
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      const target = runtime.runtime.targets.find((candidate) => candidate.getName() === sprite.name)
      if (!target) throw new Error(`Missing VM target ${sprite.name}`)
      target.sprite.soundBank = {
        setEffects: (soundTarget) => effectSnapshots.push({ ...soundTarget.soundEffects }),
        stopAllSounds: () => undefined,
      }
      runtime.start()
      runtime.greenFlag()
      for (let tick = 0; tick < 12; tick += 1) {
        runtime.runtime._step()
        await Promise.resolve()
      }
      expect(effectSnapshots.slice(-4)).toEqual([
        { pitch: 360, pan: 0 },
        { pitch: 330, pan: 0 },
        { pitch: 330, pan: -100 },
        { pitch: 0, pan: 0 },
      ])
    } finally {
      vm.quit()
    }
  })

  it('routes sound play and stop-all commands to the target sound bank', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.sounds = [{ name: 'beep', dataFormat: 'wav' }]
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'sound_play', inputs: { SOUND_MENU: { type: 'literal', value: 'beep' } } },
          { opcode: 'sound_stopallsounds' },
        ],
      },
    ]

    const vm = createHeadlessVM()
    const soundCalls: { kind: 'play' | 'stop'; target: string; soundId?: string }[] = []
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 0)
      const targets = (
        vm as unknown as {
          runtime: {
            runtime: { _step(): void }
            targets: {
              getName(): string
              sprite: {
                sounds: { soundId: string }[]
                soundBank?: {
                  playSound(target: unknown, soundId: string): Promise<void>
                  stopAllSounds(target: unknown): void
                }
              }
            }[]
          }
        }
      ).runtime.targets
      const target = targets.find((candidate) => candidate.getName() === sprite.name)
      if (!target) throw new Error(`Missing VM target ${sprite.name}`)
      target.sprite.soundBank = {
        playSound: (_target, soundId) => {
          soundCalls.push({ kind: 'play', target: sprite.name, soundId })
          return Promise.resolve()
        },
        stopAllSounds: () => {
          soundCalls.push({ kind: 'stop', target: sprite.name })
        },
      }

      for (let tick = 0; tick < 10; tick += 1) (vm as unknown as { runtime: { _step(): void } }).runtime._step()
      expect(soundCalls).toEqual([
        { kind: 'play', target: sprite.name, soundId: target.sprite.sounds[0].soundId },
        { kind: 'stop', target: sprite.name },
      ])
    } finally {
      vm.quit()
    }
  })

  it('waits for sound play to finish before resuming the script', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    sprite.sounds = [{ name: 'beep', dataFormat: 'wav' }]
    sprite.variables.push({ name: 'afterSound', value: false })
    sprite.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'sound_playuntildone', inputs: { SOUND_MENU: { type: 'literal', value: 'beep' } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'afterSound' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm = createHeadlessVM()
    let finishSound: (() => void) | undefined
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      const runtime = vm as unknown as {
        start(): void
        greenFlag(): void
        runtime: {
          _step(): void
          targets: {
            getName(): string
            sprite: {
              soundBank?: {
                playSound(): Promise<void>
                stopAllSounds(): void
                setEffects(): void
              }
            }
          }[]
        }
      }
      runtime.start()
      runtime.greenFlag()
      const target = runtime.runtime.targets.find((candidate) => candidate.getName() === sprite.name)
      if (!target) throw new Error(`Missing VM target ${sprite.name}`)
      target.sprite.soundBank = {
        playSound: () => new Promise<void>((resolve) => (finishSound = resolve)),
        stopAllSounds: () => undefined,
        setEffects: () => undefined,
      }
      for (let tick = 0; tick < 8; tick += 1) {
        runtime.runtime._step()
        await Promise.resolve()
      }
      expect(finishSound).toBeTypeOf('function')
      expect(getVariable(vm, sprite.name, 'afterSound')?.value).toBe(false)

      finishSound?.()
      for (let tick = 0; tick < 8; tick += 1) {
        runtime.runtime._step()
        await Promise.resolve()
      }
      expect(getVariable(vm, sprite.name, 'afterSound')?.value).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('executes the built-in Pen extension through its renderer adapter', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.scripts = []
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    const sprite = project.sprites[0]
    const compiledArchive = await buildScratchProjectArchive(project)
    const zip = await JSZip.loadAsync(compiledArchive)
    const projectFile = zip.file('project.json')
    if (!projectFile) throw new Error('Compiled project has no project.json')
    const scratchProject = JSON.parse(await projectFile.async('string')) as {
      extensions: string[]
      targets: { name: string; blocks: Record<string, unknown> }[]
    }
    scratchProject.extensions.push('pen')
    const target = scratchProject.targets.find(({ name }) => name === sprite.name)
    if (!target) throw new Error(`Missing sprite target ${sprite.name}`)
    target.blocks = {
      flag: {
        opcode: 'event_whenflagclicked',
        next: 'clear',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      },
      clear: {
        opcode: 'pen_clear',
        next: 'size-to',
        parent: 'flag',
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'size-to': {
        opcode: 'pen_setPenSizeTo',
        next: 'size-change',
        parent: 'clear',
        inputs: { SIZE: [1, [4, 5]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'size-change': {
        opcode: 'pen_changePenSizeBy',
        next: 'color',
        parent: 'size-to',
        inputs: { SIZE: [1, [4, 3]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      color: {
        opcode: 'pen_setPenColorToColor',
        next: 'saturation',
        parent: 'size-change',
        inputs: { COLOR: [1, [9, '#ff0000']] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      saturation: {
        opcode: 'pen_setPenColorParamTo',
        next: 'saturation-change',
        parent: 'color',
        inputs: { COLOR_PARAM: [1, [10, 'saturation']], VALUE: [1, [4, 50]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'saturation-change': {
        opcode: 'pen_changePenColorParamBy',
        next: 'transparency',
        parent: 'saturation',
        inputs: { COLOR_PARAM: [1, [10, 'saturation']], VALUE: [1, [4, 25]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      transparency: {
        opcode: 'pen_setPenColorParamTo',
        next: 'start-position',
        parent: 'saturation-change',
        inputs: { COLOR_PARAM: [1, [10, 'transparency']], VALUE: [1, [4, 25]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'start-position': {
        opcode: 'motion_gotoxy',
        next: 'down',
        parent: 'transparency',
        inputs: { X: [1, [4, 5]], Y: [1, [4, 6]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      down: {
        opcode: 'pen_penDown',
        next: 'move-1',
        parent: 'start-position',
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'move-1': {
        opcode: 'motion_gotoxy',
        next: 'move-2',
        parent: 'down',
        inputs: { X: [1, [4, 10]], Y: [1, [4, 20]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'move-2': {
        opcode: 'motion_gotoxy',
        next: 'up',
        parent: 'move-1',
        inputs: { X: [1, [4, 30]], Y: [1, [4, 40]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      up: {
        opcode: 'pen_penUp',
        next: 'stamp',
        parent: 'move-2',
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
      },
      stamp: {
        opcode: 'pen_stamp',
        next: null,
        parent: 'up',
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
      },
    }
    zip.file('project.json', JSON.stringify(scratchProject))
    const penCalls = { clears: 0, points: 0, lines: 0 }
    const penDetails = { points: [], lines: [], stamps: [] } as NonNullable<Parameters<typeof createHeadlessVM>[9]>
    const vm = createHeadlessVM(
      penCalls,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      penDetails,
    )
    try {
      await loadSb3(await zip.generateAsync({ type: 'uint8array' }), vm)
      await runForTicksAsync(vm, 20)
      expect(penCalls).toEqual({ clears: 1, points: 1, lines: 2 })
      expect(penDetails.points).toHaveLength(1)
      expect(penDetails.points[0]).toMatchObject({
        diameter: 8,
        color4f: [1, 63 / 255, 63 / 255, 0.75],
        x: 5,
        y: 6,
      })
      expect(penDetails.lines).toHaveLength(2)
      expect(penDetails.lines[0]).toMatchObject({
        diameter: 8,
        color4f: [1, 63 / 255, 63 / 255, 0.75],
        x1: 5,
        y1: 6,
        x2: 10,
        y2: 20,
      })
      expect(penDetails.stamps).toHaveLength(1)
      expect(penDetails.stamps[0]).toBeGreaterThan(0)
    } finally {
      vm.quit()
    }
  })

  it('executes every strict capability through a Scratch VM primitive or hat', () => {
    const notExecuted = CANONICAL_OPCODES.filter((opcode) => !executedRuntimeOpcodes.has(opcode))
    expect(notExecuted, 'Add runtime behavior coverage that actually invokes every strict capability').toEqual([])
  })
})
