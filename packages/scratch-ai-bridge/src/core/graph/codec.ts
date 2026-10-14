import { getInputCapability } from '../capabilities'
import type {
  CanonicalBlock,
  CanonicalComment,
  CanonicalInput,
  CanonicalProcedure,
  CanonicalScalar,
  CanonicalScript,
} from '../ir/types'
import type { ScratchBlockGraph, ScratchBlockGraphNode } from './block-graph'

export interface ScratchBlockGraphEncodeOptions {
  nextId: () => string
  resolveVariable: (name: string) => string
  resolveList: (name: string) => string
  resolveBroadcast: (name: string) => string
  procedures?: readonly (CanonicalProcedure & { argumentIds: readonly string[] })[]
  addComment?: (comment: CanonicalComment, blockId: string) => string
}

type ScratchPrimitive = [number, CanonicalScalar] | [11 | 12 | 13, string, string]
type ScratchInputValue = ScratchPrimitive | string
export type ScratchSerializedInput =
  [1, ScratchInputValue] | [2, ScratchInputValue | null] | [3, ScratchInputValue, ScratchInputValue]

export interface EncodedScratchBlockNode extends ScratchBlockGraphNode {
  next: string | null
  parent: string | null
  inputs: Record<string, ScratchSerializedInput>
  fields: Record<string, [string] | [string, string]>
  shadow: boolean
  topLevel: boolean
  comment?: string
  x?: number
  y?: number
}

export interface CanonicalBlockMappingEntry {
  irPath: string
  blockId: string
  opcode: string
  targetIndex?: number
  targetName?: string
  isStage?: boolean
}

export interface ScratchBlockGraphDecodeOptions {
  mapping?: CanonicalBlockMappingEntry[]
  pathForScript?: (scriptIndex: number) => string
  target?: Pick<CanonicalBlockMappingEntry, 'targetIndex' | 'targetName' | 'isStage'>
  procedureScope?: CanonicalProcedure
  onArgumentReporterFallback?: (fallback: {
    blockId: string
    opcode: 'argument_reporter_string_number' | 'argument_reporter_boolean'
    argumentName: string
  }) => void
}

export type EncodedScratchBlockGraph = Record<string, EncodedScratchBlockNode>

const literalPrimitive = (value: CanonicalScalar, inputName: string): ScratchPrimitive => {
  if (typeof value === 'boolean') return [10, value ? 'true' : 'false']
  if (typeof value === 'number') return [Number.isInteger(value) ? 4 : 5, value]
  if (/COLOR/i.test(inputName) && /^#[0-9a-f]{6}$/i.test(value)) return [9, value]
  return [10, value]
}

/**
 * Encode canonical scripts as Scratch's ID-linked block graph.
 * @param scripts Tree-shaped scripts to serialize as Scratch blocks.
 * @param options ID and symbol resolvers used for Scratch references.
 * @returns A serialized Scratch block graph.
 */
export const encodeCanonicalScriptsToBlockGraph = (
  scripts: readonly CanonicalScript[],
  options: ScratchBlockGraphEncodeOptions,
): EncodedScratchBlockGraph => {
  const blocks: EncodedScratchBlockGraph = {}
  const allocatedIds = new Set<string>()
  let generatedCount = 0
  const nextId = (): string => {
    generatedCount += 1
    const id = options.nextId()
    if (allocatedIds.has(id)) throw new Error(`Scratch block ID generator returned duplicate ID ${id}`)
    allocatedIds.add(id)
    return id
  }
  const setBlock = (id: string, node: EncodedScratchBlockNode): void => {
    Object.defineProperty(blocks, id, {
      value: node,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  const compileFields = (fields: CanonicalBlock['fields']): Record<string, [string] | [string, string]> => {
    const result: Record<string, [string] | [string, string]> = {}
    for (const [name, value] of Object.entries(fields ?? {})) {
      const text = String(value)
      if (name === 'VARIABLE') result[name] = [text, options.resolveVariable(text)]
      else if (name === 'LIST') result[name] = [text, options.resolveList(text)]
      else if (name === 'BROADCAST_OPTION') result[name] = [text, options.resolveBroadcast(text)]
      else result[name] = [text]
    }
    return result
  }

  const compileShadow = (parentOpcode: string, inputName: string, value: CanonicalScalar, parentId: string) => {
    const shadow = getInputCapability(parentOpcode, inputName)?.shadow
    if (!shadow) return undefined
    const id = nextId()
    setBlock(id, {
      opcode: shadow.opcode,
      next: null,
      parent: parentId,
      inputs: {},
      fields: { [shadow.field]: [String(value)] },
      shadow: true,
      topLevel: false,
    })
    return id
  }

  const compileStack = (
    canonicalBlocks: readonly CanonicalBlock[],
    initialParent: string | null,
    topLevel: boolean,
    position?: CanonicalScript['position'],
  ): string | null => {
    if (canonicalBlocks.length === 0) return null
    const ids = canonicalBlocks.map(() => nextId())

    canonicalBlocks.forEach((block, index) => {
      const id = ids[index]
      const node: EncodedScratchBlockNode = {
        opcode: block.opcode,
        next: ids[index + 1] ?? null,
        parent: index === 0 ? initialParent : ids[index - 1],
        inputs: {},
        fields: compileFields(block.fields),
        shadow: false,
        topLevel: topLevel && index === 0,
        ...(block.comment && options.addComment ? { comment: options.addComment(block.comment, id) } : {}),
      }
      if (block.opcode === 'procedures_call') {
        const procedure = options.procedures?.find(({ name }) => name === block.procedure?.name)
        if (!procedure || procedure.argumentIds.length !== procedure.parameters.length) {
          throw new Error(`Unknown or invalid procedure call: ${block.procedure?.name ?? '(missing name)'}`)
        }
        node.mutation = {
          tagName: 'mutation',
          children: [],
          proccode: [
            procedure.name,
            ...procedure.parameters.map(({ kind }) => (kind === 'boolean' ? '%b' : kind === 'number' ? '%n' : '%s')),
          ]
            .filter(Boolean)
            .join(' '),
          argumentids: JSON.stringify(procedure.argumentIds),
          warp: procedure.warp ? 'true' : 'false',
        }
      }
      if (topLevel && index === 0) {
        node.x = position?.x ?? 48 + ((generatedCount * 17) % 180)
        node.y = position?.y ?? 48 + ((generatedCount * 29) % 240)
      }
      setBlock(id, node)
    })

    canonicalBlocks.forEach((block, index) => {
      if (block.opcode === 'procedures_call') {
        const procedure = options.procedures?.find(({ name }) => name === block.procedure?.name)
        if (!procedure) throw new Error(`Unknown procedure call: ${block.procedure?.name ?? '(missing name)'}`)
        const mappedInputs = Object.fromEntries(
          procedure.parameters.flatMap((parameter, argumentIndex) => {
            const input = block.inputs?.[parameter.name]
            return input ? [[procedure.argumentIds[argumentIndex], input]] : []
          }),
        )
        blocks[ids[index]].inputs = compileInputs(mappedInputs, ids[index], block.opcode)
      } else {
        blocks[ids[index]].inputs = compileInputs(block.inputs, ids[index], block.opcode)
      }
    })

    return ids[0]
  }

  const compileInput = (
    input: CanonicalInput,
    inputName: string,
    parentId: string,
    parentOpcode: string,
  ): ScratchSerializedInput => {
    const menuShadow =
      input.type === 'literal' ? compileShadow(parentOpcode, inputName, input.value, parentId) : undefined
    switch (input.type) {
      case 'literal':
        return menuShadow ? [1, menuShadow] : [1, literalPrimitive(input.value, inputName)]
      case 'variable': {
        const primitive: ScratchPrimitive = [12, input.name, options.resolveVariable(input.name)]
        const shadow = compileShadow(parentOpcode, inputName, '', parentId)
        return shadow ? [3, primitive, shadow] : [1, primitive]
      }
      case 'list': {
        const primitive: ScratchPrimitive = [13, input.name, options.resolveList(input.name)]
        const shadow = compileShadow(parentOpcode, inputName, '', parentId)
        return shadow ? [3, primitive, shadow] : [1, primitive]
      }
      case 'broadcast': {
        const primitive: ScratchPrimitive = [11, input.name, options.resolveBroadcast(input.name)]
        const shadow = compileShadow(parentOpcode, inputName, input.name, parentId)
        return shadow ? [3, primitive, shadow] : [1, primitive]
      }
      case 'block': {
        const reporterId = compileReporter(input.block, parentId)
        const shadow = compileShadow(parentOpcode, inputName, '', parentId)
        return shadow ? [3, reporterId, shadow] : [2, reporterId]
      }
      case 'stack':
        return [2, compileStack(input.blocks, parentId, false)]
    }
  }

  const compileInputs = (
    inputs: CanonicalBlock['inputs'],
    parentId: string,
    parentOpcode: string,
  ): Record<string, ScratchSerializedInput> =>
    Object.fromEntries(
      Object.entries(inputs ?? {}).map(([name, input]) => [name, compileInput(input, name, parentId, parentOpcode)]),
    )

  const compileReporter = (block: CanonicalBlock, parentId: string): string => {
    const id = nextId()
    setBlock(id, {
      opcode: block.opcode,
      next: null,
      parent: parentId,
      inputs: {},
      fields: compileFields(block.fields),
      shadow: false,
      topLevel: false,
      ...(block.comment && options.addComment ? { comment: options.addComment(block.comment, id) } : {}),
    })
    blocks[id].inputs = compileInputs(block.inputs, id, block.opcode)
    return id
  }

  scripts.forEach((script) => compileStack(script.blocks, null, true, script.position))
  return blocks
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseMutationArray = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) return value.map((entry: unknown) => entry)
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const scalar = (value: unknown): CanonicalScalar => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

const escapePointerPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')

const fieldValue = (field: unknown): CanonicalScalar =>
  Array.isArray(field) ? scalar((field as unknown[])[0]) : scalar(field)

const primitiveToInput = (primitive: unknown): CanonicalInput => {
  if (!Array.isArray(primitive)) return { type: 'literal', value: scalar(primitive) }
  const values = primitive as unknown[]
  const primitiveType = Number(values[0])
  if (primitiveType === 11) return { type: 'broadcast', name: String(scalar(values[1] ?? '')) }
  if (primitiveType === 12) return { type: 'variable', name: String(scalar(values[1] ?? '')) }
  if (primitiveType === 13) return { type: 'list', name: String(scalar(values[1] ?? '')) }
  return { type: 'literal', value: scalar(values[1]) }
}

/**
 * Project generic Scratch blocks into the currently modeled Canonical IR v1 tree.
 * @param blocks A target's Scratch block graph.
 * @param procedures Procedure declarations used to resolve call argument names.
 * @param comments Comment records keyed by Scratch comment ID.
 * @param options Optional JSON Pointer mapping output and per-script path resolver.
 * @returns Canonical scripts projected from top-level blocks.
 */
export const decodeBlockGraphToCanonicalScripts = (
  blocks: ScratchBlockGraph,
  procedures: readonly CanonicalProcedure[] = [],
  comments: Readonly<Record<string, CanonicalComment>> = {},
  options: ScratchBlockGraphDecodeOptions = {},
): CanonicalScript[] => {
  const isBlock = (value: unknown): value is ScratchBlockGraphNode =>
    isRecord(value) && typeof value.opcode === 'string'

  const decodeBlock = (id: string, stack: Set<string>, irPath: string): CanonicalBlock => {
    if (stack.has(id)) {
      return { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: '[cycle]' } } }
    }
    const raw = blocks[id]
    if (!isBlock(raw)) {
      return { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: '[missing block]' } } }
    }

    options.mapping?.push({ irPath, blockId: id, opcode: raw.opcode, ...options.target })

    const nextStack = new Set(stack)
    nextStack.add(id)
    const inputs: Record<string, CanonicalInput> = {}
    const decodeInputBlock = (blockId: string, blockStack: Set<string>, blockPath: string): CanonicalInput => {
      const inputBlock = blocks[blockId]
      if (
        isBlock(inputBlock) &&
        (inputBlock.opcode === 'argument_reporter_string_number' || inputBlock.opcode === 'argument_reporter_boolean')
      ) {
        const argumentName = String(fieldValue(inputBlock.fields?.VALUE))
        const parameter = options.procedureScope?.parameters.find(({ name }) => name === argumentName)
        const isValidArgument =
          inputBlock.opcode === 'argument_reporter_boolean'
            ? parameter?.kind === 'boolean'
            : parameter?.kind === 'string-number' || parameter?.kind === 'number'
        if (!isValidArgument) {
          options.onArgumentReporterFallback?.({
            blockId,
            opcode: inputBlock.opcode,
            argumentName,
          })
          // Scratch VM resolves an argument reporter outside its defining procedure to numeric 0,
          // including the boolean reporter opcode (the legacy SB2 fixtures rely on this).
          return { type: 'literal', value: 0 }
        }
      }
      return { type: 'block', block: decodeBlock(blockId, blockStack, blockPath) }
    }
    for (const [name, encodedValue] of Object.entries(raw.inputs ?? {})) {
      if (!Array.isArray(encodedValue)) continue
      const encoded = encodedValue as unknown[]
      const inputType = Number(encoded[0])
      const active = encoded[1]
      const shadowId = inputType === 3 && typeof encoded[2] === 'string' ? encoded[2] : undefined
      if ((active === null || active === undefined) && shadowId) {
        const shadow = blocks[shadowId]
        const expectedShadow = getInputCapability(raw.opcode, name)?.shadow
        if (expectedShadow && isBlock(shadow) && shadow.opcode === expectedShadow.opcode) {
          inputs[name] = { type: 'literal', value: fieldValue(shadow.fields?.[expectedShadow.field]) }
        } else {
          inputs[name] = {
            ...decodeInputBlock(shadowId, nextStack, `${irPath}/inputs/${escapePointerPart(name)}/block`),
          }
        }
        continue
      }
      if (name.startsWith('SUBSTACK') && (active === null || active === undefined)) {
        inputs[name] = { type: 'stack', blocks: [] }
        continue
      }
      if (typeof active === 'string') {
        if (name.startsWith('SUBSTACK')) {
          inputs[name] = {
            type: 'stack',
            blocks: decodeChain(active, nextStack, `${irPath}/inputs/${escapePointerPart(name)}/blocks`),
          }
        } else if (inputType === 1) {
          const shadow = blocks[active]
          const expectedShadow = getInputCapability(raw.opcode, name)?.shadow
          if (expectedShadow && isBlock(shadow) && shadow.opcode === expectedShadow.opcode) {
            inputs[name] = { type: 'literal', value: fieldValue(shadow.fields?.[expectedShadow.field]) }
          } else {
            inputs[name] = {
              ...decodeInputBlock(active, nextStack, `${irPath}/inputs/${escapePointerPart(name)}/block`),
            }
          }
        } else {
          inputs[name] = {
            ...decodeInputBlock(active, nextStack, `${irPath}/inputs/${escapePointerPart(name)}/block`),
          }
        }
      } else {
        inputs[name] = primitiveToInput(active)
      }
    }

    const fields = Object.fromEntries(
      Object.entries(raw.fields ?? {}).map(([name, value]) => [name, fieldValue(value)]),
    )
    const comment = typeof raw.comment === 'string' ? comments[raw.comment] : undefined
    if (raw.opcode === 'procedures_call') {
      const proccode = raw.mutation?.proccode
      const argumentIds = parseMutationArray(raw.mutation?.argumentids) ?? []
      const procedure = procedures.find((candidate) => {
        const expected = [
          candidate.name,
          ...candidate.parameters.map(({ kind }) => (kind === 'boolean' ? '%b' : kind === 'number' ? '%n' : '%s')),
        ]
          .filter(Boolean)
          .join(' ')
        return expected === proccode
      })
      if (!procedure) return { opcode: raw.opcode, ...(comment ? { comment } : {}) }
      const mappedInputs = Object.fromEntries(
        procedure.parameters.flatMap((parameter, index) => {
          const argumentId = argumentIds[index]
          const decodedInput = typeof argumentId === 'string' ? inputs[argumentId] : undefined
          const input = decodedInput ?? { type: 'literal' as const, value: parameter.default }
          const normalizedInput =
            parameter.kind === 'boolean' &&
            input.type === 'literal' &&
            (input.value === 'true' || input.value === 'false' || input.value === '')
              ? { type: 'literal' as const, value: input.value === 'true' }
              : input
          return [[parameter.name, normalizedInput]]
        }),
      )
      return {
        opcode: raw.opcode,
        ...(comment ? { comment } : {}),
        procedure: { name: procedure.name },
        ...(Object.keys(mappedInputs).length > 0 ? { inputs: mappedInputs } : {}),
      }
    }
    return {
      opcode: raw.opcode,
      ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
      ...(comment ? { comment } : {}),
    }
  }

  const decodeChain = (startId: string, stack = new Set<string>(), blocksPath = ''): CanonicalBlock[] => {
    const result: CanonicalBlock[] = []
    const visited = new Set(stack)
    let id: string | null | undefined = startId
    while (id && !visited.has(id)) {
      const raw: ScratchBlockGraphNode | undefined = blocks[id]
      if (!isBlock(raw)) break
      result.push(decodeBlock(id, visited, `${blocksPath}/${result.length}`))
      visited.add(id)
      id = raw.next
    }
    return result
  }

  return Object.entries(blocks)
    .filter(([, block]) => isBlock(block) && block.topLevel === true && block.shadow !== true)
    .sort(([, left], [, right]) => {
      if (!isBlock(left) || !isBlock(right)) return 0
      return (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0)
    })
    .map(([id, block], scriptIndex) => {
      const raw = block
      return {
        blocks: decodeChain(id, new Set(), options.pathForScript?.(scriptIndex) ?? `/scripts/${scriptIndex}/blocks`),
        ...(typeof raw.x === 'number' && typeof raw.y === 'number' ? { position: { x: raw.x, y: raw.y } } : {}),
      }
    })
}
