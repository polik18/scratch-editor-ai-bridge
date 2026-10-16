import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { importLosslessSb3 } from '../../src/core/archive'
import { projectJsonSignature } from '../../src/core/compatibility/project-signature'
import type { ScratchBlockGraph } from '../../src/core/graph'
import {
  copyScratchBlockGraph,
  decodeBlockGraphToCanonicalScripts,
  encodeCanonicalScriptsToBlockGraph,
  extractProjectBlockGraphs,
  mergeScratchBlockGraph,
  replaceProjectBlockGraphs,
  validateScratchBlockGraph,
} from '../../src/core/graph'
import { OFFICIAL_FIXTURE_MATRIX } from '../compatibility/fixture-matrix'

describe('generic Scratch block graph', () => {
  it('preserves unknown opcodes, mutation, comments, and extension fields', () => {
    const source = {
      unknown: {
        opcode: 'thirdparty_custom_block',
        next: null,
        parent: null,
        inputs: {},
        fields: { MODE: ['fast', null] },
        mutation: { proccode: 'custom %s', argumentids: '["arg"]' },
        comment: 'comment-1',
        extensionData: { version: 3 },
        shadow: false,
        topLevel: true,
        x: 12,
        y: 34,
      },
    }

    const graph = copyScratchBlockGraph(source)
    expect(graph).toEqual(source)
    expect(graph.unknown).not.toBe(source.unknown)
    expect(validateScratchBlockGraph(graph)).toEqual([])
  })

  it('skips non-block metadata entries while reporting them during project graph extraction', () => {
    const result = extractProjectBlockGraphs({
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            valid: { opcode: 'event_whenflagclicked', next: null, parent: null, inputs: {} },
            legacyMetadata: [13, 'legacy procedure', 'prototype-id', 2562, 85],
          },
        },
      ],
    })

    expect(Object.keys(result[0].blocks)).toEqual(['valid'])
    expect(result[0].issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid-node-property',
        blockId: 'legacyMetadata',
        relatedId: 'opcode',
      }),
    )
  })

  it('preserves deterministic generated chains and opaque node data across patches', () => {
    let state = 0x5eed1234
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }

    for (let sample = 0; sample < 256; sample += 1) {
      const count = (nextRandom() % 24) + 1
      const graph = Object.fromEntries(
        Array.from({ length: count }, (_, index) => {
          const id = `generated-${sample}-${index}`
          const nextId = index + 1 < count ? `generated-${sample}-${index + 1}` : null
          const parentId = index > 0 ? `generated-${sample}-${index - 1}` : null
          return [
            id,
            {
              opcode: `vendor_${nextRandom().toString(36)}`,
              next: nextId,
              parent: parentId,
              inputs: {},
              fields: { OPAQUE: [`sample-${sample}`, index] },
              extensionData: { seed: nextRandom(), nested: [sample, index] },
              topLevel: index === 0,
            },
          ]
        }),
      ) as ScratchBlockGraph

      expect(validateScratchBlockGraph(graph)).toEqual([])
      const copied = copyScratchBlockGraph(graph)
      const selectedId = `generated-${sample}-${count - 1}`
      const patched = mergeScratchBlockGraph(copied, {
        [selectedId]: { fields: { EDITED: sample } },
      })
      expect(validateScratchBlockGraph(patched)).toEqual([])
      expect(patched[selectedId].fields).toEqual({ EDITED: sample })
      expect(patched[selectedId].extensionData).toEqual(graph[selectedId].extensionData)
      expect(Object.keys(patched)).toEqual(Object.keys(graph))
    }
  })

  it('detects deterministic generated dangling references, parent errors, and cycles', () => {
    let state = 0x0badc0de
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const expectedIssues = [
      'missing-block',
      'parent-mismatch',
      'next-cycle',
      'duplicate-reference',
      'multiple-parents',
      'invalid-substack-boundary',
      'invalid-input-descriptor',
    ] as const

    for (let sample = 0; sample < 512; sample += 1) {
      const ids = Array.from({ length: 5 + (nextRandom() % 8) }, (_, index) => `fuzz-${sample}-${index}`)
      const graph = Object.fromEntries(
        ids.map((id, index) => [
          id,
          {
            opcode: `vendor_block_${index}`,
            next: ids[index + 1] ?? null,
            parent: index > 0 ? ids[index - 1] : null,
            inputs: {},
          },
        ]),
      ) as ScratchBlockGraph
      const issue = expectedIssues[sample % expectedIssues.length]
      if (ids.length < 5) throw new Error(`generated graph seed ${sample} has too few nodes`)
      const firstId = ids[0]
      const secondId = ids[1]
      const thirdId = ids[2]
      const fifthId = ids[4]
      const lastId = ids.at(-1) ?? firstId
      const firstBlock = graph[firstId]
      const secondBlock = graph[secondId]
      const thirdBlock = graph[thirdId]
      const lastBlock = graph[lastId]
      firstBlock.inputs ??= {}
      thirdBlock.inputs ??= {}
      if (issue === 'missing-block') firstBlock.next = `absent-${sample}`
      if (issue === 'parent-mismatch') secondBlock.parent = `wrong-${sample}`
      if (issue === 'next-cycle') lastBlock.next = firstId
      if (issue === 'duplicate-reference') firstBlock.inputs.VALUE = [2, secondId]
      if (issue === 'multiple-parents') thirdBlock.inputs.VALUE = [2, fifthId]
      if (issue === 'invalid-substack-boundary') {
        secondBlock.topLevel = true
        firstBlock.inputs.SUBSTACK = [2, secondId]
      }
      if (issue === 'invalid-input-descriptor') firstBlock.inputs.VALUE = [99, secondId]

      expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain(issue)
      expect(() => mergeScratchBlockGraph(graph, {})).toThrow(issue)
    }
  })

  it('preserves deterministic nested C-block graphs up to 128 levels', () => {
    let state = 0xc0ffee12
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }

    for (let sample = 0; sample < 128; sample += 1) {
      const depth = 1 + (nextRandom() % 128)
      const graph = Object.fromEntries(
        Array.from({ length: depth + 1 }, (_, index) => {
          const id = `nested-${sample}-${index}`
          const parent = index > 0 ? `nested-${sample}-${index - 1}` : null
          const child = index < depth ? `nested-${sample}-${index + 1}` : undefined
          return [
            id,
            index < depth
              ? {
                  opcode: 'control_if',
                  parent,
                  next: null,
                  inputs: { SUBSTACK: [2, child] },
                  ...(index === 0 ? { topLevel: true } : {}),
                  opaqueDepth: depth - index,
                }
              : { opcode: 'looks_say', parent, next: null, inputs: {}, opaqueLeaf: sample },
          ]
        }),
      )

      expect(validateScratchBlockGraph(graph)).toEqual([])
      const patched = mergeScratchBlockGraph(copyScratchBlockGraph(graph), {})
      expect(validateScratchBlockGraph(patched)).toEqual([])
      expect(Object.keys(patched)).toEqual(Object.keys(graph))
      expect(patched[`nested-${sample}-0`].opaqueDepth).toBe(depth)
      expect(patched[`nested-${sample}-${depth}`].opaqueLeaf).toBe(sample)
    }
  })

  it('uses one graph codec for Canonical IR encode and decode', () => {
    const source = [
      {
        position: { x: 24, y: 36 },
        blocks: [
          { opcode: 'event_whenflagclicked' as const },
          {
            opcode: 'control_repeat' as const,
            inputs: {
              TIMES: { type: 'literal' as const, value: 3 },
              SUBSTACK: {
                type: 'stack' as const,
                blocks: [
                  { opcode: 'looks_say' as const, inputs: { MESSAGE: { type: 'literal' as const, value: 'hi' } } },
                ],
              },
            },
          },
        ],
      },
    ]
    let id = 0
    const graph = encodeCanonicalScriptsToBlockGraph(source, {
      nextId: () => `codec-${++id}`,
      resolveVariable: (name) => `var-${name}`,
      resolveList: (name) => `list-${name}`,
      resolveBroadcast: (name) => `broadcast-${name}`,
    })

    expect(validateScratchBlockGraph(graph)).toEqual([])
    expect(decodeBlockGraphToCanonicalScripts(graph)).toEqual(source)
  })

  it('rejects a duplicate ID returned by the graph codec ID factory', () => {
    expect(() =>
      encodeCanonicalScriptsToBlockGraph(
        [{ blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'looks_say' }] }],
        {
          nextId: () => 'duplicate',
          resolveVariable: (name) => name,
          resolveList: (name) => name,
          resolveBroadcast: (name) => name,
        },
      ),
    ).toThrow('duplicate ID')
  })

  it('preserves special block IDs as ordinary own keys', () => {
    const source: Record<string, unknown> = {}
    Object.defineProperty(source, '__proto__', {
      value: { opcode: 'thirdparty_custom', next: null, parent: null, inputs: {} },
      enumerable: true,
    })
    const graph = copyScratchBlockGraph(source)

    expect(Object.hasOwn(graph, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(graph, '__proto__')?.value).toMatchObject({
      opcode: 'thirdparty_custom',
    })
    expect(Object.getPrototypeOf(graph)).toBe(Object.prototype)
  })

  it('projects all inline Scratch primitive types into Canonical inputs', () => {
    const graph = copyScratchBlockGraph({
      root: {
        opcode: 'operator_add',
        next: null,
        parent: null,
        inputs: {
          P4: [1, [4, 7]],
          P5: [1, [5, 1.5]],
          P6: [1, [6, 2]],
          P7: [1, [7, -2]],
          P8: [1, [8, 90]],
          P9: [1, [9, '#aabbcc']],
          P10: [1, [10, 'text']],
          P11: [1, [11, 'message', 'broadcast-id']],
          P12: [1, [12, 'score', 'variable-id']],
          P13: [1, [13, 'items', 'list-id']],
        },
        topLevel: true,
      },
    })

    expect(decodeBlockGraphToCanonicalScripts(graph)).toEqual([
      {
        blocks: [
          {
            opcode: 'operator_add',
            inputs: {
              P4: { type: 'literal', value: 7 },
              P5: { type: 'literal', value: 1.5 },
              P6: { type: 'literal', value: 2 },
              P7: { type: 'literal', value: -2 },
              P8: { type: 'literal', value: 90 },
              P9: { type: 'literal', value: '#aabbcc' },
              P10: { type: 'literal', value: 'text' },
              P11: { type: 'broadcast', name: 'message' },
              P12: { type: 'variable', name: 'score' },
              P13: { type: 'list', name: 'items' },
            },
          },
        ],
      },
    ])
  })

  it('uses a type-3 shadow fallback when the active input is empty', () => {
    const graph = copyScratchBlockGraph({
      parent: {
        opcode: 'looks_switchcostumeto',
        next: null,
        parent: null,
        inputs: { COSTUME: [3, null, 'fallback'] },
        topLevel: true,
      },
      fallback: {
        opcode: 'looks_costume',
        next: null,
        parent: 'parent',
        inputs: {},
        fields: { COSTUME: ['costume2'] },
        shadow: true,
      },
    })

    expect(decodeBlockGraphToCanonicalScripts(graph)[0].blocks[0].inputs?.COSTUME).toEqual({
      type: 'literal',
      value: 'costume2',
    })
  })

  it('reports dangling references and inconsistent parent ownership', () => {
    const graph = copyScratchBlockGraph({
      root: { opcode: 'control_repeat', next: 'missing-next', parent: null, inputs: { SUBSTACK: [2, 'child'] } },
      child: { opcode: 'motion_movesteps', next: null, parent: 'wrong-parent', inputs: {} },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toEqual([
      'missing-block',
      'missing-parent',
      'parent-mismatch',
    ])
  })

  it('reports next-chain cycles', () => {
    const graph = copyScratchBlockGraph({
      first: { opcode: 'motion_movesteps', next: 'second', parent: null, inputs: {} },
      second: { opcode: 'motion_movesteps', next: 'first', parent: 'first', inputs: {} },
    })

    expect(validateScratchBlockGraph(graph).some(({ code }) => code === 'next-cycle')).toBe(true)
  })

  it('rejects cycles formed through nested input references', () => {
    const graph = copyScratchBlockGraph({
      parent: {
        opcode: 'control_if',
        next: null,
        parent: 'child',
        inputs: { SUBSTACK: [2, 'child'] },
        topLevel: false,
      },
      child: {
        opcode: 'looks_say',
        next: null,
        parent: 'parent',
        inputs: { MESSAGE: [1, 'parent'] },
        topLevel: false,
      },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain('block-cycle')
    expect(() => mergeScratchBlockGraph(graph, {})).toThrow('block-cycle')
  })

  it('rejects one child block referenced by multiple inputs of the same parent', () => {
    const graph = copyScratchBlockGraph({
      parent: {
        opcode: 'operator_add',
        next: null,
        parent: null,
        inputs: { NUM1: [2, 'shared'], NUM2: [2, 'shared'] },
        topLevel: true,
      },
      shared: { opcode: 'math_number', next: null, parent: 'parent', inputs: {}, shadow: true },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain('duplicate-reference')
    expect(() => mergeScratchBlockGraph(graph, {})).toThrow('duplicate-reference')
  })

  it('detects deep input-reference cycles without recursive traversal', () => {
    const count = 20_000
    const graph: ScratchBlockGraph = {}
    for (let index = 0; index < count; index += 1) {
      graph[`block-${index}`] = {
        opcode: 'vendor_nested',
        next: null,
        parent: `block-${(index + count - 1) % count}`,
        inputs: { SUBSTACK: [2, `block-${(index + 1) % count}`] },
        topLevel: false,
      }
    }

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain('block-cycle')
  })

  it('rejects empty opcodes in raw graphs and patches', () => {
    const graph = copyScratchBlockGraph({ empty: { opcode: ' ', next: null, parent: null, inputs: {} } })
    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toEqual(['invalid-opcode'])
    expect(() => mergeScratchBlockGraph({}, { empty: { opcode: '' } })).toThrow('invalid-opcode')
  })

  it('rejects malformed known node property shapes while retaining opaque extension fields', () => {
    const graph = copyScratchBlockGraph({
      malformed: {
        opcode: 'thirdparty_block',
        next: null,
        parent: null,
        inputs: {},
        fields: 'not-an-object',
        mutation: [],
        shadow: 'false',
        topLevel: 0,
        x: Number.POSITIVE_INFINITY,
        vendorPayload: { untouched: true },
      },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toEqual([
      'invalid-fields',
      'invalid-node-property',
      'invalid-node-property',
      'invalid-node-property',
      'invalid-node-property',
    ])
    expect(validateScratchBlockGraph(graph).map(({ relatedId }) => relatedId)).toEqual([
      undefined,
      'mutation',
      'shadow',
      'topLevel',
      'x',
    ])
    expect(graph.malformed.vendorPayload).toEqual({ untouched: true })
  })

  it('validates registered field descriptors and values in raw preservation graphs', () => {
    const valid = copyScratchBlockGraph({
      rotation: {
        opcode: 'motion_setrotationstyle',
        parent: null,
        next: null,
        inputs: {},
        fields: { STYLE: ["don't rotate"] },
      },
    })
    expect(validateScratchBlockGraph(valid)).toEqual([])

    const invalid = copyScratchBlockGraph({
      rotation: {
        opcode: 'motion_setrotationstyle',
        parent: null,
        next: null,
        inputs: {},
        fields: { STYLE: ['invalid'], EXTRA: ['opaque?'] },
      },
    })
    expect(validateScratchBlockGraph(invalid).map(({ code, relatedId }) => [code, relatedId])).toEqual([
      ['invalid-field-value', 'STYLE'],
      ['unknown-field', 'EXTRA'],
    ])
  })

  it('accepts case-normalized Scratch graphic-effect fields without rewriting raw values', () => {
    const graph = copyScratchBlockGraph({
      ghost: {
        opcode: 'looks_changeeffectby',
        parent: null,
        next: null,
        inputs: { CHANGE: [1, [4, 10]] },
        fields: { EFFECT: ['GHOST'] },
      },
      pixelate: {
        opcode: 'looks_seteffectto',
        parent: null,
        next: null,
        inputs: { VALUE: [1, [4, 25]] },
        fields: { EFFECT: ['PIXELATE', null] },
      },
      color: {
        opcode: 'looks_seteffectto',
        parent: null,
        next: null,
        inputs: { VALUE: [1, [4, 25]] },
        fields: { EFFECT: ['COLOR'] },
      },
    })
    const before = structuredClone(graph)

    expect(validateScratchBlockGraph(graph)).toEqual([])
    expect(graph).toEqual(before)
  })

  it('rejects malformed serialized field tuples on known blocks', () => {
    const graph = copyScratchBlockGraph({
      key: {
        opcode: 'event_whenkeypressed',
        parent: null,
        next: null,
        inputs: {},
        fields: { KEY_OPTION: 12 },
      },
    })
    expect(validateScratchBlockGraph(graph).map(({ code, relatedId }) => [code, relatedId])).toEqual([
      ['invalid-field-descriptor', 'KEY_OPTION'],
    ])
  })

  it('accepts Scratch serialized input descriptors and inline primitive shadows', () => {
    const graph = copyScratchBlockGraph({
      parent: {
        opcode: 'operator_add',
        parent: null,
        next: null,
        inputs: { NUM1: [1, [4, 2]], NUM2: [3, 'reporter', [10, 'text']] },
      },
      reporter: { opcode: 'math_number', parent: 'parent', next: null, inputs: {} },
    })

    expect(validateScratchBlockGraph(graph)).toEqual([])
  })

  it('reports malformed serialized inputs and non-string graph references', () => {
    const graph = copyScratchBlockGraph({
      broken: { opcode: 'operator_add', parent: 42, next: false, inputs: { NUM1: [4, 1], NUM2: [3, 'only-one'] } },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toEqual([
      'invalid-input-descriptor',
      'invalid-input-descriptor',
      'invalid-reference',
      'invalid-reference',
    ])
  })

  it('reports a block referenced by multiple parents', () => {
    const graph = copyScratchBlockGraph({
      first: { opcode: 'control_if', next: null, parent: null, inputs: { SUBSTACK: [2, 'shared'] } },
      second: { opcode: 'control_if', next: null, parent: null, inputs: { SUBSTACK: [2, 'shared'] } },
      shared: { opcode: 'looks_say', next: null, parent: 'first', inputs: {} },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain('multiple-parents')
  })

  it('requires a substack input to start at a regular nested block', () => {
    const graph = copyScratchBlockGraph({
      control: {
        opcode: 'control_if',
        next: null,
        parent: null,
        inputs: { SUBSTACK: [2, 'shadow-root'] },
      },
      'shadow-root': {
        opcode: 'looks_say',
        next: null,
        parent: 'control',
        inputs: {},
        shadow: true,
      },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain('invalid-substack-boundary')
  })

  it('resolves procedure calls through definition prototypes and argument metadata', () => {
    const graph = copyScratchBlockGraph({
      definition: {
        opcode: 'procedures_definition',
        next: 'body',
        parent: null,
        inputs: { custom_block: [2, 'prototype'] },
      },
      prototype: {
        opcode: 'procedures_prototype',
        next: null,
        parent: 'definition',
        inputs: {},
        mutation: {
          proccode: 'report %s',
          argumentids: '["arg1"]',
          argumentnames: '["value"]',
          argumentdefaults: '[""]',
        },
      },
      call: {
        opcode: 'procedures_call',
        next: null,
        parent: null,
        inputs: { arg1: [2, null] },
        mutation: { proccode: 'report %s', argumentids: '["arg1"]' },
      },
      body: {
        opcode: 'looks_say',
        next: null,
        parent: 'definition',
        inputs: { MESSAGE: [2, 'argument'] },
      },
      argument: {
        opcode: 'argument_reporter_string_number',
        next: null,
        parent: 'body',
        inputs: {},
        fields: { VALUE: ['value', null] },
      },
    })

    expect(validateScratchBlockGraph(graph)).toEqual([])
  })

  it('accepts omitted declared procedure call inputs so prototype defaults can apply', () => {
    const graph = copyScratchBlockGraph({
      definition: {
        opcode: 'procedures_definition',
        next: 'body',
        parent: null,
        inputs: { custom_block: [2, 'prototype'] },
      },
      prototype: {
        opcode: 'procedures_prototype',
        next: null,
        parent: 'definition',
        inputs: {},
        mutation: {
          proccode: 'say %s when %b',
          argumentids: '["arg1","arg2"]',
          argumentnames: '["message","enabled"]',
          argumentdefaults: '["default",true]',
        },
      },
      call: {
        opcode: 'procedures_call',
        next: null,
        parent: null,
        inputs: { arg1: [1, [10, 'explicit']] },
        mutation: { proccode: 'say %s when %b', argumentids: '["arg1","arg2"]' },
      },
      body: {
        opcode: 'looks_say',
        next: null,
        parent: 'definition',
        inputs: { MESSAGE: [2, 'argument'] },
      },
      argument: {
        opcode: 'argument_reporter_string_number',
        next: null,
        parent: 'body',
        inputs: {},
        fields: { VALUE: ['message', null] },
      },
    })

    expect(validateScratchBlockGraph(graph)).toEqual([])
    graph.call.inputs = {}
    expect(validateScratchBlockGraph(graph)).toEqual([])
    graph.call.inputs.unknownArgument = [2, null]
    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain('invalid-procedure-call-arguments')
  })

  it('rejects procedure prototypes with duplicate argument names', () => {
    const graph = copyScratchBlockGraph({
      definition: {
        opcode: 'procedures_definition',
        next: null,
        parent: null,
        inputs: { custom_block: [2, 'prototype'] },
      },
      prototype: {
        opcode: 'procedures_prototype',
        next: null,
        parent: 'definition',
        inputs: {},
        mutation: {
          proccode: 'combine %s %n',
          argumentids: '["arg1","arg2"]',
          argumentnames: '["value","value"]',
          argumentdefaults: '["",0]',
        },
      },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toContain('invalid-procedure-definition')
  })

  it('reports unresolved calls and inconsistent definition argument metadata', () => {
    const graph = copyScratchBlockGraph({
      definition: {
        opcode: 'procedures_definition',
        next: null,
        parent: null,
        inputs: { custom_block: [2, 'prototype'] },
      },
      prototype: {
        opcode: 'procedures_prototype',
        next: null,
        parent: 'definition',
        inputs: {},
        mutation: {
          proccode: 'known',
          argumentids: '["arg1", "arg1"]',
          argumentnames: '["a"]',
          argumentdefaults: '[0, 0]',
        },
      },
      call: {
        opcode: 'procedures_call',
        next: null,
        parent: null,
        inputs: {},
        mutation: { proccode: 'missing' },
      },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toEqual([
      'invalid-procedure-definition',
      'unresolved-procedure-call',
    ])
  })

  it('reports mismatched procedure call inputs and argument reporters outside their declaration', () => {
    const graph = copyScratchBlockGraph({
      definition: {
        opcode: 'procedures_definition',
        next: null,
        parent: null,
        inputs: { custom_block: [2, 'prototype'] },
      },
      prototype: {
        opcode: 'procedures_prototype',
        next: null,
        parent: 'definition',
        inputs: {},
        mutation: {
          proccode: 'takes %s',
          argumentids: '["arg1"]',
          argumentnames: '["declared"]',
          argumentdefaults: '[""]',
        },
      },
      call: {
        opcode: 'procedures_call',
        next: null,
        parent: null,
        inputs: { wrong: [2, null] },
        mutation: { proccode: 'takes %s', argumentids: '["wrong"]' },
      },
      orphan: {
        opcode: 'argument_reporter_string_number',
        next: null,
        parent: null,
        inputs: {},
        fields: { VALUE: ['undeclared', null] },
      },
    })

    expect(validateScratchBlockGraph(graph).map(({ code }) => code)).toEqual([
      'invalid-procedure-call-arguments',
      'invalid-argument-reporter',
    ])
  })

  it('accepts the legacy shadow prototype with an embedded argument reporter', () => {
    const graph = copyScratchBlockGraph({
      definition: {
        opcode: 'procedures_definition',
        next: null,
        parent: null,
        inputs: { custom_block: [1, 'prototype'] },
      },
      prototype: {
        opcode: 'procedures_prototype',
        next: null,
        parent: 'definition',
        inputs: { arg1: [1, 'reporter'] },
        shadow: true,
        mutation: {
          proccode: 'takes %s',
          argumentids: '["arg1"]',
          argumentnames: '["value"]',
          argumentdefaults: '[""]',
        },
      },
      reporter: {
        opcode: 'argument_reporter_string_number',
        next: null,
        parent: 'prototype',
        inputs: {},
        shadow: true,
        fields: { VALUE: ['value', null] },
      },
    })

    expect(validateScratchBlockGraph(graph)).toEqual([])
  })

  it('extracts graphs per target without losing unknown project blocks', () => {
    const targets = extractProjectBlockGraphs({
      targets: [
        {
          isStage: true,
          name: 'Stage',
          blocks: { detached: { opcode: 'thirdparty_reporter', parent: null, next: null, topLevel: true } },
        },
        { isStage: false, name: 'Sprite1', blocks: {} },
      ],
    })

    expect(targets.map(({ targetName }) => targetName)).toEqual(['Stage', 'Sprite1'])
    expect(targets.map(({ targetIndex }) => targetIndex)).toEqual([0, 1])
    expect(targets[0].blocks.detached.opcode).toBe('thirdparty_reporter')
    expect(targets[0].issues).toEqual([])
  })

  it('round-trips generic graphs while retaining project and target data', () => {
    const project = {
      meta: { semver: '3.0.0', custom: 'keep me' },
      monitors: [{ id: 'monitor-1', custom: true }],
      extensions: ['thirdparty'],
      targets: [
        {
          isStage: true,
          name: 'Stage',
          tempo: 80,
          blocks: {
            custom: {
              opcode: 'thirdparty_custom',
              next: null,
              parent: null,
              inputs: {},
              fields: { VALUE: ['original', null] },
              mutation: { custom: 'retained' },
              comment: 'comment-1',
              topLevel: true,
            },
          },
        },
      ],
    }
    const snapshots = extractProjectBlockGraphs(project)
    snapshots[0].blocks.custom.fields = { VALUE: ['edited', null] }

    const result = replaceProjectBlockGraphs(project, snapshots)

    expect(result).toEqual({
      ...project,
      targets: [
        {
          ...project.targets[0],
          blocks: {
            ...project.targets[0].blocks,
            custom: { ...project.targets[0].blocks.custom, fields: { VALUE: ['edited', null] } },
          },
        },
      ],
    })
    expect(project.targets[0].blocks.custom.fields).toEqual({ VALUE: ['original', null] })
  })

  it('rejects snapshots moved to another target or containing invalid graphs', () => {
    const project = { targets: [{ isStage: true, name: 'Stage', blocks: {} }] }
    const snapshots = extractProjectBlockGraphs(project)
    snapshots[0].blocks.bad = { opcode: 'unknown', next: 'absent', parent: null }

    expect(() => replaceProjectBlockGraphs(project, snapshots)).toThrow('missing-block')
    snapshots[0].blocks = {}
    snapshots[0].targetName = 'Other'
    expect(() => replaceProjectBlockGraphs(project, snapshots)).toThrow('does not match')
  })

  it('merges raw block edits while retaining unknown node fields', () => {
    const base = copyScratchBlockGraph({
      opaque: {
        opcode: 'thirdparty_custom',
        next: null,
        parent: null,
        inputs: {},
        fields: { VALUE: ['before', null] },
        mutation: { vendor: 'payload' },
        pluginMetadata: { keep: true },
      },
    })

    const merged = mergeScratchBlockGraph(base, {
      opaque: { fields: { VALUE: ['after', null] } },
      added: { opcode: 'motion_movesteps', next: null, parent: null, inputs: {}, fields: {} },
    })

    expect(merged.opaque).toEqual({ ...base.opaque, fields: { VALUE: ['after', null] } })
    expect(merged.added.opcode).toBe('motion_movesteps')
    expect(mergeScratchBlockGraph(merged, { added: null })).not.toHaveProperty('added')
    expect(base.opaque.pluginMetadata).toEqual({ keep: true })
  })

  it('removes explicitly selected raw properties while preserving other opaque data', () => {
    const base = copyScratchBlockGraph({
      opaque: {
        opcode: 'thirdparty_custom',
        next: null,
        parent: null,
        inputs: {},
        mutation: { obsolete: true },
        pluginMetadata: { keep: true },
      },
    })
    const merged = mergeScratchBlockGraph(base, { opaque: { removeProperties: ['mutation'] } })
    expect(merged.opaque).not.toHaveProperty('mutation')
    expect(merged.opaque.pluginMetadata).toEqual({ keep: true })
    expect(base.opaque.mutation).toEqual({ obsolete: true })
    expect(() => mergeScratchBlockGraph(base, { added: { removeProperties: ['mutation'] } })).toThrow('new block')
    expect(() => mergeScratchBlockGraph(base, { opaque: { mutation: {}, removeProperties: ['mutation'] } })).toThrow(
      'unique, non-empty',
    )
  })

  it('rejects raw graph patches that leave dangling references', () => {
    const base = copyScratchBlockGraph({
      parent: {
        opcode: 'control_if',
        next: null,
        parent: null,
        inputs: { SUBSTACK: [2, 'child'] },
        fields: {},
        topLevel: true,
      },
      child: { opcode: 'looks_say', next: null, parent: 'parent', inputs: {}, fields: {} },
    })
    expect(() => mergeScratchBlockGraph(base, { child: null })).toThrow('missing-block')
  })

  it('round-trips official SB3 source block graphs without changing their signatures', async () => {
    const fixtures = OFFICIAL_FIXTURE_MATRIX.filter(
      ({ format, expectation }) => format === 'sb3' && expectation !== 'parse-only',
    )

    for (const fixture of fixtures) {
      const source = await readFile(fixture.path)
      const imported = await importLosslessSb3(source)
      const snapshots = extractProjectBlockGraphs(imported.projectJson)
      const restored = replaceProjectBlockGraphs(imported.projectJson, snapshots)

      expect(projectJsonSignature(restored)).toEqual(projectJsonSignature(imported.projectJson))
      expect(
        snapshots.flatMap(({ issues }) => issues),
        fixture.name,
      ).toEqual([])
    }
  })
})
