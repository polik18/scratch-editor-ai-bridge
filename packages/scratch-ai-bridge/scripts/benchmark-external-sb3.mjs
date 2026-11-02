/* global document, window -- browser globals used inside Playwright page callbacks */
/** Measure the existing import workflow without collecting the project contents. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'

const file = process.argv[2]
const repetitions = Number(process.argv[3] ?? 5)
if (!file || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
  throw new Error('Usage: node scripts/benchmark-external-sb3.mjs /path/to/project.sb3 [1-20]')
}
const bytes = await readFile(resolve(file))
const server = await preview({ root: process.cwd(), configFile: 'vite.config.ts', logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } })
const address = server.httpServer?.address()
if (!address || typeof address === 'string') throw new Error('No preview server address')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const results = []
const initialized = new WeakSet()
const run = async (page, mode, iteration) => {
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' })
  await page.locator('#analyze-tab').click()
  const start = performance.now()
  await page.locator('#sb3-file').setInputFiles(resolve(file))
  await page.waitForFunction(() => {
    const text = document.querySelector('#file-status')?.textContent ?? ''
    return text.includes('檢查完成') || text.includes('無法') || text.includes('失敗')
  }, null, { timeout: 120_000 })
  const elapsed = performance.now() - start
  const sample = await page.evaluate(() => ({
    status: document.querySelector('#file-status')?.textContent,
    longTasks: window.__bridgeLongTasks ?? [],
    domNodes: document.querySelectorAll('*').length,
  }))
  results.push({ mode, iteration, elapsedMs: Math.round(elapsed), ...sample })
  process.stderr.write(`${mode} ${iteration}/${repetitions}: ${Math.round(elapsed)}ms\n`)
}
try {
  for (const mode of ['cold', 'warm']) {
    let context
    try {
      if (mode === 'warm') context = await browser.newContext()
      for (let i = 1; i <= repetitions; i += 1) {
        const current = context ?? await browser.newContext()
        try {
          if (!initialized.has(current)) await current.addInitScript(() => {
            window.__bridgeLongTasks = []
            try {
              new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) window.__bridgeLongTasks.push(Math.round(entry.duration))
              }).observe({ entryTypes: ['longtask'] })
            } catch { /* Browser does not expose longtask timing. */ }
          })
          initialized.add(current)
          const page = await current.newPage()
          try { await run(page, mode, i) } finally { await page.close() }
        } finally { if (!context) await current.close() }
      }
    } finally { await context?.close() }
  }
  console.log(JSON.stringify({ node: process.version, browser: browser.version(), platform: process.platform,
    architecture: process.arch, cacheNotes: 'cold uses a new browser context; warm reuses one context. OS cache is not cleared.', inputBytes: bytes.length, inputSha256: createHash('sha256').update(bytes).digest('hex'), results }, null, 2))
} finally { await browser.close(); await server.close() }
