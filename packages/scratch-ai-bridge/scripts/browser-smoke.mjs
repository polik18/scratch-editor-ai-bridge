import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const sitePrefix = '/scratch-editor-ai-bridge/'
const distRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
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

const server = createServer((request, response) => {
  void (async () => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (!requestUrl.pathname.startsWith(sitePrefix)) {
        response.writeHead(404).end('Not found')
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
const failures = []
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
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
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`)
  })

  await page.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })

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

  await page.locator('#advanced-tools summary').click()

  await page.locator('#json-editor').fill(await readFile(geminiMixedResponsePath, 'utf8'))
  await page.locator('#repair').click()
  await page.locator('#generate-status[data-kind="ok"], #generate-status[data-kind="error"]').waitFor()
  const mixedResponseRepaired = (await page.locator('#generate-status').textContent())?.trim()
  if ((await page.locator('#generate-status').getAttribute('data-kind')) === 'error') {
    throw new Error(`Mixed AI response repair failed: ${mixedResponseRepaired}`)
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

  await page.locator('#load-sample').click()
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
    throw new Error([`Generation failed: ${generated}`, ...failures].join('\n'))
  }

  const download = await downloadPromise
  if (download instanceof Error) throw download

  const downloadPath = await download.path()
  if (!downloadPath) throw new Error('Chromium did not expose the generated SB3 path')

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
  await page.locator('#sb3-file').setInputFiles(downloadPath)
  await page.locator('#file-status').filter({ hasText: '完成：' }).waitFor()

  const canonicalOutput = (await page.locator('#canonical-output').textContent()) ?? ''
  if (!canonicalOutput.includes('event_whenkeypressed') || !canonicalOutput.includes('TOUCHINGOBJECTMENU')) {
    throw new Error('Re-imported platformer is missing keyboard or collision blocks')
  }
  if (canonicalOutput.includes('sensing_touchingobjectmenu') || canonicalOutput.includes('looks_costume')) {
    throw new Error('Scratch menu shadows leaked into AI-facing Canonical IR')
  }

  if (failures.length > 0) throw new Error(failures.join('\n'))

  const result = {
    mixedResponseRepaired,
    repaired,
    validated,
    platformValidated,
    generated,
    analyzed: (await page.locator('#file-status').textContent())?.trim(),
    url: page.url(),
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error([message, ...failures].join('\n'), { cause: error })
} finally {
  await browser?.close()
  await new Promise((resolveClosed, rejectClosed) => {
    server.close((error) => (error ? rejectClosed(error) : resolveClosed()))
  })
}
