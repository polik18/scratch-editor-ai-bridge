import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { LocalModelGateway } from '../src/provider-gateway/gateway.ts'

const ip = Object.values(networkInterfaces())
  .flat()
  .find(
    (item) =>
      item &&
      item.family === 'IPv4' &&
      !item.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address),
  )?.address
if (!ip) throw new Error('No private IPv4 interface available for the gateway smoke')
let requests = 0
const model = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    requests += 1
    const message = JSON.parse(body).messages[0].content
    const revision = /revision: (sha256:[a-f0-9]+)/.exec(message)?.[1]
    const patch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: revision,
      summary: 'gateway smoke',
      change: { kind: 'property', targetName: 'Sprite1', property: 'x', expected: 1.906493, value: 5 },
    }
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(patch) } }] }))
  })
})
await new Promise((resolve) => model.listen(0, ip, resolve))
const gateway = new LocalModelGateway(`http://${ip}:${model.address().port}/v1`, ['http://127.0.0.1:5178'])
const port = await gateway.listen(0)
// Headless Chromium cannot answer the local-network permission prompt.
const browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] })
try {
  const page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`${message.text()}\n`)
  })
  await page.route('http://127.0.0.1:5178/**', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
  })
  await page.goto('http://127.0.0.1:5178/')
  await page.locator('button[data-tab="analyze"]').click()
  await page
    .locator('#sb3-file')
    .setInputFiles(fileURLToPath(new URL('../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url)))
  await page.waitForFunction(() => document.querySelector('#file-status')?.getAttribute('data-kind') === 'ok', null, {
    timeout: 30000,
  })
  await page.locator('#preview-imported-project').click()
  const panel = page.locator('#student-preview details').filter({ hasText: '調整匯入作品的角色、舞台與變數' })
  await panel.locator(':scope > summary').click()
  await panel.getByText('設定本機模型 API（不需要 OpenAI key）').click()
  await panel.locator('#local-ai-gateway').fill(`http://127.0.0.1:${port}`)
  await panel.getByRole('button', { name: '配對區網模型 gateway' }).click()
  await panel
    .getByText(`已配對 http://${ip}:${model.address().port}`, { exact: false })
    .waitFor({ timeout: 5000 })
    .catch(async (error) => {
      throw new Error(
        `Gateway pairing failed: ${await panel.locator('#local-ai-gateway + button + button + p').textContent()}`,
        { cause: error },
      )
    })
  await panel.locator('#local-ai-model').fill('mock')
  await panel.locator('#local-ai-request').fill('調整位置')
  await panel.getByRole('button', { name: '請本機 AI 提出修改' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: 'AI 修改已通過檢查' }).waitFor({ timeout: 30000 })
  if (requests !== 1) throw new Error('mock model did not receive exactly one request')
  await panel.getByRole('button', { name: '捨棄 AI 修改' }).click()
  await panel.getByRole('button', { name: '中斷區網模型 gateway' }).click()
  console.log('Private-interface gateway browser smoke passed')
} finally {
  await browser.close()
  gateway.close()
  model.close()
}
