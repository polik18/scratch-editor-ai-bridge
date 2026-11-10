/* global document -- serialized Playwright callback runs in the browser. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import JSZip from 'jszip'
import { chromium, firefox, webkit } from 'playwright'

const root = resolve('dist')
const browserName = process.env.BROWSER ?? 'chromium'
const browserType = { chromium, firefox, webkit }[browserName]
const appleMd5ext = '3826a4091a33e4d26f87a2fac7cf796b.svg'
const appleAssetUrl = `https://assets.scratch.mit.edu/internalapi/asset/${appleMd5ext}/get/`
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

if (!browserType) throw new Error(`Unsupported BROWSER value: ${browserName}`)

const response = {
  format: 'scratch-ai-bridge/canonical-ir',
  version: 1,
  name: 'Apple 素材瀏覽器驗證',
  broadcasts: [],
  stage: {
    kind: 'stage',
    name: 'Stage',
    variables: [],
    lists: [],
    costumes: [
      {
        name: 'Stage',
        dataFormat: 'svg',
        data: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#ffffff"/></svg>',
      },
    ],
    sounds: [],
    scripts: [],
    procedures: [],
  },
  sprites: [
    {
      kind: 'sprite',
      name: 'Apple',
      variables: [],
      lists: [],
      costumes: [{ name: 'Apple', dataFormat: 'svg' }],
      sounds: [],
      scripts: [],
      procedures: [],
      x: 0,
      y: 0,
      direction: 90,
      size: 100,
      visible: true,
      draggable: false,
      rotationStyle: 'all around',
    },
  ],
}

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex')

const server = createServer((request, serverResponse) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  const filePath = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1))
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    serverResponse.writeHead(403).end('Forbidden')
    return
  }
  void readFile(filePath)
    .then((bytes) => {
      serverResponse
        .writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
        })
        .end(bytes)
    })
    .catch(() => serverResponse.writeHead(404).end('Not found'))
})

const listen = () =>
  new Promise((resolveAddress, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveAddress(server.address()))
  })

const readDownloadedProject = async (download) => {
  const path = await download.path()
  if (!path) throw new Error('Browser did not expose the downloaded SB3 path')
  const archive = await JSZip.loadAsync(await readFile(path))
  const projectFile = archive.file('project.json')
  if (!projectFile) throw new Error('Downloaded SB3 has no project.json')
  return { archive, project: JSON.parse(await projectFile.async('string')) }
}

const installCspRecorder = (page) =>
  page.addInitScript(() => {
    globalThis.__assetLibraryCspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      globalThis.__assetLibraryCspViolations.push({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
      })
    })
  })

const runBuild = async (page, { offline }) => {
  if (offline) {
    await page.route('https://assets.scratch.mit.edu/**', (route) => route.abort('failed'))
  }
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })
  await page.locator('#json-editor').fill(JSON.stringify(response))
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#student-build').click()
  await page.locator('#generate-status[data-kind="ok"]').waitFor({ timeout: 30_000 })
  const download = await downloadPromise
  const resultMessage = (await page.locator('#student-result-message').textContent())?.trim() ?? ''
  const status = (await page.locator('#generate-status').textContent())?.trim() ?? ''
  const downloaded = await readDownloadedProject(download)
  return { ...downloaded, resultMessage, status }
}

const address = await listen()
if (!address || typeof address === 'string') throw new Error('Smoke server did not provide a port')

let browser
try {
  browser = await browserType.launch({ headless: process.env.BROWSER_HEADLESS !== 'false' })

  const onlinePage = await browser.newPage({ acceptDownloads: true })
  await installCspRecorder(onlinePage)
  const requests = []
  onlinePage.on('request', (request) => requests.push(request.url()))
  await onlinePage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })
  const online = await runBuild(onlinePage, { offline: false })
  const onlineApple = online.project.targets
    .find((target) => target.name === 'Apple')
    ?.costumes.find((costume) => costume.name === 'Apple')
  assert.equal(onlineApple?.md5ext, appleMd5ext)
  const onlineAppleBytes = await online.archive.file(appleMd5ext)?.async('uint8array')
  assert.ok(onlineAppleBytes, 'Downloaded SB3 did not contain the official Apple asset')
  assert.equal(md5(onlineAppleBytes), appleMd5ext.slice(0, 32))
  assert.match(online.resultMessage, /已放入 \d+ 個 Scratch 官方造型／背景/)
  assert.match(online.resultMessage, /官方音效/)
  assert.ok(requests.includes(appleAssetUrl), 'Browser did not request the official Apple asset URL')
  const onlineCspViolations = await onlinePage.evaluate(() => globalThis.__assetLibraryCspViolations)
  assert.deepEqual(onlineCspViolations, [])
  await onlinePage.close()

  const offlinePage = await browser.newPage({ acceptDownloads: true })
  await installCspRecorder(offlinePage)
  const offline = await runBuild(offlinePage, { offline: true })
  assert.match(offline.resultMessage, /官方素材下載失敗/)
  assert.match(offline.resultMessage, /簡單圖形/)
  const offlineApple = offline.project.targets
    .find((target) => target.name === 'Apple')
    ?.costumes.find((costume) => costume.name === 'Apple')
  assert.notEqual(offlineApple?.md5ext, appleMd5ext)
  const offlineCspViolations = await offlinePage.evaluate(() => globalThis.__assetLibraryCspViolations)
  assert.deepEqual(offlineCspViolations, [])
  await offlinePage.close()

  const evidence = {
    browser: browserName,
    appleAssetUrl,
    appleMd5ext,
    online: {
      requestedOfficialAsset: true,
      archiveAssetMd5: onlineAppleBytes ? md5(onlineAppleBytes) : null,
      resultMessage: online.resultMessage,
      status: online.status,
      cspViolations: onlineCspViolations,
    },
    offline: {
      fallbackAssetMd5ext: offlineApple?.md5ext ?? null,
      resultMessage: offline.resultMessage,
      status: offline.status,
      cspViolations: offlineCspViolations,
    },
  }
  console.log(JSON.stringify(evidence, null, 2))
  console.log(`PASS: browser asset-library online download and offline fallback (${browserName})`)
} finally {
  await browser?.close()
  await new Promise((resolveClosed, reject) => server.close((error) => (error ? reject(error) : resolveClosed())))
}
