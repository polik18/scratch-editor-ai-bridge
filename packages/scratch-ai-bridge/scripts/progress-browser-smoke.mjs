import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { chromium } from 'playwright'

const fixture = fileURLToPath(new URL('../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url))
const zip = await JSZip.loadAsync(await readFile(fixture))
const project = JSON.parse(await zip.file('project.json').async('string'))
const sprite = project.targets.find((target) => target.name === 'Sprite1')
sprite.variables.progressTest = ['progressTest', 3]
sprite.blocks.progressHat = {
  opcode: 'event_whenkeypressed',
  next: 'progressSet',
  parent: null,
  inputs: {},
  fields: { KEY_OPTION: ['space', null] },
  shadow: false,
  topLevel: true,
  x: 20,
  y: 20,
}
sprite.blocks.progressSet = {
  opcode: 'data_setvariableto',
  next: null,
  parent: 'progressHat',
  inputs: { VALUE: [1, [4, '12']] },
  fields: { VARIABLE: ['progressTest', 'progressTest'] },
  shadow: false,
  topLevel: false,
}
zip.file('project.json', JSON.stringify(project))
const input = {
  name: 'progress.sb3',
  mimeType: 'application/zip',
  buffer: await zip.generateAsync({ type: 'nodebuffer' }),
}
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('http://127.0.0.1:5178/**', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
  })
  const open = async () => {
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
    const panel = page.locator('#student-preview details').filter({ hasText: '本機遊戲進度' })
    await panel.locator(':scope > summary').click()
    return panel
  }
  const exchange = (type, snapshot, targetSnapshot) =>
    page.evaluate(
      ({ type, snapshot, targetSnapshot }) =>
        new Promise((resolve, reject) => {
          const frame = document.querySelector('#student-preview iframe.student-preview-animation')
          const token = new URL(frame.src).searchParams.get('token')
          const requestId = crypto.randomUUID()
          const timer = setTimeout(() => reject(new Error('progress request timed out')), 5000)
          const listener = (event) => {
            if (event.source !== frame.contentWindow || event.data?.requestId !== requestId) return
            window.removeEventListener('message', listener)
            clearTimeout(timer)
            if (!event.data.ok) return reject(new Error(event.data.error))
            resolve(event.data)
          }
          window.addEventListener('message', listener)
          frame.contentWindow.postMessage({ type, token, requestId, baseRevision: 0, snapshot, targetSnapshot }, '*')
        }),
      { type, snapshot, targetSnapshot },
    )
  const captureAll = () => exchange('capture-game-progress')
  const capture = async () => (await captureAll()).snapshot
  const readScore = async () => (await capture()).find((item) => item.id === 'progressTest')?.value
  const changeScore = async () => {
    const snapshot = await capture()
    await exchange(
      'restore-game-progress',
      snapshot.map((item) => (item.id === 'progressTest' ? { ...item, value: 12 } : item)),
    )
  }
  let panel = await open()
  if ((await readScore()) !== 3) throw new Error('initial variable not loaded')
  await panel.getByRole('button', { name: '儲存進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已儲存' }).waitFor()
  const current = await captureAll()
  const beforeX = current.targets.find((target) => target.name === 'Sprite1').x
  await exchange(
    'restore-game-progress',
    current.snapshot,
    current.targets.map((target) => (target.name === 'Sprite1' ? { ...target, x: 42 } : target)),
  )
  if ((await captureAll()).targets.find((target) => target.name === 'Sprite1').x !== 42)
    throw new Error('target state did not change')
  await changeScore()
  if ((await readScore()) !== 12) throw new Error('game did not update variable')
  await panel.getByRole('button', { name: '讀取進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已讀取' }).waitFor()
  if ((await readScore()) !== 3) throw new Error('saved variable was not restored')
  if ((await captureAll()).targets.find((target) => target.name === 'Sprite1').x !== beforeX)
    throw new Error('target state was not restored')
  panel = await open()
  await changeScore()
  await panel.getByRole('button', { name: '讀取進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已讀取' }).waitFor()
  if ((await readScore()) !== 3) throw new Error('saved variable did not persist after page reload')
  const exported = page.waitForEvent('download')
  await panel.getByRole('button', { name: '匯出存檔' }).click()
  const saveBytes = await readFile(await (await exported).path())
  page.once('dialog', (dialog) => dialog.accept())
  await panel.getByRole('button', { name: '刪除存檔' }).click()
  await panel.getByRole('status').filter({ hasText: '已刪除' }).waitFor()
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'save.json', mimeType: 'application/json', buffer: saveBytes })
  await panel.getByRole('status').filter({ hasText: '已匯入' }).waitFor()
  await changeScore()
  await panel.getByRole('button', { name: '讀取進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已讀取' }).waitFor()
  if ((await readScore()) !== 3) throw new Error('imported save was not restored')
  const password = panel.locator(':scope > label input[type=password]')
  await password.fill('correct horse battery staple')
  const encryptedDownload = page.waitForEvent('download')
  await panel.getByRole('button', { name: '匯出存檔' }).click()
  const encryptedBytes = await readFile(await (await encryptedDownload).path())
  if (encryptedBytes.toString().includes('progressTest')) throw new Error('encrypted save exposed plaintext')
  await panel.locator(':scope > label input[type=text]').fill('加密進度')
  await password.fill('wrong horse battery staple')
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'encrypted.json', mimeType: 'application/json', buffer: encryptedBytes })
  await panel.getByRole('status').filter({ hasText: '密碼錯誤' }).waitFor()
  await password.fill('correct horse battery staple')
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'encrypted.json', mimeType: 'application/json', buffer: encryptedBytes })
  await panel.getByRole('status').filter({ hasText: '已匯入' }).waitFor()
  await changeScore()
  await panel.getByRole('button', { name: '讀取進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已讀取' }).waitFor()
  if ((await readScore()) !== 3) throw new Error('encrypted save was not restored')
  await password.fill('')
  const wrong = JSON.parse(saveBytes.toString())
  wrong.projectRevision = `sha256:${'0'.repeat(64)}`
  const invalid = structuredClone(wrong)
  invalid.variables[0].id = 'missing-id'
  await panel.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalid)),
  })
  await panel.getByRole('status').filter({ hasText: 'does not match' }).waitFor()
  await panel.locator(':scope > label input[type=text]').fill('跨版本進度')
  page.once('dialog', (dialog) => dialog.dismiss())
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrong)) })
  await panel.getByRole('status').filter({ hasText: '已取消跨版本匯入' }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrong)) })
  await panel.getByRole('status').filter({ hasText: '已匯入' }).waitFor()
  await changeScore()
  await panel.getByRole('button', { name: '讀取進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已讀取' }).waitFor()
  if ((await readScore()) !== 3) throw new Error('rebound save was not restored')
  const canonical = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../src/core/ir/examples/06-platformer-core.json', import.meta.url)),
      'utf8',
    ),
  )
  canonical.stage.variables.push({ name: 'saveTest', value: 3 })
  const openCanonical = async () => {
    await page.goto('http://127.0.0.1:5178/')
    await page.locator('#json-editor').fill(JSON.stringify(canonical))
    await page.locator('#student-build').click()
    await page
      .locator('#student-preview .student-preview-actions button')
      .filter({ hasText: '執行作品' })
      .click({ timeout: 30000 })
    await page.waitForFunction(
      () => document.querySelector('.student-preview-stage-status')?.textContent?.includes('動畫執行中'),
      null,
      { timeout: 30000 },
    )
    const result = page.locator('#student-preview details').filter({ hasText: '本機遊戲進度' })
    await result.locator(':scope > summary').click()
    return result
  }
  panel = await openCanonical()
  let canonicalValues = await capture()
  const saveTest = canonicalValues.find((entry) => entry.name === 'saveTest')
  if (!saveTest || saveTest.value !== 3) throw new Error('Canonical save variable is missing')
  await panel.getByRole('button', { name: '儲存進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已儲存' }).waitFor()
  panel = await openCanonical()
  canonicalValues = await capture()
  await exchange(
    'restore-game-progress',
    canonicalValues.map((entry) => (entry.name === 'saveTest' ? { ...entry, value: 12 } : entry)),
  )
  await panel.getByRole('button', { name: '讀取進度' }).click()
  await panel.getByRole('status').filter({ hasText: '已讀取' }).waitFor()
  if ((await capture()).find((entry) => entry.name === 'saveTest')?.value !== 3)
    throw new Error('Canonical saved variable did not survive reload')
  console.log('Progress browser smoke passed')
} finally {
  await browser.close()
}
