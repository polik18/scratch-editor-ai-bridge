import { Buffer } from 'node:buffer'
import JSZip from 'jszip'
import scratchParser from 'scratch-parser'
import { describe, expect, it, vi } from 'vitest'
import { compileCanonicalProject, compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import { buildScratchProjectArchive, buildScratchProjectJson } from '../../src/core/compiler/project-json'
import { decompileSb3WithBlockGraphs } from '../../src/core/decompiler/decompiler'
import { extractProjectBlockGraphs, validateScratchBlockGraph } from '../../src/core/graph'
import example01 from '../../src/core/ir/examples/01-minimal-project.json'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import example03 from '../../src/core/ir/examples/03-repeat-score.json'
import example04 from '../../src/core/ir/examples/04-broadcast-flow.json'
import example05 from '../../src/core/ir/examples/05-full-entities.json'
import example06 from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createVM, getProjectJson, runForTicks, saveSb3, type ScratchVMHandle } from '../../src/scratch'

interface VMWithPeripheralRegistry extends ScratchVMHandle {
  runtime: {
    on(event: string, listener: (target: unknown, type: string, text: string) => void): void
    stopAll(): void
    handleProjectLoaded(): Promise<void>
    targets: { id: string; isStage: boolean }[]
  }
  deserializeProject(project: Record<string, unknown>, zip: JSZip | null): Promise<void>
  exportSprite(targetId: string, outputType: string): Promise<Uint8Array>
}
import cspScratchParser from '../../src/scratch/csp-scratch-parser'

const parseOfficialProject = (input: Buffer): Promise<unknown> =>
  new Promise((resolve, reject) => {
    scratchParser(input, false, (error, project) => {
      if (error) reject(error instanceof Error ? error : new Error('scratch-parser rejected the generated archive'))
      else resolve(project)
    })
  })

const examples = [example01, example02, example03, example04, example05, example06] as CanonicalProject[]
type CanonicalBlock = CanonicalProject['stage']['scripts'][number]['blocks'][number]

const stringLeaves = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringLeaves)
  return []
}

const executeSayTrace = (vm: VMWithPeripheralRegistry): string[] => {
  const maxSayEvents = 32
  const messages: string[] = []
  const runtime = (
    vm as ScratchVMHandle & {
      runtime: {
        on(event: string, listener: (target: unknown, type: string, text: string) => void): void
        stopAll(): void
      }
    }
  ).runtime
  runtime.on('SAY', (_target, _type, text) => {
    messages.push(text)
    if (messages.length === maxSayEvents) runtime.stopAll()
  })
  runForTicks(vm, 16)
  return messages
}

describe('generated SB3 compatibility', () => {
  it('bounds total browser media preflight time across slow raster and audio assets', async () => {
    vi.useFakeTimers()
    class SlowImage {
      naturalWidth = 1
      naturalHeight = 1
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      src = ''

      decode(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 9_000))
      }

      removeAttribute(name: string): void {
        if (name === 'src') this.src = ''
      }
    }
    class SlowAudio {
      duration = 1
      oncanplay: (() => void) | null = null
      onerror: (() => void) | null = null
      preload = ''
      src = ''

      load(): void {
        if (this.src) setTimeout(() => this.oncanplay?.(), 9_000)
      }

      pause(): void {}

      removeAttribute(name: string): void {
        if (name === 'src') this.src = ''
      }
    }
    vi.stubGlobal('Image', SlowImage)
    vi.stubGlobal('Audio', SlowAudio)
    const project = structuredClone(example01) as CanonicalProject
    project.stage.costumes = Array.from({ length: 2 }, (_, index) => ({
      name: `slow-costume-${index}`,
      dataFormat: 'png' as const,
      data: 'iVBORw0KGgo=',
    }))
    project.stage.sounds = Array.from({ length: 2 }, (_, index) => ({
      name: `slow-${index}`,
      dataFormat: 'mp3' as const,
      data: 'SUQz',
    }))

    try {
      const compilation = compileCanonicalProject(project)
      const rejection = compilation.then(
        () => undefined,
        (error: unknown) => error,
      )
      await vi.advanceTimersByTimeAsync(30_000)
      const error = await rejection
      expect(error).toMatchObject({ name: 'ProjectCompileError', stage: 'audio-preflight' })
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Browser media preflight exceeded its 30000ms total time budget')
      expect((error as Error).message).toContain('/stage/sounds/1')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it.each(examples)('passes scratch-parser for $name', async (project) => {
    const sb3 = await compileCanonicalProjectToSb3(project)
    const parsed = await parseOfficialProject(Buffer.from(await sb3.arrayBuffer()))

    expect(parsed).toBeDefined()
    expect(sb3.size).toBeGreaterThan(0)
  })

  it('round-trips seeded Unicode and punctuation payloads through the official parser', async () => {
    let state = 0x51a7c0de
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['a', 'Z', '0', ' ', '\\', '"', "'", '<', '>', '&', '/', '%', '中', '界', 'م', '😀', 'e\u0301']

    for (let sample = 0; sample < 24; sample += 1) {
      const message = `seed-${sample}-${Array.from(
        { length: 12 },
        () => alphabet[nextRandom() % alphabet.length],
      ).join('')}`
      const project = structuredClone(example02) as CanonicalProject
      const sayBlock = project.sprites[0].scripts[0].blocks.find(({ opcode }) => opcode === 'looks_say')
      if (!sayBlock?.inputs) throw new Error('generated project is missing its looks_say message input')
      sayBlock.inputs.MESSAGE = { type: 'literal', value: message }

      const sb3 = await compileCanonicalProjectToSb3(project)
      const parsed = await parseOfficialProject(Buffer.from(await sb3.arrayBuffer()))
      const parsedProject: unknown = Array.isArray(parsed) ? (parsed[0] as unknown) : parsed

      expect(stringLeaves(parsedProject), `seed ${sample}`).toContain(message)
    }
  })

  it('preserves a large Unicode block-text payload through parser and VM normalization', async () => {
    const prefix = 'large-text-雪-🚀-'
    const suffix = '-終-<>&/"'
    const message = `${prefix}${'界😀<&/'.repeat(64 * 1024)}${suffix}`
    const project = structuredClone(example02) as CanonicalProject
    const sayBlock = project.sprites[0].scripts[0].blocks.find(({ opcode }) => opcode === 'looks_say')
    if (!sayBlock?.inputs) throw new Error('large text fixture is missing its looks_say message input')
    sayBlock.inputs.MESSAGE = { type: 'literal', value: message }

    const assertPayload = (value: unknown, label: string) => {
      const payload = stringLeaves(value).find(
        (leaf) => leaf.length === message.length && leaf.startsWith(prefix) && leaf.endsWith(suffix),
      )
      expect(payload, label).toBeDefined()
      if (!payload) return
      let mismatchIndex = -1
      for (let index = 0; index < message.length; index += 1) {
        if (payload[index] !== message[index]) {
          mismatchIndex = index
          break
        }
      }
      const contextStart = Math.max(0, mismatchIndex - 12)
      const contextEnd = mismatchIndex < 0 ? 0 : mismatchIndex + 24
      expect(
        {
          length: payload.length,
          mismatchIndex,
          actual: mismatchIndex < 0 ? '' : payload.slice(contextStart, contextEnd),
          expected: mismatchIndex < 0 ? '' : message.slice(contextStart, contextEnd),
        },
        label,
      ).toEqual({ length: message.length, mismatchIndex: -1, actual: '', expected: '' })
    }

    assertPayload(await buildScratchProjectJson(project), 'compiled project JSON payload')
    const sourceArchive = await buildScratchProjectArchive(project)
    const parsedSource = await new Promise<Record<string, unknown>>((resolve, reject) => {
      cspScratchParser(sourceArchive, false, (error, result) => {
        if (error)
          reject(error instanceof Error ? error : new Error('Production Scratch parser returned a non-Error failure'))
        else if (!result) reject(new Error('production Scratch parser returned no project'))
        else resolve(result[0])
      })
    })
    assertPayload(parsedSource, 'production ZIP parser payload')

    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    try {
      const vmProject = structuredClone(parsedSource)
      for (const target of vmProject.targets as { costumes?: unknown[] }[]) target.costumes = []
      await vm.deserializeProject(vmProject, null)
      await vm.runtime.handleProjectLoaded()
      assertPayload(getProjectJson(vm), 'official VM serialization payload')

      const normalizedArchive = await saveSb3(vm)
      const normalizedZip = await JSZip.loadAsync(await normalizedArchive.arrayBuffer())
      const normalizedEntry = normalizedZip.file('project.json')
      if (!normalizedEntry) throw new Error('normalized fixture archive has no project.json')
      const normalizedBytes = await normalizedEntry.async('uint8array')
      assertPayload(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(normalizedBytes)),
        'saved SB3 payload',
      )

      const spriteTarget = vm.runtime.targets.find(({ isStage }) => !isStage)
      if (!spriteTarget) throw new Error('large text VM has no sprite to export')
      const spriteArchive = await vm.exportSprite(spriteTarget.id, 'uint8array')
      const spriteZip = await JSZip.loadAsync(spriteArchive)
      const spriteEntry = spriteZip.file('sprite.json')
      if (!spriteEntry) throw new Error('exported sprite has no sprite.json')
      const spriteBytes = await spriteEntry.async('uint8array')
      assertPayload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(spriteBytes)), 'saved sprite payload')
    } finally {
      vm.quit()
    }
  })

  it('preserves surrogate pairs on both sides of JSZip 16 KiB string-chunk boundaries', async () => {
    const chunkSize = 16 * 1024
    const boundaries = [chunkSize, chunkSize * 2, chunkSize * 3, chunkSize * 4]
    const offsets = [-1, -2, 0]

    for (const [boundaryIndex, boundary] of boundaries.entries()) {
      for (const [offsetIndex, offset] of offsets.entries()) {
        const prefix = 'x'.repeat(boundary + offset)
        const message = `${prefix}😀-boundary-${boundaryIndex}-${offsetIndex}-雪`
        const project = structuredClone(example02) as CanonicalProject
        const sayBlock = project.sprites[0].scripts[0].blocks.find(({ opcode }) => opcode === 'looks_say')
        if (!sayBlock?.inputs) throw new Error('boundary fixture is missing its looks_say message input')
        sayBlock.inputs.MESSAGE = { type: 'literal', value: message }

        const archive = await buildScratchProjectArchive(project)
        const officialParsed = await parseOfficialProject(Buffer.from(archive))
        expect(stringLeaves(officialParsed), `official parser boundary ${boundary} offset ${offset}`).toContain(
          message,
        )

        const productionParsed = await new Promise<Record<string, unknown>>((resolve, reject) => {
          cspScratchParser(archive, false, (error, result) => {
            if (error)
              reject(error instanceof Error ? error : new Error('production parser rejected a valid chunk boundary'))
            else if (!result) reject(new Error('production parser returned no project'))
            else resolve(result[0])
          })
        })
        expect(stringLeaves(productionParsed), `production parser boundary ${boundary} offset ${offset}`).toContain(
          message,
        )
      }
    }
  })

  it('parses seeded nested C-block projects with valid Raw IR graphs', async () => {
    let state = 0xc0ffee12
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const makeRepeat = (depth: number): CanonicalProject['stage']['scripts'][number]['blocks'][number] => ({
      opcode: 'control_repeat',
      inputs: {
        TIMES: { type: 'literal', value: 1 + (nextRandom() % 8) },
        SUBSTACK: {
          type: 'stack',
          blocks:
            depth > 1
              ? [makeRepeat(depth - 1)]
              : [
                  {
                    opcode: 'data_changevariableby',
                    fields: { VARIABLE: 'score' },
                    inputs: { VALUE: { type: 'literal', value: (nextRandom() % 11) - 5 } },
                  },
                ],
        },
      },
    })

    for (let sample = 0; sample < 16; sample += 1) {
      const depth = 1 + (nextRandom() % 16)
      const project = structuredClone(example03) as CanonicalProject
      project.stage.scripts[0].blocks = [{ opcode: 'event_whenflagclicked' }, makeRepeat(depth)]

      const sb3 = await compileCanonicalProjectToSb3(project)
      const parsed = await parseOfficialProject(Buffer.from(await sb3.arrayBuffer()))
      const parsedProject: unknown = Array.isArray(parsed) ? (parsed[0] as unknown) : parsed
      const stageGraph = extractProjectBlockGraphs(parsedProject)[0]
      const blocks = Object.values(stageGraph.blocks)

      expect(validateScratchBlockGraph(stageGraph.blocks), `seed ${sample}`).toEqual([])
      expect(
        blocks.filter(({ opcode }) => opcode === 'control_repeat'),
        `seed ${sample}`,
      ).toHaveLength(depth)
      expect(
        blocks.filter(({ opcode }) => opcode === 'data_changevariableby'),
        `seed ${sample}`,
      ).toHaveLength(1)
    }
  })

  it('differentially round-trips generated nested scripts through parser and VM', async () => {
    let state = 0x0ddba11
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['雪', '🚀', '{', '}', '`', '\\', '"', '/', '~', '中', '\n', 'e\u0301']

    for (let sample = 0; sample < 64; sample += 1) {
      const message = `diff-${sample}-${Array.from(
        { length: 8 + (nextRandom() % 24) },
        () => alphabet[nextRandom() % alphabet.length],
      ).join('')}`
      const depth = 1 + (nextRandom() % 8)
      const makeRepeat = (remaining: number): CanonicalProject['stage']['scripts'][number]['blocks'][number] => ({
        opcode: 'control_repeat',
        inputs: {
          TIMES: { type: 'literal', value: 1 + (nextRandom() % 5) },
          SUBSTACK: {
            type: 'stack',
            blocks:
              remaining > 1
                ? [makeRepeat(remaining - 1)]
                : [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: message } } }],
          },
        },
      })
      const project = structuredClone(example03) as CanonicalProject
      project.stage.scripts[0].blocks = [{ opcode: 'event_whenflagclicked' }, makeRepeat(depth)]

      const sourceArchive = await compileCanonicalProjectToSb3(project)
      const officialSource = await parseOfficialProject(Buffer.from(await sourceArchive.arrayBuffer()))
      const officialProject: unknown = Array.isArray(officialSource) ? (officialSource[0] as unknown) : officialSource
      expect(stringLeaves(officialProject), `source seed ${sample}`).toContain(message)

      const imported = await decompileSb3WithBlockGraphs(sourceArchive, project.name)
      expect(
        imported.rawBlockGraphs.every(({ issues }) => issues.length === 0),
        `graph seed ${sample}`,
      ).toBe(true)
      expect(stringLeaves(imported.canonical), `VM seed ${sample}`).toContain(message)

      const normalizedArchive = await compileCanonicalProjectToSb3(imported.canonical)
      const officialNormalized = await parseOfficialProject(Buffer.from(await normalizedArchive.arrayBuffer()))
      const normalizedProject: unknown = Array.isArray(officialNormalized)
        ? (officialNormalized[0] as unknown)
        : officialNormalized
      expect(stringLeaves(normalizedProject), `normalized seed ${sample}`).toContain(message)
    }
  })

  it('differentially round-trips generated nested Scratch control-flow shapes', async () => {
    let state = 0x6f31a5c7
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['中', '雪', '🚀', '<', '&', '/', '~', '`', 'e\u0301']
    const comparisonOperands = [0, -0, 1e-10, -1e12, Number.MAX_SAFE_INTEGER, '0', ' 1 ', '', ' ', '😀', 'a', 'A']
    let comparisonCursor = 0

    const controlShapes = [
      'control_repeat',
      'control_repeat_until',
      'control_forever',
      'control_if',
      'control_if_else',
      'control_wait_until',
      'control_wait',
    ] as const
    const runtimeComparableShapes = ['control_repeat', 'control_if', 'control_if_else', 'control_wait'] as const
    const say = (message: string): CanonicalBlock => ({
      opcode: 'looks_say',
      inputs: { MESSAGE: { type: 'literal', value: message } },
    })
    const predicate = (): CanonicalBlock => ({
      opcode: nextRandom() % 2 === 0 ? 'operator_gt' : 'operator_lt',
      inputs: {
        OPERAND1: { type: 'literal', value: comparisonOperands[comparisonCursor++ % comparisonOperands.length] },
        OPERAND2: {
          type: 'literal',
          value:
            comparisonOperands[
              (comparisonCursor + (nextRandom() % comparisonOperands.length)) % comparisonOperands.length
            ],
        },
      },
    })
    const makeControlFlow = (
      remaining: number,
      thenMessage: string,
      elseMessage: string,
      forcedShape?: (typeof controlShapes)[number],
      shapePool: readonly (typeof controlShapes)[number][] = controlShapes,
    ): CanonicalBlock[] => {
      const shape = forcedShape ?? shapePool[nextRandom() % shapePool.length]
      const nestedBlocks =
        remaining > 1
          ? makeControlFlow(remaining - 1, thenMessage, elseMessage, undefined, shapePool)
          : [say(thenMessage)]
      if (shape === 'control_repeat') {
        return [
          {
            opcode: shape,
            inputs: {
              TIMES: { type: 'literal', value: 1 + (nextRandom() % 4) },
              SUBSTACK: { type: 'stack', blocks: nestedBlocks },
            },
          },
          say(elseMessage),
        ]
      }
      if (shape === 'control_repeat_until' || shape === 'control_if') {
        return [
          {
            opcode: shape,
            inputs: {
              CONDITION: { type: 'block', block: predicate() },
              SUBSTACK: { type: 'stack', blocks: nestedBlocks },
            },
          },
          say(elseMessage),
        ]
      }
      if (shape === 'control_forever') {
        return [{ opcode: shape, inputs: { SUBSTACK: { type: 'stack', blocks: nestedBlocks } } }, say(elseMessage)]
      }
      if (shape === 'control_if_else') {
        return [
          {
            opcode: shape,
            inputs: {
              CONDITION: { type: 'block', block: predicate() },
              SUBSTACK: { type: 'stack', blocks: nestedBlocks },
              SUBSTACK2: { type: 'stack', blocks: [say(elseMessage)] },
            },
          },
        ]
      }
      if (shape === 'control_wait_until') {
        return [
          { opcode: shape, inputs: { CONDITION: { type: 'block', block: predicate() } } },
          ...nestedBlocks,
          say(elseMessage),
        ]
      }
      return [
        { opcode: shape, inputs: { DURATION: { type: 'literal', value: nextRandom() % 5 } } },
        ...nestedBlocks,
        say(elseMessage),
      ]
    }

    for (let sample = 0; sample < 224; sample += 1) {
      const payload = () =>
        Array.from({ length: 8 + (nextRandom() % 12) }, () => alphabet[nextRandom() % alphabet.length]).join('')
      const thenMessage = `then-${sample}-${payload()}`
      const elseMessage = `else-${sample}-${payload()}`
      const controlShape = controlShapes[sample % controlShapes.length]
      const runtimeComparable = (runtimeComparableShapes as readonly string[]).includes(controlShape)
      const nestingDepth = runtimeComparable ? 1 : 1 + (nextRandom() % 8)
      const shapePool = runtimeComparable ? runtimeComparableShapes : controlShapes
      const project = structuredClone(example03) as CanonicalProject
      project.stage.scripts[0].blocks = [
        { opcode: 'event_whenflagclicked' },
        ...makeControlFlow(nestingDepth, thenMessage, elseMessage, controlShape, shapePool),
      ]

      const sourceCompilation = await compileCanonicalProject(project)
      let normalizedVm: ScratchVMHandle | undefined
      try {
        const sourceArchive = sourceCompilation.sb3
        const officialSource = await parseOfficialProject(Buffer.from(await sourceArchive.arrayBuffer()))
        const officialProject: unknown = Array.isArray(officialSource)
          ? (officialSource[0] as unknown)
          : officialSource
        const sourceBlocks = Object.values(extractProjectBlockGraphs(officialProject)[0].blocks)
        expect(
          sourceBlocks.some(({ opcode }) => opcode === controlShape),
          `source shape ${sample}`,
        ).toBe(true)
        for (const message of [thenMessage, elseMessage])
          expect(stringLeaves(officialProject), `source ${sample}`).toContain(message)

        const imported = await decompileSb3WithBlockGraphs(sourceArchive, project.name)
        expect(
          imported.rawBlockGraphs.every(({ issues }) => issues.length === 0),
          `graph seed ${sample}`,
        ).toBe(true)
        for (const message of [thenMessage, elseMessage])
          expect(stringLeaves(imported.canonical), `VM ${sample}`).toContain(message)

        const normalizedCompilation = await compileCanonicalProject(imported.canonical)
        normalizedVm = normalizedCompilation.vm
        const officialNormalized = await parseOfficialProject(
          Buffer.from(await normalizedCompilation.sb3.arrayBuffer()),
        )
        const normalizedProject: unknown = Array.isArray(officialNormalized)
          ? (officialNormalized[0] as unknown)
          : officialNormalized
        const normalizedBlocks = Object.values(extractProjectBlockGraphs(normalizedProject)[0].blocks)
        expect(
          normalizedBlocks.some(({ opcode }) => opcode === controlShape),
          `normalized shape ${sample}`,
        ).toBe(true)
        for (const message of [thenMessage, elseMessage]) {
          expect(stringLeaves(normalizedProject), `normalized ${sample}`).toContain(message)
        }
        if (runtimeComparable) {
          expect(executeSayTrace(normalizedVm as VMWithPeripheralRegistry), `runtime trace seed ${sample}`).toEqual(
            executeSayTrace(sourceCompilation.vm as VMWithPeripheralRegistry),
          )
        }
      } finally {
        sourceCompilation.vm.quit()
        normalizedVm?.quit()
      }
    }
  }, 60_000)

  it('preserves generated nested branch execution traces through VM normalization', async () => {
    let state = 0x4c2f91ab
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['中', '雪', '🚀', '<', '&', '/', '~', 'e\u0301']

    for (let sample = 0; sample < 48; sample += 1) {
      const left = (nextRandom() % 11) - 5
      const right = (nextRandom() % 11) - 5
      const repeatCount = 1 + (nextRandom() % 4)
      const operator = nextRandom() % 2 === 0 ? 'operator_gt' : 'operator_lt'
      const thenMessage = `then-${sample}-${Array.from({ length: 6 }, () => alphabet[nextRandom() % alphabet.length]).join('')}`
      const elseMessage = `else-${sample}-${Array.from({ length: 6 }, () => alphabet[nextRandom() % alphabet.length]).join('')}`
      const project = structuredClone(example03) as CanonicalProject
      project.stage.scripts[0].blocks = [
        { opcode: 'event_whenflagclicked' },
        {
          opcode: 'control_repeat',
          inputs: {
            TIMES: { type: 'literal', value: repeatCount },
            SUBSTACK: {
              type: 'stack',
              blocks: [
                {
                  opcode: 'control_if_else',
                  inputs: {
                    CONDITION: {
                      type: 'block',
                      block: {
                        opcode: operator,
                        inputs: {
                          OPERAND1: { type: 'literal', value: left },
                          OPERAND2: { type: 'literal', value: right },
                        },
                      },
                    },
                    SUBSTACK: {
                      type: 'stack',
                      blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: thenMessage } } }],
                    },
                    SUBSTACK2: {
                      type: 'stack',
                      blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: elseMessage } } }],
                    },
                  },
                },
              ],
            },
          },
        },
      ]

      const sourceCompilation = await compileCanonicalProject(project)
      let normalizedVm: ScratchVMHandle | undefined
      try {
        const parsed = await parseOfficialProject(Buffer.from(await sourceCompilation.sb3.arrayBuffer()))
        const parsedProject: unknown = Array.isArray(parsed) ? (parsed[0] as unknown) : parsed
        expect(stringLeaves(parsedProject), `source seed ${sample}`).toContain(thenMessage)
        expect(stringLeaves(parsedProject), `source seed ${sample}`).toContain(elseMessage)

        const imported = await decompileSb3WithBlockGraphs(sourceCompilation.sb3, project.name)
        expect(
          imported.rawBlockGraphs.every(({ issues }) => issues.length === 0),
          `graph seed ${sample}`,
        ).toBe(true)
        const normalizedCompilation = await compileCanonicalProject(imported.canonical)
        normalizedVm = normalizedCompilation.vm
        const normalizedParsed = await parseOfficialProject(
          Buffer.from(await normalizedCompilation.sb3.arrayBuffer()),
        )
        const normalizedProject: unknown = Array.isArray(normalizedParsed)
          ? (normalizedParsed[0] as unknown)
          : normalizedParsed
        expect(stringLeaves(normalizedProject), `normalized seed ${sample}`).toContain(thenMessage)
        expect(stringLeaves(normalizedProject), `normalized seed ${sample}`).toContain(elseMessage)

        const expectedMessage = (operator === 'operator_gt' ? left > right : left < right) ? thenMessage : elseMessage
        const expectedTrace = Array.from({ length: repeatCount }, () => expectedMessage)
        expect(executeSayTrace(sourceCompilation.vm as VMWithPeripheralRegistry), `source execution seed ${sample}`).toEqual(expectedTrace)
        expect(executeSayTrace(normalizedVm as VMWithPeripheralRegistry), `normalized execution seed ${sample}`).toEqual(expectedTrace)
      } finally {
        sourceCompilation.vm.quit()
        normalizedVm?.quit()
      }
    }
  }, 60_000)

  it('refuses schema-valid projects with semantic authoring errors', async () => {
    const project = structuredClone(example06) as CanonicalProject
    project.sprites[0].scripts.push({ blocks: [{ opcode: 'event_whenkeypressed' }] })

    await expect(compileCanonicalProjectToSb3(project)).rejects.toThrow('semantic validation failed')
  })

  it('refuses schema-valid projects with missing source assets before VM compilation', async () => {
    const project = structuredClone(example06) as CanonicalProject
    project.sprites[0].costumes[0].assetIssue = 'missing-archive-entry'

    await expect(compileCanonicalProjectToSb3(project)).rejects.toThrow(
      '/sprites/0/costumes/0/assetIssue [asset-missing]',
    )
  })
})
