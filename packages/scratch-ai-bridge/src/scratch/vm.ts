import type { ScratchStorage } from '@scratch/scratch-storage'
import ScratchVM from '@scratch/scratch-vm'
import { parseProgressTargets, type ProgressTargetState } from '../core/progress/target-state'
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

interface ScratchVariableInternal extends Omit<ScratchVariableSnapshot, 'value'> {
  value: unknown
  type: string
  isCloud: boolean
}

interface ScratchTargetInternal extends ScratchTarget {
  readonly blocks: ScratchBlockContainerInternal
  readonly variables: Record<string, ScratchVariableInternal>
  readonly drawableID: number | null
  readonly draggable: boolean
  x: number
  y: number
  direction: number
  size: number
  visible: boolean
  currentCostume: number
  volume: number
  tempo: number
  setXY(x: number, y: number, force?: boolean): void
  setDirection(direction: number): void
  setSize(size: number): void
  setVisible(visible: boolean): void
  setCostume(index: number): void
  getCostumes(): readonly { readonly name: string }[]
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
export const createVM = async (): Promise<ScratchVMHandle> => {
  const vm = new ScratchVM() as unknown as ScratchVMInternal
  const loadExtensionURL = vm.extensionManager.loadExtensionURL.bind(vm.extensionManager)

  // Scratch VM treats an unknown extension ID as a worker script URL. Keep
  // unknown blocks in the project graph, but never let imported project data
  // choose executable code to load into the page.
  vm.extensionManager.loadExtensionURL = (extensionURL) =>
    LOCAL_SCRATCH_EXTENSION_IDS.has(extensionURL) && !DISABLED_SCRATCH_EXTENSION_IDS.has(extensionURL)
      ? loadExtensionURL(extensionURL)
      : Promise.resolve()

  vm.attachStorage(await createOfflineScratchStorage())
  return vm as ScratchVMHandle
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
    const vm = asInternalVM(await createVM())
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
    adapterPromise = import('@scratch/scratch-svg-renderer').then((rendererModule) => {
      // The workspace renderer is CommonJS and its interop shape differs
      // between Node, Vite and the published browser bundle.
      const moduleDefault = rendererModule.default as unknown as
        { BitmapAdapter?: new () => Parameters<ScratchVMInternal['attachV2BitmapAdapter']>[0] } | undefined
      const BitmapAdapter = rendererModule.BitmapAdapter ?? moduleDefault?.BitmapAdapter
      if (typeof BitmapAdapter !== 'function') {
        throw new Error('Scratch SVG renderer does not export a BitmapAdapter constructor')
      }
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
export const loadSb3 = async (
  file: Sb3Input,
  vm?: ScratchVMHandle,
  onProgress?: (stage: string) => void,
): Promise<ScratchVMHandle> => {
  const targetVM = vm ?? (await createVM())

  try {
    const input = await normalizeSb3Input(file)
    onProgress?.('SB3 封裝已讀取。')
    validateSb3Archive(input)
    onProgress?.('SB3 封裝驗證完成。')
    await attachBitmapAdapter(targetVM)
    onProgress?.('Scratch 素材轉接器已就緒。')
    await loadParsedProject(asInternalVM(targetVM), input)
    onProgress?.('Scratch 專案資料載入完成。')
    return targetVM
  } catch (error) {
    if (!vm) {
      try {
        const resolvedVM = await targetVM
        resolvedVM.quit()
      } catch {
        // Ignore quit errors during cleanup
      }
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
  onProgress?: (stage: string) => void,
): Promise<void> => {
  const internalVM = asInternalVM(vm)
  if (!internalVM.renderer) {
    const { default: ScratchRender } = await import('@scratch/scratch-render')
    onProgress?.('舞台繪圖器已載入。')
    internalVM.attachRenderer(new ScratchRender(canvas))
  }
  onProgress?.('正在匯入 Scratch 專案資料。')
  await loadSb3(file, vm, onProgress)
  onProgress?.('專案資料匯入完成，正在繪製舞台。')
  const renderer = internalVM.renderer
  if (!renderer) throw new Error('Scratch renderer did not attach to the VM')
  renderer.draw()
  await new Promise<void>((resolve) => {
    const fallback = window.setTimeout(resolve, 100)
    requestAnimationFrame(() => {
      window.clearTimeout(fallback)
      resolve()
    })
  })
  onProgress?.('舞台首幀已繪製。')
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
  const targetVM = vm ?? (await createVM())

  try {
    await loadParsedProject(asInternalVM(targetVM), JSON.stringify(project))
    return targetVM
  } catch (error) {
    if (!vm) {
      try {
        const resolvedVM = await targetVM
        resolvedVM.quit()
      } catch {
        // Ignore quit errors during cleanup
      }
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

export interface ScratchRuntimeVariableUpdate {
  readonly op: 'set-variable'
  readonly targetName: string
  readonly variableName: string
  readonly value: string | number | boolean
}

export interface ScratchRuntimeTargetPropertyUpdate {
  readonly op: 'set-target-property'
  readonly targetName: string
  readonly property: 'x' | 'y' | 'direction' | 'size' | 'visible' | 'currentCostume'
  readonly value: string | number | boolean
}

export interface ScratchRuntimeStagePropertyUpdate {
  readonly op: 'set-stage-property'
  readonly property: 'tempo' | 'volume' | 'backdropIndex'
  readonly value: number
}

export type ScratchRuntimePatchUpdate =
  ScratchRuntimeVariableUpdate | ScratchRuntimeTargetPropertyUpdate | ScratchRuntimeStagePropertyUpdate

export type ScratchRuntimePatchChange = ScratchRuntimePatchUpdate & {
  readonly beforeValue: string | number | boolean
}

/**
 * Atomically update existing, non-cloud scalar variables in a running preview VM.
 * VM internals stay confined to this adapter and list/broadcast storage is excluded.
 */
export const setRuntimePatchValues = (
  vm: ScratchVMHandle,
  updates: readonly ScratchRuntimePatchUpdate[],
): readonly ScratchRuntimePatchChange[] => {
  if (updates.length < 1 || updates.length > 20) throw new Error('Runtime patch must contain 1–20 operations.')
  const runtime = asInternalVM(vm).runtime
  const seen = new Set<string>()
  const prepared = updates.map((update) => {
    let key: string
    let beforeValue: string | number | boolean
    let apply: (value: string | number | boolean) => void
    if (update.op === 'set-variable') {
      if (
        (typeof update.value !== 'string' && typeof update.value !== 'number' && typeof update.value !== 'boolean') ||
        (typeof update.value === 'number' &&
          (!Number.isFinite(update.value) || Math.abs(update.value) > 1_000_000)) ||
        (typeof update.value === 'string' && update.value.length > 512)
      )
        throw new Error(`Invalid value for ${update.targetName}/${update.variableName}.`)
      key = `variable\u0000${update.targetName}\u0000${update.variableName}`
      const targets = runtime.targets.filter((target) => target.isOriginal && target.getName() === update.targetName)
      if (targets.length !== 1) throw new Error(`Could not resolve target ${update.targetName}.`)
      const matches = Object.values(targets[0]!.variables).filter((variable) => variable.name === update.variableName)
      if (matches.length !== 1)
        throw new Error(`Could not resolve variable ${update.targetName}/${update.variableName}.`)
      const variable = matches[0]!
      if (variable.type !== '' || variable.isCloud)
        throw new Error(
          `Only existing non-cloud scalar variables can be changed (${update.targetName}/${update.variableName}).`,
        )
      if (
        typeof variable.value !== 'string' &&
        typeof variable.value !== 'number' &&
        typeof variable.value !== 'boolean'
      )
        throw new Error(`Variable ${update.targetName}/${update.variableName} does not contain a scalar value.`)
      beforeValue = variable.value
      apply = (value) => {
        variable.value = value
      }
    } else if (update.op === 'set-target-property') {
      key = `target\u0000${update.targetName}\u0000${update.property}`
      const matches = runtime.targets.filter(
        (target) => target.isOriginal && !target.isStage && target.getName() === update.targetName,
      )
      if (matches.length !== 1) throw new Error(`Could not resolve unique sprite ${update.targetName}.`)
      const target = matches[0]!
      const property = update.property
      const numberValue = typeof update.value === 'number' ? update.value : NaN
      if (property === 'visible') {
        if (typeof update.value !== 'boolean') throw new Error('visible must be a boolean.')
        beforeValue = target.visible
        apply = (value) => target.setVisible(value as boolean)
      } else if (property === 'currentCostume') {
        if (!Number.isSafeInteger(numberValue) || numberValue < 0 || numberValue >= target.getCostumes().length)
          throw new Error('currentCostume is outside the costume range.')
        beforeValue = target.currentCostume
        apply = (value) => target.setCostume(value as number)
      } else {
        const limits =
          property === 'x'
            ? [-240, 240]
            : property === 'y'
              ? [-180, 180]
              : property === 'size'
                ? [1, 500]
                : [-180, 180]
        if (!Number.isFinite(numberValue) || numberValue < limits[0]! || numberValue > limits[1]!)
          throw new Error(`${property} is outside the supported range.`)
        beforeValue = target[property]
        apply = (value) => {
          if (property === 'x') target.setXY(value as number, target.y, true)
          else if (property === 'y') target.setXY(target.x, value as number, true)
          else if (property === 'direction') target.setDirection(value as number)
          else if (asInternalVM(vm).renderer) target.setSize(value as number)
          else target.size = value as number
        }
      }
    } else {
      key = `stage\u0000${update.property}`
      const stages = runtime.targets.filter((target) => target.isOriginal && target.isStage)
      if (stages.length !== 1) throw new Error('Could not resolve unique Stage target.')
      const stage = stages[0]!
      if (!Number.isFinite(update.value)) throw new Error(`${update.property} must be finite.`)
      if (update.property === 'tempo') {
        if (update.value < 20 || update.value > 500) throw new Error('tempo is outside the supported range.')
        beforeValue = stage.tempo
        apply = (value) => {
          stage.tempo = value as number
        }
      } else if (update.property === 'volume') {
        if (update.value < 0 || update.value > 100) throw new Error('volume is outside the supported range.')
        beforeValue = stage.volume
        apply = (value) => {
          stage.volume = value as number
        }
      } else {
        if (!Number.isSafeInteger(update.value) || update.value < 0 || update.value >= stage.getCostumes().length)
          throw new Error('backdropIndex is outside the costume range.')
        beforeValue = stage.currentCostume
        apply = (value) => stage.setCostume(value as number)
      }
    }
    if (seen.has(key)) throw new Error(`Duplicate runtime patch operation ${key}.`)
    seen.add(key)
    return { update, beforeValue, apply }
  })

  try {
    for (const item of prepared) item.apply(item.update.value)
  } catch (error) {
    for (const item of prepared) item.apply(item.beforeValue)
    throw error
  }
  return Object.freeze(
    prepared.map(({ update, beforeValue }) =>
      Object.freeze({
        ...update,
        beforeValue,
      }),
    ),
  )
}

export interface ScratchProgressVariable {
  readonly targetName: string
  readonly isStage: boolean
  readonly id: string
  readonly name: string
  readonly type: '' | 'list'
  readonly value: string | number | boolean | readonly (string | number | boolean)[]
}

const isProgressScalar = (value: unknown): value is string | number | boolean =>
  (typeof value === 'string' && value.length <= 512) ||
  (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000) ||
  typeof value === 'boolean'

/**
 * Capture bounded non-cloud variables and lists of original targets.
 * @param vm Running Scratch VM.
 * @returns Progress values that can be restored to the same project.
 */
export const captureScratchProgress = (vm: ScratchVMHandle): readonly ScratchProgressVariable[] => {
  const targets = asInternalVM(vm).runtime.targets.filter((target) => target.isOriginal)
  const names = targets.map((target) => target.getName())
  if (new Set(names).size !== names.length) throw new Error('Progress cannot identify targets with duplicate names.')
  const result: ScratchProgressVariable[] = []
  for (const target of targets) {
    for (const variable of Object.values(target.variables)) {
      if (variable.isCloud || (variable.type !== '' && variable.type !== 'list')) continue
      const value = variable.value
      if (variable.type === '' && !isProgressScalar(value)) throw new Error(`Unsupported value in ${variable.name}.`)
      if (
        variable.type === 'list' &&
        (!Array.isArray(value) || value.length > 1000 || !value.every(isProgressScalar))
      )
        throw new Error(`Unsupported list in ${variable.name}.`)
      result.push({
        targetName: target.getName(),
        isStage: target.isStage,
        id: variable.id,
        name: variable.name,
        type: variable.type,
        value: Array.isArray(value)
          ? ([...(value as unknown[])] as (string | number | boolean)[])
          : (value as string | number | boolean),
      })
      if (result.length > 200) throw new Error('Progress exceeds 200 variables and lists.')
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 128 * 1024)
    throw new Error('Progress exceeds 128 KiB.')
  return result
}

/**
 * Capture the visual state of original sprites and the stage.
 * @param vm Running Scratch VM.
 * @returns Validated target states.
 */
export const captureScratchTargetProgress = (vm: ScratchVMHandle): readonly ProgressTargetState[] => {
  const targets = asInternalVM(vm).runtime.targets.filter((target) => target.isOriginal)
  if (targets.some((target) => target.currentCostume < 0 || target.currentCostume >= target.getCostumes().length))
    throw new Error('A target has no valid costume to save.')
  return parseProgressTargets(
    targets.map((target) =>
      target.isStage
        ? { name: target.getName(), isStage: true, currentCostume: target.currentCostume }
        : {
            name: target.getName(),
            isStage: false,
            currentCostume: target.currentCostume,
            x: target.x,
            y: target.y,
            direction: target.direction,
            size: target.size,
            visible: target.visible,
          },
    ),
  )
}

/**
 * Validate the whole progress snapshot before restoring any variable.
 * @param vm Running Scratch VM.
 * @param snapshot Untrusted progress entries.
 * @param targetSnapshot Optional original target states.
 * @param validateOnly Validate without changing the VM.
 */
export const restoreScratchProgress = (
  vm: ScratchVMHandle,
  snapshot: unknown,
  targetSnapshot?: unknown,
  validateOnly = false,
): void => {
  if (
    !Array.isArray(snapshot) ||
    snapshot.length > 200 ||
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 128 * 1024
  )
    throw new Error('Invalid or oversized progress snapshot.')
  const targets = asInternalVM(vm).runtime.targets.filter((target) => target.isOriginal)
  const seen = new Set<string>()
  const updates = snapshot.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('Invalid progress entry.')
    const entry = item as Record<string, unknown>
    if (
      Object.keys(entry).some((key) => !['targetName', 'isStage', 'id', 'name', 'type', 'value'].includes(key)) ||
      typeof entry.targetName !== 'string' ||
      typeof entry.isStage !== 'boolean' ||
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string' ||
      (entry.type !== '' && entry.type !== 'list')
    )
      throw new Error('Invalid progress entry fields.')
    const key = JSON.stringify([entry.targetName, entry.id])
    if (seen.has(key)) throw new Error('Duplicate progress entry.')
    seen.add(key)
    const matches = targets.filter(
      (target) => target.getName() === entry.targetName && target.isStage === entry.isStage,
    )
    if (matches.length !== 1) throw new Error('Progress target is missing or ambiguous.')
    if (!Object.hasOwn(matches[0].variables, entry.id))
      throw new Error('Progress variable does not match this project.')
    const variable = matches[0].variables[entry.id]
    if (variable.isCloud || variable.type !== entry.type || variable.name !== entry.name)
      throw new Error('Progress variable does not match this project.')
    const value = entry.value
    if (
      entry.type === ''
        ? !isProgressScalar(value)
        : !Array.isArray(value) || value.length > 1000 || !value.every(isProgressScalar)
    )
      throw new Error('Invalid progress value.')
    return { variable, value: Array.isArray(value) ? [...(value as unknown[])] : value, before: variable.value }
  })
  const requestedTargets = targetSnapshot === undefined ? [] : parseProgressTargets(targetSnapshot)
  const targetUpdates = requestedTargets.map((state) => {
    const matches = targets.filter((target) => target.getName() === state.name && target.isStage === state.isStage)
    if (matches.length !== 1 || state.currentCostume >= matches[0].getCostumes().length)
      throw new Error('Saved target or costume does not match this project.')
    const target = matches[0]
    const before = target.isStage
      ? { name: target.getName(), isStage: true, currentCostume: target.currentCostume }
      : {
          name: target.getName(),
          isStage: false,
          currentCostume: target.currentCostume,
          x: target.x,
          y: target.y,
          direction: target.direction,
          size: target.size,
          visible: target.visible,
        }
    return { target, state, before }
  })
  const applyTarget = (target: ScratchTargetInternal, state: ProgressTargetState): void => {
    target.setCostume(state.currentCostume)
    if (state.isStage) {
      if (target.currentCostume !== state.currentCostume) throw new Error('Could not restore the stage backdrop.')
      return
    }
    if (
      state.x === undefined ||
      state.y === undefined ||
      state.direction === undefined ||
      state.size === undefined ||
      state.visible === undefined
    )
      throw new Error('Saved sprite state is incomplete.')
    if (asInternalVM(vm).renderer) target.setSize(state.size)
    else target.size = state.size
    target.setDirection(state.direction)
    target.setXY(state.x, state.y, true)
    target.setVisible(state.visible)
    const differs = (left: number, right: number): boolean => Math.abs(left - right) > 1e-7
    if (
      target.currentCostume !== state.currentCostume ||
      differs(target.x, state.x) ||
      differs(target.y, state.y) ||
      differs(target.direction, state.direction) ||
      differs(target.size, state.size) ||
      target.visible !== state.visible
    )
      throw new Error(`Could not exactly restore sprite ${state.name}.`)
  }
  if (validateOnly) return
  try {
    for (const update of updates) update.variable.value = update.value
    for (const update of targetUpdates) applyTarget(update.target, update.state)
  } catch (error) {
    for (const update of updates) update.variable.value = update.before
    let rollbackFailed = false
    for (const update of targetUpdates) {
      try {
        applyTarget(update.target, update.before)
      } catch {
        rollbackFailed = true
      }
    }
    if (rollbackFailed)
      throw new Error(
        'Progress restore failed and the original target state could not be fully recovered; restart the preview.',
      )
    throw error
  }
}
