import { access } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { ScratchSession } from './session.js'

/**
 * Launch a separate browser, import the active archive into the local Bridge, and run it.
 * @param session Current session.
 * @param options Connection and display settings.
 * @param options.url Local editor address.
 * @param options.headless Run without a window.
 * @param options.screenshot Optional stage output.
 */
export async function openSessionInBrowser(
  session: ScratchSession,
  options: { url: string; headless: boolean; screenshot?: string },
): Promise<void> {
  const url = new URL(options.url)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('Browser URL must be a local HTTP Bridge address, for example http://localhost:8601/.')
  }
  if (options.headless && !options.screenshot) throw new Error('--headless requires --screenshot <file.png>.')
  if (options.screenshot) {
    try {
      await access(options.screenshot)
      throw new Error(`Screenshot already exists: ${options.screenshot}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const archive = await session.archive()
  const browser = await chromium.launch({ headless: options.headless })
  try {
    const page = await browser.newPage()
    // The isolated renderer loads its modules with a null origin.
    await page.route(`${url.origin}/**`, async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
    })
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 })
    } catch (error) {
      throw new Error(
        `Cannot open Bridge at ${url.origin}. Start its local web server and check --url. ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const file = { name: 'session.sb3', mimeType: 'application/zip', buffer: Buffer.from(archive) }
    let canvas
    if ((await page.title()).includes('Scratch 3.0 GUI')) {
      // This is a new, isolated browser window; no existing user tab is replaced.
      page.on('dialog', (dialog) => {
        void dialog.accept()
      })
      await page
        .getByText(/^(File|檔案|文件)$/)
        .first()
        .click()
      const chooser = page.waitForEvent('filechooser')
      await page.getByText(/^(Load from your computer|從電腦載入|从电脑中上传)$/).click()
      await (await chooser).setFiles(file)
      await page.locator('input[class*="project-title-input_title-field"]').waitFor()
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>('input[class*="project-title-input_title-field"]')?.value ===
          'session',
        null,
        { timeout: 30000 },
      )
      await page.locator('button[class*="green-flag-button"]').click()
      canvas = page.locator('canvas[width="480"][height="360"]').first()
    } else {
      await page.locator('button[data-tab="analyze"]').click()
      await page.locator('#sb3-file').setInputFiles(file)
      await page.waitForFunction(
        () => document.querySelector('#file-status')?.getAttribute('data-kind') === 'ok',
        null,
        { timeout: 30000 },
      )
      await page.locator('#preview-imported-project').click()
      await page.locator('#student-preview .student-preview-actions button').filter({ hasText: '執行作品' }).click()
      await page.waitForFunction(
        () => document.querySelector('.student-preview-stage-status')?.textContent.includes('動畫執行中'),
        null,
        { timeout: 30000 },
      )
      canvas = page.frameLocator('#student-preview iframe.student-preview-animation').locator('#stage')
    }
    if (options.screenshot) {
      await canvas.screenshot({ path: options.screenshot })
      console.log(`✓ Scratch stage screenshot saved to "${options.screenshot}".`)
    }
    if (!options.headless) {
      console.log(`✓ Project loaded in a new browser window from ${url.origin}. Close the window to exit.`)
      await new Promise<void>((resolve) => browser.once('disconnected', () => resolve()))
    }
  } finally {
    await browser.close()
  }
}
