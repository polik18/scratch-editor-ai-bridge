import { getBlockCapability } from '../capabilities'

const caseInsensitiveRawEnumFields = new Set(['looks_changeeffectby:EFFECT', 'looks_seteffectto:EFFECT'])

const isAllowedRawFieldValue = (
  opcode: string,
  fieldName: string,
  value: string,
  values: readonly string[],
): boolean =>
  values.includes(value) ||
  (caseInsensitiveRawEnumFields.has(`${opcode}:${fieldName}`) &&
    values.some((allowed) => allowed.toLocaleLowerCase('en-US') === value.toLocaleLowerCase('en-US')))

/** A Scratch block record with its upstream fields retained verbatim. */
export interface ScratchBlockGraphNode {
  opcode: string
  next?: string | null
  parent?: string | null
  inputs?: Record<string, unknown>
  fields?: Record<string, unknown>
  shadow?: boolean
  topLevel?: boolean
  x?: number
  y?: number
  mutation?: Record<string, unknown>
  [key: string]: unknown
}

/** A block graph keyed by Scratch block ID. */
export type ScratchBlockGraph = Record<string, ScratchBlockGraphNode>

export interface BlockGraphIssue {
  code:
    | 'missing-block'
    | 'missing-parent'
    | 'multiple-parents'
    | 'parent-mismatch'
    | 'next-cycle'
    | 'invalid-inputs'
    | 'invalid-fields'
    | 'invalid-field-descriptor'
    | 'missing-field'
    | 'unknown-field'
    | 'invalid-field-value'
    | 'invalid-node-property'
    | 'invalid-opcode'
    | 'invalid-input-descriptor'
    | 'invalid-reference'
    | 'invalid-substack-boundary'
    | 'invalid-procedure-definition'
    | 'unresolved-procedure-call'
    | 'invalid-procedure-call-arguments'
    | 'invalid-argument-reporter'
    | 'block-cycle'
    | 'duplicate-reference'
  blockId: string
  relatedId?: string
  message: string
}

export interface ScratchTargetBlockGraph {
  targetIndex: number
  targetName: string
  isStage: boolean
  blocks: ScratchBlockGraph
  issues: BlockGraphIssue[]
}

export type ScratchBlockNodePatch = Partial<ScratchBlockGraphNode> & {
  /** Explicitly remove top-level raw properties from an existing block. */
  removeProperties?: readonly string[]
  /** Replace existing nested object values by JSON Pointer without replacing siblings. */
  setPaths?: readonly { path: string; value: unknown }[]
  /** Remove existing nested object values by JSON Pointer without replacing siblings. */
  removePaths?: readonly string[]
}

export interface ScratchTargetBlockPatch {
  targetIndex: number
  targetName: string
  isStage: boolean
  blocks: Record<string, ScratchBlockNodePatch | null>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRecordArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.every(isRecord)

const isBlockNode = (value: unknown): value is ScratchBlockGraphNode =>
  isRecord(value) && typeof value.opcode === 'string'

const parsePatchPath = (path: string): string[] => {
  if (!path.startsWith('/') || path.length > 512) throw new Error('must be a JSON Pointer under a node property')
  const parts = path
    .slice(1)
    .split('/')
    .map((part) => {
      if (/~(?![01])/.test(part)) throw new Error('contains invalid JSON Pointer escaping')
      return part.replace(/~1/g, '/').replace(/~0/g, '~')
    })
  if (parts.some((part) => part === '' || ['__proto__', 'prototype', 'constructor'].includes(part))) {
    throw new Error('contains an empty or unsafe path segment')
  }
  return parts
}

const patchPathsOverlap = (left: string, right: string): boolean => {
  const leftParts = parsePatchPath(left)
  const rightParts = parsePatchPath(right)
  const sharedLength = Math.min(leftParts.length, rightParts.length)
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftParts[index] !== rightParts[index]) return false
  }
  return true
}

const applyNestedPath = (root: Record<string, unknown>, path: string, value: unknown, remove: boolean): void => {
  const parts = parsePatchPath(path)
  const leaf = parts.pop()
  if (leaf === undefined) throw new Error(`path ${path} must identify a nested property`)
  let parent = root
  for (const part of parts) {
    const child = parent[part]
    if (!isRecord(child)) throw new Error(`path ${path} must traverse existing objects`)
    parent = child
  }
  if (!Object.hasOwn(parent, leaf)) throw new Error(`path ${path} must target an existing property`)
  if (remove) delete parent[leaf]
  else parent[leaf] = structuredClone(value)
}

const isPrimitiveInput = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false
  const primitive = value as unknown[]
  const kind = primitive[0]
  if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 4 || kind > 13) return false
  if ([11, 12, 13].includes(kind)) return primitive.length === 3 || primitive.length === 5
  return primitive.length === 2
}

const isInputReference = (value: unknown): boolean =>
  value === null || typeof value === 'string' || isPrimitiveInput(value)

const serializedInputIds = (descriptor: unknown): string[] => {
  if (!Array.isArray(descriptor)) return []
  const kind: unknown = descriptor[0]
  const values: unknown[] =
    kind === 1 || kind === 2 ? [descriptor[1]] : kind === 3 ? [descriptor[1], descriptor[2]] : []
  return values.filter((value): value is string => typeof value === 'string')
}

const parseMutationArray = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) return value as unknown[]
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Preserve the complete Scratch block graph, including fields this version of
 * Canonical IR does not understand. The input is JSON data from project.json.
 * @param value Scratch target blocks from project.json.
 * @returns A deep copy keyed by Scratch block ID.
 */
export const copyScratchBlockGraph = (value: unknown): ScratchBlockGraph => {
  if (!isRecord(value)) throw new Error('Scratch target blocks must be an object')
  const graph: ScratchBlockGraph = {}
  for (const [id, block] of Object.entries(value)) {
    if (!isBlockNode(block)) throw new Error(`Scratch block ${id} must contain an opcode`)
    Object.defineProperty(graph, id, {
      value: structuredClone(block),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return graph
}

/**
 * Apply node-level edits to a raw graph while retaining unmentioned opaque fields.
 * A `null` patch value deletes a block; a node patch replaces only its supplied
 * properties, with nested `inputs`, `fields`, and `mutation` values replaced as a unit.
 * @param base Original graph snapshot.
 * @param patch Block IDs mapped to property patches or `null` for deletion.
 * @returns A validated copy with the edits applied.
 */
export const mergeScratchBlockGraph = (
  base: ScratchBlockGraph,
  patch: Record<string, ScratchBlockNodePatch | null>,
): ScratchBlockGraph => {
  const graph = copyScratchBlockGraph(base)
  for (const [id, nodePatch] of Object.entries(patch)) {
    if (nodePatch === null) {
      if (!Object.hasOwn(graph, id)) throw new Error(`Scratch block patch ${id} cannot delete a missing block`)
      delete graph[id]
      continue
    }
    if (!isRecord(nodePatch)) throw new Error(`Scratch block patch ${id} must be an object`)
    const { removeProperties, setPaths, removePaths, ...propertyPatch } = nodePatch
    if (
      removeProperties !== undefined &&
      (!Array.isArray(removeProperties) ||
        removeProperties.length === 0 ||
        removeProperties.some((key: unknown) => typeof key !== 'string' || key.length === 0) ||
        new Set<unknown>(removeProperties).size !== removeProperties.length ||
        removeProperties.some((key: unknown) => typeof key === 'string' && Object.hasOwn(propertyPatch, key)))
    ) {
      throw new Error(
        `Scratch block patch ${id} removeProperties must contain unique, non-empty property names not also patched`,
      )
    }
    const existing = Object.hasOwn(graph, id) ? graph[id] : undefined
    if (removeProperties?.length && !existing) {
      throw new Error(`Scratch block patch ${id} cannot remove properties from a new block`)
    }
    const merged = existing ? { ...existing, ...structuredClone(propertyPatch) } : structuredClone(propertyPatch)
    for (const property of (removeProperties ?? []) as readonly string[]) delete merged[property]
    const paths = [...(setPaths ?? []).map(({ path }) => path), ...(removePaths ?? [])]
    if (paths.length && !existing) throw new Error(`Scratch block patch ${id} cannot edit paths on a new block`)
    if (paths.some((path, index) => paths.slice(index + 1).some((otherPath) => patchPathsOverlap(path, otherPath)))) {
      throw new Error(`Scratch block patch ${id} cannot edit overlapping paths`)
    }
    for (const path of removePaths ?? []) applyNestedPath(merged, path, undefined, true)
    for (const { path, value } of setPaths ?? []) applyNestedPath(merged, path, value, false)
    if (!isBlockNode(merged)) throw new Error(`Scratch block patch ${id} must contain an opcode`)
    Object.defineProperty(graph, id, {
      value: merged,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  const issues = validateScratchBlockGraph(graph)
  if (issues.length > 0) {
    throw new Error(`Merged block graph is invalid: ${issues.map(({ code }) => code).join(', ')}`)
  }
  return graph
}

/**
 * Check references, parent ownership, and cycles in Scratch next chains.
 * @param graph Scratch block graph keyed by block ID.
 * @returns Structural issues found in the graph.
 */
export const validateScratchBlockGraph = (graph: ScratchBlockGraph): BlockGraphIssue[] => {
  const issues: BlockGraphIssue[] = []
  const expectedParents = new Map<string, Set<string>>()
  const childReferenceCounts = new Map<string, number>()
  const graphChildren = new Map<string, string[]>()
  const procedureDefinitions = new Map<
    string,
    { blockIds: string[]; argumentIds: string[]; argumentNames: string[] }
  >()
  // Older SB3 procedure graphs omit child parent IDs; infer only unique ownership from serialized references.
  const inferredParent = (id: string): string | undefined => {
    const parents = expectedParents.get(id)
    return parents?.size === 1 ? parents.values().next().value : undefined
  }
  for (const [id, block] of Object.entries(graph)) {
    const childRefs: string[] = []
    if (block.opcode.trim().length === 0) {
      issues.push({
        code: 'invalid-opcode',
        blockId: id,
        message: `Block ${id} opcode must not be empty`,
      })
    }
    if (block.fields !== undefined && !isRecord(block.fields)) {
      issues.push({
        code: 'invalid-fields',
        blockId: id,
        message: `Block ${id} fields must be an object`,
      })
    }
    const capability = getBlockCapability(block.opcode)
    if (isRecord(block.fields) && capability?.fields) {
      for (const [fieldName, fieldValue] of Object.entries(block.fields)) {
        const field = capability.fields[fieldName]
        if (!Object.hasOwn(capability.fields, fieldName)) {
          issues.push({
            code: 'unknown-field',
            blockId: id,
            relatedId: fieldName,
            message: `Known block ${id} (${block.opcode}) has no ${fieldName} field`,
          })
          continue
        }
        if (
          !Array.isArray(fieldValue) ||
          (fieldValue.length !== 1 && fieldValue.length !== 2) ||
          typeof fieldValue[0] !== 'string' ||
          (fieldValue.length === 2 && fieldValue[1] !== null && typeof fieldValue[1] !== 'string')
        ) {
          issues.push({
            code: 'invalid-field-descriptor',
            blockId: id,
            relatedId: fieldName,
            message: `Field ${fieldName} on known block ${id} must be a Scratch [value, optionalId] tuple`,
          })
          continue
        }
        if (field.values && !isAllowedRawFieldValue(block.opcode, fieldName, fieldValue[0], field.values)) {
          issues.push({
            code: 'invalid-field-value',
            blockId: id,
            relatedId: fieldName,
            message: `Field ${fieldName} on known block ${id} has unsupported value ${fieldValue[0]}`,
          })
        }
      }
      for (const [fieldName, field] of Object.entries(capability.fields)) {
        if (field.required && !Object.hasOwn(block.fields ?? {}, fieldName)) {
          issues.push({
            code: 'missing-field',
            blockId: id,
            relatedId: fieldName,
            message: `Known block ${id} (${block.opcode}) requires field ${fieldName}`,
          })
        }
      }
    }
    const mutation: unknown = block.mutation
    const invalidProperties = [
      ...(mutation !== undefined && mutation !== null && !isRecord(mutation) ? ['mutation'] : []),
      ...(block.shadow !== undefined && typeof block.shadow !== 'boolean' ? ['shadow'] : []),
      ...(block.topLevel !== undefined && typeof block.topLevel !== 'boolean' ? ['topLevel'] : []),
      ...(block.x !== undefined && (typeof block.x !== 'number' || !Number.isFinite(block.x)) ? ['x'] : []),
      ...(block.y !== undefined && (typeof block.y !== 'number' || !Number.isFinite(block.y)) ? ['y'] : []),
    ]
    for (const property of invalidProperties) {
      issues.push({
        code: 'invalid-node-property',
        blockId: id,
        relatedId: property,
        message: `Block ${id} property ${property} has an invalid type`,
      })
    }
    if (block.inputs !== undefined && !isRecord(block.inputs)) {
      issues.push({ code: 'invalid-inputs', blockId: id, message: `Block ${id} inputs must be an object` })
    } else {
      for (const [inputName, rawDescriptor] of Object.entries(block.inputs ?? {})) {
        if (!Array.isArray(rawDescriptor)) {
          // Scratch VM runtime input records are not project.json descriptors.
          issues.push({
            code: 'invalid-input-descriptor',
            blockId: id,
            relatedId: inputName,
            message: `Input ${inputName} on block ${id} must be a serialized descriptor`,
          })
          continue
        }
        const [kind, ...values] = rawDescriptor as unknown[]
        const valid =
          (kind === 1 && values.length === 1 && isInputReference(values[0])) ||
          (kind === 2 && values.length === 1 && isInputReference(values[0])) ||
          (kind === 3 && values.length === 2 && values.every(isInputReference))
        if (!valid) {
          issues.push({
            code: 'invalid-input-descriptor',
            blockId: id,
            relatedId: inputName,
            message: `Input ${inputName} on block ${id} has an invalid serialized descriptor`,
          })
          continue
        }
        for (const value of values) {
          if (typeof value !== 'string') continue
          childRefs.push(value)
          if (inputName.startsWith('SUBSTACK') && Object.hasOwn(graph, value)) {
            const substackRoot = graph[value]
            if (substackRoot.shadow === true || substackRoot.topLevel === true) {
              issues.push({
                code: 'invalid-substack-boundary',
                blockId: id,
                relatedId: value,
                message: `Substack input ${inputName} on block ${id} must begin with a non-shadow, non-top-level block`,
              })
            }
          }
        }
      }
    }
    if (block.next !== undefined && block.next !== null && typeof block.next !== 'string') {
      issues.push({
        code: 'invalid-reference',
        blockId: id,
        relatedId: 'next',
        message: `Block ${id} next must be a block ID or null`,
      })
    }
    if (typeof block.next === 'string') childRefs.push(block.next)
    graphChildren.set(
      id,
      childRefs.filter((childId) => Object.hasOwn(graph, childId)),
    )
    for (const childId of childRefs) {
      if (!Object.hasOwn(graph, childId)) {
        issues.push({
          code: 'missing-block',
          blockId: id,
          relatedId: childId,
          message: `Block ${id} references missing block ${childId}`,
        })
        continue
      }
      const parents = expectedParents.get(childId) ?? new Set<string>()
      parents.add(id)
      expectedParents.set(childId, parents)
      childReferenceCounts.set(childId, (childReferenceCounts.get(childId) ?? 0) + 1)
    }
    if (block.parent !== undefined && block.parent !== null && typeof block.parent !== 'string') {
      issues.push({
        code: 'invalid-reference',
        blockId: id,
        relatedId: 'parent',
        message: `Block ${id} parent must be a block ID or null`,
      })
    }
    if (typeof block.parent === 'string' && !Object.hasOwn(graph, block.parent)) {
      issues.push({
        code: 'missing-parent',
        blockId: id,
        relatedId: block.parent,
        message: `Block ${id} has missing parent ${block.parent}`,
      })
    }

    if (block.opcode === 'procedures_definition') {
      const prototypeIds = serializedInputIds(block.inputs?.custom_block)
      const prototypes = prototypeIds.map((prototypeId) => graph[prototypeId])
      const prototype = prototypes.length === 1 ? prototypes[0] : undefined
      const mutation = prototype?.mutation
      const proccode = isRecord(mutation) ? mutation.proccode : undefined
      const argumentIds = isRecord(mutation) ? parseMutationArray(mutation.argumentids) : undefined
      const argumentNames = isRecord(mutation) ? parseMutationArray(mutation.argumentnames) : undefined
      const argumentDefaults = isRecord(mutation) ? parseMutationArray(mutation.argumentdefaults) : undefined
      const validArguments =
        argumentIds !== undefined &&
        argumentNames !== undefined &&
        argumentDefaults !== undefined &&
        argumentIds.every((value) => typeof value === 'string' && value.length > 0) &&
        argumentNames.every((value) => typeof value === 'string') &&
        argumentIds.length === argumentNames.length &&
        argumentIds.length === argumentDefaults.length &&
        new Set(argumentIds).size === argumentIds.length &&
        new Set(argumentNames).size === argumentNames.length
      if (
        prototype?.opcode !== 'procedures_prototype' ||
        (prototype.parent !== undefined && prototype.parent !== id) ||
        typeof proccode !== 'string' ||
        proccode.length === 0 ||
        !validArguments
      ) {
        const countMismatch =
          argumentIds && argumentNames && argumentDefaults
            ? `目前有 ${argumentIds.length} 個參數 ID、${argumentNames.length} 個參數名稱、${argumentDefaults.length} 個預設值。`
            : undefined
        issues.push({
          code: 'invalid-procedure-definition',
          blockId: id,
          relatedId: prototypeIds[0],
          message: countMismatch
            ? `自製積木的參數資料數量不一致。${countMismatch}`
            : `自製積木定義缺少有效的參數原型，或參數資料格式不完整。`,
        })
      } else {
        const definitions = procedureDefinitions.get(proccode) ?? {
          blockIds: [],
          argumentIds: argumentIds as string[],
          argumentNames,
        }
        definitions.blockIds.push(id)
        procedureDefinitions.set(proccode, definitions)
      }
    }
  }

  for (const [id, block] of Object.entries(graph)) {
    if (block.opcode !== 'procedures_call') continue
    const proccode = isRecord(block.mutation) ? block.mutation.proccode : undefined
    const definition = typeof proccode === 'string' ? procedureDefinitions.get(proccode) : undefined
    if (!definition) {
      issues.push({
        code: 'unresolved-procedure-call',
        blockId: id,
        relatedId: typeof proccode === 'string' ? proccode : undefined,
        message: `Procedure call ${id} does not resolve to a definition in this target`,
      })
      continue
    }
    const callArgumentIds = isRecord(block.mutation) ? parseMutationArray(block.mutation.argumentids) : undefined
    const expectedArgumentIds = [...definition.argumentIds].sort()
    const inputArgumentIds = Object.keys(block.inputs ?? {})
    if (
      callArgumentIds === undefined ||
      !callArgumentIds.every((argumentId) => typeof argumentId === 'string') ||
      callArgumentIds.length !== definition.argumentIds.length ||
      callArgumentIds.some((argumentId, index) => argumentId !== definition.argumentIds[index]) ||
      inputArgumentIds.some((argumentId) => !expectedArgumentIds.includes(argumentId))
    ) {
      issues.push({
        code: 'invalid-procedure-call-arguments',
        blockId: id,
        relatedId: typeof proccode === 'string' ? proccode : undefined,
        message: `Procedure call ${id} mutation must match its definition and inputs may only name declared arguments`,
      })
    }
  }

  for (const [id, block] of Object.entries(graph)) {
    if (block.opcode !== 'argument_reporter_string_number' && block.opcode !== 'argument_reporter_boolean') continue
    const valueField = isRecord(block.fields) ? block.fields.VALUE : undefined
    const argumentName = Array.isArray(valueField)
      ? (valueField as unknown[])[0]
      : isRecord(valueField)
        ? valueField.value
        : undefined
    let parentId = block.parent ?? inferredParent(id)
    const visited = new Set<string>()
    let owningDefinition: string | undefined
    while (typeof parentId === 'string' && Object.hasOwn(graph, parentId) && !visited.has(parentId)) {
      if (graph[parentId].opcode === 'procedures_definition') {
        owningDefinition = parentId
        break
      }
      visited.add(parentId)
      parentId = graph[parentId].parent ?? inferredParent(parentId)
    }
    const definition = owningDefinition
      ? [...procedureDefinitions.values()].find((candidate) => candidate.blockIds.includes(owningDefinition))
      : undefined
    if (!definition || typeof argumentName !== 'string' || !definition.argumentNames.includes(argumentName)) {
      issues.push({
        code: 'invalid-argument-reporter',
        blockId: id,
        relatedId: typeof argumentName === 'string' ? argumentName : undefined,
        message: `Argument reporter ${id} must be nested in a procedure that declares its VALUE`,
      })
    }
  }

  for (const [childId, parentIds] of expectedParents) {
    if ((childReferenceCounts.get(childId) ?? 0) > 1) {
      issues.push({
        code: 'duplicate-reference',
        blockId: childId,
        relatedId: [...parentIds].join(','),
        message: `Block ${childId} is referenced more than once by its parent blocks`,
      })
    }
    const actualParent = graph[childId].parent
    if (parentIds.size > 1) {
      issues.push({
        code: 'multiple-parents',
        blockId: childId,
        relatedId: [...parentIds].join(','),
        message: `Block ${childId} is referenced by multiple parents: ${[...parentIds].join(', ')}`,
      })
    } else {
      const [parentId] = parentIds
      if (actualParent === undefined || actualParent === parentId) continue
      issues.push({
        code: 'parent-mismatch',
        blockId: childId,
        relatedId: parentId,
        message: `Block ${childId} should have parent ${parentId}, found ${String(actualParent ?? 'null')}`,
      })
    }
  }

  const completed = new Set<string>()
  for (const startId of Object.keys(graph)) {
    const path = new Set<string>()
    let currentId: string | null | undefined = startId
    while (currentId && Object.hasOwn(graph, currentId) && !completed.has(currentId)) {
      if (path.has(currentId)) {
        issues.push({
          code: 'next-cycle',
          blockId: currentId,
          relatedId: currentId,
          message: `Next chain contains a cycle at block ${currentId}`,
        })
        break
      }
      path.add(currentId)
      currentId = graph[currentId].next
    }
    for (const id of path) completed.add(id)
  }

  const traversalState = new Map<string, 'active' | 'complete'>()
  for (const startId of Object.keys(graph)) {
    if (traversalState.has(startId)) continue
    const stack: { id: string; nextChildIndex: number }[] = [{ id: startId, nextChildIndex: 0 }]
    traversalState.set(startId, 'active')
    while (stack.length > 0) {
      const frame = stack.at(-1)
      if (!frame) break
      const children = graphChildren.get(frame.id) ?? []
      if (frame.nextChildIndex >= children.length) {
        traversalState.set(frame.id, 'complete')
        stack.pop()
        continue
      }
      const childId = children[frame.nextChildIndex]
      frame.nextChildIndex += 1
      const state = traversalState.get(childId)
      if (state === 'active') {
        issues.push({
          code: 'block-cycle',
          blockId: frame.id,
          relatedId: childId,
          message: `Block graph reference from ${frame.id} to ${childId} creates a cycle`,
        })
      } else if (state !== 'complete') {
        traversalState.set(childId, 'active')
        stack.push({ id: childId, nextChildIndex: 0 })
      }
    }
  }
  return issues
}

/**
 * Extract every target's generic block graph without projecting through Canonical IR.
 * @param project Scratch project JSON.
 * @returns Target graphs and their structural diagnostics.
 */
export const extractProjectBlockGraphs = (project: unknown): ScratchTargetBlockGraph[] => {
  if (!isRecord(project) || !isRecordArray(project.targets)) {
    throw new Error('Scratch project must contain a targets array')
  }

  return project.targets.map((target, index) => {
    if (typeof target.name !== 'string' || typeof target.isStage !== 'boolean') {
      throw new Error(`Scratch project target ${index} has invalid identity fields`)
    }
    const targetName = target.name
    const rawBlocks = target.blocks ?? {}
    if (!isRecord(rawBlocks)) throw new Error(`Scratch target ${targetName} blocks must be an object`)
    const malformedEntries = Object.entries(rawBlocks).filter(([, value]) => !isBlockNode(value))
    const blocks = copyScratchBlockGraph(
      Object.fromEntries(Object.entries(rawBlocks).filter(([, value]) => isBlockNode(value))),
    )
    const issues = malformedEntries.map(([blockId]) => ({
      code: 'invalid-node-property' as const,
      blockId,
      relatedId: 'opcode',
      message: `Scratch target ${targetName} entry ${blockId} is not a block node and was skipped during analysis`,
    }))
    return {
      targetIndex: index,
      targetName,
      isStage: target.isStage,
      blocks,
      issues: [...issues, ...validateScratchBlockGraph(blocks)],
    }
  })
}

/**
 * Replace each target's blocks while retaining all other project JSON fields.
 * @param project Original Scratch project JSON.
 * @param targetGraphs Graph snapshots returned by `extractProjectBlockGraphs`.
 * @returns A deep copy of the project with validated replacement graphs.
 */
export const replaceProjectBlockGraphs = (
  project: unknown,
  targetGraphs: readonly ScratchTargetBlockGraph[],
): Record<string, unknown> => {
  if (!isRecord(project) || !isRecordArray(project.targets)) {
    throw new Error('Scratch project must contain a targets array')
  }
  const targets = project.targets
  if (targetGraphs.length !== targets.length) {
    throw new Error('Replacement block graphs must cover every project target')
  }

  const replacementBlocks = targetGraphs.map((snapshot, index) => {
    const target = targets[index]
    if (
      snapshot.targetIndex !== index ||
      snapshot.targetName !== target.name ||
      snapshot.isStage !== target.isStage
    ) {
      throw new Error(`Replacement block graph does not match project target ${index}`)
    }
    const graph = copyScratchBlockGraph(snapshot.blocks)
    const issues = validateScratchBlockGraph(graph)
    if (issues.length > 0) {
      throw new Error(
        `Replacement block graph for target ${index} is invalid: ${issues.map(({ code }) => code).join(', ')}`,
      )
    }
    return graph
  })

  const result: unknown = structuredClone(project)
  if (!isRecord(result) || !isRecordArray(result.targets)) {
    throw new Error('Scratch project could not be copied')
  }
  const resultTargets = result.targets
  resultTargets.forEach((target, index) => {
    target.blocks = replacementBlocks[index]
  })
  return result
}

/**
 * Apply raw node patches to selected project targets while preserving all other JSON data.
 * @param project Scratch project JSON.
 * @param patches Target-identified block edits.
 * @returns A deep copy with validated block graph patches applied.
 */
export const patchProjectBlockGraphs = (
  project: unknown,
  patches: readonly ScratchTargetBlockPatch[],
): Record<string, unknown> => {
  if (!isRecord(project) || !isRecordArray(project.targets)) {
    throw new Error('Scratch project must contain a targets array')
  }
  const targets = project.targets
  const seen = new Set<number>()
  const patchedGraphs = new Map<number, ScratchBlockGraph>()
  for (const patch of patches) {
    const { targetIndex } = patch
    const target = targets[targetIndex]
    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= targets.length ||
      seen.has(targetIndex) ||
      patch.targetName !== target.name ||
      patch.isStage !== target.isStage
    ) {
      throw new Error(`Block patch does not match project target ${targetIndex}`)
    }
    seen.add(targetIndex)
    patchedGraphs.set(targetIndex, mergeScratchBlockGraph(copyScratchBlockGraph(target.blocks ?? {}), patch.blocks))
  }

  const result: unknown = structuredClone(project)
  if (!isRecord(result) || !isRecordArray(result.targets)) {
    throw new Error('Scratch project could not be copied')
  }
  for (const [index, graph] of patchedGraphs) result.targets[index].blocks = graph
  return result
}
