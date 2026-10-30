import { access, link, mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

/** Load an SB3 through the same isolated Scratch renderer page used by the app and capture its canvas. */
export const captureRendererPreview = async (
  archive: Uint8Array,
  outputPath: string,
  overwrite = false,
): Promise<Record<string, unknown>> => {
  const absoluteOutput = path.resolve(outputPath)
  const temporaryOutput = `${absoluteOutput}.${process.pid}.${randomUUID()}.tmp.png`
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  await mkdir(path.dirname(absoluteOutput), { recursive: true })
  try {
    await access(path.join(packageRoot, 'dist', 'preview.html'))
  } catch {
    throw new Error('Built renderer preview is missing; run `npm run build --workspace=@scratch/scratch-ai-bridge` first.')
  }
  const configFile = path.join(packageRoot, 'vite.config.ts')
  const server = await preview({
    root: packageRoot,
    configFile,
    logLevel: 'error',
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite preview server did not bind to a TCP port')
    const token = randomUUID()
    const pageUrl = `http://127.0.0.1:${address.port}/preview.html?token=${token}`
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage({ viewport: { width: 480, height: 360 } })
    const browserErrors: string[] = []
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('requestfailed', (request) => browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`))
    await page.setContent('<main id="preview-host"></main>')
    await page.evaluate(() => {
      const messages: unknown[] = []
      Object.assign(window, { __scratchPreviewMessages: messages })
      window.addEventListener('message', (event) => {
        if (event.source === document.querySelector('iframe')?.contentWindow && typeof event.data?.type === 'string') {
          messages.push(event.data)
        }
      })
    })
    await page.evaluate((url) => {
      const frame = document.createElement('iframe')
      frame.id = 'scratch-preview'
      frame.width = '480'
      frame.height = '360'
      frame.src = url
      document.querySelector('#preview-host')?.append(frame)
    }, pageUrl)
    try {
      await page.waitForFunction(() => {
        const messages = (window as Window & { __scratchPreviewMessages?: { type: string }[] }).__scratchPreviewMessages ?? []
        return messages.some(({ type }) => type === 'loaded')
      }, undefined, { timeout: 30_000 })
    } catch {
      const frames = page.frames().map((frame) => frame.url())
      throw new Error(`Scratch preview page did not announce loaded. Frames=${JSON.stringify(frames)} BrowserErrors=${browserErrors.join(' | ')}`)
    }
    const base64 = Buffer.from(archive).toString('base64')
    await page.evaluate(({ base64, token }) => {
      const frame = document.querySelector<HTMLIFrameElement>('#scratch-preview')
      if (!frame?.contentWindow) throw new Error('Scratch preview iframe is unavailable')
      const binary = atob(base64)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      frame.contentWindow.postMessage({ type: 'start-preview', token, archive: new Blob([bytes], { type: 'application/zip' }) }, '*')
    }, { base64, token })
    await page.waitForFunction(() => {
      const messages = (window as Window & { __scratchPreviewMessages?: { type: string; detail?: string }[] }).__scratchPreviewMessages ?? []
      return messages.some(({ type }) => type === 'ready' || type === 'error')
    }, undefined, { timeout: 45_000 })
    const messages = await page.evaluate(() => (window as Window & { __scratchPreviewMessages?: { type: string; detail?: string }[] }).__scratchPreviewMessages ?? [])
    const failure = messages.find(({ type }) => type === 'error')
    if (failure) throw new Error(`Scratch renderer preview failed: ${failure.detail ?? 'unknown preview error'}`)
    const frame = page.frame({ url: /\/preview\.html\?/ })
    if (!frame) throw new Error('Scratch preview frame did not load')
    const canvas = frame.locator('#stage')
    const dimensions = await canvas.evaluate((element) => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }))
    if (dimensions.width !== 480 || dimensions.height !== 360) throw new Error(`Unexpected Scratch stage size ${dimensions.width}x${dimensions.height}`)
    await canvas.screenshot({ path: temporaryOutput, timeout: 10_000 })
    if (overwrite) await rename(temporaryOutput, absoluteOutput)
    else {
      await link(temporaryOutput, absoluteOutput)
      await unlink(temporaryOutput)
    }
    return { path: absoluteOutput, width: dimensions.width, height: dimensions.height, renderer: 'scratch-render', previewReady: true }
  } finally {
    await unlink(temporaryOutput).catch(() => undefined)
    await browser?.close()
    await server.close()
  }
}
