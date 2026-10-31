import { validSelfHostedCloudValue } from '../core/cloud/self-hosted'
import { SCRATCH_LINK_HARDWARE_EXTENSION_IDS } from '../scratch/extensions'
import {
  connectScratchPeripheral,
  createPreviewVM,
  disconnectScratchPeripheral,
  moveScratchPreviewDrag,
  loadPreviewHardwareExtension,
  scanScratchPeripheral,
  subscribeScratchPeripheralEvent,
  type ScratchPeripheralInfo,
  type ScratchVMHandle,
  postScratchIOData,
  renderSb3Preview,
  resumePreviewAudio,
  startScratchPreviewDrag,
  startProjectRuntime,
  setRuntimePatchValues,
  captureScratchProgress,
  captureScratchTargetProgress,
  attachScratchCloudSession,
  restoreScratchProgress,
  stopScratchPreviewDrag,
  stopProjectRuntime,
  type ScratchPreviewDragState,
  type ScratchRuntimePatchUpdate,
} from '../scratch/vm'

const canvas = document.querySelector<HTMLCanvasElement>('#stage')
if (!canvas) throw new Error('Scratch animation preview canvas is missing')

let vm: ScratchVMHandle | null = null
let previewTimeout: number | null = null
const pressedKeys = new Set<string>()
let pointerDown = false
let pointerStart: { x: number; y: number; width: number; height: number } | null = null
let activeDrag: ScratchPreviewDragState | null = null
const previewToken = new URLSearchParams(window.location.search).get('token')
const pendingExtensionConsents = new Map<string, (allowed: boolean) => void>()
const peripheralSubscriptions: (() => void)[] = []
let previewHardwareExtensions = new Set<string>()
let activeHardwareExtension: string | null = null
let previewRevision = 0
let selfHostedCloud: {
  readonly projectId: string
  readonly revision: number
  readonly handle: ReturnType<typeof attachScratchCloudSession>
} | null = null

const disconnectSelfHostedCloud = (): void => {
  selfHostedCloud?.handle.disconnect()
  selfHostedCloud = null
}

const createConsentedFetch =
  (fetcher: typeof fetch): typeof fetch =>
  (input, init) => {
    let url: URL
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    } catch {
      return fetcher(input, init)
    }
    const service =
      url.origin === 'https://synthesis-service.scratch.mit.edu' && url.pathname === '/synth'
        ? 'speech'
        : url.origin === 'https://translate-service.scratch.mit.edu' && url.pathname === '/translate'
          ? 'translation'
          : null
    if (service === null) return fetcher(input, init)
    const text = url.searchParams.get('text') ?? ''
    const maxLength = service === 'speech' ? 128 : 1024
    if (text.length > maxLength || !previewToken)
      return Promise.reject(new Error(`${service} request is outside the preview consent limit`))
    const requestId = crypto.randomUUID()
    return new Promise<boolean>((resolve) => {
      pendingExtensionConsents.set(requestId, resolve)
      window.parent.postMessage(
        {
          type: 'extension-egress-consent-request',
          token: previewToken,
          requestId,
          service,
          text,
          ...(service === 'translation' ? { language: url.searchParams.get('language') ?? '' } : {}),
        },
        '*',
      )
    }).then((allowed) => {
      if (!allowed) throw new DOMException('Speech request was declined', 'AbortError')
      return fetcher(input, init)
    })
  }

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null) return
  const message = event.data as { type?: unknown; token?: unknown; requestId?: unknown; allowed?: unknown }
  if (
    message.type !== 'tts-consent-response' ||
    message.token !== previewToken ||
    typeof message.requestId !== 'string'
  )
    return
  const resolve = pendingExtensionConsents.get(message.requestId)
  if (!resolve) return
  pendingExtensionConsents.delete(message.requestId)
  resolve(message.allowed === true)
})

const send = (type: string, detail?: string): void => {
  window.parent.postMessage({ type, detail, token: previewToken }, '*')
}

const sendHardwareStatus = (extensionId: string, status: string, detail: string): void => {
  window.parent.postMessage({ type: 'hardware-status', extensionId, status, detail, token: previewToken }, '*')
}

const stop = (notifyParent = true, loseCanvasContext = true): void => {
  disconnectSelfHostedCloud()
  for (const resolve of pendingExtensionConsents.values()) resolve(false)
  pendingExtensionConsents.clear()
  if (previewTimeout !== null) window.clearTimeout(previewTimeout)
  previewTimeout = null
  if (vm) {
    for (const key of pressedKeys) {
      postScratchIOData(vm, 'keyboard', { key, isDown: false })
    }
    stopProjectRuntime(vm)
    for (const unsubscribe of peripheralSubscriptions.splice(0)) unsubscribe()
    for (const extensionId of previewHardwareExtensions) {
      try {
        disconnectScratchPeripheral(vm, extensionId)
      } catch {
        // Continue stopping the isolated VM if a peripheral adapter is unavailable.
      }
    }
    vm.quit()
    vm = null
    if (loseCanvasContext) {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
  pressedKeys.clear()
  pointerDown = false
  pointerStart = null
  activeDrag = null
  previewHardwareExtensions = new Set()
  activeHardwareExtension = null
  previewRevision = 0
  if (notifyParent) send('stopped')
}

const keyName = (key: string): string => {
  if (key === ' ') return ' '
  return key
}

document.addEventListener('keydown', (event) => {
  if (!vm) return
  resumePreviewAudio(vm)
  const key = keyName(event.key)
  pressedKeys.add(key)
  postScratchIOData(vm, 'keyboard', { key, isDown: true })
  if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault()
})

document.addEventListener('keyup', (event) => {
  if (!vm) return
  const key = keyName(event.key)
  pressedKeys.delete(key)
  postScratchIOData(vm, 'keyboard', { key, isDown: false })
  if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault()
})

const postMouse = (event: MouseEvent, isDown?: boolean, wasDragged?: boolean): void => {
  if (!vm) return
  const rect = canvas.getBoundingClientRect()
  postScratchIOData(vm, 'mouse', {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    canvasWidth: rect.width,
    canvasHeight: rect.height,
    ...(isDown === undefined ? {} : { isDown }),
    ...(wasDragged === undefined ? {} : { wasDragged }),
  })
}

const getPointerPosition = (event: MouseEvent): { x: number; y: number; width: number; height: number } => {
  const rect = canvas.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  }
}

const beginPointerInteraction = (event: MouseEvent): void => {
  if (pointerDown) return
  if (vm) resumePreviewAudio(vm)
  canvas.focus()
  pointerDown = true
  pointerStart = getPointerPosition(event)
  activeDrag = null
  postMouse(event, true)
}

const movePointerInteraction = (event: MouseEvent): void => {
  if (!vm) return
  const position = getPointerPosition(event)
  if (pointerDown && pointerStart && !activeDrag) {
    if (Math.hypot(position.x - pointerStart.x, position.y - pointerStart.y) > 3) {
      activeDrag = startScratchPreviewDrag(
        vm,
        pointerStart.x,
        pointerStart.y,
        pointerStart.width,
        pointerStart.height,
      )
    }
  }
  if (activeDrag) {
    moveScratchPreviewDrag(vm, activeDrag, position.x, position.y, position.width, position.height)
  }
  postMouse(event)
}

const endPointerInteraction = (event: MouseEvent): void => {
  if (!pointerDown) return
  if (vm && activeDrag) {
    const position = getPointerPosition(event)
    moveScratchPreviewDrag(vm, activeDrag, position.x, position.y, position.width, position.height)
    stopScratchPreviewDrag(vm, activeDrag)
  }
  postMouse(event, false, activeDrag !== null)
  pointerDown = false
  pointerStart = null
  activeDrag = null
}

canvas.addEventListener('pointerdown', beginPointerInteraction)
canvas.addEventListener('mousedown', beginPointerInteraction)
window.addEventListener('pointermove', movePointerInteraction)
window.addEventListener('mousemove', movePointerInteraction)
window.addEventListener('pointerup', endPointerInteraction)
window.addEventListener('mouseup', endPointerInteraction)
window.addEventListener('pointercancel', (event) => {
  if (!pointerDown) return
  if (vm && activeDrag) stopScratchPreviewDrag(vm, activeDrag)
  postMouse(event, false, activeDrag !== null)
  pointerDown = false
  pointerStart = null
  activeDrag = null
})
canvas.addEventListener('pointerleave', (event) => {
  if (pointerDown) return
  postMouse(event)
})
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || typeof event.data !== 'object' || event.data === null) return
  const message = event.data as {
    type?: unknown
    archive?: unknown
    extensions?: unknown
    extensionId?: unknown
    peripheralId?: unknown
    token?: unknown
    requestId?: unknown
    baseRevision?: unknown
    revision?: unknown
    operations?: unknown
    snapshot?: unknown
    targetSnapshot?: unknown
    projectId?: unknown
    canWrite?: unknown
    name?: unknown
    value?: unknown
  }
  if (!previewToken || (message as { token?: unknown }).token !== previewToken) return
  if (message.type === 'disconnect-selfhosted-cloud') {
    disconnectSelfHostedCloud()
    return
  }
  if (message.type === 'selfhosted-cloud-incoming') {
    if (
      selfHostedCloud &&
      message.baseRevision === previewRevision &&
      message.projectId === selfHostedCloud.projectId
    )
      selfHostedCloud.handle.session.receive({
        projectId: message.projectId,
        name: message.name,
        value: message.value,
      })
    return
  }
  if (message.type === 'connect-selfhosted-cloud') {
    const requestId = typeof message.requestId === 'string' ? message.requestId : ''
    try {
      if (
        !requestId ||
        requestId.length > 128 ||
        !vm ||
        message.baseRevision !== previewRevision ||
        typeof message.projectId !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(message.projectId) ||
        typeof message.canWrite !== 'boolean'
      )
        throw new Error('雲端連線要求無效。')
      if (selfHostedCloud) throw new Error('雲端變數已連線。')
      const activeVm = vm
      const revision = previewRevision
      const projectId = message.projectId
      const expiresAt = Date.now() + 30 * 60_000
      const handle = attachScratchCloudSession(activeVm, {
        grant: { projectId, username: 'self-hosted', expiresAt, canRead: true, canWrite: message.canWrite },
        verifyGrant: (grant) =>
          vm === activeVm && previewRevision === revision && grant.projectId === projectId && Date.now() < expiresAt,
        validValue: validSelfHostedCloudValue,
        minWriteIntervalMs: 0,
        send: (update, signal) => {
          if (!signal.aborted)
            window.parent.postMessage(
              { type: 'selfhosted-cloud-write', token: previewToken, baseRevision: revision, ...update },
              '*',
            )
        },
        report: (reason) =>
          window.parent.postMessage({ type: 'selfhosted-cloud-status', token: previewToken, reason }, '*'),
      })
      selfHostedCloud = { projectId, revision, handle }
      handle.session.setConnected(true)
      window.parent.postMessage(
        {
          type: 'game-progress-result',
          token: previewToken,
          requestId,
          ok: true,
          names: handle.variableNames,
          expiresAt,
        },
        '*',
      )
    } catch (error) {
      window.parent.postMessage(
        {
          type: 'game-progress-result',
          token: previewToken,
          requestId,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 500) : '雲端連線失敗。',
        },
        '*',
      )
    }
    return
  }
  if (
    message.type === 'capture-game-progress' ||
    message.type === 'restore-game-progress' ||
    message.type === 'validate-game-progress'
  ) {
    const requestId = typeof message.requestId === 'string' ? message.requestId : ''
    try {
      if (!requestId || requestId.length > 128 || !vm || message.baseRevision !== previewRevision)
        throw new Error('預覽已停止或作品版本已變更。')
      const snapshot = message.type === 'capture-game-progress' ? captureScratchProgress(vm) : undefined
      const targets = message.type === 'capture-game-progress' ? captureScratchTargetProgress(vm) : undefined
      if (message.type === 'restore-game-progress' || message.type === 'validate-game-progress')
        restoreScratchProgress(
          vm,
          message.snapshot,
          message.targetSnapshot,
          message.type === 'validate-game-progress',
        )
      window.parent.postMessage(
        { type: 'game-progress-result', token: previewToken, requestId, ok: true, snapshot, targets },
        '*',
      )
    } catch (error) {
      window.parent.postMessage(
        {
          type: 'game-progress-result',
          token: previewToken,
          requestId,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 500) : '存檔操作失敗。',
        },
        '*',
      )
    }
    return
  }
  if (message.type === 'apply-runtime-patch') {
    const requestId = typeof message.requestId === 'string' ? message.requestId : ''
    const rejectPatch = (reason: string): void => {
      window.parent.postMessage(
        { type: 'runtime-patch-result', token: previewToken, requestId, ok: false, error: reason.slice(0, 500) },
        '*',
      )
    }
    if (!requestId || requestId.length > 128 || !vm) {
      rejectPatch('Patch request or running preview is invalid.')
      return
    }
    if (
      typeof message.baseRevision !== 'number' ||
      !Number.isSafeInteger(message.baseRevision) ||
      message.baseRevision !== previewRevision ||
      typeof message.revision !== 'number' ||
      !Number.isSafeInteger(message.revision) ||
      message.revision !== previewRevision + 1
    ) {
      rejectPatch(`Stale patch revision; current revision is ${previewRevision}.`)
      return
    }
    if (!Array.isArray(message.operations) || message.operations.length < 1 || message.operations.length > 20) {
      rejectPatch('Patch must contain 1–20 operations.')
      return
    }
    try {
      const updates = message.operations.map((operation): ScratchRuntimePatchUpdate => {
        if (typeof operation !== 'object' || operation === null || Array.isArray(operation))
          throw new Error('Patch operation shape is invalid.')
        const item = operation as Record<string, unknown>
        if (item.op === 'set-variable') {
          if (
            Object.keys(item).some((key) => !['op', 'target', 'name', 'value'].includes(key)) ||
            typeof item.target !== 'string' ||
            item.target.length < 1 ||
            item.target.length > 80 ||
            typeof item.name !== 'string' ||
            item.name.length < 1 ||
            item.name.length > 80 ||
            (typeof item.value !== 'string' && typeof item.value !== 'number' && typeof item.value !== 'boolean')
          )
            throw new Error('Variable patch operation shape is invalid.')
          return { op: 'set-variable', targetName: item.target, variableName: item.name, value: item.value }
        }
        if (item.op === 'set-target-property') {
          if (
            Object.keys(item).some((key) => !['op', 'target', 'property', 'value'].includes(key)) ||
            typeof item.target !== 'string' ||
            item.target.length < 1 ||
            item.target.length > 80 ||
            (item.property !== 'x' &&
              item.property !== 'y' &&
              item.property !== 'direction' &&
              item.property !== 'size' &&
              item.property !== 'visible' &&
              item.property !== 'currentCostume') ||
            (typeof item.value !== 'string' && typeof item.value !== 'number' && typeof item.value !== 'boolean')
          )
            throw new Error('Target property patch operation shape is invalid.')
          return { op: 'set-target-property', targetName: item.target, property: item.property, value: item.value }
        }
        if (item.op === 'set-stage-property') {
          if (
            Object.keys(item).some((key) => !['op', 'property', 'value'].includes(key)) ||
            (item.property !== 'tempo' && item.property !== 'volume' && item.property !== 'backdropIndex') ||
            typeof item.value !== 'number'
          )
            throw new Error('Stage property patch operation shape is invalid.')
          return { op: 'set-stage-property', property: item.property, value: item.value }
        }
        throw new Error('Patch operation is not supported.')
      })
      const changes = setRuntimePatchValues(vm, updates)
      if (selfHostedCloud) {
        disconnectSelfHostedCloud()
        window.parent.postMessage(
          {
            type: 'selfhosted-cloud-status',
            token: previewToken,
            reason: '作品已修改，請重新連接自架雲端變數。',
            stopped: true,
          },
          '*',
        )
      }
      previewRevision = message.revision
      window.parent.postMessage(
        {
          type: 'runtime-patch-result',
          token: previewToken,
          requestId,
          baseRevision: message.baseRevision,
          revision: previewRevision,
          ok: true,
          changes,
        },
        '*',
      )
    } catch (error) {
      rejectPatch(error instanceof Error ? error.message : String(error))
    }
    return
  }
  if (vm && typeof message.extensionId === 'string' && previewHardwareExtensions.has(message.extensionId)) {
    const extensionId = message.extensionId
    try {
      if (message.type === 'scan-peripheral') {
        activeHardwareExtension = extensionId
        sendHardwareStatus(extensionId, 'searching', '正在連線 Scratch Link 並搜尋裝置…')
        scanScratchPeripheral(vm, extensionId)
      } else if (message.type === 'connect-peripheral') {
        if (
          !(typeof message.peripheralId === 'string' || typeof message.peripheralId === 'number') ||
          String(message.peripheralId).length === 0 ||
          String(message.peripheralId).length > 128 ||
          (typeof message.peripheralId === 'number' && !Number.isFinite(message.peripheralId))
        )
          return
        activeHardwareExtension = extensionId
        sendHardwareStatus(extensionId, 'connecting', '正在連線…')
        connectScratchPeripheral(vm, extensionId, message.peripheralId)
      } else if (message.type === 'disconnect-peripheral') {
        activeHardwareExtension = extensionId
        disconnectScratchPeripheral(vm, extensionId)
        sendHardwareStatus(extensionId, 'disconnected', '裝置已中斷連線。')
      }
    } catch {
      sendHardwareStatus(extensionId, 'error', '無法啟動硬體連線；請確認 Scratch Link 與瀏覽器設定。')
    }
    return
  }
  if (message.type === 'stop-preview') {
    stop()
    return
  }
  if (message.type !== 'start-preview' || !(message.archive instanceof Blob) || vm) return

  const initialRevision = message.revision === undefined ? 0 : message.revision
  if (typeof initialRevision !== 'number' || !Number.isSafeInteger(initialRevision) || initialRevision < 0) return

  void (async () => {
    try {
      send('progress', '正在建立 Scratch 執行環境。')
      const previewVM = await createPreviewVM(createConsentedFetch)
      vm = previewVM
      send('progress', '正在載入作品與角色素材。')
      await renderSb3Preview(message.archive as Blob, previewVM, canvas, (stage) => send('progress', stage))
      previewHardwareExtensions = new Set(
        Array.isArray(message.extensions)
          ? message.extensions.filter(
              (extensionId): extensionId is string =>
                typeof extensionId === 'string' && SCRATCH_LINK_HARDWARE_EXTENSION_IDS.has(extensionId),
            )
          : [],
      )
      await Promise.all(
        Array.from(previewHardwareExtensions, (extensionId) => loadPreviewHardwareExtension(previewVM, extensionId)),
      )
      send('progress', '作品已載入，正在啟動遊戲。')
      const hardwareEvents = [
        'PERIPHERAL_LIST_UPDATE',
        'PERIPHERAL_CONNECTED',
        'PERIPHERAL_DISCONNECTED',
        'PERIPHERAL_SCAN_TIMEOUT',
        'PERIPHERAL_REQUEST_ERROR',
      ] as const
      for (const eventName of hardwareEvents) {
        peripheralSubscriptions.push(
          subscribeScratchPeripheralEvent(vm, eventName, (...args) => {
            const extensionId = activeHardwareExtension
            if (!extensionId || !previewHardwareExtensions.has(extensionId)) return
            if (eventName === 'PERIPHERAL_LIST_UPDATE') {
              const discovered = args[0]
              const peripherals =
                typeof discovered === 'object' && discovered !== null
                  ? Object.values(discovered as Record<string, ScratchPeripheralInfo>).flatMap((device) => {
                      if (typeof device.peripheralId !== 'string' && typeof device.peripheralId !== 'number')
                        return []
                      return [
                        {
                          id: device.peripheralId,
                          name: (typeof device.peripheralName === 'string'
                            ? device.peripheralName
                            : typeof device.name === 'string'
                              ? device.name
                              : ''
                          ).slice(0, 100),
                        },
                      ]
                    })
                  : []
              peripherals.splice(20)
              window.parent.postMessage(
                { type: 'hardware-peripherals', extensionId, peripherals, token: previewToken },
                '*',
              )
            } else if (eventName === 'PERIPHERAL_CONNECTED') {
              sendHardwareStatus(extensionId, 'connected', '裝置已連線。')
            } else if (eventName === 'PERIPHERAL_DISCONNECTED') {
              sendHardwareStatus(extensionId, 'disconnected', '裝置已中斷連線。')
            } else if (eventName === 'PERIPHERAL_SCAN_TIMEOUT') {
              sendHardwareStatus(extensionId, 'timeout', '搜尋逾時；請確認 Scratch Link 已啟動並重試。')
            } else {
              sendHardwareStatus(extensionId, 'error', 'Scratch Link 無法連線或裝置要求失敗。')
            }
          }),
        )
      }
      startProjectRuntime(vm)
      previewRevision = initialRevision
      previewTimeout = window.setTimeout(stop, 120_000)
      send('ready')
    } catch (error) {
      stop(false)
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      send('error', stack ? `${message || 'Unknown preview error'}\n${stack}` : message)
    }
  })()
})

window.addEventListener('pagehide', () => stop(false), { once: true })
send('loaded')
