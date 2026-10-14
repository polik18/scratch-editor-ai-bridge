/* global document, window, HTMLElement, HTMLCanvasElement, HTMLImageElement, createImageBitmap, getComputedStyle -- Playwright serializes these callbacks into the browser page. */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { chromium, firefox, webkit } from 'playwright'
import { sampleProcessTreePeakMemory } from './process-tree-memory.mjs'

const browserName = process.env.BROWSER ?? 'chromium'
const browserImportAnalysisBudgetMs = Number(process.env.BROWSER_IMPORT_ANALYSIS_BUDGET_MS ?? 5_000)
const chromiumRetainedHeapBudgetBytes = Number(process.env.CHROMIUM_RETAINED_HEAP_BUDGET_BYTES ?? 64 * 1024 * 1024)
const browserNearLimitImportBytes = Number(process.env.BROWSER_NEAR_LIMIT_IMPORT_BYTES ?? 0)
if (!Number.isFinite(browserImportAnalysisBudgetMs) || browserImportAnalysisBudgetMs <= 0) {
  throw new Error('BROWSER_IMPORT_ANALYSIS_BUDGET_MS must be a positive number')
}
if (!Number.isFinite(chromiumRetainedHeapBudgetBytes) || chromiumRetainedHeapBudgetBytes <= 0) {
  throw new Error('CHROMIUM_RETAINED_HEAP_BUDGET_BYTES must be a positive number')
}
if (
  !Number.isSafeInteger(browserNearLimitImportBytes) ||
  browserNearLimitImportBytes < 0 ||
  browserNearLimitImportBytes > 256 * 1024 * 1024
) {
  throw new Error('BROWSER_NEAR_LIMIT_IMPORT_BYTES must be 0 or a whole byte count up to 256 MiB')
}
const browserTypes = { chromium, firefox, webkit }
const browserType = browserTypes[browserName]

const clickStudentPreviewStart = async (page) => {
  await page
    .locator('#student-preview .student-preview-actions button')
    .filter({ hasText: '執行作品' })
    .click({ force: process.env.BROWSER_HEADLESS === 'false' })
}
const clickStudentBuild = async (page) => {
  // The headed Firefox/WebGL lane can report layout instability for this visible
  // action after large student payload updates; keep a pointer click while
  // skipping only Playwright's stability precheck in that lane.
  await page.locator('#student-build').click({ force: process.env.BROWSER_HEADLESS === 'false' })
}
if (!browserType) throw new Error(`Unsupported BROWSER value: ${browserName}`)

const sitePrefix = '/scratch-editor-ai-bridge/'
const distRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const svgRendererBundlePath = fileURLToPath(
  new URL('../../scratch-svg-renderer/dist/web/scratch-svg-renderer.js', import.meta.url),
)
const officialSvgFixturePath = fileURLToPath(new URL('../../scratch-vm/test/fixtures/default.sb3', import.meta.url))
const officialBitmapFixturePath = fileURLToPath(
  new URL('../../scratch-vm/test/fixtures/comments.sb3', import.meta.url),
)
const officialCloudFixturePath = fileURLToPath(
  new URL('../../scratch-vm/test/fixtures/cloud_variables_simple.sb3', import.meta.url),
)
const officialStageFixturePath = fileURLToPath(
  new URL('../../scratch-vm/test/fixtures/monitors.sb3', import.meta.url),
)
const officialDraggableFixturePath = fileURLToPath(
  new URL('../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url),
)
const officialEdgeTriggeredFixturePath = fileURLToPath(
  new URL('../../scratch-vm/test/fixtures/edge-triggered-hat.sb3', import.meta.url),
)
const officialMixedAssetFixturePath = fileURLToPath(
  new URL('../../scratch-vm/test/fixtures/load-extensions/confirm-load/pen-dolphin-3d.sb3', import.meta.url),
)
const officialTextToSpeechFixturePath = fileURLToPath(
  new URL(
    '../../scratch-vm/test/fixtures/load-extensions/confirm-load/text2speech-simple-project.sb3',
    import.meta.url,
  ),
)
const officialMalformedSoundFixturePaths = ['corrupt_sound.sb3', 'missing_sound.sb3'].map((name) =>
  fileURLToPath(new URL(`../../scratch-vm/test/fixtures/${name}`, import.meta.url)),
)
const officialMalformedCostumeFixturePaths = [
  'corrupt_png.sb3',
  'missing_png.sb3',
  'corrupt_svg.sb3',
  'missing_svg.sb3',
].map((name) => fileURLToPath(new URL(`../../scratch-vm/test/fixtures/${name}`, import.meta.url)))
const bitmapFixturePath = fileURLToPath(
  new URL('../../scratch-storage/src/builtins/defaultBitmap.png', import.meta.url),
)
const speechAudioFixturePath = fileURLToPath(
  new URL('../../scratch-storage/src/builtins/defaultSound.wav', import.meta.url),
)
const officialMp3FixturePath = fileURLToPath(
  new URL('../../scratch-vm/src/extensions/scratch3_music/assets/instruments/4-guitar/60.mp3', import.meta.url),
)
const geminiDraftPath = fileURLToPath(new URL('../tests/fixtures/gemini-platformer-shorthand.json', import.meta.url))
const geminiMixedResponsePath = fileURLToPath(
  new URL('../tests/fixtures/gemini-notebook-mixed-response.txt', import.meta.url),
)
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.svg', 'image/svg+xml'],
])

const findZipSignatureOffset = (bytes, signature, startOffset = 0) => {
  const marker = Buffer.alloc(4)
  marker.writeUInt32LE(signature)
  const offset = bytes.indexOf(marker, startOffset)
  if (offset < 0) throw new Error(`ZIP signature ${signature.toString(16)} was not found`)
  return offset
}

const createDecodableWavFixture = () => {
  const sampleRate = 22_050
  const sampleCount = Math.floor(sampleRate / 4)
  const dataSize = sampleCount * 2
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataSize, 40)
  return { bytes: wav, sampleCount }
}

const createOverLimitArchive = async () => {
  const zip = new JSZip()
  zip.file('project.json', '{"targets":[]}', { compression: 'STORE', createFolders: false })
  zip.file('assets/oversized.bin', Buffer.from([0]), { compression: 'STORE', createFolders: false })
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  const firstLocalHeader = findZipSignatureOffset(archive, 0x04034b50)
  const oversizedLocalHeader = findZipSignatureOffset(archive, 0x04034b50, firstLocalHeader + 4)
  const firstCentralDirectory = findZipSignatureOffset(archive, 0x02014b50)
  const oversizedCentralDirectory = findZipSignatureOffset(archive, 0x02014b50, firstCentralDirectory + 4)
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const declaredBytes = 256 * 1024 * 1024 + 1
  view.setUint32(oversizedLocalHeader + 22, declaredBytes, true)
  view.setUint32(oversizedCentralDirectory + 24, declaredBytes, true)
  return { archive, declaredBytes }
}

const createNearLimitArchive = async (aggregateUncompressedBytes) => {
  const zip = await JSZip.loadAsync(await readFile(officialSvgFixturePath))
  let existingUncompressedBytes = 0
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) existingUncompressedBytes += (await entry.async('uint8array')).byteLength
  }
  const paddingBytes = aggregateUncompressedBytes - existingUncompressedBytes
  if (paddingBytes < 0) throw new Error('Official fixture exceeds the requested browser archive size')
  zip.file('assets/resource-limit-padding.bin', new Uint8Array(paddingBytes), {
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
    createFolders: false,
  })
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  })
  return { archive, aggregateUncompressedBytes }
}

let originUnavailable = false
let offlineOriginRequestCount = 0
const server = createServer((request, response) => {
  void (async () => {
    try {
      if (originUnavailable) {
        offlineOriginRequestCount += 1
        request.socket.destroy()
        return
      }
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (!requestUrl.pathname.startsWith(sitePrefix)) {
        response.writeHead(404).end('Not found')
        return
      }

      if (requestUrl.pathname === `${sitePrefix}scratch-svg-renderer.js`) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        response.end(await readFile(svgRendererBundlePath))
        return
      }
      if (requestUrl.pathname === `${sitePrefix}assets/scratch-svg-renderer.js`) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
        response.end(await readFile(svgRendererBundlePath))
        return
      }

      const relativePath = decodeURIComponent(requestUrl.pathname.slice(sitePrefix.length)) || 'index.html'
      const filePath = resolve(distRoot, relativePath)
      if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
        response.writeHead(403).end('Forbidden')
        return
      }

      const content = await readFile(filePath)
      response.writeHead(200, {
        'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      })
      response.end(content)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      response.writeHead(code === 'ENOENT' ? 404 : 500).end(code === 'ENOENT' ? 'Not found' : 'Server error')
    }
  })()
})

await new Promise((resolveListening, rejectListening) => {
  server.once('error', rejectListening)
  server.listen(0, '127.0.0.1', resolveListening)
})

const address = server.address()
if (!address || typeof address === 'string') throw new Error('Could not determine smoke-test server port')

let browser
let page
let svgTestPage
let strictCspSvgPage
let stageFixturePage
const failures = []
try {
  browser = await browserType.launch({
    headless: process.env.BROWSER_HEADLESS !== 'false',
  })
  page = await browser.newPage({ acceptDownloads: true })
  const scratchLinkMethods = []
  let scratchLinkCloseCount = 0
  for (const url of ['ws://127.0.0.1:20111/scratch/ble', 'wss://device-manager.scratch.mit.edu:20110/scratch/ble']) {
    await page.routeWebSocket(url, (socket) => {
      socket.onClose(() => {
        scratchLinkCloseCount += 1
      })
      socket.onMessage((payload) => {
        const request = JSON.parse(String(payload))
        scratchLinkMethods.push(request.method)
        if (request.id !== undefined) {
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: null }))
        }
        if (request.method === 'discover') {
          for (let index = 0; index < 25; index += 1) {
            socket.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'didDiscoverPeripheral',
                params: {
                  peripheralId: `mock-microbit-${index}`,
                  peripheralName: index === 0 ? 'Mock micro:bit' : '<img src=x onerror=alert(1)>',
                },
              }),
            )
          }
        }
      })
    })
  }
  await page.addInitScript(() => {
    window.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        sample: event.sample,
      })
    })
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          globalThis.__scratchAiBridgeClipboard = value
        },
      },
    })
  })

  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    const text = message.text()
    const knownScratchFontWarning =
      browserName === 'firefox' &&
      text.startsWith('[JavaScript Error: "downloadable font:') &&
      (text.includes('hdmx: the table should not be present') || text.includes('Table discarded'))
    if (message.type() === 'error' && !knownScratchFontWarning) failures.push(`console error: ${text}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  page.on('requestfailed', (request) =>
    failures.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`),
  )

  await page.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })

  const serviceWorkerReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registration = await navigator.serviceWorker.ready
    return Boolean(registration.active)
  })
  if (!serviceWorkerReady) throw new Error(`${browserName} did not install the static offline cache`)
  await page.reload({ waitUntil: 'networkidle' })
  const serviceWorkerControlsPage = await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
  if (!serviceWorkerControlsPage)
    throw new Error(`${browserName} service worker did not control the nested Pages app`)
  let offlineReloadAppReady = false
  const offlineReloadMode = browserName === 'webkit' ? 'origin-unavailable' : 'browser-offline'
  if (offlineReloadMode === 'browser-offline') {
    await page.context().setOffline(true)
    try {
      await page.reload({ waitUntil: 'networkidle', timeout: 20_000 })
      offlineReloadAppReady = await page.locator('#project-request').isVisible()
    } finally {
      await page.context().setOffline(false)
    }
  } else {
    originUnavailable = true
    try {
      await page.reload({ waitUntil: 'networkidle', timeout: 20_000 })
      offlineReloadAppReady = await page.locator('#project-request').isVisible()
    } finally {
      originUnavailable = false
    }
  }
  if (!offlineReloadAppReady) throw new Error(`${browserName} could not reload and open the app while offline`)
  const offlineReload = {
    scope: sitePrefix,
    networkMode: offlineReloadMode,
    serviceWorkerInstalled: serviceWorkerReady,
    serviceWorkerControlledPage: serviceWorkerControlsPage,
    browserNetworkDisabled: offlineReloadMode === 'browser-offline',
    originUnavailable: offlineReloadMode === 'origin-unavailable',
    droppedOriginRequests: offlineOriginRequestCount,
    reloadSucceeded: true,
    appInputVisible: offlineReloadAppReady,
  }

  const studentTextContrast = await page.evaluate(() => {
    const targets = [
      ['.eyebrow', 'header guidance'],
      ['.lede', 'student introduction'],
      ['.tab.active', 'selected navigation tab'],
      ['#analyze-tab', 'unselected navigation tab'],
      ['.progress-steps li.current', 'current progress step'],
      ['.field-label', 'request field label'],
      ['.idea-chip', 'example request button'],
      ['.inline-status', 'live status text'],
    ]
    const parseColor = (value) => {
      const channels = value.match(/[\d.]+/g)?.map(Number)
      if (!channels || channels.length < 3) throw new Error(`Unsupported computed color: ${value}`)
      return [channels[0], channels[1], channels[2], channels[3] ?? 1]
    }
    const luminance = (channels) => {
      const linear = channels.map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    return targets.map(([selector, label]) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) throw new Error(`Missing contrast target: ${selector}`)
      const foreground = parseColor(getComputedStyle(element).color)
      const ancestors = []
      for (let node = element; node; node = node.parentElement) ancestors.push(node)
      let background = [255, 255, 255]
      for (const node of ancestors.reverse()) {
        const layer = parseColor(getComputedStyle(node).backgroundColor)
        background = background.map((channel, index) => layer[index] * layer[3] + channel * (1 - layer[3]))
      }
      const foregroundLuminance = luminance(foreground)
      const backgroundLuminance = luminance(background)
      const ratio =
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      return { label, ratio }
    })
  })
  const lowContrastStudentText = studentTextContrast.filter(({ ratio }) => ratio < 4.5)
  if (lowContrastStudentText.length > 0) {
    throw new Error(`Student UI text falls below 4.5:1 contrast: ${JSON.stringify(lowContrastStudentText)}`)
  }

  await page.locator('#generate-tab').focus()
  await page.keyboard.press('ArrowRight')
  const keyboardAnalyzeTab = await page.evaluate(() => ({
    activeId: document.activeElement?.id,
    selected: document.querySelector('#analyze-tab')?.getAttribute('aria-selected'),
    tabIndex: document.querySelector('#analyze-tab')?.getAttribute('tabindex'),
    panelHidden: document.querySelector('#analyze-panel')?.hasAttribute('hidden'),
  }))
  if (
    keyboardAnalyzeTab.activeId !== 'analyze-tab' ||
    keyboardAnalyzeTab.selected !== 'true' ||
    keyboardAnalyzeTab.tabIndex !== '0' ||
    keyboardAnalyzeTab.panelHidden
  ) {
    throw new Error(`Right-arrow tab navigation failed: ${JSON.stringify(keyboardAnalyzeTab)}`)
  }
  await page.keyboard.press('ArrowLeft')
  const keyboardGenerateTab = await page.evaluate(() => ({
    activeId: document.activeElement?.id,
    selected: document.querySelector('#generate-tab')?.getAttribute('aria-selected'),
    tabIndex: document.querySelector('#generate-tab')?.getAttribute('tabindex'),
    panelHidden: document.querySelector('#generate-panel')?.hasAttribute('hidden'),
    focusIndicator: (() => {
      if (!(document.activeElement instanceof HTMLElement)) return null
      const style = getComputedStyle(document.activeElement)
      return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
    })(),
  }))
  if (
    keyboardGenerateTab.activeId !== 'generate-tab' ||
    keyboardGenerateTab.selected !== 'true' ||
    keyboardGenerateTab.tabIndex !== '0' ||
    keyboardGenerateTab.panelHidden ||
    keyboardGenerateTab.focusIndicator?.style === 'none' ||
    Number.parseFloat(keyboardGenerateTab.focusIndicator?.width ?? '0') < 3
  ) {
    throw new Error(`Left-arrow tab navigation failed: ${JSON.stringify(keyboardGenerateTab)}`)
  }

  const mobilePage = await browser.newPage({ viewport: { width: 320, height: 800 } })
  await mobilePage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
  const measureMobileLayout = (selectors) =>
    mobilePage.evaluate((targetSelectors) => {
      const bounds = (selector) => {
        const element = document.querySelector(selector)
        if (!(element instanceof HTMLElement)) return null
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width }
      }
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        targets: Object.fromEntries(
          Object.entries(targetSelectors).map(([key, selector]) => [key, bounds(selector)]),
        ),
      }
    }, selectors)
  const assertMobileLayout = (label, layout) => {
    const overflow = layout.documentWidth > layout.viewportWidth || layout.bodyWidth > layout.viewportWidth
    const outOfBounds = Object.entries(layout.targets).filter(
      ([, bounds]) => !bounds || bounds.left < 0 || bounds.right > layout.viewportWidth || bounds.width <= 0,
    )
    if (overflow || outOfBounds.length > 0) {
      throw new Error(`Student ${label} does not reflow at 320 CSS px: ${JSON.stringify({ layout, outOfBounds })}`)
    }
  }
  const mobileGenerateLayout = await measureMobileLayout({
    app: '#app',
    shell: '.app-shell',
    requestField: '#project-request',
    primaryAction: '#student-build',
  })
  assertMobileLayout('generate flow', mobileGenerateLayout)

  await mobilePage.locator('#analyze-tab').click()
  const mobileAnalyzeLayout = await measureMobileLayout({
    panel: '#analyze-panel',
    dropzone: '#dropzone',
    questionField: '#question',
  })
  assertMobileLayout('analyze flow', mobileAnalyzeLayout)

  await mobilePage.locator('#generate-tab').click()
  await mobilePage.locator('#json-editor').fill('{ not a Canonical Scratch project')
  await mobilePage.locator('#student-build').click()
  await mobilePage.locator('#generate-status[data-kind="error"]').waitFor()
  const mobileErrorLayout = await measureMobileLayout({
    status: '#generate-status',
  })
  assertMobileLayout('validation error result', mobileErrorLayout)
  const mobileLayout = {
    viewportWidth: mobileGenerateLayout.viewportWidth,
    generate: mobileGenerateLayout,
    analyze: mobileAnalyzeLayout,
    validationError: mobileErrorLayout,
  }
  await mobilePage.close()

  const overLimitPage = await browser.newPage()
  overLimitPage.on('pageerror', (error) => failures.push(`over-limit page error: ${error.message}`))
  overLimitPage.on('console', (message) => {
    if (message.type() === 'error') failures.push(`over-limit console error: ${message.text()}`)
  })
  overLimitPage.on('response', (response) => {
    if (response.status() >= 400) failures.push(`over-limit HTTP ${response.status()}: ${response.url()}`)
  })
  await overLimitPage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
  await overLimitPage.locator('button[data-tab="analyze"]').click()
  const overLimitArchive = await createOverLimitArchive()
  const overLimitStartedAt = performance.now()
  await overLimitPage.locator('#sb3-file').setInputFiles({
    name: 'declared-over-limit.sb3',
    mimeType: 'application/zip',
    buffer: overLimitArchive.archive,
  })
  await overLimitPage.locator('#file-status[data-kind="error"]').waitFor()
  const overLimitImportMs = performance.now() - overLimitStartedAt
  const overLimitMessage = (await overLimitPage.locator('#file-status').textContent()) ?? ''
  if (!overLimitMessage.includes('256 MiB uncompressed-size limit')) {
    throw new Error(`The over-limit archive was rejected for an unexpected reason: ${overLimitMessage}`)
  }
  if (overLimitArchive.archive.byteLength > 1_000_000) {
    throw new Error('Over-limit browser fixture unexpectedly contains a large compressed payload')
  }
  await overLimitPage.close()

  let nearLimitImportResult
  if (browserNearLimitImportBytes > 0) {
    const nearLimitPage = await browser.newPage()
    await nearLimitPage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
    await nearLimitPage.locator('button[data-tab="analyze"]').click()
    const nearLimitArchive = await createNearLimitArchive(browserNearLimitImportBytes)
    const memorySampler = sampleProcessTreePeakMemory(process.pid)
    const nearLimitStartedAt = performance.now()
    let nearLimitMemory
    try {
      await nearLimitPage.locator('#sb3-file').setInputFiles({
        name: `near-limit-${browserNearLimitImportBytes}.sb3`,
        mimeType: 'application/zip',
        buffer: nearLimitArchive.archive,
      })
      await nearLimitPage.locator('#file-status[data-kind="ok"], #file-status[data-kind="error"]').waitFor()
      const nearLimitStatus = (await nearLimitPage.locator('#file-status').textContent()) ?? ''
      if ((await nearLimitPage.locator('#file-status').getAttribute('data-kind')) !== 'ok') {
        throw new Error(`Browser rejected the within-limit archive: ${nearLimitStatus}`)
      }
    } finally {
      nearLimitMemory = await memorySampler.stop()
      await nearLimitPage.close()
    }
    nearLimitImportResult = {
      aggregateUncompressedBytes: nearLimitArchive.aggregateUncompressedBytes,
      compressedArchiveBytes: nearLimitArchive.archive.byteLength,
      importMs: Number((performance.now() - nearLimitStartedAt).toFixed(1)),
      ...(nearLimitMemory === undefined ? {} : { processTreeRssSumPeakBytes: nearLimitMemory.rssPeakBytes }),
      ...(nearLimitMemory === undefined ? {} : { processTreeRssSampleCount: nearLimitMemory.rssSamples }),
      ...(nearLimitMemory?.pssPeakBytes === undefined
        ? {}
        : { processTreePssSumPeakBytes: nearLimitMemory.pssPeakBytes }),
      ...(nearLimitMemory?.pssSamples === undefined ? {} : { processTreePssSampleCount: nearLimitMemory.pssSamples }),
    }
  }

  const assertDamagedSvgAnimationFallback = async (fixturePath, expectedIssue, fixtureName) => {
    const damagedSvgPage = await browser.newPage()
    damagedSvgPage.on('pageerror', (error) => failures.push(`${fixtureName} page error: ${error.message}`))
    damagedSvgPage.on('console', (message) => {
      if (message.type() === 'error') failures.push(`${fixtureName} console error: ${message.text()}`)
    })
    await damagedSvgPage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
    await damagedSvgPage.locator('button[data-tab="analyze"]').click()
    const officialArchive = await JSZip.loadAsync(await readFile(fixturePath))
    const projectEntryName = Object.keys(officialArchive.files).find((name) => name.endsWith('/project.json'))
    if (!projectEntryName) throw new Error(`${fixtureName} fixture has no nested project.json`)
    const projectBytes = await officialArchive.file(projectEntryName)?.async('uint8array')
    if (!projectBytes) throw new Error(`${fixtureName} fixture project.json could not be read`)
    const project = JSON.parse(new TextDecoder().decode(projectBytes))
    const prefix = projectEntryName.slice(0, -'project.json'.length)
    const normalizedArchive = new JSZip()
    normalizedArchive.file('project.json', projectBytes)
    const assetNames = new Set(
      (project.targets ?? []).flatMap((target) =>
        [...(target.costumes ?? []), ...(target.sounds ?? [])]
          .map((asset) => asset.md5ext)
          .filter((name) => typeof name === 'string'),
      ),
    )
    for (const assetName of assetNames) {
      const entry = officialArchive.file(`${prefix}${assetName}`)
      if (entry) normalizedArchive.file(assetName, await entry.async('uint8array'))
    }
    const normalizedFixture = await normalizedArchive.generateAsync({ type: 'nodebuffer' })
    await damagedSvgPage.locator('#sb3-file').setInputFiles({
      name: fixturePath.split('/').at(-1) ?? `${fixtureName}.sb3`,
      mimeType: 'application/zip',
      buffer: normalizedFixture,
    })
    await damagedSvgPage.locator('#file-status[data-kind="ok"], #file-status[data-kind="error"]').waitFor()
    if ((await damagedSvgPage.locator('#file-status').getAttribute('data-kind')) !== 'ok') {
      throw new Error(
        `${fixtureName} failed before damaged-asset preview: ${await damagedSvgPage.locator('#file-status').textContent()}`,
      )
    }
    const imported = JSON.parse((await damagedSvgPage.locator('#canonical-output').textContent()) ?? 'null')
    const sprite = imported?.sprites?.find((target) =>
      target.costumes?.some((costume) => costume.assetIssue === expectedIssue),
    )
    const damagedCostumeIndex = sprite?.costumes?.findIndex((costume) => costume.assetIssue === expectedIssue) ?? -1
    if (!sprite || damagedCostumeIndex < 0) {
      throw new Error(
        `${fixtureName} did not retain expected Canonical asset issue ${expectedIssue}: ${JSON.stringify(imported?.sprites)}`,
      )
    }
    await damagedSvgPage.locator('#preview-imported-project').click()
    await damagedSvgPage.locator('#student-preview .student-preview-tile figcaption').waitFor()
    if (
      !(await damagedSvgPage.locator('#student-preview .student-preview-tile figcaption').textContent())?.includes(
        '素材示意',
      )
    ) {
      throw new Error(`${fixtureName} static preview did not show the SVG placeholder`)
    }
    await clickStudentPreviewStart(damagedSvgPage)
    await damagedSvgPage.waitForFunction(
      () =>
        ['已將 1 個損壞造型替換為示意素材', '動畫預覽載入失敗'].some((message) =>
          document.querySelector('.student-preview-stage-status')?.textContent?.includes(message),
        ),
      null,
      { timeout: 15_000 },
    )
    const status = await damagedSvgPage.locator('.student-preview-stage-status').textContent()
    if (status?.includes('動畫預覽載入失敗')) throw new Error(`${fixtureName} animation failed: ${status}`)
    const png = await damagedSvgPage
      .frameLocator('#student-preview iframe.student-preview-animation')
      .locator('canvas')
      .screenshot()
    const pixels = await damagedSvgPage.evaluate(
      async (pngBytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not inspect damaged-SVG animation pixels')
        context.drawImage(bitmap, 0, 0)
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data
        const colors = new Set()
        let nonWhitePixels = 0
        for (let index = 0; index < imageData.length; index += 4) {
          colors.add(`${imageData[index]},${imageData[index + 1]},${imageData[index + 2]}`)
          if (imageData[index] !== 255 || imageData[index + 1] !== 255 || imageData[index + 2] !== 255) {
            nonWhitePixels += 1
          }
        }
        bitmap.close()
        return { distinctColors: colors.size, nonWhitePixels }
      },
      [...png],
    )
    if (pixels.distinctColors < 8 || pixels.nonWhitePixels < 500) {
      throw new Error(`${fixtureName} animation fallback rendered blank: ${JSON.stringify(pixels)}`)
    }
    await damagedSvgPage
      .locator('#student-preview .student-preview-actions button')
      .filter({ hasText: '停止預覽' })
      .click()
    await damagedSvgPage.locator('#student-preview iframe.student-preview-animation').waitFor({ state: 'detached' })
    await damagedSvgPage.locator('button[data-tab="analyze"]').click()
    const afterPreview = JSON.parse((await damagedSvgPage.locator('#canonical-output').textContent()) ?? 'null')
    const afterSprite = afterPreview?.sprites?.find((target) => target.name === sprite.name)
    if (afterSprite?.costumes?.[damagedCostumeIndex]?.assetIssue !== expectedIssue) {
      throw new Error(`${fixtureName} preview changed the imported Canonical asset issue`)
    }
    await damagedSvgPage.close()
  }

  await assertDamagedSvgAnimationFallback(officialMalformedCostumeFixturePaths[2], 'checksum-mismatch', 'corrupt SVG')
  await assertDamagedSvgAnimationFallback(
    officialMalformedCostumeFixturePaths[3],
    'missing-archive-entry',
    'missing SVG',
  )

  const firstImportPage = await browser.newPage()
  const projectFileNetworkViolations = []
  const localAppOrigin = `http://127.0.0.1:${address.port}`
  firstImportPage.on('request', (request) => {
    const requestUrl = new URL(request.url())
    if (requestUrl.origin !== localAppOrigin || !['GET', 'HEAD'].includes(request.method())) {
      projectFileNetworkViolations.push({ method: request.method(), url: request.url() })
    }
  })
  firstImportPage.on('pageerror', (error) => failures.push(`damaged-asset page error: ${error.message}`))
  firstImportPage.on('console', (message) => {
    if (message.type() === 'error') failures.push(`damaged-asset console error: ${message.text()}`)
  })
  await firstImportPage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
  await firstImportPage.locator('button[data-tab="analyze"]').click()
  await firstImportPage.locator('#sb3-file').setInputFiles(officialMalformedCostumeFixturePaths[1])
  await firstImportPage.locator('#file-status[data-kind="ok"], #file-status[data-kind="error"]').waitFor()
  if ((await firstImportPage.locator('#file-status').getAttribute('data-kind')) !== 'ok') {
    throw new Error(
      `First bitmap import failed before preview initialization: ${await firstImportPage.locator('#file-status').textContent()}`,
    )
  }
  const firstImportCanonical = JSON.parse(
    (await firstImportPage.locator('#canonical-output').textContent()) ?? 'null',
  )
  const firstImportSprite = firstImportCanonical?.sprites?.find((sprite) => sprite.name === 'Green Guy')
  if (firstImportSprite?.costumes?.[0]?.assetIssue !== 'missing-archive-entry') {
    throw new Error('First bitmap import did not retain the missing-costume issue in Canonical IR')
  }
  if (!(await firstImportPage.locator('#diagnostics').textContent())?.includes('素材')) {
    throw new Error('First bitmap import did not surface its missing costume in analysis diagnostics')
  }
  await firstImportPage.locator('#preview-imported-project').click()
  await firstImportPage.locator('#student-preview .student-preview-tile figcaption').waitFor()
  const missingAssetPreview = await firstImportPage.locator('#student-preview').evaluate((element) => ({
    message: element.parentElement?.querySelector('#student-result-message')?.textContent ?? '',
    captions: [...element.querySelectorAll('figcaption')].map((caption) => caption.textContent),
    image: element.querySelector('.student-preview-sprite')?.getAttribute('src') ?? '',
  }))
  if (
    !missingAssetPreview.message.includes('1 個缺失或 checksum 不符的造型') ||
    !missingAssetPreview.captions.some((caption) => caption?.includes('素材示意')) ||
    !missingAssetPreview.image.startsWith('data:image/svg+xml')
  ) {
    throw new Error(
      `Missing bitmap preview did not show an isolated placeholder: ${JSON.stringify(missingAssetPreview)}`,
    )
  }
  await clickStudentPreviewStart(firstImportPage)
  await firstImportPage.waitForFunction(
    () =>
      ['已將 1 個損壞造型替換為示意素材', '動畫預覽載入失敗'].some((message) =>
        document.querySelector('.student-preview-stage-status')?.textContent?.includes(message),
      ),
    null,
    { timeout: 15_000 },
  )
  const missingAnimationStatus = await firstImportPage.locator('.student-preview-stage-status').textContent()
  if (missingAnimationStatus?.includes('動畫預覽載入失敗')) {
    throw new Error(`Missing-costume animation preview failed: ${missingAnimationStatus}`)
  }
  if (!(await firstImportPage.locator('#student-preview iframe.student-preview-animation').count())) {
    throw new Error('Missing-costume animation preview did not start with its fallback asset')
  }
  const missingFallbackPng = await firstImportPage
    .frameLocator('#student-preview iframe.student-preview-animation')
    .locator('canvas')
    .screenshot()
  const missingFallbackPixels = await firstImportPage.evaluate(
    async (pngBytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not inspect missing-costume animation pixels')
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const colors = new Set()
      let nonWhitePixels = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const color = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
        colors.add(color)
        if (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255) nonWhitePixels += 1
      }
      bitmap.close()
      return { distinctColors: colors.size, nonWhitePixels }
    },
    [...missingFallbackPng],
  )
  if (missingFallbackPixels.distinctColors < 8 || missingFallbackPixels.nonWhitePixels < 500) {
    throw new Error(`Missing-costume animation fallback rendered blank: ${JSON.stringify(missingFallbackPixels)}`)
  }
  await firstImportPage
    .locator('#student-preview .student-preview-actions button')
    .filter({ hasText: '停止預覽' })
    .click()
  await firstImportPage.locator('#student-preview iframe.student-preview-animation').waitFor({ state: 'detached' })
  await firstImportPage.locator('button[data-tab="analyze"]').click()
  const afterMissingPreviewCanonical = JSON.parse(
    (await firstImportPage.locator('#canonical-output').textContent()) ?? 'null',
  )
  const afterMissingPreviewSprite = afterMissingPreviewCanonical?.sprites?.find(
    (sprite) => sprite.name === 'Green Guy',
  )
  if (afterMissingPreviewSprite?.costumes?.[0]?.assetIssue !== 'missing-archive-entry') {
    throw new Error('Missing-asset preview changed the imported Canonical issue marker')
  }
  if (projectFileNetworkViolations.length > 0) {
    throw new Error(
      `SB3 import/preview attempted an external or write network request: ${JSON.stringify(projectFileNetworkViolations)}`,
    )
  }
  await firstImportPage.close()

  const corruptImportPage = await browser.newPage()
  corruptImportPage.on('pageerror', (error) => failures.push(`corrupt-asset page error: ${error.message}`))
  corruptImportPage.on('console', (message) => {
    if (message.type() === 'error') failures.push(`corrupt-asset console error: ${message.text()}`)
  })
  await corruptImportPage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
  await corruptImportPage.locator('button[data-tab="analyze"]').click()
  await corruptImportPage.locator('#sb3-file').setInputFiles(officialMalformedCostumeFixturePaths[0])
  await corruptImportPage.locator('#file-status[data-kind="ok"], #file-status[data-kind="error"]').waitFor()
  if ((await corruptImportPage.locator('#file-status').getAttribute('data-kind')) !== 'ok') {
    throw new Error(
      `First corrupt bitmap import failed: ${await corruptImportPage.locator('#file-status').textContent()}`,
    )
  }
  const corruptImportCanonical = JSON.parse(
    (await corruptImportPage.locator('#canonical-output').textContent()) ?? 'null',
  )
  const corruptImportSprite = corruptImportCanonical?.sprites?.find((sprite) => sprite.name === 'Green Guy')
  if (corruptImportSprite?.costumes?.[0]?.assetIssue !== 'checksum-mismatch') {
    throw new Error('First corrupt bitmap import did not retain the checksum mismatch in Canonical IR')
  }
  await corruptImportPage.locator('#preview-imported-project').click()
  await corruptImportPage.locator('#student-preview .student-preview-tile figcaption').waitFor()
  const corruptAssetPreview = await corruptImportPage.locator('#student-preview').evaluate((element) => ({
    message: element.parentElement?.querySelector('#student-result-message')?.textContent ?? '',
    captions: [...element.querySelectorAll('figcaption')].map((caption) => caption.textContent),
    image: element.querySelector('.student-preview-sprite')?.getAttribute('src') ?? '',
  }))
  if (
    !corruptAssetPreview.message.includes('1 個缺失或 checksum 不符的造型') ||
    !corruptAssetPreview.captions.some((caption) => caption?.includes('素材示意')) ||
    !corruptAssetPreview.image.startsWith('data:image/svg+xml')
  ) {
    throw new Error(
      `Checksum-mismatch preview did not show an isolated placeholder: ${JSON.stringify(corruptAssetPreview)}`,
    )
  }
  await clickStudentPreviewStart(corruptImportPage)
  await corruptImportPage.waitForFunction(
    () =>
      ['已將 1 個損壞造型替換為示意素材', '動畫預覽載入失敗'].some((message) =>
        document.querySelector('.student-preview-stage-status')?.textContent?.includes(message),
      ),
    null,
    { timeout: 15_000 },
  )
  const corruptAnimationStatus = await corruptImportPage.locator('.student-preview-stage-status').textContent()
  if (corruptAnimationStatus?.includes('動畫預覽載入失敗')) {
    throw new Error(`Checksum-mismatch animation preview failed: ${corruptAnimationStatus}`)
  }
  if (!(await corruptImportPage.locator('#student-preview iframe.student-preview-animation').count())) {
    throw new Error('Checksum-mismatch animation preview did not start with its fallback asset')
  }
  const corruptFallbackPng = await corruptImportPage
    .frameLocator('#student-preview iframe.student-preview-animation')
    .locator('canvas')
    .screenshot()
  const corruptFallbackPixels = await corruptImportPage.evaluate(
    async (pngBytes) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not inspect checksum-mismatch animation pixels')
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const colors = new Set()
      let nonWhitePixels = 0
      for (let index = 0; index < pixels.length; index += 4) {
        colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`)
        if (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255) nonWhitePixels += 1
      }
      bitmap.close()
      return { distinctColors: colors.size, nonWhitePixels }
    },
    [...corruptFallbackPng],
  )
  if (corruptFallbackPixels.distinctColors < 8 || corruptFallbackPixels.nonWhitePixels < 500) {
    throw new Error(`Checksum-mismatch animation fallback rendered blank: ${JSON.stringify(corruptFallbackPixels)}`)
  }
  await corruptImportPage
    .locator('#student-preview .student-preview-actions button')
    .filter({ hasText: '停止預覽' })
    .click()
  await corruptImportPage.locator('#student-preview iframe.student-preview-animation').waitFor({ state: 'detached' })
  await corruptImportPage.locator('button[data-tab="analyze"]').click()
  const afterCorruptPreviewCanonical = JSON.parse(
    (await corruptImportPage.locator('#canonical-output').textContent()) ?? 'null',
  )
  const afterCorruptPreviewSprite = afterCorruptPreviewCanonical?.sprites?.find(
    (sprite) => sprite.name === 'Green Guy',
  )
  if (afterCorruptPreviewSprite?.costumes?.[0]?.assetIssue !== 'checksum-mismatch') {
    throw new Error('Checksum-mismatch preview changed the imported Canonical issue marker')
  }
  await corruptImportPage.close()

  if (
    (await page.locator('#analyze-panel').evaluate((element) => globalThis.getComputedStyle(element).display)) !==
    'none'
  ) {
    throw new Error('Inactive analysis mode is visible')
  }
  if ((await page.locator('#generate-panel').getAttribute('aria-labelledby')) !== 'generate-tab') {
    throw new Error('Generate mode is not associated with its tab')
  }
  if (await page.locator('#validate').isVisible()) throw new Error('Technical controls are visible in student mode')
  if (await page.locator('#question').isVisible()) throw new Error('Inactive analysis controls are visible')
  const unlabeledTextareas = await page
    .locator('textarea')
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.labels?.length === 0 &&
            !element.getAttribute('aria-label') &&
            !element.getAttribute('aria-labelledby'),
        )
        .map((element) => element.id),
    )
  if (unlabeledTextareas.length > 0) throw new Error(`Unlabeled textareas: ${unlabeledTextareas.join(', ')}`)
  await page.locator('#project-request').fill('做一個可以收集金幣的平台遊戲')
  await page.locator('#copy-instruction').click()
  const studentInstruction = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof studentInstruction !== 'string' ||
    !studentInstruction.includes('作品需求：\n做一個可以收集金幣的平台遊戲') ||
    !studentInstruction.includes('event_whenkeypressed')
  ) {
    throw new Error('Student project request was not included in the copied AI instruction')
  }

  const malformedAiResponse = '{"broken":'
  await page.locator('#json-editor').fill(malformedAiResponse)
  await page.locator('#student-build').click()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  if (await page.locator('#download-repair-report').isDisabled()) {
    throw new Error(
      `Invalid AI response report button is disabled: ${await page.locator('#repair-summary').textContent()}`,
    )
  }
  const invalidValidationDownloadPromise = page.waitForEvent('download', { timeout: 5_000 })
  await page.locator('#download-repair-report').click()
  await page.locator('#generate-status').filter({ hasText: '已下載含原始回覆雜湊的驗證報告' }).waitFor()
  const invalidValidationDownload = await invalidValidationDownloadPromise
  const invalidValidationPath = await invalidValidationDownload.path()
  if (!invalidValidationPath) throw new Error('Invalid AI response did not expose its validation report')
  const invalidValidationReport = JSON.parse(await readFile(invalidValidationPath, 'utf8'))
  if (
    invalidValidationReport.format !== 'scratch-ai-bridge/validation-report' ||
    invalidValidationReport.version !== 2 ||
    invalidValidationReport.sourceResponseSha256 !== createHash('sha256').update(malformedAiResponse).digest('hex') ||
    invalidValidationReport.canonicalProjectSha256 !== null ||
    invalidValidationReport.checks.responseParsed !== 'failed' ||
    invalidValidationReport.checks.scratchVmCompile !== 'skipped'
  ) {
    throw new Error('Invalid AI response validation report did not identify the source and failed stage')
  }
  await page.locator('#repair-tools .technical-details summary').click()

  let deeplyNestedValue = 'limit'
  for (let depth = 0; depth < 140; depth += 1) deeplyNestedValue = [deeplyNestedValue]
  const normalizationLimitResponse = JSON.stringify({
    format: 'scratch-ai-bridge/canonical-ir',
    version: 1,
    name: 'Depth limit',
    meta: { nested: deeplyNestedValue },
  })
  await page.locator('#json-editor').fill(normalizationLimitResponse)
  await page.locator('#student-build').click()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  const normalizationValidationDownloadPromise = page.waitForEvent('download', { timeout: 5_000 })
  await page.locator('#download-repair-report').click()
  await page.locator('#generate-status').filter({ hasText: '已下載含原始回覆雜湊的驗證報告' }).waitFor()
  const normalizationValidationDownload = await normalizationValidationDownloadPromise
  const normalizationValidationPath = await normalizationValidationDownload.path()
  if (!normalizationValidationPath) throw new Error('Normalization failure did not expose its validation report')
  const normalizationValidationReport = JSON.parse(await readFile(normalizationValidationPath, 'utf8'))
  if (
    normalizationValidationReport.sourceResponseSha256 !==
      createHash('sha256').update(normalizationLimitResponse).digest('hex') ||
    normalizationValidationReport.checks.responseParsed !== 'passed' ||
    normalizationValidationReport.checks.normalization !== 'failed' ||
    normalizationValidationReport.checks.canonicalSchema !== 'skipped' ||
    !normalizationValidationReport.repairReport.issues.some(
      (issue) => issue.phase === 'normalize' && issue.code === 'normalization-failed',
    )
  ) {
    throw new Error('Normalization failure validation report did not identify the passed/failed stages')
  }
  await page.locator('#repair-tools .technical-details summary').click()

  const schemaRecoveryProject = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/core/ir/examples/06-platformer-core.json', import.meta.url)),
      'utf8',
    ),
  )
  const schemaFailureProject = structuredClone(schemaRecoveryProject)
  schemaFailureProject.name = 17
  const schemaFailureResponse = JSON.stringify(schemaFailureProject)
  await page.locator('#json-editor').fill(schemaFailureResponse)
  await page.locator('#student-build').click()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-report').click()
  const schemaFailureValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  if (
    schemaFailureValidationReport.checks.responseParsed !== 'passed' ||
    schemaFailureValidationReport.checks.normalization !== 'passed' ||
    schemaFailureValidationReport.checks.canonicalSchema !== 'failed' ||
    schemaFailureValidationReport.checks.semanticValidation !== 'skipped' ||
    schemaFailureValidationReport.checks.scratchVmCompile !== 'skipped'
  ) {
    throw new Error('Canonical schema failure report did not identify the failed stage')
  }
  const schemaNameIssue = schemaFailureValidationReport.repairReport.issues.find(
    (issue) => issue.phase === 'schema' && issue.path === '/name',
  )
  if (schemaNameIssue?.expected !== 'type=string' || schemaNameIssue?.example?.replaceWith !== 'Scratch Project') {
    throw new Error('Canonical schema report omitted its path-specific name correction example')
  }
  await page.locator('#copy-repair-prompt').click()
  const schemaRepairPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (typeof schemaRepairPrompt !== 'string' || !schemaRepairPrompt.includes('"/name"')) {
    throw new Error('Schema repair prompt omitted the invalid Canonical path')
  }
  await page.locator('#repair-tools .technical-details summary').click()

  await page.locator('#json-editor').fill(JSON.stringify(schemaRecoveryProject))
  const schemaRecoveryDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const schemaRecoveryDownload = await schemaRecoveryDownloadPromise
  const schemaRecoveryPath = await schemaRecoveryDownload.path()
  if (!schemaRecoveryPath) throw new Error('Corrected Canonical schema response did not produce an SB3')
  const schemaRecoveryArchive = await JSZip.loadAsync(await readFile(schemaRecoveryPath))
  const schemaRecoverySb3 = await schemaRecoveryArchive.file('project.json')?.async('string')
  if (!schemaRecoverySb3 || JSON.parse(schemaRecoverySb3).meta?.semver !== '3.0.0') {
    throw new Error('Corrected Canonical schema response did not produce a valid Scratch project archive')
  }
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'schema-recovery.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(schemaRecoveryPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const schemaRecoveryCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const schemaRecoverySpriteName = schemaRecoveryProject.sprites[0]?.name
  if (!schemaRecoveryCanonical.sprites.some((sprite) => sprite.name === schemaRecoverySpriteName)) {
    throw new Error(`Schema-corrected SB3 lost its first sprite on re-import: ${schemaRecoverySpriteName}`)
  }
  await page.locator('#generate-tab').click()

  const schemaAdditionalProperty = 'unexpectedField'
  const schemaAdditionalFailureProject = structuredClone(schemaRecoveryProject)
  schemaAdditionalFailureProject[schemaAdditionalProperty] = 'remove this field'
  await page.locator('#json-editor').fill(JSON.stringify(schemaAdditionalFailureProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-report').click()
  const schemaAdditionalValidationReport = JSON.parse(
    await page.evaluate(() => globalThis.__scratchAiBridgeClipboard),
  )
  const schemaAdditionalIssue = schemaAdditionalValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'schema-additionalProperties' && issue.path === `/${schemaAdditionalProperty}`,
  )
  if (
    schemaAdditionalValidationReport.checks.canonicalSchema !== 'failed' ||
    schemaAdditionalValidationReport.checks.semanticValidation !== 'skipped' ||
    schemaAdditionalValidationReport.checks.scratchVmCompile !== 'skipped' ||
    schemaAdditionalIssue?.expected !== 'no additional property at this path' ||
    schemaAdditionalIssue?.example?.removeProperty !== schemaAdditionalProperty
  ) {
    throw new Error(
      `Additional-property report omitted its exact path or repair example: ${JSON.stringify({ checks: schemaAdditionalValidationReport.checks, issue: schemaAdditionalIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const schemaAdditionalPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof schemaAdditionalPrompt !== 'string' ||
    !schemaAdditionalPrompt.includes('schema-additionalProperties') ||
    !schemaAdditionalPrompt.includes(`"/${schemaAdditionalProperty}"`)
  ) {
    throw new Error('Additional-property repair prompt omitted its issue code or path')
  }
  await page.locator('#repair-tools .technical-details summary').click()
  const correctedSchemaAdditionalProject = structuredClone(schemaAdditionalFailureProject)
  delete correctedSchemaAdditionalProject[schemaAdditionalProperty]
  await page.locator('#json-editor').fill(JSON.stringify(correctedSchemaAdditionalProject))
  const schemaAdditionalDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const schemaAdditionalDownload = await schemaAdditionalDownloadPromise
  const schemaAdditionalPath = await schemaAdditionalDownload.path()
  if (!schemaAdditionalPath) throw new Error('Corrected additional-property response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'schema-additional-property-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(schemaAdditionalPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const schemaAdditionalCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (Object.hasOwn(schemaAdditionalCanonical, schemaAdditionalProperty)) {
    throw new Error(`Removed additional property unexpectedly survived SB3 re-import: ${schemaAdditionalProperty}`)
  }
  await page.locator('#generate-tab').click()

  const schemaEnumFailureProject = structuredClone(schemaRecoveryProject)
  const invalidRotationStyle = 'sideways'
  const expectedRotationStyle = 'all around'
  schemaEnumFailureProject.sprites[0].rotationStyle = invalidRotationStyle
  await page.locator('#json-editor').fill(JSON.stringify(schemaEnumFailureProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-report').click()
  const schemaEnumValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  const schemaEnumIssue = schemaEnumValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'schema-enum' && issue.path === '/sprites/0/rotationStyle',
  )
  if (
    schemaEnumValidationReport.checks.canonicalSchema !== 'failed' ||
    schemaEnumValidationReport.checks.semanticValidation !== 'skipped' ||
    schemaEnumValidationReport.checks.scratchVmCompile !== 'skipped' ||
    schemaEnumIssue?.actual !== invalidRotationStyle ||
    schemaEnumIssue?.example?.replaceWith !== expectedRotationStyle
  ) {
    throw new Error(
      `Enum report omitted its path or allowed replacement: ${JSON.stringify({ checks: schemaEnumValidationReport.checks, issue: schemaEnumIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const schemaEnumPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof schemaEnumPrompt !== 'string' ||
    !schemaEnumPrompt.includes('schema-enum') ||
    !schemaEnumPrompt.includes('"/sprites/0/rotationStyle"')
  ) {
    throw new Error('Enum repair prompt omitted its issue code or path')
  }
  await page.locator('#repair-tools .technical-details summary').click()
  const correctedSchemaEnumProject = structuredClone(schemaEnumFailureProject)
  correctedSchemaEnumProject.sprites[0].rotationStyle = expectedRotationStyle
  await page.locator('#json-editor').fill(JSON.stringify(correctedSchemaEnumProject))
  const schemaEnumDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const schemaEnumDownload = await schemaEnumDownloadPromise
  const schemaEnumPath = await schemaEnumDownload.path()
  if (!schemaEnumPath) throw new Error('Corrected enum response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'schema-enum-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(schemaEnumPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const schemaEnumCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const reimportedRotationStyle = schemaEnumCanonical.sprites[0].rotationStyle
  if (reimportedRotationStyle !== expectedRotationStyle) {
    throw new Error(`Corrected enum value did not survive SB3 re-import: ${reimportedRotationStyle}`)
  }
  await page.locator('#generate-tab').click()

  const schemaConstFailureProject = structuredClone(schemaRecoveryProject)
  schemaConstFailureProject.stage.kind = 'sprite'
  await page.locator('#json-editor').fill(JSON.stringify(schemaConstFailureProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-report').click()
  const schemaConstValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  const schemaConstIssue = schemaConstValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'schema-const' && issue.path === '/stage/kind',
  )
  if (
    schemaConstValidationReport.checks.canonicalSchema !== 'failed' ||
    schemaConstValidationReport.checks.semanticValidation !== 'skipped' ||
    schemaConstValidationReport.checks.scratchVmCompile !== 'skipped' ||
    schemaConstIssue?.actual !== 'sprite' ||
    schemaConstIssue?.expected !== 'const="stage"' ||
    schemaConstIssue?.example?.replaceWith !== 'stage'
  ) {
    throw new Error(
      `Const report omitted its path or required replacement: ${JSON.stringify({ checks: schemaConstValidationReport.checks, issue: schemaConstIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const schemaConstPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof schemaConstPrompt !== 'string' ||
    !schemaConstPrompt.includes('schema-const') ||
    !schemaConstPrompt.includes('"/stage/kind"')
  ) {
    throw new Error('Const repair prompt omitted its issue code or path')
  }
  await page.locator('#repair-tools .technical-details summary').click()
  const correctedSchemaConstProject = structuredClone(schemaConstFailureProject)
  correctedSchemaConstProject.stage.kind = 'stage'
  await page.locator('#json-editor').fill(JSON.stringify(correctedSchemaConstProject))
  const schemaConstDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const schemaConstDownload = await schemaConstDownloadPromise
  const schemaConstPath = await schemaConstDownload.path()
  if (!schemaConstPath) throw new Error('Corrected const response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'schema-const-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(schemaConstPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const schemaConstCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (schemaConstCanonical.stage.kind !== 'stage') {
    throw new Error(`Corrected const value did not survive SB3 re-import: ${schemaConstCanonical.stage.kind}`)
  }
  await page.locator('#generate-tab').click()

  const schemaRequiredFailureProject = structuredClone(schemaRecoveryProject)
  const requiredInputPath = '/sprites/0/scripts/0/blocks/2/inputs/VALUE'
  schemaRequiredFailureProject.sprites[0].scripts[0].blocks[2].inputs.VALUE = { type: 'literal' }
  await page.locator('#json-editor').fill(JSON.stringify(schemaRequiredFailureProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-report').click()
  const schemaRequiredValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  const schemaRequiredIssue = schemaRequiredValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'schema-required' && issue.path === `${requiredInputPath}/value`,
  )
  if (
    schemaRequiredValidationReport.checks.canonicalSchema !== 'failed' ||
    schemaRequiredValidationReport.checks.semanticValidation !== 'skipped' ||
    schemaRequiredValidationReport.checks.scratchVmCompile !== 'skipped' ||
    schemaRequiredIssue?.expected !== 'required property value' ||
    !Object.hasOwn(schemaRequiredIssue?.example?.addProperty ?? {}, 'value')
  ) {
    throw new Error(
      `Required-input report omitted its exact path or example: ${JSON.stringify({ checks: schemaRequiredValidationReport.checks, issue: schemaRequiredIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const schemaRequiredPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof schemaRequiredPrompt !== 'string' ||
    !schemaRequiredPrompt.includes('schema-required') ||
    !schemaRequiredPrompt.includes(`"${requiredInputPath}/value"`)
  ) {
    throw new Error('Required-input repair prompt omitted its issue code or path')
  }
  await page.locator('#repair-tools .technical-details summary').click()
  const correctedSchemaRequiredProject = structuredClone(schemaRequiredFailureProject)
  correctedSchemaRequiredProject.sprites[0].scripts[0].blocks[2].inputs.VALUE = { type: 'literal', value: 0 }
  await page.locator('#json-editor').fill(JSON.stringify(correctedSchemaRequiredProject))
  const schemaRequiredDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const schemaRequiredDownload = await schemaRequiredDownloadPromise
  const schemaRequiredPath = await schemaRequiredDownload.path()
  if (!schemaRequiredPath) throw new Error('Corrected required-input response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'schema-required-input-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(schemaRequiredPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const schemaRequiredCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const findReimportedRequiredInput = (blocks) => {
    for (const block of blocks ?? []) {
      if (
        block.opcode === 'data_setvariableto' &&
        block.fields?.VARIABLE === 'y velocity' &&
        block.inputs?.VALUE?.type === 'literal' &&
        block.inputs?.VALUE?.value === 0
      ) {
        return block.inputs.VALUE
      }
      for (const input of Object.values(block.inputs ?? {})) {
        if (input.type === 'block') {
          const nested = findReimportedRequiredInput([input.block])
          if (nested) return nested
        }
        if (input.type === 'stack') {
          const nested = findReimportedRequiredInput(input.blocks)
          if (nested) return nested
        }
      }
    }
    return undefined
  }
  const reimportedRequiredInput = schemaRequiredCanonical.sprites[0].scripts
    .map((script) => findReimportedRequiredInput(script.blocks))
    .find(Boolean)
  if (reimportedRequiredInput?.type !== 'literal' || reimportedRequiredInput.value !== 0) {
    throw new Error(
      `Corrected required input did not survive SB3 re-import: ${JSON.stringify(reimportedRequiredInput)}`,
    )
  }
  await page.locator('#generate-tab').click()

  const schemaMinLengthFailureProject = structuredClone(schemaRecoveryProject)
  schemaMinLengthFailureProject.name = ''
  await page.locator('#json-editor').fill(JSON.stringify(schemaMinLengthFailureProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-report').click()
  const schemaMinLengthValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  const schemaMinLengthIssue = schemaMinLengthValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'schema-minLength' && issue.path === '/name',
  )
  const schemaMinLengthReplacement = schemaMinLengthIssue?.example?.replaceWith
  if (
    schemaMinLengthValidationReport.checks.canonicalSchema !== 'failed' ||
    schemaMinLengthValidationReport.checks.semanticValidation !== 'skipped' ||
    schemaMinLengthValidationReport.checks.scratchVmCompile !== 'skipped' ||
    schemaMinLengthIssue?.actual !== '' ||
    schemaMinLengthIssue?.expected !== '≥ characters 1' ||
    schemaMinLengthReplacement !== 'Scratch Project'
  ) {
    throw new Error(
      `Min-length report omitted its actual value or replacement: ${JSON.stringify({ checks: schemaMinLengthValidationReport.checks, issue: schemaMinLengthIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const schemaMinLengthPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof schemaMinLengthPrompt !== 'string' ||
    !schemaMinLengthPrompt.includes('schema-minLength') ||
    !schemaMinLengthPrompt.includes('"/name"')
  ) {
    throw new Error('Min-length repair prompt omitted its issue code or path')
  }
  await page.locator('#repair-tools .technical-details summary').click()
  const correctedSchemaMinLengthProject = structuredClone(schemaMinLengthFailureProject)
  correctedSchemaMinLengthProject.name = schemaMinLengthReplacement
  await page.locator('#json-editor').fill(JSON.stringify(correctedSchemaMinLengthProject))
  const submittedSchemaMinLengthProject = JSON.parse(await page.locator('#json-editor').inputValue())
  if (submittedSchemaMinLengthProject.name !== schemaMinLengthReplacement) {
    throw new Error('Min-length correction did not apply the suggested name to the full project response')
  }
  const schemaMinLengthDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const schemaMinLengthDownload = await schemaMinLengthDownloadPromise
  const schemaMinLengthPath = await schemaMinLengthDownload.path()
  if (!schemaMinLengthPath) throw new Error('Corrected min-length response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'schema-min-length-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(schemaMinLengthPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const schemaMinLengthCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const schemaMinLengthReimportedSprites = schemaMinLengthCanonical.sprites.map((sprite) => sprite.name)
  if (!schemaMinLengthReimportedSprites.includes('Player')) {
    throw new Error(`Corrected min-length project lost its Player sprite after SB3 re-import`)
  }
  await page.locator('#generate-tab').click()

  const malformedSvgProject = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/core/ir/examples/06-platformer-core.json', import.meta.url)),
      'utf8',
    ),
  )
  const validSvgData = malformedSvgProject.sprites[0].costumes[0].data
  malformedSvgProject.sprites[0].costumes[0].data = '<not-svg>this is not valid</not-svg>'
  const malformedSvgResponse = JSON.stringify(malformedSvgProject)
  await page.locator('#json-editor').fill(malformedSvgResponse)
  await page.locator('#student-build').click()
  await page.waitForFunction(() => {
    const status = document.querySelector('#generate-status')
    return status?.textContent?.includes('無法完成這份作品') || status?.textContent?.includes('已開始下載')
  })
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) !== 'error') {
    throw new Error(
      `Malformed SVG did not fail browser compilation: ${await page.locator('#generate-status').textContent()}`,
    )
  }
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  const malformedSvgReportDownloadPromise = page.waitForEvent('download', { timeout: 5_000 })
  await page.locator('#download-repair-report').click()
  const malformedSvgReportDownload = await malformedSvgReportDownloadPromise
  const malformedSvgReportPath = await malformedSvgReportDownload.path()
  if (!malformedSvgReportPath) throw new Error('Malformed SVG did not expose a compile validation report')
  const malformedSvgValidationReport = JSON.parse(await readFile(malformedSvgReportPath, 'utf8'))
  if (
    malformedSvgValidationReport.checks.responseParsed !== 'passed' ||
    malformedSvgValidationReport.version !== 2 ||
    malformedSvgValidationReport.checks.normalization !== 'passed' ||
    malformedSvgValidationReport.checks.canonicalSchema !== 'passed' ||
    malformedSvgValidationReport.checks.semanticValidation !== 'passed' ||
    malformedSvgValidationReport.checks.scratchVmCompile !== 'skipped' ||
    malformedSvgValidationReport.compileFailureStage !== 'svg-preflight' ||
    !malformedSvgValidationReport.repairReport.issues.some(
      (issue) =>
        issue.phase === 'compile' &&
        issue.code === 'compile-failed' &&
        issue.path.includes('/costumes/0') &&
        issue.actual?.stage === 'svg-preflight' &&
        issue.expected?.includes('well-formed SVG') &&
        issue.suggestion.includes('SVG XML'),
    )
  ) {
    throw new Error(
      `Malformed SVG validation report did not identify the actual XML compile failure: ${JSON.stringify(malformedSvgValidationReport)}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const malformedSvgRepairPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof malformedSvgRepairPrompt !== 'string' ||
    !malformedSvgRepairPrompt.includes('compile-failed') ||
    !malformedSvgRepairPrompt.includes('"/sprites/0/costumes/0"')
  ) {
    throw new Error('Malformed SVG repair prompt omitted its compile failure or costume path')
  }
  await page.locator('#repair-tools .technical-details summary').click()

  const correctedSvgProject = structuredClone(malformedSvgProject)
  correctedSvgProject.sprites[0].costumes[0].data = validSvgData
  await page.locator('#json-editor').fill(JSON.stringify(correctedSvgProject))
  const submittedSvgCorrection = JSON.parse(await page.locator('#json-editor').inputValue())
  if (submittedSvgCorrection.sprites[0].costumes[0].data !== validSvgData) {
    throw new Error('Malformed SVG repair did not submit the complete corrected Canonical response')
  }
  const correctedSvgDownloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const correctedSvgDownload = await correctedSvgDownloadPromise
  const correctedSvgPath = await correctedSvgDownload.path()
  if (!correctedSvgPath) throw new Error('Corrected SVG response did not produce an SB3 download')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'corrected-svg.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(correctedSvgPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const correctedSvgCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const correctedSvgSprites = correctedSvgCanonical.sprites.map((sprite) => sprite.name)
  const correctedSvgCostume = correctedSvgCanonical.sprites.find((sprite) => sprite.name === 'Player')?.costumes[0]
  const correctedSvgData =
    typeof correctedSvgCostume?.data === 'string' && correctedSvgCostume.data.startsWith('data:image/svg+xml;base64,')
      ? Buffer.from(correctedSvgCostume.data.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
      : correctedSvgCostume?.data
  const correctedSvgAssetValid =
    correctedSvgCostume?.dataFormat === 'svg' &&
    typeof correctedSvgData === 'string' &&
    /^\s*<svg[\s>]/.test(correctedSvgData) &&
    !correctedSvgData.includes('<not-svg>')
  if (!correctedSvgSprites.includes('Player') || !correctedSvgAssetValid) {
    throw new Error(
      `Corrected SVG asset failed after SB3 re-import: ${JSON.stringify({
        sprites: correctedSvgSprites,
        costume: correctedSvgCostume && {
          dataFormat: correctedSvgCostume.dataFormat,
          dataPrefix: typeof correctedSvgCostume.data === 'string' ? correctedSvgCostume.data.slice(0, 48) : null,
        },
      })}`,
    )
  }
  await page.locator('#generate-tab').click()

  for (const [dataFormat, data] of [
    ['png', 'iVBORw0KGgo='],
    ['jpeg', '/9j/'],
    ['bmp', 'Qk'],
  ]) {
    const malformedRasterProject = JSON.parse(
      await readFile(
        fileURLToPath(new URL('../src/core/ir/examples/06-platformer-core.json', import.meta.url)),
        'utf8',
      ),
    )
    malformedRasterProject.sprites[0].costumes[0].dataFormat = dataFormat
    malformedRasterProject.sprites[0].costumes[0].data = data
    await page.locator('#json-editor').fill(JSON.stringify(malformedRasterProject))
    await page.locator('#student-build').click()
    await page.waitForFunction(() =>
      document.querySelector('#generate-status')?.textContent?.includes('無法完成這份作品'),
    )
    await page.locator('#repair-tools:not([hidden])').waitFor()
    await page.locator('#repair-tools .technical-details summary').click()
    const malformedRasterReportDownloadPromise = page.waitForEvent('download', { timeout: 5_000 })
    await page.locator('#download-repair-report').click()
    const malformedRasterReportDownload = await malformedRasterReportDownloadPromise
    const malformedRasterReportPath = await malformedRasterReportDownload.path()
    if (!malformedRasterReportPath)
      throw new Error(`Malformed ${dataFormat} did not expose a compile validation report`)
    const malformedRasterValidationReport = JSON.parse(await readFile(malformedRasterReportPath, 'utf8'))
    if (
      malformedRasterValidationReport.version !== 2 ||
      malformedRasterValidationReport.checks.canonicalSchema !== 'passed' ||
      malformedRasterValidationReport.checks.semanticValidation !== 'passed' ||
      malformedRasterValidationReport.checks.scratchVmCompile !== 'skipped' ||
      malformedRasterValidationReport.compileFailureStage !== 'raster-preflight' ||
      !malformedRasterValidationReport.repairReport.issues.some(
        (issue) =>
          issue.phase === 'compile' &&
          issue.code === 'compile-failed' &&
          issue.path === '/sprites/0/costumes/0' &&
          issue.actual?.stage === 'raster-preflight' &&
          issue.expected?.includes('browser-decodable PNG, JPEG, or BMP') &&
          issue.suggestion.includes('可解碼的 PNG、JPEG 或 BMP'),
      )
    ) {
      throw new Error(
        `Malformed ${dataFormat} validation report did not identify image decode failure: ${JSON.stringify(malformedRasterValidationReport)}`,
      )
    }
    await page.locator('#repair-tools .technical-details summary').click()
  }

  const malformedRasterRepairProject = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/core/ir/examples/06-platformer-core.json', import.meta.url)),
      'utf8',
    ),
  )
  malformedRasterRepairProject.sprites[0].costumes[0].dataFormat = 'png'
  malformedRasterRepairProject.sprites[0].costumes[0].data = 'iVBORw0KGgo='
  await page.locator('#json-editor').fill(JSON.stringify(malformedRasterRepairProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-prompt').click()
  const malformedRasterRepairPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof malformedRasterRepairPrompt !== 'string' ||
    !malformedRasterRepairPrompt.includes('compile-failed') ||
    !malformedRasterRepairPrompt.includes('"/sprites/0/costumes/0"')
  ) {
    throw new Error('Malformed raster repair prompt omitted its compile failure or costume path')
  }
  await page.locator('#repair-tools .technical-details summary').click()
  const correctedRasterProject = structuredClone(malformedRasterRepairProject)
  const correctedRasterData = (await readFile(bitmapFixturePath)).toString('base64')
  correctedRasterProject.sprites[0].costumes[0].data = correctedRasterData
  await page.locator('#json-editor').fill(JSON.stringify(correctedRasterProject))
  const submittedRasterCorrection = JSON.parse(await page.locator('#json-editor').inputValue())
  if (submittedRasterCorrection.sprites[0].costumes[0].data !== correctedRasterData) {
    throw new Error('Malformed raster repair did not submit the complete corrected Canonical response')
  }
  const correctedRasterDownloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const correctedRasterDownload = await correctedRasterDownloadPromise
  const correctedRasterPath = await correctedRasterDownload.path()
  if (!correctedRasterPath) throw new Error('Corrected raster response did not produce an SB3 download')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'corrected-raster.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(correctedRasterPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const correctedRasterCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const correctedRasterSprites = correctedRasterCanonical.sprites.map((sprite) => sprite.name)
  const correctedRasterCostume = correctedRasterCanonical.sprites.find((sprite) => sprite.name === 'Player')
    ?.costumes[0]
  const correctedRasterAssetValid =
    correctedRasterCostume?.dataFormat === 'png' &&
    typeof correctedRasterCostume.data === 'string' &&
    correctedRasterCostume.data.length > 16 &&
    correctedRasterCostume.data !== 'iVBORw0KGgo='
  if (!correctedRasterSprites.includes('Player') || !correctedRasterAssetValid) {
    throw new Error('Corrected raster project lost its Player sprite after SB3 re-import')
  }
  await page.locator('#generate-tab').click()

  const validRasterProject = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/core/ir/examples/02-green-flag-move-say.json', import.meta.url)),
      'utf8',
    ),
  )
  validRasterProject.stage.costumes.push({
    name: 'Valid bitmap',
    dataFormat: 'png',
    data: (await readFile(bitmapFixturePath)).toString('base64'),
  })
  const validRasterDownloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.locator('#json-editor').fill(JSON.stringify(validRasterProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const validRasterDownload = await validRasterDownloadPromise
  const validRasterDownloadPath = await validRasterDownload.path()
  if (!validRasterDownloadPath || (await readFile(validRasterDownloadPath)).byteLength === 0) {
    throw new Error('A decodable PNG costume did not produce an SB3 download')
  }
  await page.locator('#download-student-validation-report').waitFor({ state: 'visible' })
  const validRasterReportDownloadPromise = page.waitForEvent('download', { timeout: 5_000 })
  await page.locator('#download-student-validation-report').click()
  const validRasterReportDownload = await validRasterReportDownloadPromise
  const validRasterReportPath = await validRasterReportDownload.path()
  if (!validRasterReportPath) throw new Error('Successful raster compilation did not expose its validation report')
  const validRasterValidationReport = JSON.parse(await readFile(validRasterReportPath, 'utf8'))
  if (
    validRasterValidationReport.version !== 2 ||
    validRasterValidationReport.compileFailureStage !== null ||
    validRasterValidationReport.checks.scratchVmCompile !== 'passed'
  ) {
    throw new Error(
      `Valid raster compile report was not a passing version 2 report: ${JSON.stringify(validRasterValidationReport)}`,
    )
  }

  const validWav = createDecodableWavFixture()
  for (const [dataFormat, data] of [
    ['wav', 'UklGRg=='],
    ['mp3', 'SUQz'],
  ]) {
    const malformedAudioProject = JSON.parse(
      await readFile(
        fileURLToPath(new URL('../src/core/ir/examples/02-green-flag-move-say.json', import.meta.url)),
        'utf8',
      ),
    )
    malformedAudioProject.stage.sounds.push({ name: `Truncated ${dataFormat}`, dataFormat, data })
    await page.locator('#json-editor').fill(JSON.stringify(malformedAudioProject))
    await page.locator('#student-build').click()
    await page.waitForFunction(() =>
      document.querySelector('#generate-status')?.textContent?.includes('無法完成這份作品'),
    )
    await page.locator('#repair-tools:not([hidden])').waitFor()
    await page.locator('#repair-tools .technical-details summary').click()
    const malformedAudioReportDownloadPromise = page.waitForEvent('download', { timeout: 5_000 })
    await page.locator('#download-repair-report').click()
    const malformedAudioReportDownload = await malformedAudioReportDownloadPromise
    const malformedAudioReportPath = await malformedAudioReportDownload.path()
    if (!malformedAudioReportPath) throw new Error(`Malformed ${dataFormat} did not expose a validation report`)
    const malformedAudioValidationReport = JSON.parse(await readFile(malformedAudioReportPath, 'utf8'))
    if (
      malformedAudioValidationReport.version !== 2 ||
      malformedAudioValidationReport.checks.canonicalSchema !== 'passed' ||
      malformedAudioValidationReport.checks.semanticValidation !== 'passed' ||
      malformedAudioValidationReport.checks.scratchVmCompile !== 'skipped' ||
      malformedAudioValidationReport.compileFailureStage !== 'audio-preflight' ||
      !malformedAudioValidationReport.repairReport.issues.some(
        (issue) =>
          issue.phase === 'compile' &&
          issue.code === 'compile-failed' &&
          issue.path === '/stage/sounds/0' &&
          issue.actual?.stage === 'audio-preflight' &&
          issue.expected?.includes('browser-decodable WAV or MP3') &&
          issue.suggestion.includes('可解碼的 WAV 或 MP3'),
      )
    ) {
      throw new Error(
        `Malformed ${dataFormat} validation report did not identify audio decode failure: ${JSON.stringify(malformedAudioValidationReport)}`,
      )
    }
    await page.locator('#repair-tools .technical-details summary').click()
  }

  const malformedAudioRepairProject = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/core/ir/examples/02-green-flag-move-say.json', import.meta.url)),
      'utf8',
    ),
  )
  malformedAudioRepairProject.stage.sounds.push({
    name: 'Truncated wav',
    dataFormat: 'wav',
    data: 'UklGRg==',
    rate: 22_050,
    sampleCount: 1,
  })
  await page.locator('#json-editor').fill(JSON.stringify(malformedAudioRepairProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-prompt').click()
  const malformedAudioRepairPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof malformedAudioRepairPrompt !== 'string' ||
    !malformedAudioRepairPrompt.includes('compile-failed') ||
    !malformedAudioRepairPrompt.includes('"/stage/sounds/0"')
  ) {
    throw new Error('Malformed audio repair prompt omitted its compile failure or sound path')
  }
  await page.locator('#repair-tools .technical-details summary').click()
  const correctedAudioProject = structuredClone(malformedAudioRepairProject)
  correctedAudioProject.stage.sounds[0].data = validWav.bytes.toString('base64')
  correctedAudioProject.stage.sounds[0].sampleCount = validWav.sampleCount
  await page.locator('#json-editor').fill(JSON.stringify(correctedAudioProject))
  const submittedAudioCorrection = JSON.parse(await page.locator('#json-editor').inputValue())
  if (submittedAudioCorrection.stage.sounds[0].data !== correctedAudioProject.stage.sounds[0].data) {
    throw new Error('Malformed audio repair did not submit the complete corrected Canonical response')
  }
  const correctedAudioDownloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const correctedAudioDownload = await correctedAudioDownloadPromise
  const correctedAudioPath = await correctedAudioDownload.path()
  if (!correctedAudioPath) throw new Error('Corrected audio response did not produce an SB3 download')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'corrected-audio.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(correctedAudioPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const correctedAudioCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const correctedAudioSoundNames = correctedAudioCanonical.stage.sounds.map((sound) => sound.name)
  const correctedAudioSound = correctedAudioCanonical.stage.sounds.find((sound) => sound.name === 'Truncated wav')
  const correctedAudioAssetValid =
    correctedAudioSound?.dataFormat === 'wav' &&
    typeof correctedAudioSound.data === 'string' &&
    correctedAudioSound.data.length > 100 &&
    correctedAudioSound.data !== 'UklGRg=='
  if (!correctedAudioSoundNames.includes('Truncated wav') || !correctedAudioAssetValid) {
    throw new Error('Corrected audio sound did not survive SB3 re-import')
  }
  await page.locator('#generate-tab').click()

  const validAudioProject = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/core/ir/examples/02-green-flag-move-say.json', import.meta.url)),
      'utf8',
    ),
  )
  validAudioProject.stage.sounds.push(
    {
      name: 'Valid WAV',
      dataFormat: 'wav',
      data: validWav.bytes.toString('base64'),
      rate: 22_050,
      sampleCount: validWav.sampleCount,
    },
    {
      name: 'Valid MP3',
      dataFormat: 'mp3',
      data: (await readFile(officialMp3FixturePath)).toString('base64'),
    },
  )
  const validAudioDownloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await page.locator('#json-editor').fill(JSON.stringify(validAudioProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const validAudioDownload = await validAudioDownloadPromise
  if (!(await validAudioDownload.path())) throw new Error('Decodable WAV and MP3 did not produce an SB3 download')

  await page.locator('#advanced-tools summary').click()

  await page.locator('#json-editor').fill(await readFile(geminiMixedResponsePath, 'utf8'))
  await page.locator('#repair').click()
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  const mixedResponseRepaired = (await page.locator('#generate-status').textContent())?.trim()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) === 'error') {
    throw new Error(`Mixed AI response repair failed: ${mixedResponseRepaired}`)
  }
  const mixedResponseProject = JSON.parse(await page.locator('#json-editor').inputValue())
  if (mixedResponseProject.name !== 'Mario ``` Mixed Response') {
    throw new Error(`Mixed AI response selected the wrong JSON candidate: ${mixedResponseProject.name}`)
  }
  await page.locator('#validate').click()
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) === 'error') {
    throw new Error(
      `Extracted AI response validation failed: ${await page.locator('#generate-status').textContent()}`,
    )
  }

  await page.locator('#json-editor').fill(await readFile(geminiDraftPath, 'utf8'))
  await page.locator('#repair').click()
  await page.locator('#generate-status[data-kind="neutral"], #generate-status[data-kind="error"]').waitFor()
  const repaired = (await page.locator('#generate-status').textContent())?.trim()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) === 'error') {
    throw new Error(`AI draft repair failed: ${repaired}`)
  }

  await page.locator('#copy-repair-prompt').click()
  const repairPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof repairPrompt !== 'string' ||
    !repairPrompt.includes('只回傳一個完整 JSON 根物件') ||
    !repairPrompt.includes('scratch-ai-bridge/repair-report') ||
    !repairPrompt.includes('Current Canonical IR:')
  ) {
    throw new Error('Paste-ready AI repair prompt is incomplete')
  }

  await page.locator('#repair-tools .technical-details summary').click()
  await page.locator('#copy-repair-report').click()
  const copiedReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  if (copiedReport.summary.autoRepaired !== 106 || copiedReport.summary.warnings !== 3) {
    throw new Error(`Unexpected Repair Report summary: ${JSON.stringify(copiedReport.summary)}`)
  }

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => {
        throw new Error('permission denied')
      },
    })
  })
  await page.locator('#copy-repair-report').click()
  await page.locator('#clipboard-fallback:not([hidden])').waitFor()
  const fallbackReport = JSON.parse(await page.locator('#clipboard-fallback-text').inputValue())
  if (fallbackReport.format !== 'scratch-ai-bridge/repair-report') {
    throw new Error('Clipboard fallback does not contain the complete Repair Report')
  }

  await page.locator('#undo-repair').click()
  const restoredDraft = JSON.parse(await page.locator('#json-editor').inputValue())
  if (restoredDraft.stage.kind !== undefined) throw new Error('Undo did not restore the original AI response')
  await page.locator('#repair').click()

  await page.locator('#validate').click()
  await page.locator('#generate-status[data-kind="neutral"], #generate-status[data-kind="error"]').waitFor()
  const validated = (await page.locator('#generate-status').textContent())?.trim()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) === 'error') {
    throw new Error(`Repaired draft validation failed: ${validated}`)
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (value) => {
        globalThis.__scratchAiBridgeClipboard = value
      },
    })
  })

  const correctedCanonical = JSON.parse(await page.locator('#json-editor').inputValue())
  const brokenCanonical = structuredClone(correctedCanonical)
  const repairTarget = brokenCanonical.sprites.find((sprite) => sprite.scripts?.length > 0)
  const repairBlock = repairTarget?.scripts[0]?.blocks[0]
  if (!repairBlock) throw new Error('Repaired AI response has no block for the correction-loop regression')
  repairBlock.opcode = 'unsupported_repair_loop_smoke_opcode'
  await page.locator('#json-editor').fill(JSON.stringify(brokenCanonical, null, 2))
  await page.locator('#validate').click()
  await page.waitForFunction(() =>
    document.querySelector('#generate-status')?.textContent?.includes('unknown-opcode'),
  )
  await page.waitForFunction(() => document.querySelector('#repair-summary')?.textContent?.includes('必須修正 1'))
  await page.locator('#copy-repair-prompt').click()
  const correctionPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (typeof correctionPrompt !== 'string' || !correctionPrompt.includes('unknown-opcode')) {
    throw new Error(
      `Repair prompt did not include the blocking semantic issue: ${JSON.stringify({ summary: await page.locator('#repair-summary').textContent(), status: await page.locator('#generate-status').textContent(), prompt: String(correctionPrompt).slice(0, 300) })}`,
    )
  }
  await page.locator('#copy-repair-report').click()
  const correctionReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  if (
    correctionReport.summary.errors < 1 ||
    !correctionReport.issues.some((issue) => issue.code === 'unknown-opcode')
  ) {
    throw new Error('Repair Report omitted the unsupported opcode error')
  }
  await page.locator('#student-build').click()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const semanticFailureValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  if (
    semanticFailureValidationReport.checks.canonicalSchema !== 'passed' ||
    semanticFailureValidationReport.checks.semanticValidation !== 'failed' ||
    semanticFailureValidationReport.checks.scratchVmCompile !== 'skipped'
  ) {
    throw new Error('Canonical semantic failure report did not identify the failed stage')
  }
  const invalidImageProject = structuredClone(correctedCanonical)
  invalidImageProject.stage.costumes = [
    {
      name: 'base64-valid-but-not-png',
      dataFormat: 'png',
      data: Buffer.from('this is not a PNG').toString('base64'),
    },
  ]
  await page.locator('#json-editor').fill(JSON.stringify(invalidImageProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const invalidImageValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  if (
    invalidImageValidationReport.checks.canonicalSchema !== 'passed' ||
    invalidImageValidationReport.checks.semanticValidation !== 'failed' ||
    invalidImageValidationReport.checks.scratchVmCompile !== 'skipped' ||
    !invalidImageValidationReport.repairReport.issues.some((issue) => issue.code === 'asset-format-mismatch')
  ) {
    throw new Error('Base64-valid but undecodable PNG was not rejected during semantic validation')
  }
  const invalidCostumeIndexProject = structuredClone(schemaRecoveryProject)
  invalidCostumeIndexProject.stage.currentCostume = Math.max(1, invalidCostumeIndexProject.stage.costumes.length)
  await page.locator('#json-editor').fill(JSON.stringify(invalidCostumeIndexProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const invalidCostumeIndexValidationReport = JSON.parse(
    await page.evaluate(() => globalThis.__scratchAiBridgeClipboard),
  )
  const invalidCostumeIndexIssue = invalidCostumeIndexValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'current-costume-out-of-range',
  )
  if (
    invalidCostumeIndexValidationReport.checks.canonicalSchema !== 'passed' ||
    invalidCostumeIndexValidationReport.checks.semanticValidation !== 'failed' ||
    invalidCostumeIndexValidationReport.checks.scratchVmCompile !== 'skipped' ||
    invalidCostumeIndexIssue?.path !== '/stage/currentCostume' ||
    invalidCostumeIndexIssue?.example?.replaceWith !== 0
  ) {
    throw new Error('Out-of-range current costume was not rejected with a usable repair suggestion')
  }

  const suggestedCostumeIndex = invalidCostumeIndexIssue.example?.replaceWith
  if (!Number.isSafeInteger(suggestedCostumeIndex)) {
    throw new Error('Out-of-range current costume suggestion is not a safe integer')
  }
  const repairedCostumeIndexProject = structuredClone(invalidCostumeIndexProject)
  repairedCostumeIndexProject.stage.currentCostume = suggestedCostumeIndex
  await page.locator('#json-editor').fill(JSON.stringify(repairedCostumeIndexProject))
  const costumeRepairDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const costumeRepairDownload = await costumeRepairDownloadPromise
  const costumeRepairPath = await costumeRepairDownload.path()
  if (!costumeRepairPath) throw new Error('Suggested costume repair did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'costume-index-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(costumeRepairPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const costumeRepairCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (costumeRepairCanonical.stage.currentCostume !== suggestedCostumeIndex) {
    throw new Error(
      `Suggested costume index ${suggestedCostumeIndex} did not survive SB3 re-import: ${costumeRepairCanonical.stage.currentCostume}`,
    )
  }
  await page.locator('#generate-tab').click()

  const unknownSpriteProject = structuredClone(schemaRecoveryProject)
  const unknownSpriteInput =
    unknownSpriteProject.sprites[0].scripts[0].blocks[3].inputs.SUBSTACK.blocks[2].inputs.CONDITION.block.inputs
      .TOUCHINGOBJECTMENU
  if (unknownSpriteInput?.type !== 'literal' || typeof unknownSpriteInput.value !== 'string') {
    throw new Error('Platformer fixture no longer has the expected touching-object sprite menu for repair smoke')
  }
  const originalSpriteMenuValue = unknownSpriteInput.value
  unknownSpriteInput.value = 'Missing Sprite'
  await page.locator('#json-editor').fill(JSON.stringify(unknownSpriteProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const unknownSpriteValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  const unknownSpriteIssue = unknownSpriteValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'unknown-sprite',
  )
  if (
    unknownSpriteValidationReport.checks.canonicalSchema !== 'passed' ||
    unknownSpriteValidationReport.checks.semanticValidation !== 'failed' ||
    unknownSpriteValidationReport.checks.scratchVmCompile !== 'skipped' ||
    unknownSpriteIssue?.actual?.value !== 'Missing Sprite' ||
    unknownSpriteIssue?.path !==
      '/sprites/0/scripts/0/blocks/3/inputs/SUBSTACK/blocks/2/inputs/CONDITION/block/inputs/TOUCHINGOBJECTMENU'
  ) {
    throw new Error(
      `Unknown-sprite report omitted the exact semantic failure path and value: ${JSON.stringify({ checks: unknownSpriteValidationReport.checks, issue: unknownSpriteIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const unknownSpritePrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof unknownSpritePrompt !== 'string' ||
    !unknownSpritePrompt.includes('unknown-sprite') ||
    !unknownSpritePrompt.includes(unknownSpriteIssue.path)
  ) {
    throw new Error('Unknown-sprite repair prompt omitted its issue code or path')
  }
  const correctedUnknownSpriteProject = structuredClone(unknownSpriteProject)
  correctedUnknownSpriteProject.sprites[0].scripts[0].blocks[3].inputs.SUBSTACK.blocks[2].inputs.CONDITION.block.inputs.TOUCHINGOBJECTMENU.value =
    originalSpriteMenuValue
  await page.locator('#json-editor').fill(JSON.stringify(correctedUnknownSpriteProject))
  const unknownSpriteDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const unknownSpriteDownload = await unknownSpriteDownloadPromise
  const unknownSpritePath = await unknownSpriteDownload.path()
  if (!unknownSpritePath) throw new Error('Corrected unknown-sprite response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'unknown-sprite-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(unknownSpritePath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const unknownSpriteCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const unknownSpriteNames = unknownSpriteCanonical.sprites.map((sprite) => sprite.name)
  if (!unknownSpriteNames.includes('Player') || !unknownSpriteNames.includes(originalSpriteMenuValue)) {
    throw new Error(
      `Corrected unknown-sprite project lost its collision target: ${JSON.stringify(unknownSpriteNames)}`,
    )
  }
  await page.locator('#generate-tab').click()

  const unknownVariableProject = structuredClone(schemaRecoveryProject)
  const unknownVariableInput =
    unknownVariableProject.sprites[0].scripts[0].blocks[3].inputs.SUBSTACK.blocks[0].inputs.DY
  if (unknownVariableInput?.type !== 'variable') {
    throw new Error('Platformer fixture no longer has the expected variable reporter for semantic repair smoke')
  }
  const originalVariableName = unknownVariableInput.name
  unknownVariableInput.name = 'missing y velocity'
  await page.locator('#json-editor').fill(JSON.stringify(unknownVariableProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const unknownVariableValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  const unknownVariableIssue = unknownVariableValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'unknown-variable',
  )
  if (
    unknownVariableValidationReport.checks.canonicalSchema !== 'passed' ||
    unknownVariableValidationReport.checks.semanticValidation !== 'failed' ||
    unknownVariableValidationReport.checks.scratchVmCompile !== 'skipped' ||
    unknownVariableIssue?.actual?.name !== 'missing y velocity' ||
    unknownVariableIssue?.path !== '/sprites/0/scripts/0/blocks/3/inputs/SUBSTACK/blocks/0/inputs/DY'
  ) {
    throw new Error(
      `Unknown-variable report omitted the exact semantic failure path and value: ${JSON.stringify({ checks: unknownVariableValidationReport.checks, issue: unknownVariableIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const unknownVariablePrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof unknownVariablePrompt !== 'string' ||
    !unknownVariablePrompt.includes('unknown-variable') ||
    !unknownVariablePrompt.includes(unknownVariableIssue.path)
  ) {
    throw new Error('Unknown-variable repair prompt omitted its issue code or path')
  }
  await page.locator('#json-editor').fill(JSON.stringify(schemaRecoveryProject))
  const unknownVariableDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const unknownVariableDownload = await unknownVariableDownloadPromise
  const unknownVariablePath = await unknownVariableDownload.path()
  if (!unknownVariablePath) throw new Error('Corrected unknown-variable response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'unknown-variable-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(unknownVariablePath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const unknownVariableCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (unknownVariableCanonical.sprites[0].variables[0].name !== originalVariableName) {
    throw new Error('Corrected unknown-variable project did not retain its declared variable after re-import')
  }
  await page.locator('#generate-tab').click()

  const unknownBroadcastProject = structuredClone(schemaRecoveryProject)
  const broadcastHat = unknownBroadcastProject.sprites[0].scripts[1]?.blocks[0]
  if (broadcastHat?.opcode !== 'event_whenkeypressed') {
    throw new Error('Platformer fixture no longer has the expected keyboard hat for broadcast repair smoke')
  }
  const unknownBroadcastName = 'Missing broadcast'
  broadcastHat.opcode = 'event_whenbroadcastreceived'
  broadcastHat.fields = { BROADCAST_OPTION: unknownBroadcastName }
  await page.locator('#json-editor').fill(JSON.stringify(unknownBroadcastProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const unknownBroadcastValidationReport = JSON.parse(
    await page.evaluate(() => globalThis.__scratchAiBridgeClipboard),
  )
  const unknownBroadcastIssue = unknownBroadcastValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'unknown-broadcast',
  )
  if (
    unknownBroadcastValidationReport.checks.canonicalSchema !== 'passed' ||
    unknownBroadcastValidationReport.checks.semanticValidation !== 'failed' ||
    unknownBroadcastValidationReport.checks.scratchVmCompile !== 'skipped' ||
    unknownBroadcastIssue?.actual !== unknownBroadcastName ||
    unknownBroadcastIssue?.path !== '/sprites/0/scripts/1/blocks/0/fields/BROADCAST_OPTION' ||
    !unknownBroadcastIssue.suggestion.includes('{"name":"..."}')
  ) {
    throw new Error(
      `Unknown-broadcast report omitted the declaration guidance or exact issue: ${JSON.stringify({ checks: unknownBroadcastValidationReport.checks, issue: unknownBroadcastIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const unknownBroadcastPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof unknownBroadcastPrompt !== 'string' ||
    !unknownBroadcastPrompt.includes('unknown-broadcast') ||
    !unknownBroadcastPrompt.includes(unknownBroadcastIssue.path)
  ) {
    throw new Error('Unknown-broadcast repair prompt omitted its issue code or path')
  }
  const correctedUnknownBroadcastProject = structuredClone(unknownBroadcastProject)
  correctedUnknownBroadcastProject.broadcasts.push({ name: unknownBroadcastName })
  await page.locator('#json-editor').fill(JSON.stringify(correctedUnknownBroadcastProject))
  const unknownBroadcastDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const unknownBroadcastDownload = await unknownBroadcastDownloadPromise
  const unknownBroadcastPath = await unknownBroadcastDownload.path()
  if (!unknownBroadcastPath) throw new Error('Corrected unknown-broadcast response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'unknown-broadcast-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(unknownBroadcastPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const unknownBroadcastCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (!unknownBroadcastCanonical.broadcasts.some((broadcast) => broadcast.name === unknownBroadcastName)) {
    throw new Error('Corrected unknown-broadcast declaration did not survive SB3 re-import')
  }
  await page.locator('#generate-tab').click()

  const unknownListProject = structuredClone(schemaRecoveryProject)
  const listCommand = unknownListProject.sprites[0].scripts[0].blocks[2]
  if (listCommand?.opcode !== 'data_setvariableto') {
    throw new Error('Platformer fixture no longer has the expected data command for list repair smoke')
  }
  const unknownListName = 'Missing list'
  listCommand.opcode = 'data_addtolist'
  listCommand.fields = { LIST: unknownListName }
  listCommand.inputs = { ITEM: { type: 'literal', value: 'score' } }
  await page.locator('#json-editor').fill(JSON.stringify(unknownListProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const unknownListValidationReport = JSON.parse(await page.evaluate(() => globalThis.__scratchAiBridgeClipboard))
  const unknownListIssue = unknownListValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'unknown-list',
  )
  if (
    unknownListValidationReport.checks.canonicalSchema !== 'passed' ||
    unknownListValidationReport.checks.semanticValidation !== 'failed' ||
    unknownListValidationReport.checks.scratchVmCompile !== 'skipped' ||
    unknownListIssue?.actual !== unknownListName ||
    unknownListIssue?.path !== '/sprites/0/scripts/0/blocks/2/fields/LIST' ||
    !unknownListIssue.suggestion.includes('清單')
  ) {
    throw new Error(
      `Unknown-list report omitted the declaration guidance or exact issue: ${JSON.stringify({ checks: unknownListValidationReport.checks, issue: unknownListIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const unknownListPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof unknownListPrompt !== 'string' ||
    !unknownListPrompt.includes('unknown-list') ||
    !unknownListPrompt.includes(unknownListIssue.path)
  ) {
    throw new Error('Unknown-list repair prompt omitted its issue code or path')
  }
  const correctedUnknownListProject = structuredClone(unknownListProject)
  correctedUnknownListProject.stage.lists.push({ name: unknownListName, value: [] })
  await page.locator('#json-editor').fill(JSON.stringify(correctedUnknownListProject))
  const unknownListDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const unknownListDownload = await unknownListDownloadPromise
  const unknownListPath = await unknownListDownload.path()
  if (!unknownListPath) throw new Error('Corrected unknown-list response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'unknown-list-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(unknownListPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const unknownListCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (!unknownListCanonical.stage.lists.some((list) => list.name === unknownListName)) {
    throw new Error('Corrected unknown-list declaration did not survive SB3 re-import')
  }
  await page.locator('#generate-tab').click()

  const unknownProcedureProject = structuredClone(schemaRecoveryProject)
  const procedureCall = unknownProcedureProject.sprites[0].scripts[0].blocks[2]
  if (procedureCall?.opcode !== 'data_setvariableto') {
    throw new Error('Platformer fixture no longer has the expected data command for procedure repair smoke')
  }
  const unknownProcedureName = 'Missing procedure'
  procedureCall.opcode = 'procedures_call'
  procedureCall.fields = {}
  procedureCall.inputs = {}
  procedureCall.procedure = { name: unknownProcedureName }
  await page.locator('#json-editor').fill(JSON.stringify(unknownProcedureProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const unknownProcedureValidationReport = JSON.parse(
    await page.evaluate(() => globalThis.__scratchAiBridgeClipboard),
  )
  const unknownProcedureIssue = unknownProcedureValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'unknown-procedure',
  )
  if (
    unknownProcedureValidationReport.checks.canonicalSchema !== 'passed' ||
    unknownProcedureValidationReport.checks.semanticValidation !== 'failed' ||
    unknownProcedureValidationReport.checks.scratchVmCompile !== 'skipped' ||
    unknownProcedureIssue?.path !== '/sprites/0/scripts/0/blocks/2' ||
    unknownProcedureIssue?.actual?.procedure?.name !== unknownProcedureName ||
    !unknownProcedureIssue.suggestion.includes('procedure definition')
  ) {
    throw new Error(
      `Unknown-procedure report omitted its definition guidance or exact issue: ${JSON.stringify({ checks: unknownProcedureValidationReport.checks, issue: unknownProcedureIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const unknownProcedurePrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof unknownProcedurePrompt !== 'string' ||
    !unknownProcedurePrompt.includes('unknown-procedure') ||
    !unknownProcedurePrompt.includes(unknownProcedureIssue.path)
  ) {
    throw new Error('Unknown-procedure repair prompt omitted its issue code or path')
  }
  const correctedUnknownProcedureProject = structuredClone(unknownProcedureProject)
  correctedUnknownProcedureProject.sprites[0].procedures.push({
    name: unknownProcedureName,
    parameters: [],
    warp: false,
    body: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'procedure repaired' } } }],
  })
  await page.locator('#json-editor').fill(JSON.stringify(correctedUnknownProcedureProject))
  const unknownProcedureDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const unknownProcedureDownload = await unknownProcedureDownloadPromise
  const unknownProcedurePath = await unknownProcedureDownload.path()
  if (!unknownProcedurePath) throw new Error('Corrected unknown-procedure response did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'unknown-procedure-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(unknownProcedurePath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const unknownProcedureCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (!unknownProcedureCanonical.sprites[0].procedures.some((procedure) => procedure.name === unknownProcedureName)) {
    throw new Error('Corrected procedure definition did not survive SB3 re-import')
  }
  await page.locator('#generate-tab').click()

  const unknownProcedureArgumentProject = structuredClone(schemaRecoveryProject)
  const findBlockLocation = (blocks, parentPath = []) => {
    for (const [index, block] of (blocks ?? []).entries()) {
      const path = [...parentPath, index]
      if (block.opcode === 'data_setvariableto') return { block, path }
      for (const [inputName, input] of Object.entries(block.inputs ?? {})) {
        if (input.type === 'block') {
          const nested = findBlockLocation([input.block], [...path, 'inputs', inputName, 'block'])
          if (nested) return nested
        }
        if (input.type === 'stack') {
          const nested = findBlockLocation(input.blocks, [...path, 'inputs', inputName, 'blocks'])
          if (nested) return nested
        }
      }
    }
    return undefined
  }
  const procedureArgumentLocation = findBlockLocation(unknownProcedureArgumentProject.sprites[0].scripts[0].blocks)
  const procedureArgumentCall = procedureArgumentLocation?.block
  const procedureArgumentIssuePath = `/sprites/0/scripts/0/blocks/${procedureArgumentLocation?.path.join('/')}/inputs/unexpected`
  const knownProcedureName = 'Known procedure'
  const unexpectedProcedureArgumentName = 'unexpected'
  if (procedureArgumentCall?.opcode !== 'data_setvariableto') {
    throw new Error('Platformer fixture no longer has the expected command for procedure-argument repair smoke')
  }
  procedureArgumentCall.opcode = 'procedures_call'
  procedureArgumentCall.fields = {}
  procedureArgumentCall.procedure = { name: knownProcedureName }
  procedureArgumentCall.inputs = {
    [unexpectedProcedureArgumentName]: { type: 'literal', value: 'extra' },
  }
  unknownProcedureArgumentProject.sprites[0].procedures.push({
    name: knownProcedureName,
    parameters: [],
    warp: false,
    body: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'known procedure' } } }],
  })
  await page.locator('#json-editor').fill(JSON.stringify(unknownProcedureArgumentProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const unknownProcedureArgumentValidationReport = JSON.parse(
    await page.evaluate(() => globalThis.__scratchAiBridgeClipboard),
  )
  const unknownProcedureArgumentIssue = unknownProcedureArgumentValidationReport.repairReport.issues.find(
    (issue) => issue.code === 'unknown-procedure-argument',
  )
  if (
    unknownProcedureArgumentValidationReport.checks.canonicalSchema !== 'passed' ||
    unknownProcedureArgumentValidationReport.checks.semanticValidation !== 'failed' ||
    unknownProcedureArgumentValidationReport.checks.scratchVmCompile !== 'skipped' ||
    unknownProcedureArgumentIssue?.path !== procedureArgumentIssuePath ||
    unknownProcedureArgumentIssue?.actual?.value !== 'extra' ||
    !unknownProcedureArgumentIssue.suggestion.includes('參數')
  ) {
    throw new Error(
      `Unknown procedure argument report omitted its exact path or repair guidance: ${JSON.stringify({ checks: unknownProcedureArgumentValidationReport.checks, issue: unknownProcedureArgumentIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const unknownProcedureArgumentPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof unknownProcedureArgumentPrompt !== 'string' ||
    !unknownProcedureArgumentPrompt.includes('unknown-procedure-argument') ||
    !unknownProcedureArgumentPrompt.includes(unknownProcedureArgumentIssue.path)
  ) {
    throw new Error('Unknown procedure argument prompt omitted its issue code or path')
  }
  const correctedUnknownProcedureArgumentProject = structuredClone(unknownProcedureArgumentProject)
  let correctedProcedureArgumentParent = correctedUnknownProcedureArgumentProject.sprites[0].scripts[0].blocks
  for (const pathPart of procedureArgumentLocation.path.slice(0, -1)) {
    correctedProcedureArgumentParent = correctedProcedureArgumentParent[pathPart]
  }
  delete correctedProcedureArgumentParent[procedureArgumentLocation.path.at(-1)].inputs[
    unexpectedProcedureArgumentName
  ]
  await page.locator('#json-editor').fill(JSON.stringify(correctedUnknownProcedureArgumentProject))
  const unknownProcedureArgumentDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const unknownProcedureArgumentDownload = await unknownProcedureArgumentDownloadPromise
  const unknownProcedureArgumentPath = await unknownProcedureArgumentDownload.path()
  if (!unknownProcedureArgumentPath) {
    throw new Error('Corrected procedure argument response did not produce an SB3')
  }
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'unknown-procedure-argument-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(unknownProcedureArgumentPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const unknownProcedureArgumentCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const findProcedureCall = (blocks) => {
    for (const block of blocks ?? []) {
      if (block.opcode === 'procedures_call') return block
      for (const input of Object.values(block.inputs ?? {})) {
        if (input.type === 'block') {
          const nestedCall = findProcedureCall([input.block])
          if (nestedCall) return nestedCall
        }
        if (input.type === 'stack') {
          const nestedCall = findProcedureCall(input.blocks)
          if (nestedCall) return nestedCall
        }
      }
    }
    return undefined
  }
  const reimportedProcedureCall = unknownProcedureArgumentCanonical.sprites[0].scripts
    .map((script) => findProcedureCall(script.blocks))
    .find(Boolean)
  if (
    !unknownProcedureArgumentCanonical.sprites[0].procedures.some(
      (procedure) => procedure.name === knownProcedureName,
    ) ||
    reimportedProcedureCall?.opcode !== 'procedures_call' ||
    Object.hasOwn(reimportedProcedureCall?.inputs ?? {}, unexpectedProcedureArgumentName)
  ) {
    throw new Error('Corrected procedure call or its definition did not survive SB3 re-import')
  }
  await page.locator('#generate-tab').click()

  const duplicateProcedureArgumentProject = structuredClone(schemaRecoveryProject)
  duplicateProcedureArgumentProject.sprites[0].procedures.push({
    name: 'Duplicate parameter repair',
    parameters: [
      { name: 'value', kind: 'string-number', default: '' },
      { name: 'value', kind: 'number', default: 0 },
    ],
    warp: false,
    body: [],
  })
  await page.locator('#json-editor').fill(JSON.stringify(duplicateProcedureArgumentProject))
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="error"]').waitFor()
  await page.locator('#repair-tools:not([hidden])').waitFor()
  await page.locator('#copy-repair-report').click()
  const duplicateProcedureArgumentReport = JSON.parse(
    await page.evaluate(() => globalThis.__scratchAiBridgeClipboard),
  )
  const duplicateProcedureArgumentIssue = duplicateProcedureArgumentReport.repairReport.issues.find(
    (issue) => issue.code === 'duplicate-procedure-argument',
  )
  if (
    duplicateProcedureArgumentReport.checks.canonicalSchema !== 'passed' ||
    duplicateProcedureArgumentReport.checks.semanticValidation !== 'failed' ||
    duplicateProcedureArgumentReport.checks.scratchVmCompile !== 'skipped' ||
    duplicateProcedureArgumentIssue?.path !== '/sprites/0/procedures/0/parameters/1/name' ||
    duplicateProcedureArgumentIssue?.actual !== 'value' ||
    !duplicateProcedureArgumentIssue.suggestion.includes('唯一')
  ) {
    throw new Error(
      `Duplicate procedure argument report omitted its exact path or repair guidance: ${JSON.stringify({ checks: duplicateProcedureArgumentReport.checks, issue: duplicateProcedureArgumentIssue })}`,
    )
  }
  await page.locator('#copy-repair-prompt').click()
  const duplicateProcedureArgumentPrompt = await page.evaluate(() => globalThis.__scratchAiBridgeClipboard)
  if (
    typeof duplicateProcedureArgumentPrompt !== 'string' ||
    !duplicateProcedureArgumentPrompt.includes('duplicate-procedure-argument') ||
    !duplicateProcedureArgumentPrompt.includes(duplicateProcedureArgumentIssue.path)
  ) {
    throw new Error('Duplicate procedure argument prompt omitted its issue code or path')
  }
  const correctedDuplicateProcedureArgumentProject = structuredClone(duplicateProcedureArgumentProject)
  correctedDuplicateProcedureArgumentProject.sprites[0].procedures[0].parameters[1].name = 'amount'
  await page.locator('#json-editor').fill(JSON.stringify(correctedDuplicateProcedureArgumentProject))
  const duplicateProcedureArgumentDownloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor()
  const duplicateProcedureArgumentDownload = await duplicateProcedureArgumentDownloadPromise
  const duplicateProcedureArgumentPath = await duplicateProcedureArgumentDownload.path()
  if (!duplicateProcedureArgumentPath)
    throw new Error('Corrected duplicate procedure argument did not produce an SB3')
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'duplicate-procedure-argument-repair.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(duplicateProcedureArgumentPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const duplicateProcedureArgumentCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  const reimportedParameterNames = duplicateProcedureArgumentCanonical.sprites[0].procedures
    .find((procedure) => procedure.name === 'Duplicate parameter repair')
    ?.parameters.map(({ name }) => name)
  if (JSON.stringify(reimportedParameterNames) !== JSON.stringify(['value', 'amount'])) {
    throw new Error('Corrected distinct procedure parameter names did not survive SB3 re-import')
  }
  await page.locator('#generate-tab').click()

  await page.locator('#json-editor').fill(JSON.stringify(correctedCanonical, null, 2))
  await page.locator('#validate').click()
  await page
    .locator(
      '#generate-status[data-kind="neutral"], #generate-status[data-kind="ok"], #generate-status[data-kind="error"]',
    )
    .waitFor()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) === 'error') {
    throw new Error(
      `Corrected response did not pass validation: ${await page.locator('#generate-status').textContent()}`,
    )
  }
  const repairLoopDownloadPromise = page.waitForEvent('download')
  await page.locator('#compile').click()
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) !== 'ok') {
    throw new Error(`Corrected response did not compile: ${await page.locator('#generate-status').textContent()}`)
  }
  const repairLoopDownload = await repairLoopDownloadPromise
  const repairLoopPath = await repairLoopDownload.path()
  if (!repairLoopPath) throw new Error('Corrected AI response did not produce a downloadable SB3')
  const repairLoopArchive = await JSZip.loadAsync(await readFile(repairLoopPath))
  const repairLoopProject = JSON.parse(await repairLoopArchive.file('project.json').async('string'))
  if (!repairLoopProject.targets.some((target) => target.name === repairTarget.name)) {
    throw new Error('Compiled correction-loop SB3 lost the repaired sprite')
  }
  await page.locator('#analyze-tab').click()
  await page.locator('#sb3-file').setInputFiles({
    name: 'ai-repair-loop.sb3',
    mimeType: 'application/zip',
    buffer: await readFile(repairLoopPath),
  })
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const repairLoopCanonical = JSON.parse(await page.locator('#canonical-output').textContent())
  if (!repairLoopCanonical.sprites.some((sprite) => sprite.name === repairTarget.name)) {
    throw new Error('Re-imported corrected response lost its sprite during analysis')
  }
  await page.locator('#generate-tab').click()

  await page.locator('#load-sample').click()
  const previewProject = JSON.parse(await page.locator('#json-editor').inputValue())
  previewProject.extensions = ['microbit']
  previewProject.stage.variables.push({ name: 'cloud score', value: 0, cloud: true })
  const previewPlayer = previewProject.sprites.find((sprite) => sprite.name === 'Player')
  if (!previewPlayer?.costumes[0]?.data)
    throw new Error('Platformer sample has no Player costume for stage-preview coverage')
  const rightArrowScript = previewPlayer.scripts.find(
    (script) =>
      script.blocks[0]?.opcode === 'event_whenkeypressed' && script.blocks[0].fields?.KEY_OPTION === 'right arrow',
  )
  if (!rightArrowScript) throw new Error('Platformer sample has no right-arrow input script for preview coverage')
  rightArrowScript.blocks.splice(1, 0, {
    opcode: 'looks_say',
    inputs: { MESSAGE: { type: 'literal', value: 'Right arrow received' } },
  })
  previewPlayer.costumes.push({
    ...previewPlayer.costumes[0],
    name: 'player-preview-alternate',
    data: `${previewPlayer.costumes[0].data.replace('#4c97ff', '#dc4c4c').replace('#2457a6', '#792d2d')}`,
  })
  previewPlayer.currentCostume = 1
  await page.locator('#json-editor').fill(JSON.stringify(previewProject))
  await page.locator('#validate').click()
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  const platformValidated = (await page.locator('#generate-status').textContent())?.trim()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) === 'error') {
    throw new Error(`Platformer sample validation failed: ${platformValidated}`)
  }

  const downloadPromise = page.waitForEvent('download').catch((error) => error)
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()

  const generated = (await page.locator('#generate-status').textContent())?.trim()
  const generateKind = await page.locator('#generate-status').getAttribute('data-kind')
  if (generateKind !== 'ok') {
    const repairSummary = (await page.locator('#repair-summary').textContent())?.trim()
    const repairExplanation = (await page.locator('#repair-explanation').textContent())?.trim()
    const reportDownloadPromise = page.waitForEvent('download')
    await page.locator('#download-repair-report').click()
    const reportDownload = await reportDownloadPromise
    const reportPath = await reportDownload.path()
    const report = reportPath ? JSON.parse(await readFile(reportPath, 'utf8')) : null
    throw new Error(
      [`Generation failed: ${generated}`, repairSummary, repairExplanation, JSON.stringify(report), ...failures].join(
        '\n',
      ),
    )
  }
  const studentResultMessage = await page.locator('#student-result-message').textContent()
  if (!studentResultMessage?.includes('目前 Bridge 預覽不會同步至 Scratch 雲端')) {
    throw new Error('Student build result did not explain offline cloud-variable behavior')
  }

  const download = await downloadPromise
  if (download instanceof Error) throw download

  const downloadPath = await download.path()
  if (!downloadPath) throw new Error(`${browserName} did not expose the generated SB3 path`)
  const validationReportDownloadPromise = page.waitForEvent('download')
  await page.locator('#download-student-validation-report').click()
  const validationReportDownload = await validationReportDownloadPromise
  const validationReportPath = await validationReportDownload.path()
  if (!validationReportPath) throw new Error(`${browserName} did not expose the generated validation report`)
  const validationReport = JSON.parse(await readFile(validationReportPath, 'utf8'))
  if (
    validationReport.format !== 'scratch-ai-bridge/validation-report' ||
    validationReport.version !== 2 ||
    !/^[0-9a-f]{64}$/.test(validationReport.sourceResponseSha256) ||
    !/^[0-9a-f]{64}$/.test(validationReport.canonicalProjectSha256) ||
    Object.values(validationReport.checks).some((status) => status !== 'passed')
  ) {
    throw new Error('Student generated output did not provide a content-addressed passing validation report')
  }
  const downloadedArchive = await JSZip.loadAsync(await readFile(downloadPath))
  const downloadedProject = JSON.parse(await downloadedArchive.file('project.json').async('string'))
  const downloadedStage = downloadedProject.targets.find((target) => target.isStage)
  const downloadedCloudVariable = downloadedStage
    ? Object.values(downloadedStage.variables).find((variable) => variable[0] === 'cloud score')
    : undefined
  if (!downloadedCloudVariable || downloadedCloudVariable[2] !== true) {
    throw new Error('Student build did not preserve its cloud-variable declaration')
  }
  const downloadedPlayer = downloadedProject.targets.find((target) => target.name === 'Player')
  if (downloadedPlayer?.currentCostume !== 1 || downloadedPlayer.costumes.length !== 2) {
    throw new Error('Downloaded multi-costume preview project did not preserve the selected costume')
  }
  const stageCostume = downloadedProject.targets.find((target) => target.isStage)?.costumes[0]
  const stageArtwork = stageCostume ? await downloadedArchive.file(stageCostume.md5ext)?.async('string') : undefined
  if (!stageArtwork?.includes('data-sab-preset="platform-day"')) {
    throw new Error('Generated project did not embed the automatic visible backdrop')
  }
  const officialArchive = await JSZip.loadAsync(await readFile(officialSvgFixturePath))
  const officialProject = JSON.parse(await officialArchive.file('project.json').async('string'))
  const officialSprite = officialProject.targets.find((target) => !target.isStage)
  const officialCostume = officialSprite?.costumes[officialSprite.currentCostume ?? 0]
  const officialArtwork = officialCostume
    ? await officialArchive.file(officialCostume.md5ext)?.async('string')
    : undefined
  if (!officialArtwork) throw new Error('Official SVG fixture did not contain its Stage artwork')
  strictCspSvgPage = await browser.newPage()
  await strictCspSvgPage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
  const strictCspPolicy = await strictCspSvgPage
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  if (
    !strictCspPolicy?.includes("script-src 'self'") ||
    strictCspPolicy.includes("script-src 'self' 'unsafe-inline'") ||
    !strictCspPolicy.includes("style-src-attr 'self'")
  ) {
    throw new Error(`Strict-CSP renderer page has an unexpected style policy: ${strictCspPolicy}`)
  }
  await strictCspSvgPage.addScriptTag({ url: `http://127.0.0.1:${address.port}${sitePrefix}scratch-svg-renderer.js` })
  const strictCspRenderer = await strictCspSvgPage.evaluate(
    async ({ generatedSvg, importedSvg }) => {
      const render = async (svg) => {
        const renderer = new globalThis.ScratchSVGRenderer.SVGRenderer()
        await new Promise((resolve, reject) => {
          renderer.loadSVG(svg, false, resolve).catch(reject)
        })
        renderer.draw()
        const pixels = renderer.canvas
          .getContext('2d')
          ?.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height)
        const visiblePixels = pixels?.data.filter((channel, index) => index % 4 === 3 && channel > 0).length ?? 0
        if (!renderer.canvas.width || !renderer.canvas.height || visiblePixels === 0) {
          throw new Error('Scratch SVG renderer produced a blank canvas under the application CSP')
        }
        return { width: renderer.canvas.width, height: renderer.canvas.height, visiblePixels }
      }
      return {
        generated: await render(generatedSvg),
        imported: await render(importedSvg),
      }
    },
    { generatedSvg: stageArtwork, importedSvg: officialArtwork },
  )
  svgTestPage = await browser.newPage({ bypassCSP: true })
  await svgTestPage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
  await svgTestPage.addScriptTag({
    url: `http://127.0.0.1:${address.port}${sitePrefix}assets/scratch-svg-renderer.js`,
  })
  const rendererResults = await svgTestPage.evaluate(
    async ({ generatedSvg, importedSvg }) => {
      const render = async (svg) => {
        const renderer = new globalThis.ScratchSVGRenderer.SVGRenderer()
        await new Promise((resolve, reject) => {
          renderer.loadSVG(svg, false, resolve).catch(reject)
        })
        if (!renderer.loaded) throw new Error('Official Scratch SVG renderer did not finish loading')
        renderer.draw()
        const [width, height] = renderer.size
        const pixels = renderer.canvas
          .getContext('2d')
          ?.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height)
        if (!width || !height || !renderer.canvas.width || !renderer.canvas.height) {
          throw new Error('Official Scratch SVG renderer produced an empty canvas')
        }
        if (!pixels?.data.some((channel, index) => index % 4 === 3 && channel > 0)) {
          throw new Error('Official Scratch SVG renderer produced a blank canvas')
        }
        return { width, height }
      }
      return {
        generated: await render(generatedSvg),
        imported: await render(importedSvg),
        normalizedGenerated: await (async () => {
          const svg = await globalThis.ScratchSVGRenderer.loadSvgString(generatedSvg)
          return {
            width: svg.getAttribute('width'),
            height: svg.getAttribute('height'),
            viewBox: svg.getAttribute('viewBox'),
          }
        })(),
        normalizedImported: await (async () => {
          const svg = await globalThis.ScratchSVGRenderer.loadSvgString(importedSvg)
          return {
            width: svg.getAttribute('width'),
            height: svg.getAttribute('height'),
            viewBox: svg.getAttribute('viewBox'),
          }
        })(),
        sanitizer: await (async () => {
          const sanitizedText = globalThis.ScratchSVGRenderer.sanitizeSvg.sanitizeSvgText(
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><script>window.__scratchSvgSmoke = true</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject><image href="https://example.invalid/track.png"/><rect width="8" height="8" onclick="window.__scratchSvgSmoke = true"/></svg>',
          )
          const svg = new globalThis.DOMParser().parseFromString(sanitizedText, 'image/svg+xml').documentElement
          let malformedRejected = false
          try {
            await globalThis.ScratchSVGRenderer.loadSvgString('<not-svg/>')
          } catch {
            malformedRejected = true
          }
          const image = svg.querySelector('image')
          const rect = svg.querySelector('rect')
          const result = {
            scripts: svg.querySelectorAll('script').length,
            foreignObjects: svg.querySelectorAll('foreignObject').length,
            externalImageHref: image?.getAttribute('href') ?? image?.getAttribute('xlink:href'),
            eventHandler: rect?.getAttribute('onclick'),
            malformedRejected,
          }
          if (
            result.scripts !== 0 ||
            result.foreignObjects !== 0 ||
            result.externalImageHref !== null ||
            result.eventHandler !== null ||
            !result.malformedRejected
          ) {
            throw new Error(`Official loadSvgString sanitizer contract failed: ${JSON.stringify(result)}`)
          }
          return result
        })(),
      }
    },
    { generatedSvg: stageArtwork, importedSvg: officialArtwork },
  )
  const studentVisualResult = (await page.locator('#student-result-message').textContent())?.trim()
  if (!studentVisualResult?.includes('已自動補上 1 個背景')) {
    throw new Error(`Student result did not explain the automatic artwork: ${studentVisualResult}`)
  }
  await page.waitForFunction(() => {
    const preview = document.querySelector('#student-preview')
    const background = preview?.querySelector('.student-preview-background')
    return (
      !preview?.hidden && background instanceof HTMLImageElement && background.complete && background.naturalWidth > 0
    )
  })
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#student-preview .student-preview-canvas')
    return canvas instanceof HTMLCanvasElement && !canvas.hidden && canvas.width === 480 && canvas.height === 360
  })
  const stagePreviewPixels = await page.locator('#student-preview .student-preview-canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) throw new Error('Scratch VM stage preview did not create a WebGL context')
    return gl.getParameter(gl.VIEWPORT).join('x')
  })
  const stagePreviewCanvas = page.locator('#student-preview .student-preview-canvas')
  const stagePreviewRegion = await page.locator('#student-preview').boundingBox()
  if (!stagePreviewRegion) throw new Error('Scratch VM stage preview did not have a visible screenshot region')
  const captureStagePreview = () => page.screenshot({ clip: stagePreviewRegion, animations: 'disabled' })
  const visibleStage = await captureStagePreview()
  await stagePreviewCanvas.evaluate((canvas) => {
    canvas.hidden = true
  })
  const stageWithoutRenderer = await captureStagePreview()
  await stagePreviewCanvas.evaluate((canvas) => {
    canvas.hidden = false
  })
  if (
    createHash('sha256').update(visibleStage).digest('hex') ===
    createHash('sha256').update(stageWithoutRenderer).digest('hex')
  ) {
    throw new Error('Scratch VM stage preview canvas did not change the visible stage image')
  }
  if ((await page.locator('#student-preview .student-preview-tile').count()) < 1) {
    throw new Error('Strict-CSP project preview did not include any visible Scratch sprites')
  }
  await clickStudentPreviewStart(page)
  const animatedFrame = page.locator('#student-preview iframe.student-preview-animation')
  await animatedFrame.waitFor({ state: 'attached' })
  if ((await animatedFrame.getAttribute('sandbox')) !== 'allow-scripts') {
    throw new Error('Animated Scratch preview iframe does not use the scripts-only sandbox')
  }
  try {
    await page.waitForFunction(
      () => {
        const status = document.querySelector('.student-preview-stage-status')?.textContent ?? ''
        return status.includes('動畫執行中') || status.includes('動畫預覽載入失敗')
      },
      null,
      { timeout: 10_000 },
    )
  } catch (error) {
    const status = await page.locator('.student-preview-stage-status').textContent()
    throw new Error(`Animation iframe startup timed out: ${status}`, { cause: error })
  }
  const animatedStatus = await page.locator('.student-preview-stage-status').textContent()
  if (!animatedStatus?.includes('動畫執行中')) {
    throw new Error(`Isolated animation preview failed to start: ${animatedStatus}`)
  }
  const animatedCanvas = page.frameLocator('#student-preview iframe.student-preview-animation').locator('canvas')
  const beforeAnimationInput = await animatedCanvas.screenshot()
  await animatedCanvas.evaluate((canvas) => {
    const view = canvas.ownerDocument.defaultView
    if (!view) throw new Error('Animated preview canvas has no window')
    view.__scratchSmokeKeyEvents = []
    canvas.ownerDocument.addEventListener('keydown', (event) => view.__scratchSmokeKeyEvents.push(event.key), true)
  })
  await animatedCanvas.click()
  await animatedCanvas.evaluate((canvas) => canvas.focus())
  const previewCanvasFocused = await animatedCanvas.evaluate(
    (canvas) => canvas.ownerDocument.activeElement === canvas,
  )
  if (!previewCanvasFocused) throw new Error(`${browserName} animation stage did not retain keyboard focus`)
  // The sample moves its player and shows an unmistakable speech bubble for the
  // right-arrow event; repeat the real key press for cross-engine timing.
  for (let press = 0; press < 3; press += 1) {
    await animatedCanvas.press('ArrowRight')
    await page.waitForTimeout(25)
  }
  const beforeAnimationHash = createHash('sha256').update(beforeAnimationInput).digest('hex')
  let afterAnimationHash = beforeAnimationHash
  for (let attempt = 0; attempt < 30 && afterAnimationHash === beforeAnimationHash; attempt++) {
    await page.waitForTimeout(100)
    const afterAnimationInput = await animatedCanvas.screenshot()
    afterAnimationHash = createHash('sha256').update(afterAnimationInput).digest('hex')
  }
  if (afterAnimationHash === beforeAnimationHash) {
    await writeFile(
      resolve(process.cwd(), 'test-results', `browser-${browserName}-animation-before.png`),
      beforeAnimationInput,
    )
    await writeFile(
      resolve(process.cwd(), 'test-results', `browser-${browserName}-animation-after.png`),
      await animatedCanvas.screenshot(),
    )
    const keyEvents = await animatedCanvas.evaluate((canvas) => {
      const view = canvas.ownerDocument.defaultView
      return {
        activeElementIsCanvas: canvas.ownerDocument.activeElement === canvas,
        keys: view?.__scratchSmokeKeyEvents ?? [],
      }
    })
    throw new Error(
      `${browserName} animated stage preview did not visibly respond to ArrowRight; input=${JSON.stringify(keyEvents)}`,
    )
  }
  const hardwarePanel = page.locator('#student-preview .student-preview-hardware')
  await hardwarePanel.waitFor({ state: 'visible' })
  const microbitRow = page.locator('.student-preview-hardware-row').filter({ hasText: 'micro:bit' })
  await microbitRow.getByRole('button', { name: '搜尋裝置' }).click()
  try {
    await microbitRow.getByText('找到裝置，選擇要連線的項目：').waitFor({ timeout: 5_000 })
  } catch (error) {
    throw new Error(
      `Scratch Link mock discovery failed; UI=${await microbitRow.textContent()}, requests=${scratchLinkMethods.join(',')}`,
      { cause: error },
    )
  }
  await microbitRow.getByRole('button', { name: '連線：Mock micro:bit' }).click()
  await microbitRow.getByText('裝置已連線。').waitFor()
  await microbitRow.getByRole('button', { name: '中斷連線' }).click()
  await microbitRow.getByText('裝置已中斷連線。').waitFor()
  await microbitRow.getByRole('button', { name: '搜尋裝置' }).click()
  await microbitRow.getByText('找到裝置，選擇要連線的項目：').waitFor()
  await page.waitForFunction(
    () => document.querySelectorAll('.student-preview-hardware-devices button').length === 20,
  )
  if ((await microbitRow.locator('img').count()) !== 0) {
    throw new Error(`${browserName} hardware device names were interpreted as markup`)
  }
  await microbitRow.getByRole('button', { name: '連線：Mock micro:bit' }).click()
  await microbitRow.getByText('裝置已連線。').waitFor()
  if (!scratchLinkMethods.includes('discover') || !scratchLinkMethods.includes('connect')) {
    throw new Error(`${browserName} hardware preview did not issue Scratch Link discover/connect requests`)
  }
  const consentChild = page.frames().find((frame) => frame.url().includes('/preview.html?token='))
  if (!consentChild) throw new Error(`${browserName} could not locate the active preview iframe for consent UI smoke`)
  const probeConsent = async (service, decision) => {
    const requestId = `consent-ui-${service}-${decision}`
    await consentChild.evaluate(
      ({ requestId: id, service: requestedService }) => {
        window.__consentUiResponses = window.__consentUiResponses ?? []
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'tts-consent-response') window.__consentUiResponses.push(event.data)
        })
        const token = new URLSearchParams(window.location.search).get('token')
        window.parent.postMessage(
          {
            type: 'extension-egress-consent-request',
            token,
            requestId: id,
            service: requestedService,
            text: 'parent UI consent smoke text',
            ...(requestedService === 'translation' ? { language: 'fr' } : {}),
          },
          '*',
        )
      },
      { requestId, service },
    )
    const dialog = page.locator('dialog')
    await dialog.waitFor({ state: 'visible' })
    const expectedServiceName = service === 'speech' ? 'Scratch 文字轉語音' : 'Scratch 翻譯文字'
    if (!(await dialog.getByText(expectedServiceName).isVisible())) {
      throw new Error(`${browserName} ${service} consent dialog did not identify the service`)
    }
    const responseButton = dialog.getByRole('button', { name: decision === 'allow' ? '只允許這次' : '拒絕' })
    await responseButton.click()
    await consentChild.waitForFunction(
      (id) => window.__consentUiResponses?.some((response) => response.requestId === id),
      requestId,
    )
    const response = await consentChild.evaluate(
      (id) => window.__consentUiResponses.find((candidate) => candidate.requestId === id),
      requestId,
    )
    if (response?.allowed !== (decision === 'allow')) {
      throw new Error(`${browserName} ${service} consent UI returned the wrong decision`)
    }
  }
  await probeConsent('speech', 'deny')
  await probeConsent('translation', 'allow')
  const scratchLinkCloseCountBeforeStop = scratchLinkCloseCount
  await page.locator('#student-preview .student-preview-actions button').filter({ hasText: '停止預覽' }).click()
  await animatedFrame.waitFor({ state: 'detached' })
  await page.locator('#student-preview .student-preview-canvas:not([hidden])').waitFor()
  if (scratchLinkCloseCount <= scratchLinkCloseCountBeforeStop) {
    throw new Error(`${browserName} stopping the preview did not close its Scratch Link hardware channel`)
  }
  const animatedPreview =
    'isolated iframe: keyboard input changes stage; mocked Scratch Link discovery/connect/disconnect works; manual stop restores static preview'

  const officialStageZip = await JSZip.loadAsync(await readFile(officialStageFixturePath))
  const officialStageProject = JSON.parse(await officialStageZip.file('project.json').async('string'))
  const officialFixtureStage = officialStageProject.targets.find((target) => target.isStage)
  const officialSelectedSprite = officialStageProject.targets.find((target) => target.name === 'Heart')
  if (
    officialFixtureStage?.costumes?.length !== 2 ||
    officialFixtureStage.currentCostume !== 1 ||
    officialSelectedSprite?.costumes?.length !== 2 ||
    officialSelectedSprite.currentCostume !== 1
  ) {
    throw new Error('Official monitors.sb3 fixture no longer covers selected non-default Stage and sprite costumes')
  }

  const draggableArchive = await JSZip.loadAsync(await readFile(officialDraggableFixturePath))
  const draggableProject = JSON.parse(await draggableArchive.file('project.json').async('string'))
  const draggableSprite = draggableProject.targets.find((target) => target.name === 'Sprite1')
  if (!draggableSprite?.draggable || draggableSprite.x !== 1.906493 || draggableSprite.y !== 16.3136646) {
    throw new Error('Official draggable.sb3 fixture no longer provides the expected draggable Sprite1')
  }
  await page.locator('button[data-tab="analyze"]').click()
  await page.locator('#sb3-file').setInputFiles(officialDraggableFixturePath)
  await page.waitForFunction(() => {
    const status = document.querySelector('#file-status')
    const output = document.querySelector('#canonical-output')?.textContent
    if (status?.getAttribute('data-kind') !== 'ok' || !output) return false
    try {
      return JSON.parse(output).name === 'draggable'
    } catch {
      return false
    }
  })
  if ((await page.locator('#file-status').getAttribute('data-kind')) !== 'ok') {
    throw new Error(`Official draggable fixture import failed: ${await page.locator('#file-status').textContent()}`)
  }
  const draggableCanonical = JSON.parse((await page.locator('#canonical-output').textContent()) ?? 'null')
  const importedDraggableSprite = draggableCanonical?.sprites?.find((sprite) => sprite.name === 'Sprite1')
  if (importedDraggableSprite?.draggable !== true) {
    throw new Error('Official draggable fixture lost its draggable flag during decompilation')
  }
  await page.locator('#preview-imported-project').click()
  await page
    .locator('#student-preview .student-preview-tile figcaption')
    .filter({ hasText: /^Sprite1$/ })
    .waitFor()
  await clickStudentPreviewStart(page)
  const draggableFrame = page.locator('#student-preview iframe.student-preview-animation')
  await draggableFrame.waitFor({ state: 'attached' })
  await page.waitForFunction(
    () => document.querySelector('.student-preview-stage-status')?.textContent?.includes('動畫執行中'),
    null,
    { timeout: 10_000 },
  )
  const draggableCanvas = page.frameLocator('#student-preview iframe.student-preview-animation').locator('#stage')
  const draggableCanvasBox = await draggableCanvas.boundingBox()
  if (!draggableCanvasBox || draggableCanvasBox.width <= 0 || draggableCanvasBox.height <= 0) {
    throw new Error(`${browserName} official draggable fixture has no visible animation canvas`)
  }
  const draggableBefore = await draggableCanvas.screenshot()
  await draggableCanvas.evaluate(
    (stage, { spriteX, spriteY }) => {
      const rect = stage.getBoundingClientRect()
      const PointerEventConstructor = stage.ownerDocument.defaultView?.PointerEvent
      if (!PointerEventConstructor) throw new Error('Pointer Events are unavailable in the preview browser')
      const startX = rect.left + rect.width * (0.5 + spriteX / 480)
      const startY = rect.top + rect.height * (0.5 - spriteY / 360)
      const dispatchPointer = (type, clientX, clientY, buttons) =>
        stage.dispatchEvent(
          new PointerEventConstructor(type, {
            bubbles: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            clientX,
            clientY,
            button: 0,
            buttons,
          }),
        )
      dispatchPointer('pointerdown', startX, startY, 1)
      for (let step = 1; step <= 6; step += 1) {
        dispatchPointer(
          'pointermove',
          startX + (rect.width * 50 * step) / (480 * 6),
          startY - (rect.height * 40 * step) / (360 * 6),
          1,
        )
      }
      dispatchPointer('pointerup', startX + (rect.width * 50) / 480, startY - (rect.height * 40) / 360, 0)
    },
    { spriteX: draggableSprite.x, spriteY: draggableSprite.y },
  )
  await page.waitForTimeout(200)
  const draggableAfter = await draggableCanvas.screenshot()
  const officialDraggablePreview = {
    fixture: 'draggable.sb3',
    targetName: 'Sprite1',
    importedDraggable: importedDraggableSprite.draggable,
    dragDeltaStageUnits: { x: 50, y: 40 },
    visibleCanvasChangedAfterDrag:
      createHash('sha256').update(draggableBefore).digest('hex') !==
      createHash('sha256').update(draggableAfter).digest('hex'),
  }
  if (!officialDraggablePreview.visibleCanvasChangedAfterDrag) {
    throw new Error(`${browserName} dragging the official draggable sprite did not change the rendered stage`)
  }
  await page.locator('#student-preview .student-preview-actions button').filter({ hasText: '停止預覽' }).click()
  await draggableFrame.waitFor({ state: 'detached' })

  const edgeTriggeredArchive = await JSZip.loadAsync(await readFile(officialEdgeTriggeredFixturePath))
  const edgeTriggeredProject = JSON.parse(await edgeTriggeredArchive.file('project.json').async('string'))
  const edgeTriggeredSprite = edgeTriggeredProject.targets.find((target) => target.name === 'Sprite1')
  const edgeTriggeredBlocks = Object.values(edgeTriggeredSprite?.blocks ?? {})
  const timerHat = edgeTriggeredBlocks.find(
    (block) => block.opcode === 'event_whengreaterthan' && block.fields?.WHENGREATERTHANMENU?.[0] === 'TIMER',
  )
  const timerMove = timerHat ? edgeTriggeredSprite.blocks[timerHat.next] : null
  if (
    edgeTriggeredSprite?.x !== 50 ||
    edgeTriggeredSprite.y !== 0 ||
    !timerHat ||
    timerHat.inputs?.VALUE?.[1]?.[1] !== '-1' ||
    timerMove?.opcode !== 'motion_movesteps' ||
    timerMove.inputs?.STEPS?.[1]?.[1] !== '10'
  ) {
    throw new Error('Official edge-triggered-hat.sb3 fixture no longer has its timer-to-motion behavior')
  }
  await page.locator('button[data-tab="analyze"]').click()
  await page.locator('#sb3-file').setInputFiles(officialEdgeTriggeredFixturePath)
  await page.waitForFunction(() => {
    const status = document.querySelector('#file-status')
    const output = document.querySelector('#canonical-output')?.textContent
    if (status?.getAttribute('data-kind') !== 'ok' || !output) return false
    try {
      const project = JSON.parse(output)
      return project.sprites?.some((sprite) => sprite.name === 'Sprite1' && sprite.x === 50)
    } catch {
      return false
    }
  })
  await page.locator('#preview-imported-project').click()
  await page.locator('#student-preview .student-preview-canvas').waitFor({ state: 'visible' })
  const edgeTriggeredStatic = await page.locator('#student-preview .student-preview-canvas').screenshot()
  await clickStudentPreviewStart(page)
  const edgeTriggeredFrame = page.locator('#student-preview iframe.student-preview-animation')
  await edgeTriggeredFrame.waitFor({ state: 'attached' })
  await page.waitForFunction(
    () => document.querySelector('.student-preview-stage-status')?.textContent?.includes('動畫執行中'),
    null,
    { timeout: 10_000 },
  )
  const edgeTriggeredCanvas = page.frameLocator('#student-preview iframe.student-preview-animation').locator('#stage')
  await page.waitForTimeout(300)
  const edgeTriggeredAnimated = await edgeTriggeredCanvas.screenshot()
  const edgeTriggeredCanvasDimensions = {
    before: { width: edgeTriggeredStatic.readUInt32BE(16), height: edgeTriggeredStatic.readUInt32BE(20) },
    after: { width: edgeTriggeredAnimated.readUInt32BE(16), height: edgeTriggeredAnimated.readUInt32BE(20) },
  }
  if (
    edgeTriggeredCanvasDimensions.before.width <= 0 ||
    edgeTriggeredCanvasDimensions.before.height <= 0 ||
    edgeTriggeredCanvasDimensions.before.width !== edgeTriggeredCanvasDimensions.after.width ||
    edgeTriggeredCanvasDimensions.before.height !== edgeTriggeredCanvasDimensions.after.height
  ) {
    throw new Error(`${browserName} official event-hat preview screenshots have mismatched canvas dimensions`)
  }
  const officialEventHatPreview = {
    fixture: 'edge-triggered-hat.sb3',
    targetName: 'Sprite1',
    timerHatOpcode: timerHat.opcode,
    timerThreshold: Number(timerHat.inputs.VALUE[1][1]),
    movementOpcode: timerMove.opcode,
    movementSteps: Number(timerMove.inputs.STEPS[1][1]),
    canvasDimensions: edgeTriggeredCanvasDimensions,
    visibleCanvasChangedAfterRuntime:
      createHash('sha256').update(edgeTriggeredStatic).digest('hex') !==
      createHash('sha256').update(edgeTriggeredAnimated).digest('hex'),
  }
  if (!officialEventHatPreview.visibleCanvasChangedAfterRuntime) {
    throw new Error(`${browserName} official edge-triggered fixture did not change the stage after starting runtime`)
  }
  await page.locator('#student-preview .student-preview-actions button').filter({ hasText: '停止預覽' }).click()
  await edgeTriggeredFrame.waitFor({ state: 'detached' })

  const archiveWithProjectJson = async (sourcePath, project) => {
    const zip = await JSZip.loadAsync(await readFile(sourcePath))
    zip.file('project.json', JSON.stringify(project))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }
  const createOverlappingAudioFixture = async () => {
    const zip = await JSZip.loadAsync(await readFile(officialSvgFixturePath))
    const project = JSON.parse(await zip.file('project.json').async('string'))
    const firstSprite = project.targets.find((target) => !target.isStage)
    const soundName = firstSprite.sounds?.[0]?.name
    if (!soundName) throw new Error('Official default fixture has no sound for overlapping-audio smoke')
    const secondSprite = structuredClone(firstSprite)
    secondSprite.name = 'AudioOverlapSprite'
    const clearSprite = structuredClone(firstSprite)
    clearSprite.name = 'AudioClearSprite'
    const changeEffectSprite = structuredClone(firstSprite)
    changeEffectSprite.name = 'AudioChangeEffectSprite'
    const volumeSprite = structuredClone(firstSprite)
    volumeSprite.name = 'AudioVolumeSprite'
    const stopAllSprite = structuredClone(firstSprite)
    stopAllSprite.name = 'AudioStopAllSprite'
    project.targets.push(secondSprite, clearSprite, changeEffectSprite, volumeSprite, stopAllSprite)
    for (const [index, sprite] of [firstSprite, secondSprite, clearSprite].entries()) {
      sprite.blocks = {}
      const suffix = String(index)
      const hatId = `audio-overlap-hat-${suffix}`
      const effectId = `audio-overlap-effect-${suffix}`
      const effectValueId = `audio-overlap-effect-value-${suffix}`
      const changeId = `audio-overlap-change-${suffix}`
      const changeValueId = `audio-overlap-change-value-${suffix}`
      const firstPanPlayId = `audio-overlap-pan-play-${suffix}`
      const firstPanMenuId = `audio-overlap-pan-menu-${suffix}`
      const panWaitId = `audio-overlap-pan-wait-${suffix}`
      const panWaitValueId = `audio-overlap-pan-wait-value-${suffix}`
      const clearId = `audio-overlap-clear-${suffix}`
      const playId = `audio-overlap-play-${suffix}`
      const menuId = `audio-overlap-menu-${suffix}`
      sprite.blocks[hatId] = {
        opcode: 'event_whenflagclicked',
        next: effectId,
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 20,
        y: 20,
      }
      sprite.blocks[effectId] = {
        opcode: 'sound_seteffectto',
        next: index === 2 ? clearId : index === 1 ? firstPanPlayId : playId,
        parent: hatId,
        inputs: { VALUE: [1, effectValueId] },
        fields: { EFFECT: [index === 1 ? 'PAN' : 'PITCH', null] },
        shadow: false,
        topLevel: false,
      }
      sprite.blocks[effectValueId] = {
        opcode: 'math_number',
        next: null,
        parent: effectId,
        inputs: {},
        fields: { NUM: [index === 1 ? '-100' : '120', null] },
        shadow: true,
        topLevel: false,
      }
      if (index === 1) {
        sprite.blocks[firstPanPlayId] = {
          opcode: 'sound_play',
          next: panWaitId,
          parent: effectId,
          inputs: { SOUND_MENU: [1, firstPanMenuId] },
          fields: {},
          shadow: false,
          topLevel: false,
        }
        sprite.blocks[firstPanMenuId] = {
          opcode: 'sound_sounds_menu',
          next: null,
          parent: firstPanPlayId,
          inputs: {},
          fields: { SOUND_MENU: [soundName, null] },
          shadow: true,
          topLevel: false,
        }
        sprite.blocks[panWaitId] = {
          opcode: 'control_wait',
          next: changeId,
          parent: firstPanPlayId,
          inputs: { DURATION: [1, panWaitValueId] },
          fields: {},
          shadow: false,
          topLevel: false,
        }
        sprite.blocks[panWaitValueId] = {
          opcode: 'math_number',
          next: null,
          parent: panWaitId,
          inputs: {},
          fields: { NUM: ['0.2', null] },
          shadow: true,
          topLevel: false,
        }
        sprite.blocks[changeId] = {
          opcode: 'sound_changeeffectby',
          next: playId,
          parent: panWaitId,
          inputs: { VALUE: [1, changeValueId] },
          fields: { EFFECT: ['PAN', null] },
          shadow: false,
          topLevel: false,
        }
        sprite.blocks[changeValueId] = {
          opcode: 'math_number',
          next: null,
          parent: changeId,
          inputs: {},
          fields: { NUM: ['200', null] },
          shadow: true,
          topLevel: false,
        }
      }
      if (index === 2) {
        sprite.blocks[clearId] = {
          opcode: 'sound_cleareffects',
          next: playId,
          parent: effectId,
          inputs: {},
          fields: {},
          shadow: false,
          topLevel: false,
        }
      }
      sprite.blocks[playId] = {
        opcode: 'sound_play',
        next: null,
        parent: index === 2 ? clearId : index === 1 ? changeId : effectId,
        inputs: { SOUND_MENU: [1, menuId] },
        fields: {},
        shadow: false,
        topLevel: false,
      }
      sprite.blocks[menuId] = {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: playId,
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      }
    }
    volumeSprite.blocks = {
      'audio-volume-hat': {
        opcode: 'event_whenflagclicked',
        next: 'audio-volume-set',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 20,
        y: 20,
      },
      'audio-volume-set': {
        opcode: 'sound_setvolumeto',
        next: 'audio-volume-first-play',
        parent: 'audio-volume-hat',
        inputs: { VOLUME: [1, 'audio-volume-set-value'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-volume-set-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-volume-set',
        inputs: {},
        fields: { NUM: ['50', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-volume-first-play': {
        opcode: 'sound_play',
        next: 'audio-volume-wait',
        parent: 'audio-volume-set',
        inputs: { SOUND_MENU: [1, 'audio-volume-first-menu'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-volume-first-menu': {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: 'audio-volume-first-play',
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      },
      'audio-volume-wait': {
        opcode: 'control_wait',
        next: 'audio-volume-change',
        parent: 'audio-volume-first-play',
        inputs: { DURATION: [1, 'audio-volume-wait-value'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-volume-wait-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-volume-wait',
        inputs: {},
        fields: { NUM: ['0.5', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-volume-change': {
        opcode: 'sound_changevolumeby',
        next: 'audio-volume-second-play',
        parent: 'audio-volume-wait',
        inputs: { VOLUME: [1, 'audio-volume-change-value'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-volume-change-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-volume-change',
        inputs: {},
        fields: { NUM: ['-25', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-volume-second-play': {
        opcode: 'sound_play',
        next: null,
        parent: 'audio-volume-change',
        inputs: { SOUND_MENU: [1, 'audio-volume-second-menu'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-volume-second-menu': {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: 'audio-volume-second-play',
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      },
    }
    changeEffectSprite.blocks = {
      'audio-change-hat': {
        opcode: 'event_whenflagclicked',
        next: 'audio-change-set',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 20,
        y: 20,
      },
      'audio-change-set': {
        opcode: 'sound_seteffectto',
        next: 'audio-change-by',
        parent: 'audio-change-hat',
        inputs: { VALUE: [1, 'audio-change-set-value'] },
        fields: { EFFECT: ['PITCH', null] },
        shadow: false,
        topLevel: false,
      },
      'audio-change-set-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-change-set',
        inputs: {},
        fields: { NUM: ['120', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-change-by': {
        opcode: 'sound_changeeffectby',
        next: 'audio-change-play',
        parent: 'audio-change-set',
        inputs: { VALUE: [1, 'audio-change-by-value'] },
        fields: { EFFECT: ['PITCH', null] },
        shadow: false,
        topLevel: false,
      },
      'audio-change-by-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-change-by',
        inputs: {},
        fields: { NUM: ['-30', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-change-play': {
        opcode: 'sound_play',
        next: null,
        parent: 'audio-change-by',
        inputs: { SOUND_MENU: [1, 'audio-change-menu'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-change-menu': {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: 'audio-change-play',
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      },
    }
    stopAllSprite.blocks = {
      'audio-stop-all-hat': {
        opcode: 'event_whenflagclicked',
        next: 'audio-stop-all-play',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 20,
        y: 20,
      },
      'audio-stop-all-play': {
        opcode: 'sound_play',
        next: 'audio-stop-all-wait',
        parent: 'audio-stop-all-hat',
        inputs: { SOUND_MENU: [1, 'audio-stop-all-menu'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-stop-all-menu': {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: 'audio-stop-all-play',
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      },
      'audio-stop-all-wait': {
        opcode: 'control_wait',
        next: 'audio-stop-all-command',
        parent: 'audio-stop-all-play',
        inputs: { DURATION: [1, 'audio-stop-all-wait-value'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-stop-all-wait-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-stop-all-wait',
        inputs: {},
        fields: { NUM: ['0.2', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-stop-all-command': {
        opcode: 'sound_stopallsounds',
        next: null,
        parent: 'audio-stop-all-wait',
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
      },
    }
    zip.file('project.json', JSON.stringify(project))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }
  const createAudioWaitFixture = async () => {
    const zip = await JSZip.loadAsync(await readFile(officialSvgFixturePath))
    const project = JSON.parse(await zip.file('project.json').async('string'))
    const sprite = project.targets.find((target) => !target.isStage)
    const soundName = sprite.sounds?.[0]?.name
    if (!soundName) throw new Error('Official default fixture has no sound for sound_playuntildone smoke')
    sprite.blocks = {
      'audio-wait-hat': {
        opcode: 'event_whenflagclicked',
        next: 'audio-wait-until-done',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 20,
        y: 20,
      },
      'audio-wait-until-done': {
        opcode: 'sound_playuntildone',
        next: 'audio-wait-play-again',
        parent: 'audio-wait-hat',
        inputs: { SOUND_MENU: [1, 'audio-wait-first-menu'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-wait-first-menu': {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: 'audio-wait-until-done',
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      },
      'audio-wait-play-again': {
        opcode: 'sound_play',
        next: null,
        parent: 'audio-wait-until-done',
        inputs: { SOUND_MENU: [1, 'audio-wait-second-menu'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-wait-second-menu': {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: 'audio-wait-play-again',
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      },
    }
    zip.file('project.json', JSON.stringify(project))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }
  const createCombinedAudioEffectsFixture = async () => {
    const zip = await JSZip.loadAsync(await readFile(officialSvgFixturePath))
    const project = JSON.parse(await zip.file('project.json').async('string'))
    const sprite = project.targets.find((target) => !target.isStage)
    const soundName = sprite.sounds?.[0]?.name
    if (!soundName) throw new Error('Official default fixture has no sound for combined-effects smoke')
    sprite.blocks = {
      'audio-combined-hat': {
        opcode: 'event_whenflagclicked',
        next: 'audio-combined-pitch',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 20,
        y: 20,
      },
      'audio-combined-pitch': {
        opcode: 'sound_seteffectto',
        next: 'audio-combined-pan',
        parent: 'audio-combined-hat',
        inputs: { VALUE: [1, 'audio-combined-pitch-value'] },
        fields: { EFFECT: ['PITCH', null] },
        shadow: false,
        topLevel: false,
      },
      'audio-combined-pitch-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-combined-pitch',
        inputs: {},
        fields: { NUM: ['120', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-combined-pan': {
        opcode: 'sound_seteffectto',
        next: 'audio-combined-volume',
        parent: 'audio-combined-pitch',
        inputs: { VALUE: [1, 'audio-combined-pan-value'] },
        fields: { EFFECT: ['PAN', null] },
        shadow: false,
        topLevel: false,
      },
      'audio-combined-volume': {
        opcode: 'sound_setvolumeto',
        next: 'audio-combined-play',
        parent: 'audio-combined-pan',
        inputs: { VOLUME: [1, 'audio-combined-volume-value'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-combined-volume-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-combined-volume',
        inputs: {},
        fields: { NUM: ['40', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-combined-pan-value': {
        opcode: 'math_number',
        next: null,
        parent: 'audio-combined-pan',
        inputs: {},
        fields: { NUM: ['-100', null] },
        shadow: true,
        topLevel: false,
      },
      'audio-combined-play': {
        opcode: 'sound_play',
        next: null,
        parent: 'audio-combined-volume',
        inputs: { SOUND_MENU: [1, 'audio-combined-menu'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      'audio-combined-menu': {
        opcode: 'sound_sounds_menu',
        next: null,
        parent: 'audio-combined-play',
        inputs: {},
        fields: { SOUND_MENU: [soundName, null] },
        shadow: true,
        topLevel: false,
      },
    }
    zip.file('project.json', JSON.stringify(project))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }
  const selectedStageProject = structuredClone(officialStageProject)
  for (const target of selectedStageProject.targets) {
    if (!target.isStage) target.visible = false
  }
  const defaultStageProject = structuredClone(selectedStageProject)
  defaultStageProject.targets.find((target) => target.isStage).currentCostume = 0
  const selectedStageBytes = await archiveWithProjectJson(officialStageFixturePath, selectedStageProject)
  const defaultStageBytes = await archiveWithProjectJson(officialStageFixturePath, defaultStageProject)
  stageFixturePage = await browser.newPage()
  await stageFixturePage.addInitScript(() => {
    window.__officialStageFixtureInputEvents = []
    for (const eventName of ['pointerdown', 'keydown']) {
      document.addEventListener(
        eventName,
        (event) => {
          window.__officialStageFixtureInputEvents.push({
            type: eventName,
            trusted: event.isTrusted,
            target: event.target instanceof HTMLElement ? event.target.id : '',
          })
        },
        true,
      )
    }
    if (!(window.AudioBufferSourceNode instanceof Function)) return
    const originalStart = window.AudioBufferSourceNode.prototype.start
    let activeAudioSources = 0
    window.AudioBufferSourceNode.prototype.start = function (...args) {
      const token = new URLSearchParams(window.location.search).get('token')
      if (token) {
        const context = this.context
        const sendState = () =>
          window.parent.postMessage({ type: 'audio-context-state', state: context.state, token }, '*')
        context.addEventListener('statechange', sendState)
        sendState()
        activeAudioSources += 1
        window.parent.postMessage(
          {
            type: 'audio-source-started',
            token,
            activeAudioSources,
            playbackRate: this.playbackRate?.value ?? 1,
          },
          '*',
        )
        this.addEventListener(
          'ended',
          () => {
            activeAudioSources = Math.max(0, activeAudioSources - 1)
            window.parent.postMessage({ type: 'audio-source-ended', token, activeAudioSources }, '*')
          },
          { once: true },
        )
      }
      return originalStart.apply(this, args)
    }
    const originalStop = window.AudioBufferSourceNode.prototype.stop
    window.AudioBufferSourceNode.prototype.stop = function (...args) {
      const token = new URLSearchParams(window.location.search).get('token')
      if (token) window.parent.postMessage({ type: 'audio-source-stop-called', token }, '*')
      return originalStop.apply(this, args)
    }
    if (window.AudioParam instanceof Function) {
      const originalLinearRampToValueAtTime = window.AudioParam.prototype.linearRampToValueAtTime
      window.AudioParam.prototype.linearRampToValueAtTime = function (value, ...args) {
        const token = new URLSearchParams(window.location.search).get('token')
        if (token) window.parent.postMessage({ type: 'audio-volume-ramp', token, value }, '*')
        return originalLinearRampToValueAtTime.call(this, value, ...args)
      }
      const originalSetTargetAtTime = window.AudioParam.prototype.setTargetAtTime
      window.AudioParam.prototype.setTargetAtTime = function (value, ...args) {
        const token = new URLSearchParams(window.location.search).get('token')
        if (token) window.parent.postMessage({ type: 'audio-gain-target', token, value }, '*')
        return originalSetTargetAtTime.call(this, value, ...args)
      }
    }
    if (window.AudioContext instanceof Function) {
      const originalClose = window.AudioContext.prototype.close
      window.AudioContext.prototype.close = function (...args) {
        const token = new URLSearchParams(window.location.search).get('token')
        if (token) window.parent.postMessage({ type: 'audio-context-closed', token }, '*')
        return originalClose.apply(this, args)
      }
    }
  })
  await stageFixturePage.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })
  let extensionRequestCount = 0
  let serveSpeechAudio = false
  let serveTranslationResult = false
  const speechAudioBytes = await readFile(speechAudioFixturePath)
  await stageFixturePage.route(
    /https:\/\/(synthesis-service|translate-service)\.scratch\.mit\.edu\//,
    async (route) => {
      extensionRequestCount += 1
      const requestUrl = new URL(route.request().url())
      if (serveSpeechAudio && requestUrl.hostname === 'synthesis-service.scratch.mit.edu') {
        await route.fulfill({ status: 200, contentType: 'audio/wav', body: speechAudioBytes })
      } else if (serveTranslationResult && requestUrl.hostname === 'translate-service.scratch.mit.edu') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ result: 'translation approved' }),
        })
      } else {
        await route.fulfill({ status: 503, body: 'intentional browser smoke network stub' })
      }
    },
  )
  const renderStageFixture = async (
    archiveBytes,
    {
      requireAudioPlayback = false,
      requireSoundUntilDone = false,
      requireOverlappingAudio = false,
      requirePitchEffect = false,
      requireClearEffects = false,
      requireChangedPitch = false,
      requireChangedPan = false,
      requireCombinedAudioEffects = false,
      combinedAudioEffectsEvidence = null,
      requireVolumeEffects = false,
      requireStopAllSounds = false,
      consentDecision = null,
      expectedConsent = null,
      expectedConsentText = 'hello from consent smoke',
      expectedNoConsentService = null,
      requireOpaqueStage = false,
      stagePixelEvidence = null,
    } = {},
  ) => {
    const initialExtensionRequestCount = extensionRequestCount
    const token = randomBytes(16).toString('hex')
    await stageFixturePage.evaluate(
      ({ token: activeToken, base64Archive, consentDecision }) => {
        const frame = document.createElement('iframe')
        frame.className = 'student-preview-animation'
        frame.style.width = '480px'
        frame.style.height = '360px'
        frame.dataset.stageFixtureToken = activeToken
        frame.setAttribute('sandbox', 'allow-scripts')
        frame.setAttribute('allow', 'autoplay')
        const archiveBytes = Uint8Array.from(atob(base64Archive), (character) => character.charCodeAt(0))
        const archive = new Blob([archiveBytes], { type: 'application/zip' })
        const status = {
          state: 'loading',
          audioSourcesStarted: 0,
          audioSourceLifecycle: [],
          maxConcurrentAudioSources: 0,
          audioPlaybackRates: [],
          audioGainTargets: [],
          audioVolumeRamps: [],
          audioSourceStopCalls: 0,
          audioContextsClosed: 0,
          audioContextStates: [],
          consentRequests: [],
        }
        window.__officialStageFixtureStatus = window.__officialStageFixtureStatus ?? {}
        window.__officialStageFixtureStatus[activeToken] = status
        window.addEventListener('message', (event) => {
          if (event.origin !== 'null' || event.data?.token !== activeToken) return
          if (event.data.type === 'loaded') {
            frame.contentWindow?.postMessage({ type: 'start-preview', archive, token: activeToken }, '*')
          } else if (event.data.type === 'ready') {
            status.state = 'ready'
          } else if (event.data.type === 'error') {
            status.state = `error: ${event.data.detail ?? 'unknown'}`
          } else if (event.data.type === 'stopped') {
            status.state = 'stopped'
          } else if (event.data.type === 'audio-source-started') {
            status.audioSourcesStarted += 1
            status.audioSourceLifecycle.push('start')
            status.maxConcurrentAudioSources = Math.max(
              status.maxConcurrentAudioSources,
              event.data.activeAudioSources ?? 0,
            )
            status.audioPlaybackRates.push(event.data.playbackRate ?? 1)
          } else if (event.data.type === 'audio-gain-target') {
            status.audioGainTargets.push(event.data.value)
          } else if (event.data.type === 'audio-source-ended') {
            status.audioSourceLifecycle.push('ended')
          } else if (event.data.type === 'audio-volume-ramp') {
            status.audioVolumeRamps.push(event.data.value)
          } else if (event.data.type === 'audio-source-stop-called') {
            status.audioSourceStopCalls += 1
          } else if (event.data.type === 'audio-context-closed') {
            status.audioContextsClosed += 1
          } else if (event.data.type === 'audio-context-state') {
            status.audioContextStates.push(event.data.state)
          } else if (event.data.type === 'extension-egress-consent-request') {
            status.consentRequests.push(event.data)
            if (consentDecision) {
              frame.contentWindow?.postMessage(
                {
                  type: 'tts-consent-response',
                  token: activeToken,
                  requestId: event.data.requestId,
                  allowed: consentDecision === 'allow',
                },
                '*',
              )
            }
          }
        })
        const previewUrl = new URL('preview.html', document.baseURI)
        previewUrl.searchParams.set('token', activeToken)
        previewUrl.searchParams.set('scratchSvgRendererOpaquePreview', '1')
        frame.src = previewUrl.toString()
        document.body.append(frame)
      },
      { token, base64Archive: archiveBytes.toString('base64'), consentDecision },
    )
    await stageFixturePage.waitForFunction(
      (activeToken) => window.__officialStageFixtureStatus?.[activeToken]?.state !== 'loading',
      token,
      { timeout: 15_000 },
    )
    const state = await stageFixturePage.evaluate(
      (activeToken) => window.__officialStageFixtureStatus?.[activeToken]?.state,
      token,
    )
    if (state !== 'ready') throw new Error(`${browserName} failed to load official stage fixture: ${state}`)
    if (expectedConsent) {
      await stageFixturePage.waitForFunction(
        ({ activeToken, service }) =>
          window.__officialStageFixtureStatus?.[activeToken]?.consentRequests.some(
            (request) => request.service === service,
          ),
        { activeToken: token, service: expectedConsent },
        { timeout: 5_000 },
      )
      const consentRequest = await stageFixturePage.evaluate(
        ({ activeToken, service }) =>
          window.__officialStageFixtureStatus?.[activeToken]?.consentRequests.find(
            (request) => request.service === service,
          ),
        { activeToken: token, service: expectedConsent },
      )
      if (consentRequest?.text !== expectedConsentText) {
        throw new Error(`${browserName} ${expectedConsent} preview did not ask consent for the expected text`)
      }
      if (consentDecision) {
        await stageFixturePage.waitForTimeout(250)
      }
    }
    if (expectedNoConsentService) {
      await stageFixturePage.waitForTimeout(250)
      const requests = await stageFixturePage.evaluate(
        (activeToken) => window.__officialStageFixtureStatus?.[activeToken]?.consentRequests ?? [],
        token,
      )
      if (requests.some((request) => request.service === expectedNoConsentService)) {
        throw new Error(`${browserName} over-limit ${expectedNoConsentService} input incorrectly displayed consent`)
      }
      if (extensionRequestCount !== initialExtensionRequestCount) {
        throw new Error(`${browserName} over-limit ${expectedNoConsentService} input reached the network`)
      }
    }
    if (requireAudioPlayback) {
      await stageFixturePage.frameLocator(`iframe[data-stage-fixture-token="${token}"]`).locator('#stage').click()
      try {
        await stageFixturePage.waitForFunction(
          (activeToken) => window.__officialStageFixtureStatus?.[activeToken]?.audioContextStates.includes('running'),
          token,
          { timeout: browserName === 'firefox' ? 15_000 : 5_000 },
        )
      } catch (error) {
        const audioStatus = await stageFixturePage.evaluate(
          (activeToken) => window.__officialStageFixtureStatus?.[activeToken],
          token,
        )
        const inputEvents = await stageFixturePage
          .frameLocator(`iframe[data-stage-fixture-token="${token}"]`)
          .locator('#stage')
          .evaluate(() => window.__officialStageFixtureInputEvents)
        throw new Error(`${browserName} preview AudioContext did not start: ${JSON.stringify(audioStatus)}`, {
          cause: new Error(`Input events: ${JSON.stringify(inputEvents)}`, { cause: error }),
        })
      }
      await stageFixturePage.waitForFunction(
        (activeToken) => (window.__officialStageFixtureStatus?.[activeToken]?.audioSourcesStarted ?? 0) > 0,
        token,
        { timeout: 5_000 },
      )
      if (requireOverlappingAudio) {
        await stageFixturePage.waitForFunction(
          (activeToken) => (window.__officialStageFixtureStatus?.[activeToken]?.maxConcurrentAudioSources ?? 0) > 1,
          token,
          { timeout: 5_000 },
        )
      }
      if (requireSoundUntilDone) {
        await stageFixturePage.waitForFunction(
          (activeToken) => {
            const lifecycle = window.__officialStageFixtureStatus?.[activeToken]?.audioSourceLifecycle ?? []
            const firstStart = lifecycle.indexOf('start')
            const firstEnd = lifecycle.indexOf('ended', firstStart + 1)
            const secondStart = lifecycle.indexOf('start', firstEnd + 1)
            return firstStart >= 0 && firstEnd > firstStart && secondStart > firstEnd
          },
          token,
          { timeout: 5_000 },
        )
      }
      if (requirePitchEffect) {
        await stageFixturePage.waitForFunction(
          (activeToken) => {
            const rates = window.__officialStageFixtureStatus?.[activeToken]?.audioPlaybackRates ?? []
            return rates.some((rate) => Math.abs(rate - 2) < 0.05) && rates.some((rate) => Math.abs(rate - 1) < 0.05)
          },
          token,
          { timeout: 5_000 },
        )
        await stageFixturePage.waitForFunction(
          (activeToken) => {
            const targets = window.__officialStageFixtureStatus?.[activeToken]?.audioGainTargets ?? []
            return (
              targets.some((value) => Math.abs(value) < 0.01) && targets.some((value) => Math.abs(value - 1) < 0.01)
            )
          },
          token,
          { timeout: 5_000 },
        )
      }
      if (requireClearEffects) {
        await stageFixturePage.waitForFunction(
          (activeToken) => {
            const rates = window.__officialStageFixtureStatus?.[activeToken]?.audioPlaybackRates ?? []
            return rates.filter((rate) => Math.abs(rate - 1) < 0.05).length >= 2
          },
          token,
          { timeout: 5_000 },
        )
      }
      if (requireChangedPitch) {
        await stageFixturePage.waitForFunction(
          (activeToken) => {
            const rates = window.__officialStageFixtureStatus?.[activeToken]?.audioPlaybackRates ?? []
            return rates.some((rate) => Math.abs(rate - 2 ** (90 / 120)) < 0.03)
          },
          token,
          { timeout: 5_000 },
        )
      }
      if (requireChangedPan) {
        await stageFixturePage.waitForTimeout(250)
        const audioGainTargets = await stageFixturePage.evaluate(
          (activeToken) => window.__officialStageFixtureStatus?.[activeToken]?.audioGainTargets ?? [],
          token,
        )
        const leftPanIndex = audioGainTargets.findIndex(
          (value, index) => Math.abs(value - 1) < 0.01 && Math.abs(audioGainTargets[index + 1]) < 0.01,
        )
        const rightPanIndex = audioGainTargets.findIndex(
          (value, index) =>
            index > leftPanIndex && Math.abs(value) < 0.01 && Math.abs(audioGainTargets[index + 1] - 1) < 0.01,
        )
        const hasPanChange = leftPanIndex >= 0 && rightPanIndex > leftPanIndex
        if (!hasPanChange) {
          throw new Error(
            `${browserName} PAN change gain targets did not follow 1/0 then 0/1: ${JSON.stringify(audioGainTargets)}`,
          )
        }
      }
      if (requireCombinedAudioEffects) {
        await stageFixturePage.waitForFunction(
          (activeToken) => {
            const status = window.__officialStageFixtureStatus?.[activeToken]
            const hasPitch = status?.audioPlaybackRates?.some((rate) => Math.abs(rate - 2) < 0.05)
            const gains = status?.audioGainTargets ?? []
            const hasLeftPan = gains.some(
              (value, index) => Math.abs(value - 1) < 0.01 && Math.abs(gains[index + 1]) < 0.01,
            )
            const volumes = status?.audioVolumeRamps ?? []
            const hasVolume = volumes.some((value) => Math.abs(value - 0.4) < 0.01)
            return hasPitch && hasLeftPan && hasVolume
          },
          token,
          { timeout: 5_000 },
        )
        if (combinedAudioEffectsEvidence && typeof combinedAudioEffectsEvidence === 'object') {
          const audioStatus = await stageFixturePage.evaluate(
            (activeToken) => window.__officialStageFixtureStatus?.[activeToken],
            token,
          )
          const leftPanIndex = audioStatus.audioGainTargets.findIndex(
            (value, index) => Math.abs(value - 1) < 0.01 && Math.abs(audioStatus.audioGainTargets[index + 1]) < 0.01,
          )
          Object.assign(combinedAudioEffectsEvidence, {
            playbackRate: audioStatus.audioPlaybackRates.find((rate) => Math.abs(rate - 2) < 0.05),
            panLeftGain: audioStatus.audioGainTargets[leftPanIndex],
            panRightGain: audioStatus.audioGainTargets[leftPanIndex + 1],
            volumeGain: audioStatus.audioVolumeRamps.find((value) => Math.abs(value - 0.4) < 0.01),
          })
        }
      }
      if (requireVolumeEffects) {
        await stageFixturePage.waitForFunction(
          (activeToken) => {
            const values = window.__officialStageFixtureStatus?.[activeToken]?.audioVolumeRamps ?? []
            return (
              values.some((value) => Math.abs(value - 0.5) < 0.01) &&
              values.some((value) => Math.abs(value - 0.25) < 0.01)
            )
          },
          token,
          { timeout: 5_000 },
        )
      }
      if (requireStopAllSounds) {
        await stageFixturePage.waitForFunction(
          (activeToken) =>
            (window.__officialStageFixtureStatus?.[activeToken]?.audioSourceStopCalls ?? 0) >= 4 &&
            (window.__officialStageFixtureStatus?.[activeToken]?.audioContextsClosed ?? 0) === 0,
          token,
          { timeout: 5_000 },
        )
        const audioContextStates = await stageFixturePage.evaluate(
          (activeToken) => window.__officialStageFixtureStatus?.[activeToken]?.audioContextStates ?? [],
          token,
        )
        if (!audioContextStates.includes('running')) {
          throw new Error(`${browserName} sound_stopallsounds did not leave the preview AudioContext running`)
        }
      }
    }
    const stageCanvas = stageFixturePage.frameLocator(`iframe[data-stage-fixture-token="${token}"]`).locator('#stage')
    const screenshot = await stageCanvas.screenshot()
    if (requireOpaqueStage) {
      const pixels = await stageFixturePage.evaluate(async (base64Png) => {
        const bytes = Uint8Array.from(atob(base64Png), (character) => character.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Could not decode the Scratch stage screenshot')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        let opaquePixels = 0
        const colors = new Set()
        for (let offset = 0; offset < data.length; offset += 4) {
          if (data[offset + 3] > 0) opaquePixels += 1
          colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`)
        }
        return { width: canvas.width, height: canvas.height, opaquePixels, distinctColors: colors.size }
      }, screenshot.toString('base64'))
      if (
        pixels.width !== 480 ||
        pixels.height !== 360 ||
        pixels.opaquePixels < pixels.width * pixels.height * 0.9 ||
        pixels.distinctColors < 16
      ) {
        throw new Error(
          `${browserName} stage preview produced insufficient screenshot pixels: ${JSON.stringify(pixels)}`,
        )
      }
      if (Array.isArray(stagePixelEvidence)) stagePixelEvidence.push(pixels)
    }
    await stageFixturePage.evaluate((activeToken) => {
      document
        .querySelector(`iframe[data-stage-fixture-token="${activeToken}"]`)
        ?.contentWindow?.postMessage({ type: 'stop-preview', token: activeToken }, '*')
    }, token)
    await stageFixturePage.waitForFunction(
      (activeToken) => window.__officialStageFixtureStatus?.[activeToken]?.state === 'stopped',
      token,
      { timeout: 2_000 },
    )
    await stageFixturePage.waitForFunction(
      (activeToken) => (window.__officialStageFixtureStatus?.[activeToken]?.audioContextsClosed ?? 0) > 0,
      token,
      { timeout: 2_000 },
    )
    await stageFixturePage.locator(`iframe[data-stage-fixture-token="${token}"]`).evaluate((frame) => frame.remove())
    return screenshot
  }

  const createEgressFixture = async (service, text = 'hello from consent smoke') => {
    const zip = await JSZip.loadAsync(await readFile(officialTextToSpeechFixturePath))
    const project = JSON.parse(await zip.file('project.json').async('string'))
    project.extensions = [service]
    const sprite = project.targets.find((target) => !target.isStage)
    sprite.blocks = {}
    const hatId = 'consent-smoke-hat'
    const actionId = 'consent-smoke-action'
    sprite.blocks[hatId] = {
      opcode: 'event_whenflagclicked',
      next: actionId,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 20,
      y: 20,
    }
    if (service === 'text2speech') {
      sprite.blocks[actionId] = {
        opcode: 'text2speech_speakAndWait',
        next: null,
        parent: hatId,
        inputs: { WORDS: [1, [10, text]] },
        fields: {},
        shadow: false,
        topLevel: false,
      }
    } else {
      const sayId = 'consent-smoke-say'
      const translateId = 'consent-smoke-translate'
      sprite.blocks[hatId].next = sayId
      sprite.blocks[sayId] = {
        opcode: 'looks_say',
        next: null,
        parent: hatId,
        inputs: { MESSAGE: [3, translateId, [10, '']] },
        fields: {},
        shadow: false,
        topLevel: false,
      }
      sprite.blocks[translateId] = {
        opcode: 'translate_getTranslate',
        next: null,
        parent: sayId,
        inputs: { WORDS: [1, [10, text]], LANGUAGE: [1, [10, 'fr']] },
        fields: {},
        shadow: false,
        topLevel: false,
      }
    }
    zip.file('project.json', JSON.stringify(project))
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }

  const consentRequestCounts = { speech: 0, translation: 0 }
  const translationStageImages = new Map()
  for (const [service, extensionId] of [
    ['speech', 'text2speech'],
    ['translation', 'translate'],
  ]) {
    const archive = await createEgressFixture(extensionId)
    for (const decision of ['deny', 'allow']) {
      const before = extensionRequestCount
      const playSpeechAudio = service === 'speech' && decision === 'allow'
      serveSpeechAudio = playSpeechAudio
      serveTranslationResult = service === 'translation' && decision === 'allow'
      const stageImage = await renderStageFixture(archive, {
        consentDecision: decision,
        expectedConsent: service,
        ...(playSpeechAudio ? { requireAudioPlayback: true } : {}),
      })
      serveSpeechAudio = false
      serveTranslationResult = false
      if (service === 'translation') translationStageImages.set(decision, stageImage)
      const delta = extensionRequestCount - before
      if (delta !== (decision === 'allow' ? 1 : 0)) {
        const consentState = await stageFixturePage.evaluate(() => window.__officialStageFixtureStatus)
        throw new Error(
          `${browserName} ${service} ${decision} consent produced ${delta} network requests; expected ${decision === 'allow' ? 1 : 0}; state=${JSON.stringify(consentState)}`,
        )
      }
      consentRequestCounts[service] += 1
    }
  }
  if (
    createHash('sha256').update(translationStageImages.get('deny')).digest('hex') ===
    createHash('sha256').update(translationStageImages.get('allow')).digest('hex')
  ) {
    throw new Error(`${browserName} Translate approved response did not change the Scratch stage output`)
  }
  const maxTranslationText = 'x'.repeat(1024)
  const beforeMaxTranslation = extensionRequestCount
  serveTranslationResult = true
  await renderStageFixture(await createEgressFixture('translate', maxTranslationText), {
    consentDecision: 'allow',
    expectedConsent: 'translation',
    expectedConsentText: maxTranslationText,
  })
  serveTranslationResult = false
  if (extensionRequestCount - beforeMaxTranslation !== 1) {
    throw new Error(`${browserName} 1,024-character Translate input did not send exactly one approved request`)
  }
  await renderStageFixture(await createEgressFixture('translate', 'x'.repeat(1025)), {
    expectedNoConsentService: 'translation',
  })
  const extensionConsentSmoke = `extension egress consent: ${consentRequestCounts.speech} speech and ${consentRequestCounts.translation} translation prompts; deny sent no request, allow sent one request; mocked WAV played through Scratch Audio; approved translation changed stage text; 1,024 characters accepted and 1,025 rejected before consent`

  const officialSelectedStageScreenshot = await renderStageFixture(selectedStageBytes)
  const officialDefaultStageScreenshot = await renderStageFixture(defaultStageBytes)
  if (
    createHash('sha256').update(officialSelectedStageScreenshot).digest('hex') ===
    createHash('sha256').update(officialDefaultStageScreenshot).digest('hex')
  ) {
    throw new Error(`${browserName} official monitors.sb3 Stage preview ignored its selected non-default backdrop`)
  }

  const selectedHeartProject = structuredClone(officialStageProject)
  selectedHeartProject.targets.find((target) => target.isStage).currentCostume = 0
  for (const target of selectedHeartProject.targets) {
    if (!target.isStage && target.name !== 'Heart') target.visible = false
  }
  const defaultHeartProject = structuredClone(selectedHeartProject)
  defaultHeartProject.targets.find((target) => target.name === 'Heart').currentCostume = 0
  const selectedHeartBytes = await archiveWithProjectJson(officialStageFixturePath, selectedHeartProject)
  const defaultHeartBytes = await archiveWithProjectJson(officialStageFixturePath, defaultHeartProject)
  const officialSelectedHeartScreenshot = await renderStageFixture(selectedHeartBytes)
  const officialDefaultHeartScreenshot = await renderStageFixture(defaultHeartBytes)
  if (
    createHash('sha256').update(officialSelectedHeartScreenshot).digest('hex') ===
    createHash('sha256').update(officialDefaultHeartScreenshot).digest('hex')
  ) {
    throw new Error(
      `${browserName} official monitors.sb3 sprite preview ignored Heart's selected non-default costume`,
    )
  }

  const officialMixedAssetZip = await JSZip.loadAsync(await readFile(officialMixedAssetFixturePath))
  const officialMixedAssetProject = JSON.parse(await officialMixedAssetZip.file('project.json').async('string'))
  const officialMixedAssetStage = officialMixedAssetProject.targets.find((target) => target.isStage)
  const officialMixedAssetTitle = officialMixedAssetProject.targets.find((target) => target.name === 'Title')
  const officialMixedAssetTrivia = officialMixedAssetProject.targets.find((target) => target.name === 'Trivia')
  if (
    officialMixedAssetStage?.costumes?.length !== 2 ||
    officialMixedAssetStage.currentCostume !== 1 ||
    officialMixedAssetStage.costumes.some((costume) => costume.dataFormat !== 'png') ||
    !officialMixedAssetTitle?.costumes?.some((costume) => costume.dataFormat === 'svg') ||
    !officialMixedAssetTitle.costumes.some((costume) => costume.dataFormat === 'png') ||
    officialMixedAssetTrivia?.costumes?.length !== 11
  ) {
    throw new Error('Official pen-dolphin-3d.sb3 fixture no longer covers selected bitmap and mixed costume formats')
  }
  const mixedAssetScreenshot = await renderStageFixture(await readFile(officialMixedAssetFixturePath), {
    requireAudioPlayback: true,
  })
  if (mixedAssetScreenshot.byteLength < 10_000) {
    throw new Error(
      `${browserName} pen-dolphin-3d.sb3 resolution-2 PNG backdrop rendered an unexpectedly small image`,
    )
  }
  const officialBitmapZip = await JSZip.loadAsync(await readFile(officialBitmapFixturePath))
  const officialBitmapPreviewProject = JSON.parse(await officialBitmapZip.file('project.json').async('string'))
  const officialBitmapPreviewStage = officialBitmapPreviewProject.targets.find((target) => target.isStage)
  if (
    !officialBitmapPreviewStage?.costumes?.some(
      (costume) => costume.dataFormat === 'png' && costume.bitmapResolution === 1,
    )
  ) {
    throw new Error('Official comments.sb3 fixture no longer covers a resolution-1 PNG Stage backdrop')
  }
  const officialBitmapStageScreenshot = await renderStageFixture(await readFile(officialBitmapFixturePath), {
    requireOpaqueStage: true,
  })
  if (officialBitmapStageScreenshot.byteLength < 10_000) {
    throw new Error(`${browserName} comments.sb3 resolution-1 PNG backdrop rendered an unexpectedly small image`)
  }
  const officialMultiCostumePreview =
    'comments.sb3 renders a resolution-1 PNG Stage backdrop; monitors.sb3 verifies selected Stage/sprite costumes; pen-dolphin-3d.sb3 renders resolution-2 PNG/mixed PNG-SVG assets and starts official Scratch audio'
  const overlappingAudioScreenshot = await renderStageFixture(await createOverlappingAudioFixture(), {
    requireAudioPlayback: true,
    requireOverlappingAudio: true,
    requirePitchEffect: true,
    requireClearEffects: true,
    requireChangedPitch: true,
    requireChangedPan: true,
    requireVolumeEffects: true,
    requireStopAllSounds: true,
  })
  if (overlappingAudioScreenshot.byteLength < 10_000) {
    throw new Error(`${browserName} overlapping Scratch sound playback did not preserve a visible stage`)
  }
  const overlappingAudioPreview =
    'six sound scripts overlap; verifies PITCH set/change rates 2x/~1.682x, PAN -100 then +200 gains 1/0 then 0/1, clear-effects at 1x, volume ramps 0.5/0.25, and stopallsounds without closing AudioContext'
  const soundWaitScreenshot = await renderStageFixture(await createAudioWaitFixture(), {
    requireAudioPlayback: true,
    requireSoundUntilDone: true,
  })
  if (soundWaitScreenshot.byteLength < 10_000) {
    throw new Error(`${browserName} sound_playuntildone fixture did not preserve a visible stage`)
  }
  const soundWaitPreview =
    'sound_playuntildone waits for the first WAV source ended event before the next sound_play starts'
  const combinedAudioEffectsEvidence = {}
  const combinedAudioEffectsScreenshot = await renderStageFixture(await createCombinedAudioEffectsFixture(), {
    requireAudioPlayback: true,
    requireCombinedAudioEffects: true,
    combinedAudioEffectsEvidence,
  })
  if (combinedAudioEffectsScreenshot.byteLength < 10_000) {
    throw new Error(`${browserName} combined Scratch sound effects did not preserve a visible stage`)
  }
  const combinedAudioEffects = {
    fixture: 'default.sb3-derived-combined-effects',
    pitchOpcode: 'sound_seteffectto',
    pitchValue: 120,
    panOpcode: 'sound_seteffectto',
    panValue: -100,
    volumeOpcode: 'sound_setvolumeto',
    volumeValue: 40,
    playbackRate: combinedAudioEffectsEvidence.playbackRate,
    panLeftGain: combinedAudioEffectsEvidence.panLeftGain,
    panRightGain: combinedAudioEffectsEvidence.panRightGain,
    volumeGain: combinedAudioEffectsEvidence.volumeGain,
  }
  let malformedSoundPreviewCount = 0
  for (const fixturePath of officialMalformedSoundFixturePaths) {
    const malformedSoundScreenshot = await renderStageFixture(await readFile(fixturePath))
    if (malformedSoundScreenshot.byteLength < 10_000) {
      throw new Error(`${browserName} malformed-sound fixture did not produce a visible fallback stage`)
    }
    malformedSoundPreviewCount += 1
  }
  let malformedCostumePreviewCount = 0
  const malformedCostumeStageEvidence = []
  for (const fixturePath of officialMalformedCostumeFixturePaths) {
    let fixtureBytes = await readFile(fixturePath)
    const zip = await JSZip.loadAsync(fixtureBytes)
    const projectEntry = Object.values(zip.files).find((entry) => entry.name.endsWith('/project.json'))
    if (projectEntry) {
      const prefix = projectEntry.name.slice(0, -'project.json'.length)
      const normalizedZip = new JSZip()
      for (const entry of Object.values(zip.files)) {
        if (!entry.dir && entry.name.startsWith(prefix) && !entry.name.split('/').at(-1)?.startsWith('._')) {
          normalizedZip.file(entry.name.slice(prefix.length), await entry.async('uint8array'))
        }
      }
      fixtureBytes = await normalizedZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }
    const malformedCostumeScreenshot = await renderStageFixture(fixtureBytes, {
      requireOpaqueStage: true,
      stagePixelEvidence: malformedCostumeStageEvidence,
    })
    if (malformedCostumeScreenshot.byteLength < 1_000) {
      throw new Error(
        `${browserName} malformed-costume fixture ${fixturePath} did not produce a capturable fallback frame (${malformedCostumeScreenshot.byteLength} bytes)`,
      )
    }
    malformedCostumePreviewCount += 1
  }

  const bitmapProject = structuredClone(previewProject)
  const bitmapPlayer = bitmapProject.sprites.find((sprite) => sprite.name === 'Player')
  if (!bitmapPlayer?.costumes[0]) throw new Error('Bitmap adapter smoke project has no Player costume')
  bitmapPlayer.costumes[0].data = `data:image/png;base64,${(await readFile(bitmapFixturePath)).toString('base64')}`
  bitmapPlayer.costumes[0].dataFormat = 'png'
  bitmapPlayer.costumes[0].bitmapResolution = 1
  bitmapPlayer.currentCostume = 0
  await page.locator('#json-editor').fill(JSON.stringify(bitmapProject))
  await clickStudentBuild(page)
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) !== 'ok') {
    throw new Error(
      `Scratch 2 bitmap adapter preview failed: ${await page.locator('#generate-status').textContent()}`,
    )
  }
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#student-preview .student-preview-canvas')
    return canvas instanceof HTMLCanvasElement && !canvas.hidden
  })

  await page.locator('button[data-tab="analyze"]').click()
  if (
    (await page.locator('#generate-panel').evaluate((element) => globalThis.getComputedStyle(element).display)) !==
    'none'
  ) {
    throw new Error('Inactive generate mode is visible')
  }
  await page.locator('#sb3-file').focus()
  if ((await page.evaluate(() => globalThis.document.activeElement?.id)) !== 'sb3-file') {
    throw new Error('Scratch file picker is not keyboard focusable')
  }
  await page.locator('#sb3-file').setInputFiles(officialCloudFixturePath)
  await page.locator('#file-status').filter({ hasText: '檢查完成：' }).waitFor()
  const cloudCanonicalOutput = await page.locator('#canonical-output').textContent()
  const cloudCanonicalProject = cloudCanonicalOutput ? JSON.parse(cloudCanonicalOutput) : null
  if (!cloudCanonicalProject?.stage.variables.some((variable) => variable.cloud === true)) {
    throw new Error('Official cloud variable declaration was lost during browser analysis')
  }
  const cloudWarningText = await page.locator('#diagnostics').innerText()
  if (!cloudWarningText.includes('不會同步到 Scratch 雲端')) {
    throw new Error('Browser analysis did not warn that cloud variables are unavailable offline')
  }
  const officialBitmapSourceArchive = await JSZip.loadAsync(await readFile(officialBitmapFixturePath))
  const officialBitmapSourceProject = JSON.parse(
    await officialBitmapSourceArchive.file('project.json').async('string'),
  )
  const sourceSpriteForNormalization = officialBitmapSourceProject.targets.find((target) => !target.isStage)
  if (!sourceSpriteForNormalization) throw new Error('Official bitmap fixture has no sprite for normalization smoke')
  sourceSpriteForNormalization.direction = 360
  officialBitmapSourceArchive.file('project.json', JSON.stringify(officialBitmapSourceProject))
  const officialBitmapSourceBytes = await officialBitmapSourceArchive.generateAsync({ type: 'nodebuffer' })
  await page.locator('#sb3-file').setInputFiles({
    name: 'official-bitmap-costume-direction-edge.sb3',
    mimeType: 'application/zip',
    buffer: officialBitmapSourceBytes,
  })
  await page.locator('#file-status').filter({ hasText: '完成：' }).waitFor()
  const officialBitmapCanonical = await page.locator('#canonical-output').textContent()
  if (!officialBitmapCanonical?.includes('Stage')) {
    throw new Error('Official bitmap-bearing Scratch project did not reach Canonical IR analysis')
  }
  const sourceBitmapStage = officialBitmapSourceProject.targets.find((target) => target.isStage)
  const canonicalBitmapProject = JSON.parse(officialBitmapCanonical)
  const canonicalBitmapStage = canonicalBitmapProject.stage
  const sourceStageCostume = sourceBitmapStage?.costumes[0]
  const canonicalStageCostume = canonicalBitmapStage.costumes[0]
  const sourceStagePng = sourceStageCostume
    ? await officialBitmapSourceArchive.file(sourceStageCostume.md5ext)?.async('uint8array')
    : undefined
  if (
    canonicalStageCostume.bitmapResolution !== sourceStageCostume?.bitmapResolution ||
    canonicalStageCostume.rotationCenterX !== sourceStageCostume?.rotationCenterX ||
    canonicalStageCostume.rotationCenterY !== sourceStageCostume?.rotationCenterY ||
    !sourceStagePng ||
    !canonicalStageCostume.data.endsWith(Buffer.from(sourceStagePng).toString('base64'))
  ) {
    throw new Error(
      'Canonical conversion did not restore source bitmap bytes, resolution, and rotation center metadata',
    )
  }
  for (const sourceTarget of officialBitmapSourceProject.targets.filter((target) => !target.isStage)) {
    const canonicalTarget = canonicalBitmapProject.sprites.find((sprite) => sprite.name === sourceTarget.name)
    for (const key of ['x', 'y', 'direction', 'size', 'visible', 'draggable', 'rotationStyle', 'currentCostume']) {
      if (sourceTarget[key] !== undefined && canonicalTarget?.[key] !== sourceTarget[key]) {
        throw new Error(`Canonical import changed source sprite ${key} for ${sourceTarget.name}`)
      }
    }
    if (sourceTarget.direction === 360 && canonicalTarget?.direction !== 360) {
      throw new Error('Canonical import lost source direction before Scratch VM wrap normalization')
    }
  }
  await page.locator('button[data-tab="generate"]').click()
  await page.locator('#json-editor').fill(officialBitmapCanonical)
  const officialBitmapDownloadPromise = page.waitForEvent('download')
  await clickStudentBuild(page)
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) !== 'ok') {
    throw new Error(
      `Official bitmap-bearing Scratch project did not recompile: ${await page.locator('#generate-status').textContent()}`,
    )
  }
  const officialBitmapDownload = await officialBitmapDownloadPromise
  const officialBitmapDownloadPath = await officialBitmapDownload.path()
  if (!officialBitmapDownloadPath) throw new Error('Official bitmap-bearing Scratch project did not produce an SB3')
  const officialBitmapArchive = await JSZip.loadAsync(await readFile(officialBitmapDownloadPath))
  const officialBitmapProject = JSON.parse(await officialBitmapArchive.file('project.json').async('string'))
  const officialStage = officialBitmapProject.targets.find((target) => target.isStage)
  const officialBitmapSprite = officialBitmapProject.targets.find((target) => !target.isStage)
  const officialStageCostume = officialStage?.costumes.find((costume) => costume.dataFormat === 'png')
  const officialStagePng = officialStageCostume
    ? await officialBitmapArchive.file(officialStageCostume.md5ext)?.async('uint8array')
    : undefined
  if (
    !officialStagePng ||
    officialStagePng[0] !== 0x89 ||
    officialStagePng[1] !== 0x50 ||
    officialStagePng[2] !== 0x4e ||
    officialStagePng[3] !== 0x47 ||
    !sourceStagePng ||
    !Buffer.from(officialStagePng).equals(Buffer.from(sourceStagePng)) ||
    officialBitmapSprite?.costumes.length !== 2
  ) {
    throw new Error('Official bitmap project lost its PNG Stage asset or multi-costume sprite during recompilation')
  }
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#student-preview .student-preview-canvas')
    return canvas instanceof HTMLCanvasElement && !canvas.hidden
  })
  await page.locator('button[data-tab="analyze"]').click()
  const benchmarkProject = structuredClone(downloadedProject)
  const benchmarkTarget = benchmarkProject.targets.find((target) => !target.isStage)
  if (!benchmarkTarget) throw new Error('Downloaded project did not contain a sprite for browser latency testing')
  const preservationProbeTarget = benchmarkProject.targets.find((target) => Object.keys(target.blocks).length > 0)
  const preservationProbeBlock = preservationProbeTarget && Object.entries(preservationProbeTarget.blocks)[0]
  if (!preservationProbeTarget || !preservationProbeBlock) {
    throw new Error('Downloaded project did not contain a block for property-removal browser testing')
  }
  const [preservationProbeBlockId, preservationProbeNode] = preservationProbeBlock
  preservationProbeNode.smokeRemoveMe = 'remove-me'
  preservationProbeNode.smokeNested = { keep: 'before', remove: 'selected' }
  const benchmarkBlockCount = 2_000
  for (let index = 0; index < benchmarkBlockCount; index += 1) {
    const id = `browser-benchmark-${index}`
    const next = index + 1 < benchmarkBlockCount ? `browser-benchmark-${index + 1}` : null
    const parent = index > 0 ? `browser-benchmark-${index - 1}` : null
    benchmarkTarget.blocks[id] = {
      opcode: 'looks_say',
      next,
      parent,
      inputs: { MESSAGE: [1, [10, `browser sample ${index}`]] },
      fields: {},
      shadow: false,
      topLevel: index === 0,
      ...(index === 0 ? { x: 0, y: 0 } : {}),
    }
  }
  const benchmarkArchive = await JSZip.loadAsync(await readFile(downloadPath))
  benchmarkArchive.file('project.json', JSON.stringify(benchmarkProject))
  benchmarkArchive.file('assets/incremental-hash-smoke.bin', randomBytes(2 * 1024 * 1024))
  const benchmarkBytes = await benchmarkArchive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const chromeCdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined
  if (chromeCdp) await chromeCdp.send('HeapProfiler.collectGarbage')
  const heapBeforeImport = chromeCdp ? await chromeCdp.send('Runtime.getHeapUsage') : undefined
  const processRssSampler = sampleProcessTreePeakMemory(process.pid)
  const browserImportStartedAt = performance.now()
  await page.locator('#sb3-file').setInputFiles({
    name: 'browser-performance-2000.sb3',
    mimeType: 'application/zip',
    buffer: benchmarkBytes,
  })
  await page.locator('#file-status').filter({ hasText: '完成：' }).waitFor()
  const browserImportAnalysisMs = performance.now() - browserImportStartedAt
  const processTreePeakRss = await processRssSampler?.stop()
  if (chromeCdp) await chromeCdp.send('HeapProfiler.collectGarbage')
  const heapAfterImport = chromeCdp ? await chromeCdp.send('Runtime.getHeapUsage') : undefined
  const retainedHeapGrowthBytes =
    heapBeforeImport && heapAfterImport
      ? Math.max(
          0,
          heapAfterImport.usedSize +
            heapAfterImport.backingStorageSize -
            heapBeforeImport.usedSize -
            heapBeforeImport.backingStorageSize,
        )
      : undefined
  const importedStatus = (await page.locator('#file-status').textContent())?.trim() ?? ''
  const importedBlockCount = Number(importedStatus.match(/完成：(\d+) 個積木/)?.[1])
  if (!Number.isFinite(importedBlockCount) || importedBlockCount < benchmarkBlockCount) {
    throw new Error(`Browser import discarded the generated block graph: ${importedStatus}`)
  }
  if (browserImportAnalysisMs > browserImportAnalysisBudgetMs) {
    throw new Error(
      `${browserName} imported and analyzed ${importedBlockCount} blocks in ${browserImportAnalysisMs.toFixed(1)} ms; budget ${browserImportAnalysisBudgetMs} ms`,
    )
  }
  if (retainedHeapGrowthBytes !== undefined && retainedHeapGrowthBytes > chromiumRetainedHeapBudgetBytes) {
    throw new Error(
      `Chromium retained ${retainedHeapGrowthBytes} bytes after importing ${importedBlockCount} blocks; budget ${chromiumRetainedHeapBudgetBytes} bytes`,
    )
  }

  const canonicalOutput = (await page.locator('#canonical-output').textContent()) ?? ''
  if (!canonicalOutput.includes('event_whenkeypressed') || !canonicalOutput.includes('TOUCHINGOBJECTMENU')) {
    throw new Error('Re-imported platformer is missing keyboard or collision blocks')
  }
  if (canonicalOutput.includes('sensing_touchingobjectmenu') || canonicalOutput.includes('looks_costume')) {
    throw new Error('Scratch menu shadows leaked into AI-facing Canonical IR')
  }
  const analysisOutput = (await page.locator('#analysis-output').textContent()) ?? ''
  if (!analysisOutput.includes('raw-block-graph-preserved')) {
    throw new Error('Analysis output is missing the raw block graph preservation diagnostic')
  }
  const procedureNormalizationOutput = (await page.locator('#procedure-normalization-output').textContent()) ?? ''
  if (!procedureNormalizationOutput.includes('scratch-ai-bridge/procedure-normalization-report')) {
    throw new Error('Procedure normalization report is missing from the advanced analysis output')
  }
  await page.locator('.target-script-list summary').click()
  const targetScriptEntries = await page.locator('#target-script-list .target-script-entry').count()
  if (targetScriptEntries !== downloadedProject.targets.length) {
    throw new Error(
      `Target script summary lists ${targetScriptEntries} targets; expected ${downloadedProject.targets.length}`,
    )
  }
  if ((await page.locator('#target-script-list').innerText()).includes('undefined 個程式')) {
    throw new Error('Target script summary contains a missing script count')
  }
  if (await page.locator('#download-original-sb3').isDisabled()) {
    throw new Error('Lossless source archive download was not enabled after analysis')
  }
  if (await page.locator('#download-procedure-report').isDisabled()) {
    throw new Error('Procedure normalization report download was not enabled after project analysis')
  }
  await page.getByRole('tabpanel', { name: '請 AI 幫我檢查作品' }).locator('details.advanced-tools summary').click()
  const [sourceArchiveDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-original-sb3').click(),
  ])
  if (sourceArchiveDownload.suggestedFilename() !== 'browser-performance-2000-preserved.sb3') {
    throw new Error(
      `Raw-preserving archive download used an unexpected filename: ${sourceArchiveDownload.suggestedFilename()}`,
    )
  }
  const sourceArchivePath = await sourceArchiveDownload.path()
  if (!sourceArchivePath) throw new Error('Browser did not expose the raw-preserving archive download')
  const sourceArchive = await JSZip.loadAsync(await readFile(sourceArchivePath))
  for (const [filename] of Object.entries(benchmarkArchive.files).filter(([, archiveEntry]) => !archiveEntry.dir)) {
    const originalBytes = await benchmarkArchive.file(filename)?.async('uint8array')
    const preservedBytes = await sourceArchive.file(filename)?.async('uint8array')
    if (!originalBytes || !preservedBytes || Buffer.compare(originalBytes, preservedBytes) !== 0) {
      throw new Error(`Raw-preserving download changed source entry payload bytes: ${filename}`)
    }
  }
  const [vmNormalizedDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#normalize-vm-sb3').click(),
  ])
  if (vmNormalizedDownload.suggestedFilename() !== 'browser-performance-2000-vm-normalized.sb3') {
    throw new Error(`VM-normalized archive used an unexpected filename: ${vmNormalizedDownload.suggestedFilename()}`)
  }
  if (!(await page.locator('#download-vm-normalization-report').isEnabled())) {
    throw new Error('VM normalization report download was not enabled after VM save')
  }
  const normalizedPath = await vmNormalizedDownload.path()
  if (!normalizedPath) throw new Error('Browser did not expose the VM-normalized archive download')
  const normalizedArchive = await JSZip.loadAsync(await readFile(normalizedPath))
  const [normalizationReportDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-vm-normalization-report').click(),
  ])
  if (normalizationReportDownload.suggestedFilename() !== 'browser-performance-2000-vm-normalization-report.json') {
    throw new Error(
      `VM normalization report used an unexpected filename: ${normalizationReportDownload.suggestedFilename()}`,
    )
  }
  const normalizationReportPath = await normalizationReportDownload.path()
  if (!normalizationReportPath) throw new Error('Browser did not expose the VM normalization report download')
  const normalizationReport = JSON.parse(await readFile(normalizationReportPath, 'utf8'))
  const normalizedProjectBytes = await normalizedArchive.file('project.json')?.async('uint8array')
  const sourceProjectBytes = await benchmarkArchive.file('project.json')?.async('uint8array')
  if (
    normalizationReport.format !== 'scratch-ai-bridge/vm-normalization-report' ||
    normalizationReport.version !== 1 ||
    !normalizedProjectBytes ||
    !sourceProjectBytes ||
    normalizationReport.sourceProjectJsonSha256 !== createHash('sha256').update(sourceProjectBytes).digest('hex') ||
    normalizationReport.normalizedProjectJsonSha256 !==
      createHash('sha256').update(normalizedProjectBytes).digest('hex') ||
    !Array.isArray(normalizationReport.projectJsonChanges) ||
    !Array.isArray(normalizationReport.archiveEntryChanges)
  ) {
    throw new Error('VM normalization report does not match the downloaded source/output archives')
  }
  if (!normalizationReport.archiveEntryChanges.some(({ name }) => name === 'project.json')) {
    throw new Error('VM normalization report does not describe project.json')
  }
  for (const entryChange of normalizationReport.archiveEntryChanges) {
    const sourceEntryBytes = await benchmarkArchive.file(entryChange.name)?.async('uint8array')
    const normalizedEntryBytes = await normalizedArchive.file(entryChange.name)?.async('uint8array')
    const sourceHash = sourceEntryBytes ? createHash('sha256').update(sourceEntryBytes).digest('hex') : null
    const normalizedHash = normalizedEntryBytes
      ? createHash('sha256').update(normalizedEntryBytes).digest('hex')
      : null
    if (entryChange.sourceSha256 !== sourceHash || entryChange.normalizedSha256 !== normalizedHash) {
      throw new Error(`VM normalization report has an incorrect archive-entry hash: ${entryChange.name}`)
    }
  }
  if (sourceArchiveDownload.suggestedFilename().includes('preserved') === false) {
    throw new Error('Raw-preserving download filename does not identify the preserved source')
  }
  const [procedureReportDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-procedure-report').click(),
  ])
  if (procedureReportDownload.suggestedFilename() !== 'procedure-normalization-report.json') {
    throw new Error('Procedure normalization report download used an unexpected filename')
  }
  const [blockMappingDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-block-mapping').click(),
  ])
  if (blockMappingDownload.suggestedFilename() !== 'canonical-block-mapping.json') {
    throw new Error('Canonical block mapping download used an unexpected filename')
  }
  const blockMappingPath = await blockMappingDownload.path()
  if (!blockMappingPath) throw new Error('Browser did not expose the Canonical block mapping download')
  const blockMapping = JSON.parse(await readFile(blockMappingPath, 'utf8'))
  const mappedBlock = blockMapping.entries?.find((entry) => entry.opcode === 'event_whenflagclicked')
  const mappedTarget = downloadedProject.targets[mappedBlock?.targetIndex]
  if (
    blockMapping.format !== 'scratch-ai-bridge/canonical-block-mapping' ||
    !(mappedBlock?.irPath.startsWith('/stage/') || mappedBlock?.irPath.startsWith('/sprites/')) ||
    mappedTarget?.name !== mappedBlock.targetName ||
    mappedTarget?.isStage !== mappedBlock.isStage ||
    mappedTarget?.blocks[mappedBlock.blockId]?.opcode !== mappedBlock.opcode
  ) {
    throw new Error(
      `Canonical block mapping does not resolve to its source Scratch block: ${JSON.stringify({ mappedBlock, mappedTargetName: mappedTarget?.name, mappedTargetIsStage: mappedTarget?.isStage, mappedOpcode: mappedTarget?.blocks?.[mappedBlock?.blockId]?.opcode })}`,
    )
  }

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => {
        throw new Error('permission denied')
      },
    })
  })
  await page.locator('#preservation-request').fill('保留所有其他資料，替一個積木加上 smoke 測試標記。')
  await page.locator('#copy-preservation-prompt').click()
  await page.locator('#preservation-clipboard-fallback:not([hidden])').waitFor()
  const preservationPrompt = await page.locator('#preservation-clipboard-fallback-text').inputValue()
  if (
    typeof preservationPrompt !== 'string' ||
    !preservationPrompt.includes('scratch-ai-bridge/block-graph-patch') ||
    !preservationPrompt.includes('原始積木圖')
  ) {
    throw new Error('Preservation-edit prompt is missing its scoped raw graph contract')
  }

  const patchTarget = downloadedProject.targets.find((target) => Object.keys(target.blocks).length > 0)
  const firstTargetBlock = patchTarget && Object.entries(patchTarget.blocks)[0]
  if (!patchTarget || !firstTargetBlock) throw new Error('Generated fixture has no blocks for preservation edit')
  const [patchedBlockId] = firstTargetBlock
  const patchReply = {
    format: 'scratch-ai-bridge/block-graph-patch',
    version: 1,
    patches: [
      {
        targetIndex: downloadedProject.targets.indexOf(patchTarget),
        targetName: patchTarget.name,
        isStage: patchTarget.isStage,
        blocks: {
          [patchedBlockId]: {
            smokePatch: 'preserved',
            removeProperties: ['smokeRemoveMe'],
            setPaths: [{ path: '/smokeNested/keep', value: 'updated' }],
            removePaths: ['/smokeNested/remove'],
          },
        },
      },
    ],
  }
  await page.locator('#preservation-patch').fill(JSON.stringify(patchReply))
  const preservationDownloadPromise = page.waitForEvent('download')
  await page.locator('#apply-preservation-patch').click()
  await page.locator('#preservation-status[data-kind="ok"]').waitFor()
  const preservationDownload = await preservationDownloadPromise
  if (!preservationDownload.suggestedFilename().endsWith('-preserved-edit.sb3')) {
    throw new Error(`Preservation-edit download used an unexpected name: ${preservationDownload.suggestedFilename()}`)
  }
  const preservationPath = await preservationDownload.path()
  if (!preservationPath) throw new Error(`${browserName} did not expose the preserved SB3 path`)
  const preservedArchive = await JSZip.loadAsync(await readFile(preservationPath))
  const preservedProject = JSON.parse(await preservedArchive.file('project.json').async('string'))
  const preservedTarget = preservedProject.targets.find((target) => target.name === patchTarget.name)
  if (preservedTarget?.blocks[patchedBlockId]?.smokePatch !== 'preserved') {
    throw new Error('Preservation-edit patch was not applied to the requested raw block')
  }
  if (preservedTarget?.blocks[preservationProbeBlockId]?.smokeRemoveMe !== undefined) {
    throw new Error('Preservation-edit removeProperties operation did not remove the selected raw property')
  }
  const preservedNested = preservedTarget?.blocks[preservationProbeBlockId]?.smokeNested
  if (preservedNested?.keep !== 'updated' || Object.hasOwn(preservedNested, 'remove')) {
    throw new Error('Preservation-edit nested path operations did not update and remove the selected values')
  }
  for (const filename of Object.keys(downloadedArchive.files).filter((name) => name !== 'project.json')) {
    const originalBytes = await downloadedArchive.file(filename)?.async('uint8array')
    const preservedBytes = await preservedArchive.file(filename)?.async('uint8array')
    if (!originalBytes || !preservedBytes || Buffer.compare(originalBytes, preservedBytes) !== 0) {
      throw new Error(`Preservation edit changed an unrelated archive entry: ${filename}`)
    }
  }

  const unicodeRoundTripProject = structuredClone(downloadedProject)
  const unicodeRoundTripTarget = unicodeRoundTripProject.targets.find((target) =>
    Object.values(target.blocks).some((block) => block.opcode === 'looks_say'),
  )
  const unicodeRoundTripBlock =
    unicodeRoundTripTarget &&
    Object.entries(unicodeRoundTripTarget.blocks).find(([, block]) => block.opcode === 'looks_say')
  if (!unicodeRoundTripTarget || !unicodeRoundTripBlock) {
    throw new Error('Browser Unicode round-trip fixture has no looks_say block')
  }
  const unicodePayload = `large-text-雪-🚀-${'界😀<&/'.repeat(64 * 1024)}-終-<>&/"`
  unicodeRoundTripBlock[1].inputs = { MESSAGE: [1, [10, unicodePayload]] }
  const unicodeRoundTripArchive = await JSZip.loadAsync(await readFile(downloadPath))
  unicodeRoundTripArchive.file('project.json', new TextEncoder().encode(JSON.stringify(unicodeRoundTripProject)))
  const unicodeRoundTripBytes = await unicodeRoundTripArchive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })
  await page.locator('#sb3-file').setInputFiles({
    name: 'large-unicode-round-trip.sb3',
    mimeType: 'application/zip',
    buffer: unicodeRoundTripBytes,
  })
  await page.locator('#file-status').filter({ hasText: 'large-unicode-round-trip.sb3' }).waitFor()
  await page.locator('#file-status').filter({ hasText: '完成：' }).waitFor()
  const unicodeRoundTripCanonical = (await page.locator('#canonical-output').textContent()) ?? ''
  const parsedUnicodeCanonical = JSON.parse(unicodeRoundTripCanonical)
  const findUnicodePayload = (value) => {
    if (typeof value === 'string' && value.startsWith('large-text-雪-🚀-')) return value
    if (Array.isArray(value)) return value.map(findUnicodePayload).find(Boolean)
    if (value && typeof value === 'object') return Object.values(value).map(findUnicodePayload).find(Boolean)
    return undefined
  }
  const importedUnicodePayload = findUnicodePayload(parsedUnicodeCanonical)
  if (importedUnicodePayload !== unicodePayload) {
    throw new Error(
      `${browserName} browser import changed the large Unicode block-text payload (expected=${unicodePayload.length}, actual=${importedUnicodePayload?.length})`,
    )
  }

  const blockedEvalViolations = await page.evaluate(() =>
    (window.__cspViolations ?? []).filter((violation) => violation.blockedURI === 'eval'),
  )
  if (blockedEvalViolations.length > 0) {
    throw new Error(
      `${browserName} attempted eval under the production script CSP: ${JSON.stringify(blockedEvalViolations)}`,
    )
  }

  if (failures.length > 0) throw new Error(failures.join('\n'))

  const studentAccessibilityEvidence = {
    textContrastRatios: studentTextContrast,
    keyboardTabNavigation: {
      rightArrow: keyboardAnalyzeTab,
      leftArrow: keyboardGenerateTab,
    },
    mobileReflow: mobileLayout,
  }
  const result = {
    browser: browserName,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      browserVersion: browser.version(),
    },
    mixedResponseRepaired,
    mixedResponseProjectName: mixedResponseProject.name,
    repaired,
    validated,
    correctionLoop: 'failure → copied report/prompt → corrected response → VM compile → re-import/analysis',
    compileRepairRecoveryEvidence: {
      svgCorrectionLoop: {
        issueCode: 'compile-failed',
        issuePath: '/sprites/0/costumes/0',
        compileStage: 'svg-preflight',
        promptContainsIssueAndPath:
          typeof malformedSvgRepairPrompt === 'string' &&
          malformedSvgRepairPrompt.includes('compile-failed') &&
          malformedSvgRepairPrompt.includes('"/sprites/0/costumes/0"'),
        submittedCorrectedResponse: submittedSvgCorrection.sprites[0].costumes[0].data === validSvgData,
        recoveredDownload: Boolean(correctedSvgPath),
        reimportedSprites: correctedSvgSprites,
        reimportedAssetValid: correctedSvgAssetValid,
      },
      rasterCorrectionLoop: {
        issueCode: 'compile-failed',
        issuePath: '/sprites/0/costumes/0',
        compileStage: 'raster-preflight',
        promptContainsIssueAndPath:
          typeof malformedRasterRepairPrompt === 'string' &&
          malformedRasterRepairPrompt.includes('compile-failed') &&
          malformedRasterRepairPrompt.includes('"/sprites/0/costumes/0"'),
        submittedCorrectedResponse: submittedRasterCorrection.sprites[0].costumes[0].data === correctedRasterData,
        recoveredDownload: Boolean(correctedRasterPath),
        reimportedSprites: correctedRasterSprites,
        reimportedAssetValid: correctedRasterAssetValid,
      },
      audioCorrectionLoop: {
        issueCode: 'compile-failed',
        issuePath: '/stage/sounds/0',
        compileStage: 'audio-preflight',
        promptContainsIssueAndPath:
          typeof malformedAudioRepairPrompt === 'string' &&
          malformedAudioRepairPrompt.includes('compile-failed') &&
          malformedAudioRepairPrompt.includes('"/stage/sounds/0"'),
        submittedCorrectedResponse:
          submittedAudioCorrection.stage.sounds[0].data === correctedAudioProject.stage.sounds[0].data,
        recoveredDownload: Boolean(correctedAudioPath),
        reimportedSounds: correctedAudioSoundNames,
        reimportedAssetValid: correctedAudioAssetValid,
      },
    },
    schemaFailureCorrectionLoop: {
      issueCode: schemaNameIssue.code,
      issuePath: schemaNameIssue.path,
      recoveredDownload: true,
      reimportedSpriteName: schemaRecoverySpriteName,
    },
    schemaAdditionalPropertyCorrectionLoop: {
      issueCode: schemaAdditionalIssue.code,
      issuePath: schemaAdditionalIssue.path,
      reportedProperty: schemaAdditionalProperty,
      recoveredDownload: Boolean(schemaAdditionalPath),
      reimportedPropertyPresent: Object.hasOwn(schemaAdditionalCanonical, schemaAdditionalProperty),
    },
    schemaEnumCorrectionLoop: {
      issueCode: schemaEnumIssue.code,
      issuePath: schemaEnumIssue.path,
      reportedValue: schemaEnumIssue.actual,
      replacementValue: expectedRotationStyle,
      recoveredDownload: Boolean(schemaEnumPath),
      reimportedValue: reimportedRotationStyle,
    },
    schemaConstCorrectionLoop: {
      issueCode: schemaConstIssue.code,
      issuePath: schemaConstIssue.path,
      reportedValue: schemaConstIssue.actual,
      replacementValue: schemaConstIssue.example.replaceWith,
      recoveredDownload: Boolean(schemaConstPath),
      reimportedValue: schemaConstCanonical.stage.kind,
    },
    schemaRequiredCorrectionLoop: {
      issueCode: schemaRequiredIssue.code,
      issuePath: schemaRequiredIssue.path,
      expected: schemaRequiredIssue.expected,
      recoveredDownload: Boolean(schemaRequiredPath),
      reimportedInput: reimportedRequiredInput,
    },
    schemaMinLengthCorrectionLoop: {
      issueCode: schemaMinLengthIssue.code,
      issuePath: schemaMinLengthIssue.path,
      reportedValue: schemaMinLengthIssue.actual,
      replacementValue: schemaMinLengthReplacement,
      submittedProjectName: submittedSchemaMinLengthProject.name,
      recoveredDownload: Boolean(schemaMinLengthPath),
      reimportedSprites: schemaMinLengthReimportedSprites,
    },
    currentCostumeCorrectionLoop: {
      issueCode: invalidCostumeIndexIssue.code,
      issuePath: invalidCostumeIndexIssue.path,
      replacementIndex: suggestedCostumeIndex,
      recoveredDownload: Boolean(costumeRepairPath),
      reimportedIndex: costumeRepairCanonical.stage.currentCostume,
    },
    unknownSpriteCorrectionLoop: {
      issueCode: unknownSpriteIssue.code,
      issuePath: unknownSpriteIssue.path,
      reportedSprite: unknownSpriteIssue.actual.value,
      correctedSprite: originalSpriteMenuValue,
      recoveredDownload: Boolean(unknownSpritePath),
      reimportedSprites: unknownSpriteNames,
    },
    unknownVariableCorrectionLoop: {
      issueCode: unknownVariableIssue.code,
      issuePath: unknownVariableIssue.path,
      reportedName: unknownVariableIssue.actual,
      correctedName: originalVariableName,
      recoveredDownload: Boolean(unknownVariablePath),
      reimportedVariableName: unknownVariableCanonical.sprites[0].variables[0].name,
    },
    unknownBroadcastCorrectionLoop: {
      issueCode: unknownBroadcastIssue.code,
      issuePath: unknownBroadcastIssue.path,
      reportedName: unknownBroadcastIssue.actual,
      correctedName: unknownBroadcastName,
      recoveredDownload: Boolean(unknownBroadcastPath),
      reimportedBroadcastNames: unknownBroadcastCanonical.broadcasts.map((broadcast) => broadcast.name),
    },
    unknownListCorrectionLoop: {
      issueCode: unknownListIssue.code,
      issuePath: unknownListIssue.path,
      reportedName: unknownListIssue.actual,
      correctedName: unknownListName,
      recoveredDownload: Boolean(unknownListPath),
      reimportedListNames: unknownListCanonical.stage.lists.map((list) => list.name),
    },
    unknownProcedureCorrectionLoop: {
      issueCode: unknownProcedureIssue.code,
      issuePath: unknownProcedureIssue.path,
      reportedName: unknownProcedureName,
      correctedName: unknownProcedureName,
      recoveredDownload: Boolean(unknownProcedurePath),
      reimportedProcedureNames: unknownProcedureCanonical.sprites[0].procedures.map((procedure) => procedure.name),
    },
    unknownProcedureArgumentCorrectionLoop: {
      issueCode: unknownProcedureArgumentIssue.code,
      issuePath: unknownProcedureArgumentIssue.path,
      reportedName: unexpectedProcedureArgumentName,
      correctedName: knownProcedureName,
      recoveredDownload: Boolean(unknownProcedureArgumentPath),
      reimportedProcedureNames: unknownProcedureArgumentCanonical.sprites[0].procedures.map(
        (procedure) => procedure.name,
      ),
      reimportedCallInputs: Object.keys(reimportedProcedureCall.inputs ?? {}),
    },
    duplicateProcedureArgumentCorrectionLoop: {
      issueCode: duplicateProcedureArgumentIssue.code,
      issuePath: duplicateProcedureArgumentIssue.path,
      reportedName: duplicateProcedureArgumentIssue.actual,
      correctedName: 'amount',
      recoveredDownload: Boolean(duplicateProcedureArgumentPath),
      reimportedParameterNames,
    },
    platformValidated,
    generated,
    blockedEvalViolations,
    studentAccessibilityEvidence,
    strictCspRenderer: { policy: strictCspPolicy, ...strictCspRenderer },
    vmStagePreviewViewport: stagePreviewPixels,
    vmStagePreviewVisible: true,
    animatedPreview,
    officialDraggablePreview,
    officialEventHatPreview,
    extensionConsentSmoke,
    officialMultiCostumePreview,
    overlappingAudioPreview,
    soundWaitPreview,
    combinedAudioEffects,
    offlineReload,
    malformedAssetPreviews: {
      sounds: malformedSoundPreviewCount,
      costumes: malformedCostumePreviewCount,
      costumeStagePixels: malformedCostumeStageEvidence,
    },
    projectFileHandling: 'SB3 import and preview used same-origin reads only; no external or write network request',
    declaredOverLimitArchive: {
      declaredUncompressedBytes: overLimitArchive.declaredBytes,
      compressedArchiveBytes: overLimitArchive.archive.byteLength,
      importMs: Number(overLimitImportMs.toFixed(2)),
      rejectedBeforeDecompression: true,
    },
    ...(nearLimitImportResult === undefined ? {} : { nearLimitArchive: nearLimitImportResult }),
    svgRenderer: rendererResults,
    studentVisualResult,
    preservationEdit: preservationDownload.suggestedFilename(),
    unicodeBlockTextRoundTrip: { utf16CodeUnits: unicodePayload.length, exact: true },
    analyzed: importedStatus,
    browserImportAnalysisMs: Number(browserImportAnalysisMs.toFixed(1)),
    browserImportAnalysisBudgetMs,
    ...(retainedHeapGrowthBytes === undefined ? {} : { retainedHeapGrowthBytes }),
    ...(processTreePeakRss === undefined ? {} : { processTreeRssSumPeakBytes: processTreePeakRss.rssPeakBytes }),
    ...(processTreePeakRss === undefined ? {} : { processTreeRssSampleCount: processTreePeakRss.rssSamples }),
    ...(processTreePeakRss?.pssPeakBytes === undefined
      ? {}
      : { processTreePssSumPeakBytes: processTreePeakRss.pssPeakBytes }),
    ...(processTreePeakRss?.pssSamples === undefined
      ? {}
      : { processTreePssSampleCount: processTreePeakRss.pssSamples }),
    ...(retainedHeapGrowthBytes === undefined ? {} : { retainedHeapBudgetBytes: chromiumRetainedHeapBudgetBytes }),
    url: page.url(),
  }
  const resultDirectory = fileURLToPath(new URL('../test-results/', import.meta.url))
  await mkdir(resultDirectory, { recursive: true })
  await writeFile(
    resolve(resultDirectory, `browser-${browserName}.json`),
    `${JSON.stringify(
      {
        browser: browserName,
        runtime: {
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          browserVersion: browser.version(),
        },
        measured:
          'nested-path offline reload through a precached same-origin service worker; SB3 upload, VM decompile, Canonical conversion, and analysis for at least 2,000 blocks; exact large Unicode block-text round-trip; WCAG text contrast, ARIA tab keyboard navigation and focus visibility, 320 CSS-pixel mobile reflow, same-origin-only/no-write SB3 import preview; declared over-limit ZIP rejected before decompression; optional near-limit archive import; process-tree RSS sum sampled every 40 ms and PSS sum on Linux',
        blocks: importedBlockCount,
        studentAccessibilityEvidence,
        aiRepairRecoveryEvidence: {
          schemaFailureCorrectionLoop: result.schemaFailureCorrectionLoop,
          schemaAdditionalPropertyCorrectionLoop: result.schemaAdditionalPropertyCorrectionLoop,
          schemaEnumCorrectionLoop: result.schemaEnumCorrectionLoop,
          schemaConstCorrectionLoop: result.schemaConstCorrectionLoop,
          schemaRequiredCorrectionLoop: result.schemaRequiredCorrectionLoop,
          schemaMinLengthCorrectionLoop: result.schemaMinLengthCorrectionLoop,
          currentCostumeCorrectionLoop: result.currentCostumeCorrectionLoop,
          unknownSpriteCorrectionLoop: result.unknownSpriteCorrectionLoop,
          unknownVariableCorrectionLoop: result.unknownVariableCorrectionLoop,
          unknownBroadcastCorrectionLoop: result.unknownBroadcastCorrectionLoop,
          unknownListCorrectionLoop: result.unknownListCorrectionLoop,
          unknownProcedureCorrectionLoop: result.unknownProcedureCorrectionLoop,
          unknownProcedureArgumentCorrectionLoop: result.unknownProcedureArgumentCorrectionLoop,
          duplicateProcedureArgumentCorrectionLoop: result.duplicateProcedureArgumentCorrectionLoop,
        },
        compileRepairRecoveryEvidence: result.compileRepairRecoveryEvidence,
        unicodeBlockTextRoundTrip: { utf16CodeUnits: unicodePayload.length, exact: true },
        declaredOverLimitArchive: {
          declaredUncompressedBytes: overLimitArchive.declaredBytes,
          compressedArchiveBytes: overLimitArchive.archive.byteLength,
          importMs: Number(overLimitImportMs.toFixed(2)),
          rejectedBeforeDecompression: true,
        },
        malformedAssetPreviews: {
          sounds: malformedSoundPreviewCount,
          costumes: malformedCostumePreviewCount,
          costumeStagePixels: malformedCostumeStageEvidence,
        },
        officialDraggablePreview,
        officialEventHatPreview,
        combinedAudioEffects,
        offlineReload,
        projectFileHandling:
          'SB3 import and preview used same-origin reads only; no external or write network request',
        ...(nearLimitImportResult === undefined ? {} : { nearLimitArchive: nearLimitImportResult }),
        durationMs: Number(browserImportAnalysisMs.toFixed(1)),
        budgetMs: browserImportAnalysisBudgetMs,
        ...(retainedHeapGrowthBytes === undefined ? {} : { retainedHeapGrowthBytes }),
        ...(retainedHeapGrowthBytes === undefined
          ? {}
          : { retainedHeapBudgetBytes: chromiumRetainedHeapBudgetBytes }),
        ...(processTreePeakRss === undefined ? {} : { processTreeRssSumPeakBytes: processTreePeakRss.rssPeakBytes }),
        ...(processTreePeakRss === undefined ? {} : { processTreeRssSampleCount: processTreePeakRss.rssSamples }),
        ...(processTreePeakRss?.pssPeakBytes === undefined
          ? {}
          : { processTreePssSumPeakBytes: processTreePeakRss.pssPeakBytes }),
        ...(processTreePeakRss?.pssSamples === undefined
          ? {}
          : { processTreePssSampleCount: processTreePeakRss.pssSamples }),
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (page) {
    try {
      const violations = await page.evaluate(() => window.__cspViolations ?? [])
      if (violations.length > 0) failures.push(`CSP details: ${JSON.stringify(violations)}`)
    } catch {
      // Preserve the original browser failure if the page has already closed.
    }
  }
  throw new Error([message, ...failures].join('\n'), { cause: error })
} finally {
  await strictCspSvgPage?.close()
  await svgTestPage?.close()
  await stageFixturePage?.close()
  await browser?.close()
  await new Promise((resolveClosed, rejectClosed) => {
    server.close((error) => (error ? rejectClosed(error) : resolveClosed()))
  })
}
