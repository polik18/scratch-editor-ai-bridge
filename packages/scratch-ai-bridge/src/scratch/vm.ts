import type { ScratchStorage } from '@scratch/scratch-storage'
import ScratchVM from '@scratch/scratch-vm'
import parseScratchProject from './csp-scratch-parser'
import {
  DISABLED_SCRATCH_EXTENSION_IDS,
  SCRATCH_LINK_HARDWARE_EXTENSION_IDS,
  LOCAL_SCRATCH_EXTENSION_IDS,
} from './extensions'
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

export interface ScratchVariableSnapshot {
  readonly id: string
  readonly name: string
  readonly value: unknown
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
  readonly variables: Record<string, ScratchVariableSnapshot>
  readonly drawableID: number | null
  readonly draggable: boolean
  readonly x: number
  readonly y: number
  goToFront(): void
}

interface ScratchRuntimeInternal {
  readonly targets: ScratchTargetInternal[]
  getTargetById(id: string): ScratchTargetInternal | null
  _step(): void
  handleProjectLoaded(): void
}

interface ScratchVMInternal extends ScratchVMHandle {
  readonly runtime: ScratchRuntimeInternal
  readonly renderer: {
    draw(): void
    getNativeSize(): [number, number]
    pick(
      centerX: number,
      centerY: number,
      touchWidth?: number,
      touchHeight?: number,
      candidateIDs?: number[],
    ): number | null
  } | null
  readonly extensionManager: {
    loadExtensionURL(extensionURL: string): Promise<unknown>
  }
  start(): void
  greenFlag(): void
  stopAll(): void
  startDrag(targetId: string): void
  stopDrag(targetId: string): void
  postSpriteInfo(data: Record<string, unknown>): void
  getTargetIdForDrawableId(drawableId: number): string | null
  postIOData(device: string, data: Record<string, unknown>): void
  scanForPeripheral(extensionId: string): void
  connectPeripheral(extensionId: string, peripheralId: string | number): void
  disconnectPeripheral(extensionId: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
  attachAudioEngine(audioEngine: { audioContext: AudioContext }): void
  attachStorage(storage: ScratchStorage): void
  attachRenderer(renderer: { draw(): void }): void
  attachV2BitmapAdapter(adapter: {
    resize(image: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement
    convertDataURIToBinary(dataURI: string): Uint8Array
  }): void
  loadProject(input: string | object | ArrayBuffer | ArrayBufferView): Promise<void>
  deserializeProject(projectJSON: ScratchProjectJson, zip: unknown): Promise<void>
  saveProjectSb3(): Promise<Blob>
  toJSON(): string
}

export interface ScratchPeripheralInfo {
  readonly peripheralId: string | number
  readonly peripheralName?: string
  readonly name?: string
}

export type ScratchPeripheralEvent =
  | 'PERIPHERAL_LIST_UPDATE'
  | 'PERIPHERAL_CONNECTED'
  | 'PERIPHERAL_DISCONNECTED'
  | 'PERIPHERAL_SCAN_TIMEOUT'
  | 'PERIPHERAL_REQUEST_ERROR'

/**
 * Start a hardware scan for an extension exposed by the preview UI.
 * @param vm Preview VM.
 * @param extensionId Allowlisted bundled Scratch hardware extension ID.
 */
export const scanScratchPeripheral = (vm: ScratchVMHandle, extensionId: string): void => {
  if (!SCRATCH_LINK_HARDWARE_EXTENSION_IDS.has(extensionId)) throw new Error('Unsupported hardware extension')
  asInternalVM(vm).scanForPeripheral(extensionId)
}

/**
 * Load a bundled hardware adapter declared by the preview project.
 * @param vm Isolated VM that will own the adapter instance.
 * @param extensionId ID of a locally bundled Scratch hardware adapter.
 * @returns A promise resolved when the local adapter is initialized.
 */
export const loadPreviewHardwareExtension = (vm: ScratchVMHandle, extensionId: string): Promise<unknown> => {
  if (!SCRATCH_LINK_HARDWARE_EXTENSION_IDS.has(extensionId))
    return Promise.reject(new Error('Unsupported hardware extension'))
  return asInternalVM(vm).extensionManager.loadExtensionURL(extensionId)
}

/**
 * Connect a discovered hardware peripheral.
 * @param vm Preview VM.
 * @param extensionId Allowlisted bundled Scratch hardware extension ID.
 * @param peripheralId ID reported by Scratch Link discovery.
 */
export const connectScratchPeripheral = (
  vm: ScratchVMHandle,
  extensionId: string,
  peripheralId: string | number,
): void => {
  if (!SCRATCH_LINK_HARDWARE_EXTENSION_IDS.has(extensionId)) throw new Error('Unsupported hardware extension')
  asInternalVM(vm).connectPeripheral(extensionId, peripheralId)
}

/**
 * Disconnect an extension's current peripheral.
 * @param vm Preview VM.
 * @param extensionId Allowlisted bundled Scratch hardware extension ID.
 */
export const disconnectScratchPeripheral = (vm: ScratchVMHandle, extensionId: string): void => {
  if (!SCRATCH_LINK_HARDWARE_EXTENSION_IDS.has(extensionId)) throw new Error('Unsupported hardware extension')
  asInternalVM(vm).disconnectPeripheral(extensionId)
}

/**
 * Subscribe to one Scratch VM hardware event.
 * @param vm Preview VM.
 * @param event Hardware event to observe.
 * @param listener Event callback.
 * @returns A function that removes the listener.
 */
export const subscribeScratchPeripheralEvent = (
  vm: ScratchVMHandle,
  event: ScratchPeripheralEvent,
  listener: (...args: unknown[]) => void,
): (() => void) => {
  const internalVM = asInternalVM(vm)
  internalVM.on(event, listener)
  return () => internalVM.removeListener(event, listener)
}

const asInternalVM = (vm: ScratchVMHandle): ScratchVMInternal => vm as ScratchVMInternal

const parseScratchProjectAsync = (
  input: string | ArrayBuffer | ArrayBufferView,
): Promise<[ScratchProjectJson, unknown]> =>
  new Promise((resolve, reject) => {
    parseScratchProject(input, false, (error, result) => {
      if (error) {
        reject(error instanceof Error ? error : new Error('Scratch project parsing failed', { cause: error }))
        return
      }
      if (!result) {
        reject(new Error('Scratch parser returned no project'))
        return
      }
      resolve(result)
    })
  })

const loadParsedProject = async (
  vm: ScratchVMInternal,
  input: string | ArrayBuffer | ArrayBufferView,
): Promise<void> => {
  try {
    const [project, zip] = await parseScratchProjectAsync(input)
    await vm.deserializeProject(project, zip)
    vm.runtime.handleProjectLoaded()
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'validationError' in error) {
      // Keep the JSON-string schema rejection used by Scratch VM's public loader.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve Scratch VM's legacy rejection type.
      return Promise.reject(JSON.stringify(error))
    }
    throw error
  }
}

const targetHandles = new WeakMap<ScratchTarget, ScratchTargetInternal>()
const bitmapAdapterPromises = new WeakMap<ScratchVMHandle, Promise<void>>()
const previewAudioContexts = new WeakMap<ScratchVMHandle, AudioContext>()

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
  const loadExtensionURL = vm.extensionManager.loadExtensionURL.bind(vm.extensionManager)

  // Scratch VM treats an unknown extension ID as a worker script URL. Keep
  // unknown blocks in the project graph, but never let imported project data
  // choose executable code to load into the page.
  vm.extensionManager.loadExtensionURL = (extensionURL) =>
    LOCAL_SCRATCH_EXTENSION_IDS.has(extensionURL) && !DISABLED_SCRATCH_EXTENSION_IDS.has(extensionURL)
      ? loadExtensionURL(extensionURL)
      : Promise.resolve()

  vm.attachStorage(createOfflineScratchStorage())
  return vm
}

/**
 * Create a VM for interactive preview with Scratch's official audio engine.
 * Its AudioContext is closed when the VM quits.
 * @param wrapFetch Optional wrapper for this VM's network fetch function.
 * @returns An audio-enabled Scratch VM handle.
 */
export const createPreviewVM = async (
  wrapFetch?: (fetcher: typeof fetch) => typeof fetch,
): Promise<ScratchVMHandle> => {
  const originalFetch = globalThis.fetch
  if (wrapFetch) globalThis.fetch = wrapFetch(originalFetch.bind(globalThis))
  try {
    const vm = asInternalVM(createVM())
    const { default: ScratchAudio } = await import('scratch-audio')
    const audioEngine = new ScratchAudio()
    const decodeSoundPlayer = audioEngine.decodeSoundPlayer.bind(audioEngine)
    audioEngine.decodeSoundPlayer = (sound: unknown) => {
      const soundRecord = sound as { data?: { buffer?: unknown } }
      const importedAsset = soundRecord.data?.buffer
      const assetUrl =
        typeof importedAsset === 'object' && importedAsset !== null && 'default' in importedAsset
          ? importedAsset.default
          : importedAsset
      if (typeof assetUrl !== 'string') return decodeSoundPlayer(sound)

      return fetch(new URL(assetUrl, import.meta.url))
        .then((response) => {
          if (!response.ok) throw new Error(`Could not load bundled Scratch sound (${response.status})`)
          return response.arrayBuffer()
        })
        .then((buffer) => decodeSoundPlayer({ ...soundRecord, data: { ...soundRecord.data, buffer } }))
    }
    vm.attachAudioEngine(audioEngine)
    previewAudioContexts.set(vm, audioEngine.audioContext)
    const quit = vm.quit.bind(vm)
    vm.quit = () => {
      quit()
      if (wrapFetch) globalThis.fetch = originalFetch
      if (audioEngine.audioContext.state !== 'closed') {
        void audioEngine.audioContext.close().catch(() => undefined)
      }
    }
    return vm
  } catch (error) {
    if (wrapFetch) globalThis.fetch = originalFetch
    throw error
  }
}

/**
 * Resume interactive preview audio after a real keyboard or pointer gesture.
 * @param vm Preview VM whose audio context should resume.
 */
export const resumePreviewAudio = (vm: ScratchVMHandle): void => {
  const audioContext = previewAudioContexts.get(vm)
  if (audioContext?.state === 'suspended') void audioContext.resume().catch(() => undefined)
}

const attachBitmapAdapter = (vm: ScratchVMHandle): Promise<void> => {
  let adapterPromise = bitmapAdapterPromises.get(vm)
  if (!adapterPromise) {
    adapterPromise = import('@scratch/scratch-svg-renderer').then(({ BitmapAdapter }) => {
      asInternalVM(vm).attachV2BitmapAdapter(new BitmapAdapter())
    })
    bitmapAdapterPromises.set(vm, adapterPromise)
  }
  return adapterPromise
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
    await attachBitmapAdapter(targetVM)
    await loadParsedProject(asInternalVM(targetVM), input)
    return targetVM
  } catch (error) {
    if (!vm) {
      targetVM.quit()
    }
    throw error
  }
}

/**
 * Attach Scratch's renderer before loading bitmap costumes that require VM skin creation.
 * @param vm VM that will load a project with bitmap assets.
 * @returns Nothing.
 */
export const prepareVmForBitmapAssetImport = async (vm: ScratchVMHandle): Promise<() => void> => {
  const internalVM = asInternalVM(vm)
  if (internalVM.renderer) return () => undefined
  if (typeof document === 'undefined') {
    throw new Error('Importing bitmap costumes requires a browser canvas renderer')
  }
  const { default: ScratchRender } = await import('@scratch/scratch-render')
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 360
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.position = 'fixed'
  canvas.style.left = '-10000px'
  canvas.style.top = '0'
  document.body.append(canvas)
  try {
    internalVM.attachRenderer(new ScratchRender(canvas))
  } catch (error) {
    canvas.remove()
    throw error
  }
  return () => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    canvas.remove()
  }
}

/**
 * Render an imported SB3's initial stage state through the official Scratch renderer.
 * Project scripts are not started; the canvas shows the saved positions and costumes.
 * @param file Scratch SB3 archive bytes.
 * @param vm Scratch VM instance to reuse.
 * @param canvas Canvas receiving the rendered stage.
 */
export const renderSb3Preview = async (
  file: Sb3Input,
  vm: ScratchVMHandle,
  canvas: HTMLCanvasElement,
): Promise<void> => {
  const internalVM = asInternalVM(vm)
  if (!internalVM.renderer) {
    const { default: ScratchRender } = await import('@scratch/scratch-render')
    internalVM.attachRenderer(new ScratchRender(canvas))
  }
  await loadSb3(file, vm)
  const renderer = internalVM.renderer
  if (!renderer) throw new Error('Scratch renderer did not attach to the VM')
  renderer.draw()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  renderer.draw()
}

/**
 * Start Scratch's browser runtime after an initial stage render.
 * @param vm Loaded VM instance.
 */
export const startProjectRuntime = (vm: ScratchVMHandle): void => {
  const internalVM = asInternalVM(vm)
  internalVM.start()
  internalVM.greenFlag()
}

/**
 * Stop all scripts and block threads without exposing the VM runtime object.
 * @param vm VM instance to stop.
 * @returns Nothing.
 */
export const stopProjectRuntime = (vm: ScratchVMHandle): void => asInternalVM(vm).stopAll()

/**
 * Forward an explicit browser input event through Scratch VM's public IO channel.
 * @param vm VM that receives input.
 * @param device Scratch IO device name.
 * @param data Device event values.
 * @returns Nothing.
 */
export const postScratchIOData = (vm: ScratchVMHandle, device: string, data: Record<string, unknown>): void =>
  asInternalVM(vm).postIOData(device, data)

export interface ScratchPreviewDragState {
  readonly targetId: string
  readonly offsetX: number
  readonly offsetY: number
}

/**
 * Begin a player-style drag for a draggable target under the stage pointer.
 * Coordinates are CSS pixels relative to the preview canvas, matching Scratch GUI.
 * @param vm VM receiving the drag interaction.
 * @param x Pointer position relative to the preview canvas.
 * @param y Pointer position relative to the preview canvas.
 * @param canvasWidth Preview canvas width in CSS pixels.
 * @param canvasHeight Preview canvas height in CSS pixels.
 * @returns Target and stage-coordinate offset, or null when no draggable target was hit.
 */
export const startScratchPreviewDrag = (
  vm: ScratchVMHandle,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): ScratchPreviewDragState | null => {
  const internalVM = asInternalVM(vm)
  const renderer = internalVM.renderer
  if (!renderer || canvasWidth <= 0 || canvasHeight <= 0) return null
  const targets = internalVM.runtime.targets.filter(
    (target) => Number.isFinite(target.drawableID) && target.draggable,
  )
  if (targets.length === 0) return null
  const drawableIds = targets.flatMap((target) =>
    typeof target.drawableID === 'number' && Number.isFinite(target.drawableID) ? [target.drawableID] : [],
  )
  const drawableId = renderer.pick(x, y, 1, 1, drawableIds)
  if (drawableId === null) return null
  const targetId = internalVM.getTargetIdForDrawableId(drawableId)
  if (targetId === null) return null
  const target = internalVM.runtime.getTargetById(targetId)
  if (!target) return null
  const nativeSize = renderer.getNativeSize()
  const scratchMouseX = (nativeSize[0] / canvasWidth) * (x - canvasWidth / 2)
  const scratchMouseY = (nativeSize[1] / canvasHeight) * (y - canvasHeight / 2)
  const state = {
    targetId,
    offsetX: target.x - scratchMouseX,
    offsetY: -(target.y + scratchMouseY),
  }
  target.goToFront()
  internalVM.startDrag(targetId)
  return state
}

/**
 * Move the active player-style drag using Scratch's native stage coordinates.
 * @param vm VM receiving the drag movement.
 * @param drag Drag state returned by startScratchPreviewDrag.
 * @param x Pointer position relative to the preview canvas.
 * @param y Pointer position relative to the preview canvas.
 * @param canvasWidth Preview canvas width in CSS pixels.
 * @param canvasHeight Preview canvas height in CSS pixels.
 */
export const moveScratchPreviewDrag = (
  vm: ScratchVMHandle,
  drag: ScratchPreviewDragState,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): void => {
  const renderer = asInternalVM(vm).renderer
  if (!renderer || canvasWidth <= 0 || canvasHeight <= 0) return
  const nativeSize = renderer.getNativeSize()
  const scratchMouseX = (nativeSize[0] / canvasWidth) * (x - canvasWidth / 2)
  const scratchMouseY = (nativeSize[1] / canvasHeight) * (y - canvasHeight / 2)
  asInternalVM(vm).postSpriteInfo({
    x: scratchMouseX + drag.offsetX,
    y: -(scratchMouseY + drag.offsetY),
    force: true,
  })
}

/**
 * End an active player-style drag.
 * @param vm VM whose drag interaction should end.
 * @param drag Active drag state.
 * @returns Nothing.
 */
export const stopScratchPreviewDrag = (vm: ScratchVMHandle, drag: ScratchPreviewDragState): void =>
  asInternalVM(vm).stopDrag(drag.targetId)

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
    await loadParsedProject(asInternalVM(targetVM), JSON.stringify(project))
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

/**
 * Start the loaded project and advance its runtime by a bounded number of ticks.
 * This deterministic execution hook is intended for validation and integration
 * checks; it does not run the VM's browser timer loop.
 * @param vm VM to execute.
 * @param ticks Number of synchronous runtime ticks to execute.
 */
export const runForTicks = (vm: ScratchVMHandle, ticks: number): void => {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 100_000) {
    throw new Error('Scratch VM tick count must be an integer between 0 and 100000')
  }

  const internalVM = asInternalVM(vm)
  internalVM.start()
  internalVM.greenFlag()
  for (let tick = 0; tick < ticks; tick += 1) internalVM.runtime._step()
}

/**
 * Start the loaded project and advance it while yielding between runtime ticks
 * so Promise-returning Scratch blocks can finish their current step.
 * @param vm VM to execute.
 * @param ticks Number of bounded runtime ticks to execute.
 */
export const runForTicksAsync = async (vm: ScratchVMHandle, ticks: number): Promise<void> => {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 100_000) {
    throw new Error('Scratch VM tick count must be an integer between 0 and 100000')
  }

  const internalVM = asInternalVM(vm)
  internalVM.start()
  internalVM.greenFlag()
  for (let tick = 0; tick < ticks; tick += 1) {
    internalVM.runtime._step()
    await Promise.resolve()
  }
}

/**
 * Read a variable from an original target by its visible name.
 * @param vm VM containing the loaded project.
 * @param targetName Stage or sprite name.
 * @param variableName Visible variable name.
 * @returns A frozen variable snapshot, or undefined when not found.
 */
export const getVariable = (
  vm: ScratchVMHandle,
  targetName: string,
  variableName: string,
): ScratchVariableSnapshot | undefined => {
  const target = asInternalVM(vm).runtime.targets.find(
    (candidate) => candidate.isOriginal && candidate.getName() === targetName,
  )
  const variable = target && Object.values(target.variables).find((candidate) => candidate.name === variableName)
  return variable ? Object.freeze({ id: variable.id, name: variable.name, value: variable.value }) : undefined
}
