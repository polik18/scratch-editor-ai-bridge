import type { ScratchStorage } from '@scratch/scratch-storage'
import ScratchVM from '@scratch/scratch-vm'
import { createOfflineScratchStorage } from './storage'

export type Sb3Input = Blob | ArrayBuffer | ArrayBufferView
export type ScratchProjectJson = Record<string, unknown>

/**
 * Opaque handle to the Scratch VM.
 *
 * Callers intentionally do not receive the VM runtime shape. Access to runtime
 * internals is centralized in this adapter so later compiler/decompiler code
 * does not grow direct dependencies on Scratch VM private fields.
 */
export interface ScratchVMHandle {
  quit(): void
}

/**
 * Read-only target metadata that is safe for the rest of the bridge to use.
 * The underlying Scratch target contains more fields, but those stay behind
 * this adapter boundary.
 */
export interface ScratchTarget {
  readonly id: string
  readonly isStage: boolean
  readonly isOriginal: boolean
  getName(): string
}

export interface ScratchBlock {
  readonly id: string
  readonly opcode: string
  readonly next: string | null
  readonly parent: string | null
  readonly inputs: Readonly<Record<string, ScratchBlockInput>>
  readonly fields: Readonly<Record<string, ScratchBlockField>>
  readonly shadow: boolean
  readonly topLevel: boolean
  readonly mutation?: Readonly<Record<string, unknown>> | null
  readonly x?: number
  readonly y?: number
}

export interface ScratchBlockInput {
  readonly name: string
  readonly block: string | null
  readonly shadow: string | null
}

export interface ScratchBlockField {
  readonly name: string
  readonly value: unknown
  readonly id?: string | null
  readonly variableType?: string
}

interface ScratchBlockContainerInternal {
  readonly _blocks: Record<string, ScratchBlock>
}

interface ScratchTargetInternal extends ScratchTarget {
  readonly blocks: ScratchBlockContainerInternal
}

interface ScratchRuntimeInternal {
  readonly targets: ScratchTargetInternal[]
}

interface ScratchVMInternal extends ScratchVMHandle {
  readonly runtime: ScratchRuntimeInternal
  attachStorage(storage: ScratchStorage): void
  loadProject(input: string | object | ArrayBuffer | ArrayBufferView): Promise<void>
  saveProjectSb3(): Promise<Blob>
  toJSON(): string
}

const asInternalVM = (vm: ScratchVMHandle): ScratchVMInternal => vm as ScratchVMInternal

const targetHandles = new WeakMap<ScratchTarget, ScratchTargetInternal>()

const MAX_SB3_BYTES = 64 * 1024 * 1024
const MAX_SB3_ENTRIES = 2_048
const MAX_SB3_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_PROJECT_JSON_BYTES = 16 * 1024 * 1024
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50

const createTargetHandle = (target: ScratchTargetInternal): ScratchTarget => {
  const handle: ScratchTarget = Object.freeze({
    id: target.id,
    isStage: target.isStage,
    isOriginal: target.isOriginal,
    getName: () => target.getName(),
  })

  targetHandles.set(handle, target)
  return handle
}

const getInternalTarget = (target: ScratchTarget): ScratchTargetInternal => {
  const internalTarget = targetHandles.get(target)

  if (!internalTarget) {
    throw new Error('Scratch target handle was not created by getTargets()')
  }

  return internalTarget
}

const snapshotBlock = (block: ScratchBlock): ScratchBlock => {
  const inputs = Object.freeze(
    Object.fromEntries(Object.entries(block.inputs).map(([name, input]) => [name, Object.freeze({ ...input })])),
  )
  const fields = Object.freeze(
    Object.fromEntries(Object.entries(block.fields).map(([name, field]) => [name, Object.freeze({ ...field })])),
  )
  const mutation = block.mutation ? Object.freeze({ ...block.mutation }) : block.mutation

  return Object.freeze({
    id: block.id,
    opcode: block.opcode,
    next: block.next,
    parent: block.parent,
    inputs,
    fields,
    shadow: block.shadow,
    topLevel: block.topLevel,
    mutation,
    x: block.x,
    y: block.y,
  })
}

const normalizeSb3Input = async (file: Sb3Input): Promise<ArrayBuffer | ArrayBufferView> => {
  if (file instanceof Blob) {
    if (file.size > MAX_SB3_BYTES) throw new Error('SB3 exceeds the 64 MiB compressed-size limit')
    return file.arrayBuffer()
  }

  if (file.byteLength > MAX_SB3_BYTES) throw new Error('SB3 exceeds the 64 MiB compressed-size limit')
  return file
}

const asBytes = (input: ArrayBuffer | ArrayBufferView): Uint8Array =>
  input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

const validateSb3Archive = (input: ArrayBuffer | ArrayBufferView): void => {
  const bytes = asBytes(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557)
  let directoryEnd = -1

  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      directoryEnd = offset
      break
    }
  }
  if (directoryEnd < 0) throw new Error('The selected file is not a valid SB3 ZIP archive')

  const entryCount = view.getUint16(directoryEnd + 10, true)
  const directorySize = view.getUint32(directoryEnd + 12, true)
  const directoryOffset = view.getUint32(directoryEnd + 16, true)
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 SB3 archives are not supported')
  }
  if (entryCount === 0 || entryCount > MAX_SB3_ENTRIES) {
    throw new Error(`SB3 contains an unsupported number of files (${entryCount})`)
  }
  if (directoryOffset + directorySize > directoryEnd) {
    throw new Error('SB3 central directory is malformed')
  }

  const decoder = new TextDecoder()
  let offset = directoryOffset
  let totalUncompressedBytes = 0
  let hasProjectJson = false

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('SB3 central directory entry is malformed')
    }
    if ((view.getUint16(offset + 8, true) & 1) !== 0) throw new Error('Encrypted SB3 files are not supported')

    const uncompressedBytes = view.getUint32(offset + 24, true)
    const filenameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const entryEnd = offset + 46 + filenameLength + extraLength + commentLength
    if (entryEnd > directoryEnd) throw new Error('SB3 central directory entry exceeds archive bounds')

    totalUncompressedBytes += uncompressedBytes
    if (totalUncompressedBytes > MAX_SB3_UNCOMPRESSED_BYTES) {
      throw new Error('SB3 exceeds the 256 MiB uncompressed-size limit')
    }

    const filename = decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength))
    if (filename === 'project.json') {
      hasProjectJson = true
      if (uncompressedBytes > MAX_PROJECT_JSON_BYTES) {
        throw new Error('SB3 project.json exceeds the 16 MiB limit')
      }
    }
    offset = entryEnd
  }

  if (!hasProjectJson) throw new Error('SB3 archive does not contain project.json')
}

/**
 * Create a fresh official Scratch VM instance.
 * @returns An opaque handle to the initialized VM.
 */
export const createVM = (): ScratchVMHandle => {
  const vm = new ScratchVM() as unknown as ScratchVMInternal

  vm.attachStorage(createOfflineScratchStorage())
  return vm
}

/**
 * Load an SB3 into a VM. If no VM is supplied, a new one is created and
 * returned so browser upload flows can simply call `loadSb3(file)`.
 * @param file SB3 bytes or a browser Blob.
 * @param vm Optional existing VM to reuse.
 * @returns The VM containing the loaded project.
 */
export const loadSb3 = async (file: Sb3Input, vm?: ScratchVMHandle): Promise<ScratchVMHandle> => {
  const targetVM = vm ?? createVM()

  try {
    const input = await normalizeSb3Input(file)
    validateSb3Archive(input)
    await asInternalVM(targetVM).loadProject(input)
    return targetVM
  } catch (error) {
    if (!vm) {
      targetVM.quit()
    }
    throw error
  }
}

/**
 * Load a Scratch 3 project JSON object through Scratch VM's official loader.
 * @param project Scratch 3 project JSON.
 * @param vm Optional existing VM to reuse.
 * @returns The VM containing the loaded project.
 */
export const loadProjectJson = async (
  project: ScratchProjectJson,
  vm?: ScratchVMHandle,
): Promise<ScratchVMHandle> => {
  const targetVM = vm ?? createVM()

  try {
    await asInternalVM(targetVM).loadProject(project)
    return targetVM
  } catch (error) {
    if (!vm) {
      targetVM.quit()
    }
    throw error
  }
}

/**
 * Serialize the VM's current project to Scratch 3 project JSON through Scratch VM.
 * @param vm VM to serialize.
 * @returns Scratch 3 project JSON.
 */
export const getProjectJson = (vm: ScratchVMHandle): ScratchProjectJson => {
  const json = asInternalVM(vm).toJSON()
  return JSON.parse(json) as ScratchProjectJson
}

/**
 * Serialize the current VM project using Scratch VM's official SB3 writer.
 * @param vm VM to serialize.
 * @returns An SB3 Blob.
 */
export const saveSb3 = async (vm: ScratchVMHandle): Promise<Blob> => asInternalVM(vm).saveProjectSb3()

/**
 * Return the original project targets (stage and sprites), excluding runtime clones.
 * @param vm VM whose targets should be inspected.
 * @returns Read-only target handles.
 */
export const getTargets = (vm: ScratchVMHandle): readonly ScratchTarget[] =>
  Object.freeze(
    asInternalVM(vm)
      .runtime.targets.filter((target) => target.isOriginal)
      .map(createTargetHandle),
  )

/**
 * Return a stable read-only snapshot of all blocks owned by a target.
 *
 * Scratch VM currently has no public "get all blocks" method. The private
 * `_blocks` access is intentionally isolated here instead of leaking it into
 * compiler/decompiler modules.
 * @param target Target returned by getTargets().
 * @returns Read-only block snapshots.
 */
export const getBlocks = (target: ScratchTarget): readonly ScratchBlock[] =>
  Object.freeze(Object.values(getInternalTarget(target).blocks._blocks).map(snapshotBlock))
