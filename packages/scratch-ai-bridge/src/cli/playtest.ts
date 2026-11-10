import { randomUUID } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Frame, type Page } from 'playwright'
import { preview, type PreviewServer } from 'vite'
import {
  changedVariableNames,
  controlMovement,
  snapshotsChanged,
  type PlaytestControl as SharedPlaytestControl,
  type PlaytestSnapshot,
} from '../core/playtest/feedback'

export type PlaytestControl = SharedPlaytestControl

export interface PlaytestPlan {
  readonly controls: readonly PlaytestControl[]
  /** Click visible sprites during free play instead of (or in addition to) pressing keys. */
  readonly clicks?: boolean
  readonly idleMs?: number
  readonly holdMs?: number
  readonly playMs?: number
}

export interface PlaytestControlResult {
  readonly key: string
  readonly expected: string
  readonly moved: boolean
  /** Sprite whose position changed the most along the expected axis and direction. */
  readonly sprite?: string
  readonly delta: number
}

export interface PlaytestResult {
  readonly ready: boolean
  readonly error?: string
  readonly pageErrors: readonly string[]
  /** Something on stage changed with no input during the idle window (pixels, sprite state or variables). */
  readonly autonomousMotion: boolean
  readonly controls: readonly PlaytestControlResult[]
  /** Variables whose value changed between the start and the end of free play. */
  readonly changedVariables: readonly string[]
  /** State capture failed (for example duplicate sprite names); motion checks then rely on pixels only. */
  readonly stateUnavailable?: string
}

export interface PreviewMessage {
  readonly type: string
  readonly detail?: string
  readonly requestId?: string
  readonly ok?: boolean
  readonly error?: string
  readonly snapshot?: PlaytestSnapshot['variables']
  readonly targets?: (PlaytestSnapshot['sprites'][number] & { isStage: boolean })[]
}

type Snapshot = PlaytestSnapshot

export interface OpenPreview {
  readonly token: string
  readonly frame: Frame
  readonly waitFor: (match: (message: PreviewMessage) => boolean, timeout: number) => Promise<PreviewMessage>
}

const MOVE_THRESHOLD = 4

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Drives compiled SB3 files in the real Scratch renderer preview (dist/preview.html) with headless Chromium and
 * reports observable behavior. One runner reuses a single preview server and browser across many projects.
 */
export class PlaytestRunner {
  private readonly server: PreviewServer
  private readonly browser: Browser
  private readonly baseUrl: string

  private constructor(server: PreviewServer, browser: Browser, baseUrl: string) {
    this.server = server
    this.browser = browser
    this.baseUrl = baseUrl
  }

  static async create(): Promise<PlaytestRunner> {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    try {
      await access(path.join(packageRoot, 'dist', 'preview.html'))
    } catch {
      throw new Error(
        'Built renderer preview is missing; run `npm run build --workspace=@scratch/scratch-ai-bridge` first.',
      )
    }
    const server = await preview({
      root: packageRoot,
      configFile: path.join(packageRoot, 'vite.config.ts'),
      logLevel: 'error',
      preview: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Vite preview server did not bind to a TCP port')
    const browser = await chromium.launch({ headless: true })
    return new PlaytestRunner(server, browser, `http://127.0.0.1:${address.port}`)
  }

  async close(): Promise<void> {
    await this.browser.close()
    await new Promise<void>((resolve) => this.server.httpServer.close(() => resolve()))
  }

  async run(archive: Uint8Array, plan: PlaytestPlan, screenshotPath?: string): Promise<PlaytestResult> {
    const page = await this.browser.newPage({ viewport: { width: 480, height: 360 } })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 300)))
    try {
      return await this.drive(page, archive, plan, pageErrors, screenshotPath)
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        pageErrors,
        autonomousMotion: false,
        controls: [],
        changedVariables: [],
      }
    } finally {
      await page.close()
    }
  }

  /**
   * Loads an SB3 into the isolated preview page and resolves once Scratch reports it ready.
   * @param page - Page to host the preview iframe.
   * @param archive - Compiled SB3 bytes.
   * @returns The preview frame and message helpers, or the preview's start-up error.
   */
  async openPreview(page: Page, archive: Uint8Array): Promise<OpenPreview | { readonly error: string }> {
    const token = randomUUID()
    await page.setContent('<style>body{margin:0}iframe{border:0;display:block}</style><main id="host"></main>')
    await page.evaluate(() => {
      const messages: unknown[] = []
      Object.assign(window, { __messages: messages })
      window.addEventListener('message', (event) => {
        if (event.source === document.querySelector('iframe')?.contentWindow) messages.push(event.data)
      })
    })
    await page.evaluate((url) => {
      const frame = document.createElement('iframe')
      frame.width = '480'
      frame.height = '360'
      frame.src = url
      document.querySelector('#host')?.append(frame)
    }, `${this.baseUrl}/preview.html?token=${token}`)

    const messages = (): Promise<PreviewMessage[]> =>
      page.evaluate(() => (window as unknown as { __messages: PreviewMessage[] }).__messages)
    const waitFor = async (match: (message: PreviewMessage) => boolean, timeout: number): Promise<PreviewMessage> => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const found = (await messages()).find(match)
        if (found) return found
        await sleep(50)
      }
      throw new Error('Timed out waiting for the Scratch preview')
    }

    await waitFor(({ type }) => type === 'loaded', 30_000)
    await page.evaluate(
      ({ base64, token }) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        document
          .querySelector('iframe')
          ?.contentWindow?.postMessage({ type: 'start-preview', token, archive: new Blob([bytes]) }, '*')
      },
      { base64: Buffer.from(archive).toString('base64'), token },
    )
    const started = await waitFor(({ type }) => type === 'ready' || type === 'error', 60_000)
    if (started.type === 'error') return { error: (started.detail ?? 'preview error').slice(0, 500) }

    const frame = page.frames().find((candidate) => candidate.url().includes('/preview.html'))
    if (!frame) throw new Error('Scratch preview frame did not load')
    return { token, frame, waitFor }
  }

  /**
   * Opens a fresh page for callers that drive the preview themselves (for example spec scenarios).
   * @returns A stage-sized page in the runner's browser.
   */
  newPage(): Promise<Page> {
    return this.browser.newPage({ viewport: { width: 480, height: 360 } })
  }

  private async drive(
    page: Page,
    archive: Uint8Array,
    plan: PlaytestPlan,
    pageErrors: string[],
    screenshotPath?: string,
  ): Promise<PlaytestResult> {
    const opened = await this.openPreview(page, archive)
    if ('error' in opened) {
      return {
        ready: false,
        error: opened.error,
        pageErrors,
        autonomousMotion: false,
        controls: [],
        changedVariables: [],
      }
    }
    const { token, frame, waitFor } = opened
    const canvas = frame.locator('#stage')

    let stateUnavailable: string | undefined
    const capture = async (): Promise<Snapshot | undefined> => {
      const requestId = randomUUID()
      await page.evaluate(
        ({ token, requestId }) =>
          document
            .querySelector('iframe')
            ?.contentWindow?.postMessage({ type: 'capture-game-progress', token, requestId, baseRevision: 0 }, '*'),
        { token, requestId },
      )
      const result = await waitFor(
        (message) => message.type === 'game-progress-result' && message.requestId === requestId,
        5_000,
      )
      if (!result.ok) {
        stateUnavailable = result.error ?? 'capture failed'
        return undefined
      }
      return {
        sprites: (result.targets ?? []).filter((target) => !target.isStage),
        variables: result.snapshot ?? [],
      }
    }
    const key = (name: string, isDown: boolean): Promise<void> =>
      frame.evaluate(
        ({ name, isDown }) => {
          document.dispatchEvent(new KeyboardEvent(isDown ? 'keydown' : 'keyup', { key: name }))
        },
        { name, isDown },
      )

    const idleMs = plan.idleMs ?? 1500
    const holdMs = plan.holdMs ?? 600
    const playMs = plan.playMs ?? 8000

    const pixelsBefore = await canvas.screenshot()
    const start = await capture()
    await sleep(idleMs)
    const pixelsAfter = await canvas.screenshot()
    const afterIdle = await capture()
    const autonomousMotion = !pixelsBefore.equals(pixelsAfter) || snapshotsChanged(start, afterIdle)

    const controls: PlaytestControlResult[] = []
    for (const control of plan.controls) {
      const before = await capture()
      await key(control.key, true)
      await sleep(holdMs)
      const after = await capture()
      await key(control.key, false)
      controls.push(controlMovement(before, after, control, MOVE_THRESHOLD))
    }

    await this.freePlay(page, plan, playMs, key, capture)
    const end = await capture()
    const changedVariables = changedVariableNames(start, end)

    if (screenshotPath) await writeFile(screenshotPath, await canvas.screenshot())

    return {
      ready: true,
      pageErrors,
      autonomousMotion,
      controls,
      changedVariables,
      ...(stateUnavailable ? { stateUnavailable } : {}),
    }
  }

  private async freePlay(
    page: Page,
    plan: PlaytestPlan,
    playMs: number,
    key: (name: string, isDown: boolean) => Promise<void>,
    capture: () => Promise<Snapshot | undefined>,
  ): Promise<void> {
    const deadline = Date.now() + playMs
    let step = 0
    while (Date.now() < deadline) {
      const hasControls = plan.controls.length > 0
      if (hasControls) {
        const control = plan.controls[step % plan.controls.length]
        await key(control.key, true)
        await sleep(250)
        await key(control.key, false)
      }
      if (plan.clicks === true) {
        const snapshot = await capture()
        const targets = (snapshot?.sprites ?? []).filter(
          ({ visible, x, y }) => visible && Math.abs(x) <= 240 && Math.abs(y) <= 180,
        )
        // Click visible sprites in turn; with none visible, sweep the stage.
        const target = targets.length > 0 ? targets[step % targets.length] : undefined
        const x = target === undefined ? 40 + ((step * 97) % 400) : target.x + 240
        const y = target === undefined ? 40 + ((step * 61) % 280) : 180 - target.y
        await page.mouse.click(x, y)
        await sleep(150)
      }
      if (!hasControls && plan.clicks !== true) await sleep(250)
      step += 1
    }
  }
}
