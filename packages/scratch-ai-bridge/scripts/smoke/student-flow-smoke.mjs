/* global document -- serialized Playwright callback runs in the browser. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import JSZip from 'jszip'
import { chromium, firefox, webkit } from 'playwright'

const root = resolve('dist')
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  const path = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1))
  if (!path.startsWith(root + sep)) return response.writeHead(403).end()
  void readFile(path)
    .then((bytes) => {
      response
        .writeHead(200, {
          'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        })
        .end(bytes)
    })
    .catch(() => response.writeHead(404).end())
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Preview server did not provide a port')
const browserType = { chromium, firefox, webkit }[process.env.BROWSER ?? 'chromium']
if (!browserType) throw new Error('Unsupported browser')
const browser = await browserType.launch({ headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true })
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          globalThis.__studentCopied = text
        },
      },
    }),
  )
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })
  assert.deepEqual(await page.locator('#generate-panel button:visible').allTextContents(), [
    '打開我的作品',
    '從網址讀取',
    '複製製作訊息給 AI',
    '檢查並製作 Scratch',
  ])
  assert.equal(await page.locator('.student-share-panel').isVisible(), false)
  await page.locator('.teacher-share > summary').click()
  assert.equal(await page.locator('.student-share-panel').isVisible(), true)
  await page.locator('.teacher-share > summary').click()
  assert.equal(await page.locator('#student-ai-guide').isVisible(), false)
  await page.locator('#project-request').fill('小貓冒險')
  await page.locator('#copy-direct-instruction').click()
  await page.locator('#student-ai-guide').waitFor({ state: 'visible' })
  assert.ok((await page.evaluate(() => globalThis.__studentCopied)).includes('小貓冒險'))
  await page.locator('#student-ai-answer-ready').click()
  assert.equal(await page.locator('#json-editor').evaluate((element) => document.activeElement === element), true)
  await page.locator('.sample-workflow > summary').click()
  await page.locator('#load-sample').click()
  const original = await page.locator('#json-editor').inputValue()
  await page.locator('#json-editor').fill('{incomplete')
  await page.locator('#student-build').click()
  await page.locator('#repair-tools').waitFor({ state: 'visible' })
  await page.locator('#copy-repair-prompt').click()
  assert.ok((await page.evaluate(() => globalThis.__studentCopied)).includes('小貓冒險'))
  await page.locator('#json-editor').fill(original)
  const initialDownload = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await initialDownload
  await page.locator('#iteration-request').fill('跳高一點')
  await page.locator('#iteration-generate').click()
  const prompt = await page.evaluate(() => globalThis.__studentCopied)
  assert.ok(prompt.includes('跳高一點') && prompt.includes('Canonical IR'))
  const candidate = JSON.parse(original)
  candidate.name = '新版候選作品'
  candidate.sprites[0].x = 37
  await page.locator('#json-editor').fill(JSON.stringify(candidate))
  let downloaded = false
  page.on('download', () => {
    downloaded = true
  })
  await page.locator('#student-build').click()
  await page.locator('#accept-student-candidate').waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(downloaded, false, 'candidate must not download before the student accepts it')
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#accept-student-candidate').waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(JSON.parse(await page.locator('#json-editor').inputValue()).name, candidate.name)
  const stage = page.locator('#student-preview .student-preview-stage')
  const previewControls = page.locator('#student-preview .student-preview-controls')
  const controlsAboveStage = await previewControls.evaluate(
    (controls, stageElement) => {
      const controlsBox = controls.getBoundingClientRect()
      const stageBox = stageElement.getBoundingClientRect()
      return controlsBox.bottom <= stageBox.top
    },
    await stage.elementHandle(),
  )
  assert.equal(controlsAboveStage, true, 'green flag and stop controls must sit above the Scratch stage')
  const initialStop = page.locator('#student-preview .student-preview-controls .preview-control-stop')
  assert.equal(await initialStop.isVisible(), true, 'stop control must remain visible like Scratch')
  assert.equal(await initialStop.isDisabled(), true, 'stop control must be disabled before the preview starts')
  await page.locator('#student-preview .student-preview-actions button').filter({ hasText: '執行作品' }).click()
  await page.locator('#student-preview iframe.student-preview-animation').waitFor({ state: 'attached' })
  const stop = page.locator('#student-preview .student-preview-actions button').filter({ hasText: '停止預覽' })
  try {
    await stop.waitFor({ state: 'visible', timeout: 30000 })
  } catch {
    throw new Error(`Preview did not start: ${await page.locator('.student-preview-stage-status').textContent()}`)
  }
  await stop.click()
  await page.locator('#student-preview iframe.student-preview-animation').waitFor({ state: 'detached' })
  await page.locator('#discard-student-candidate').click()
  assert.equal(await page.locator('#json-editor').inputValue(), original)
  await page.locator('#iteration-generate').click()
  await page.locator('#json-editor').fill(JSON.stringify(candidate))
  await page.locator('#student-build').click()
  await page.locator('#accept-student-candidate').waitFor({ state: 'visible', timeout: 30000 })
  const acceptedDownload = page.waitForEvent('download')
  await page.locator('#accept-student-candidate').click()
  const file = await acceptedDownload
  assert.match(file.suggestedFilename(), /新版候選作品/)
  const zip = await JSZip.loadAsync(await readFile(await file.path()))
  const savedProject = JSON.parse(await zip.file('project.json').async('string'))
  assert.equal(savedProject.targets.find((target) => target.name === candidate.sprites[0].name)?.x, 37)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#iteration-card').waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(JSON.parse(await page.locator('#json-editor').inputValue()).name, candidate.name)
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('clipboard blocked')
        },
      },
    }),
  )
  await page.locator('#iteration-generate').click()
  await page.locator('#clipboard-fallback').waitFor({ state: 'visible' })
  assert.ok((await page.locator('#clipboard-fallback-text').inputValue()).includes('跳高一點'))
  const storageDenied = await browser.newPage()
  try {
    await storageDenied.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'setItem', {
        configurable: true,
        value: () => {
          throw new Error('storage blocked')
        },
      })
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    })
    await storageDenied.goto('http://127.0.0.1:' + address.port + '/', { waitUntil: 'networkidle' })
    await storageDenied.locator('#project-request').fill('小貓冒險')
    assert.match(await storageDenied.locator('#student-draft-status').textContent(), /無法暫存/)
    await storageDenied.locator('#copy-direct-instruction').click()
    await storageDenied.locator('#advanced-tools[open]').waitFor({ state: 'visible' })
    assert.ok((await storageDenied.locator('#instruction').inputValue()).includes('小貓冒險'))
  } finally {
    await storageDenied.close()
  }
  console.log('PASS: candidate preview, discard, acceptance, reload and storage failure')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
