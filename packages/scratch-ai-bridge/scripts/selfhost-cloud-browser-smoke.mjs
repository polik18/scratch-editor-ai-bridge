import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { chromium } from 'playwright'
import { decryptProgressSave } from '../src/core/progress/encryption.ts'
import { ProgressSyncServer } from '../src/progress-sync/server.ts'
import { EncryptedSaveStore } from '../src/progress-sync/store.ts'

const token = 'a'.repeat(64)
const password = 'correct horse battery staple'
const fixture = fileURLToPath(new URL('../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url))
const zip = await JSZip.loadAsync(await readFile(fixture))
const project = JSON.parse(await zip.file('project.json').async('string'))
const stage = project.targets.find((target) => target.isStage)
stage.variables.cloudTest = ['☁ cloudTest', 0, true]
stage.variables.cloudMirror = ['mirror', 0]
stage.blocks.cloudHat = {
  opcode: 'event_whenflagclicked',
  next: 'cloudWait',
  parent: null,
  inputs: {},
  fields: {},
  shadow: false,
  topLevel: true,
  x: 20,
  y: 20,
}
stage.blocks.cloudWait = {
  opcode: 'control_wait',
  next: 'cloudSet',
  parent: 'cloudHat',
  inputs: { DURATION: [1, [4, '4']] },
  fields: {},
  shadow: false,
  topLevel: false,
}
stage.blocks.cloudSet = {
  opcode: 'data_setvariableto',
  next: null,
  parent: 'cloudWait',
  inputs: { VALUE: [1, [4, '17']] },
  fields: { VARIABLE: ['☁ cloudTest', 'cloudTest'] },
  shadow: false,
  topLevel: false,
}
stage.blocks.mirrorHat = {
  opcode: 'event_whenflagclicked',
  next: 'mirrorForever',
  parent: null,
  inputs: {},
  fields: {},
  shadow: false,
  topLevel: true,
  x: 20,
  y: 140,
}
stage.blocks.mirrorForever = {
  opcode: 'control_forever',
  next: null,
  parent: 'mirrorHat',
  inputs: { SUBSTACK: [2, 'mirrorSet'] },
  fields: {},
  shadow: false,
  topLevel: false,
}
stage.blocks.mirrorSet = {
  opcode: 'data_setvariableto',
  next: null,
  parent: 'mirrorForever',
  inputs: { VALUE: [3, 'cloudReporter', [4, '0']] },
  fields: { VARIABLE: ['mirror', 'cloudMirror'] },
  shadow: false,
  topLevel: false,
}
stage.blocks.cloudReporter = {
  opcode: 'data_variable',
  next: null,
  parent: 'mirrorSet',
  inputs: {},
  fields: { VARIABLE: ['☁ cloudTest', 'cloudTest'] },
  shadow: false,
  topLevel: false,
}
zip.file('project.json', JSON.stringify(project))
const input = {
  name: 'cloud.sb3',
  mimeType: 'application/zip',
  buffer: await zip.generateAsync({ type: 'nodebuffer' }),
}
const root = await mkdtemp(join(tmpdir(), 'bridge-cloud-browser-'))
const store = new EncryptedSaveStore(root)
await store.start()
const server = new ProgressSyncServer(store, token, ['http://127.0.0.1:5178'])
const port = await server.listen(0)
// Headless Chromium cannot answer the local-network permission prompt.
const browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] })
try {
  const open = async (write, delayInitialRead = false) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    if (delayInitialRead) {
      let delayed = false
      await page.route(`http://127.0.0.1:${port}/v1/saves/**`, async (route) => {
        if (!delayed && route.request().method() === 'GET') {
          delayed = true
          await new Promise((resolve) => setTimeout(resolve, 5000))
        }
        await route.continue()
      })
    }
    await page.route('http://127.0.0.1:5178/**', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
    })
    await page.goto('http://127.0.0.1:5178/')
    await page.locator('button[data-tab="analyze"]').click()
    await page.locator('#sb3-file').setInputFiles(input)
    await page.waitForFunction(
      () => document.querySelector('#file-status')?.getAttribute('data-kind') === 'ok',
      null,
      { timeout: 30000 },
    )
    await page.locator('#preview-imported-project').click()
    await page.locator('#student-preview .student-preview-actions button').filter({ hasText: '執行作品' }).click()
    await page.waitForFunction(
      () => document.querySelector('.student-preview-stage-status')?.textContent?.includes('動畫執行中'),
      null,
      { timeout: 30000 },
    )
    const progress = page.locator('#student-preview details').filter({ hasText: '本機遊戲進度' })
    await progress.locator(':scope > summary').click()
    await progress.locator(':scope > label input[type=password]').fill(password)
    const sync = progress.locator('details').filter({ hasText: '自架跨裝置同步' })
    await sync.locator('summary').click()
    await sync.locator('#progress-sync-url').fill(`http://127.0.0.1:${port}`)
    await sync.locator('#progress-sync-token').fill(token)
    if (write) await sync.getByLabel('允許此遊戲寫入自架雲端變數').check()
    await sync.getByRole('button', { name: '連接自架雲端變數', exact: true }).click()
    await sync.getByRole('status').filter({ hasText: '自架雲端變數已連線' }).waitFor({ timeout: 30000 })
    return { page, sync }
  }
  const capture = (page) =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const frame = document.querySelector('#student-preview iframe.student-preview-animation')
          const frameToken = new URL(frame.src).searchParams.get('token')
          const requestId = crypto.randomUUID()
          const timer = setTimeout(() => reject(new Error('capture timed out')), 5000)
          const listener = (event) => {
            if (event.source !== frame.contentWindow || event.data?.requestId !== requestId) return
            window.removeEventListener('message', listener)
            clearTimeout(timer)
            if (!event.data.ok) return reject(new Error(event.data.error))
            resolve(event.data.snapshot)
          }
          window.addEventListener('message', listener)
          frame.contentWindow.postMessage(
            { type: 'capture-game-progress', token: frameToken, requestId, baseRevision: 0 },
            '*',
          )
        }),
    )
  const first = await open(true, true)
  await first.sync.getByRole('status').filter({ hasText: '已送出' }).waitFor({ timeout: 20000 })
  const dir = join(root, 'scratch-ai-bridge-sync-v1')
  const storedName = (await readdir(dir)).find((name) => name.endsWith('.json'))
  const stored = await readFile(join(dir, storedName), 'utf8')
  if (stored.includes('cloudTest') || stored.includes(password) || stored.includes(token))
    throw new Error('server retained cloud plaintext or credentials')
  const decoded = await decryptProgressSave(JSON.parse(stored), password)
  if (decoded.name !== '☁ cloudTest' || String(decoded.value) !== '17')
    throw new Error('real Scratch script did not send its cloud value')
  const second = await open(false)
  let mirror
  for (let i = 0; i < 100; i += 1) {
    mirror = (await capture(second.page)).find((entry) => entry.id === 'cloudMirror')?.value
    if (String(mirror) === '17') break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (String(mirror) !== '17') throw new Error('second game did not receive the encrypted cloud value')
  const frame = second.page.frameLocator('#student-preview iframe.student-preview-animation')
  await frame.locator('#stage').evaluate((_, projectId) => {
    const frameToken = new URL(location.href).searchParams.get('token')
    parent.postMessage(
      {
        type: 'selfhosted-cloud-write',
        token: frameToken,
        baseRevision: 0,
        projectId,
        name: '☁ cloudTest',
        value: 99,
      },
      '*',
    )
  }, decoded.projectRevision)
  await second.page.waitForTimeout(500)
  if ((await readFile(join(dir, storedName), 'utf8')) !== stored) throw new Error('read-only game was able to write')
  await first.sync.getByRole('button', { name: '中斷自架雲端變數' }).click()
  await first.sync.getByRole('status').filter({ hasText: '已中斷' }).waitFor()
  await first.page
    .frameLocator('#student-preview iframe.student-preview-animation')
    .locator('#stage')
    .evaluate((_, projectId) => {
      const frameToken = new URL(location.href).searchParams.get('token')
      parent.postMessage(
        {
          type: 'selfhosted-cloud-write',
          token: frameToken,
          baseRevision: 0,
          projectId,
          name: '☁ cloudTest',
          value: 55,
        },
        '*',
      )
    }, decoded.projectRevision)
  await first.page.waitForTimeout(500)
  if ((await readFile(join(dir, storedName), 'utf8')) !== stored)
    throw new Error('disconnected game was able to write')
  console.log('Self-hosted cloud variable browser smoke passed')
} finally {
  await browser.close()
  await server.close()
  await rm(root, { recursive: true, force: true })
}
