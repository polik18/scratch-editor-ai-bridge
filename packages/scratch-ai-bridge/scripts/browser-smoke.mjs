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

  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`)
  })

  await page.goto(`http://127.0.0.1:${address.port}${sitePrefix}`, { waitUntil: 'networkidle' })

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
  await page.locator('#compile').click()
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
