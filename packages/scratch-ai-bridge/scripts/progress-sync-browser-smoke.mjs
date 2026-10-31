import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { chromium } from 'playwright'
import { ProgressSyncServer } from '../src/progress-sync/server.ts'
import { EncryptedSaveStore } from '../src/progress-sync/store.ts'

const token = 'a'.repeat(64)
const password = 'correct horse battery staple'
const fixture = fileURLToPath(new URL('../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url))
const zip = await JSZip.loadAsync(await readFile(fixture))
const project = JSON.parse(await zip.file('project.json').async('string'))
project.targets.find((target) => target.name === 'Sprite1').variables.syncTest = ['syncTest', 3]
zip.file('project.json', JSON.stringify(project))
const input = {
  name: 'sync.sb3',
  mimeType: 'application/zip',
  buffer: await zip.generateAsync({ type: 'nodebuffer' }),
}
const root = await mkdtemp(join(tmpdir(), 'bridge-sync-browser-'))
const store = new EncryptedSaveStore(root)
await store.start()
const server = new ProgressSyncServer(store, token, ['http://127.0.0.1:5178'])
const port = await server.listen(0)
// Headless Chromium cannot answer the local-network permission prompt.
const browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] })
try {
  const open = async () => {
    const context = await browser.newContext()
    const page = await context.newPage()
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
    return { page, progress, sync }
  }
  const exchange = (page, type, snapshot) =>
    page.evaluate(
      ({ type, snapshot }) =>
        new Promise((resolve, reject) => {
          const frame = document.querySelector('#student-preview iframe.student-preview-animation')
          const frameToken = new URL(frame.src).searchParams.get('token')
          const requestId = crypto.randomUUID()
          const timer = setTimeout(() => reject(new Error('progress request timed out')), 5000)
          const listener = (event) => {
            if (event.source !== frame.contentWindow || event.data?.requestId !== requestId) return
            window.removeEventListener('message', listener)
            clearTimeout(timer)
            if (!event.data.ok) return reject(new Error(event.data.error))
            resolve(event.data.snapshot)
          }
          window.addEventListener('message', listener)
          frame.contentWindow.postMessage({ type, token: frameToken, requestId, baseRevision: 0, snapshot }, '*')
        }),
      { type, snapshot },
    )
  const score = async (page) =>
    (await exchange(page, 'capture-game-progress')).find((entry) => entry.id === 'syncTest').value
  const change = async (page, value) => {
    const snapshot = await exchange(page, 'capture-game-progress')
    await exchange(
      page,
      'restore-game-progress',
      snapshot.map((entry) => (entry.id === 'syncTest' ? { ...entry, value } : entry)),
    )
  }
  const first = await open()
  await first.progress.getByRole('button', { name: '儲存進度' }).click()
  await first.progress.locator(':scope > p[role=status]').filter({ hasText: '已儲存' }).waitFor()
  await first.sync.getByRole('button', { name: '上傳加密存檔' }).click()
  await first.sync.getByRole('status').filter({ hasText: '已上傳' }).waitFor()
  const storageDir = join(root, 'scratch-ai-bridge-sync-v1')
  const storedFile = (await readdir(storageDir)).find((name) => name.endsWith('.json'))
  const storedBytes = await readFile(join(storageDir, storedFile), 'utf8')
  if (storedBytes.includes('syncTest') || storedBytes.includes(password) || storedBytes.includes(token))
    throw new Error('server retained plaintext or a credential')
  await first.sync.getByRole('checkbox', { name: '啟用自動同步（僅在沒有衝突時）' }).check()
  await first.sync.getByRole('status').filter({ hasText: '自動同步已啟用' }).waitFor()
  const third = await open()
  await third.progress.getByRole('button', { name: '儲存進度' }).click()
  await third.progress.locator(':scope > p[role=status]').filter({ hasText: '已儲存' }).waitFor()
  await third.progress.locator(':scope > label input[type=password]').fill('wrong horse battery staple')
  await third.sync.getByRole('button', { name: '上傳加密存檔' }).click()
  await third.sync.getByRole('status').filter({ hasText: '密碼錯誤' }).waitFor()
  const second = await open()
  await second.sync.getByRole('checkbox', { name: '啟用自動同步（僅在沒有衝突時）' }).check()
  await second.sync.getByRole('status').filter({ hasText: '自動同步已啟用' }).waitFor()
  await second.progress.getByRole('button', { name: '讀取進度' }).click()
  await second.progress.locator(':scope > p[role=status]').filter({ hasText: '已讀取' }).waitFor()
  if ((await score(second.page)) !== 3) throw new Error('second device did not read the first save')
  await change(second.page, 12)
  second.page.once('dialog', (dialog) => dialog.accept())
  await second.progress.getByRole('button', { name: '儲存進度' }).click()
  await second.progress.locator(':scope > p[role=status]').filter({ hasText: '已儲存' }).waitFor()
  await second.sync.getByRole('status').filter({ hasText: '已上傳' }).waitFor()
  await first.progress.getByRole('button', { name: '讀取進度' }).click()
  await first.sync.getByRole('status').filter({ hasText: '已自動下載' }).waitFor()
  await first.progress.locator(':scope > p[role=status]').filter({ hasText: '已讀取' }).waitFor()
  if ((await score(first.page)) !== 12) throw new Error('automatic download did not restore the remote save')
  await change(second.page, 18)
  second.page.once('dialog', (dialog) => dialog.accept())
  await second.progress.getByRole('button', { name: '儲存進度' }).click()
  await second.progress.locator(':scope > p[role=status]').filter({ hasText: '已儲存' }).waitFor()
  await second.sync.getByRole('status').filter({ hasText: '已上傳' }).waitFor()
  await change(first.page, 24)
  first.page.once('dialog', (dialog) => dialog.accept())
  await first.progress.getByRole('button', { name: '儲存進度' }).click()
  await first.sync.getByRole('status').filter({ hasText: '本機已儲存，但未上傳' }).waitFor()
  first.page.once('dialog', (dialog) => dialog.accept())
  await first.sync.getByRole('button', { name: '下載同步存檔' }).click()
  await first.sync.getByRole('status').filter({ hasText: '已下載' }).waitFor()
  await first.progress.getByRole('button', { name: '讀取進度' }).click()
  await first.progress.locator(':scope > p[role=status]').filter({ hasText: '已讀取' }).waitFor()
  if ((await score(first.page)) !== 18) throw new Error('conflict handling did not preserve the remote save')
  first.page.once('dialog', (dialog) => dialog.accept())
  await first.sync.getByRole('button', { name: '刪除遠端存檔' }).click()
  await first.sync.getByRole('status').filter({ hasText: '已刪除' }).waitFor()
  console.log('Two-context encrypted sync browser smoke passed')
} finally {
  await browser.close()
  await server.close()
  await rm(root, { recursive: true, force: true })
}
