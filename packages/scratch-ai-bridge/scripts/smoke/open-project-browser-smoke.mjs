/* global DataTransfer, document -- Browser globals used in Playwright page evaluations */
// Opening a student's own .sb3 from the main page: the button, a drop anywhere on the window, plain errors, and the
// question before replacing a work with changes that were not downloaded. Needs `vite preview` on 127.0.0.1:5178.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const fixture = fileURLToPath(new URL('../../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url))
const fixtureBase64 = (await readFile(fixture)).toString('base64')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('http://127.0.0.1:5178/**', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
  })
  await page.goto('http://127.0.0.1:5178/')

  const drop = async (files) => {
    const transfer = await page.evaluateHandle((entries) => {
      const data = new DataTransfer()
      for (const [name, base64] of entries)
        data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], name))
      return data
    }, files)
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer })
    if (!(await page.isVisible('#drop-overlay'))) throw new Error('dragging a file did not show the drop overlay')
    await page.dispatchEvent('#drop-overlay', 'drop', { dataTransfer: transfer })
    if (await page.isVisible('#drop-overlay')) throw new Error('the drop overlay stayed after the drop')
  }
  const expectStatus = async (kind, text) => {
    await page.waitForFunction(
      ([expectedKind, expectedText]) => {
        const box = document.querySelector('#open-sb3-status')
        return box?.getAttribute('data-kind') === expectedKind && box.textContent.includes(expectedText)
      },
      [kind, text],
      { timeout: 30000 },
    )
  }

  const textDrag = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.setData('text/plain', 'not a file')
    return data
  })
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: textDrag })
  if (await page.isVisible('#drop-overlay')) throw new Error('dragging text showed the file drop overlay')

  await drop([['old.sb2', btoa('x')]])
  await expectStatus('error', 'Scratch 2')
  await drop([['broken.sb3', btoa('not a zip')]])
  await expectStatus('error', '已經損壞')

  await drop([
    ['draggable.sb3', fixtureBase64],
    ['other.sb3', fixtureBase64],
  ])
  await expectStatus('ok', '一次只能打開一個作品')
  const panel = page.locator('#student-preview .ai-edit-panel:visible')
  await panel.waitFor()
  if ((await page.locator('#generate-tab').getAttribute('aria-selected')) !== 'true')
    throw new Error('opening a work left the main tab')

  // A change that was not downloaded is protected by a question.
  await panel.getByText('不用 AI，自己改數值').click()
  await panel.locator('select').nth(0).selectOption('Sprite1')
  await panel.locator('select').nth(1).selectOption('x')
  await panel.locator('.ai-subsection > label > input[type=text]').fill('42')
  await panel.getByRole('button', { name: '套用屬性' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用' }).waitFor()
  let asked = 0
  page.once('dialog', (dialog) => {
    asked += 1
    void dialog.dismiss()
  })
  await drop([['again.sb3', fixtureBase64]])
  await page.waitForTimeout(500)
  if (asked !== 1) throw new Error('replacing an edited work did not ask first')
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用' }).waitFor()

  // The button opens the same flow through the file chooser.
  page.once('dialog', (dialog) => void dialog.accept())
  const chooser = page.waitForEvent('filechooser')
  await page.locator('#open-sb3-button').click()
  await (await chooser).setFiles(fixture)
  await expectStatus('ok', '已打開「draggable.sb3」')
  console.log('Open-project browser smoke passed: button, window drop, errors and replace question.')
} finally {
  await browser.close()
}
