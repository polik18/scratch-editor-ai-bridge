import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { chromium } from 'playwright'

const fixture = fileURLToPath(new URL('../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true })
  await page.route('http://127.0.0.1:5178/**', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
  })
  await page.goto('http://127.0.0.1:5178/')
  await page.locator('button[data-tab="analyze"]').click()
  const fixtureZip = await JSZip.loadAsync(await readFile(fixture))
  const fixtureProject = JSON.parse(await fixtureZip.file('project.json').async('string'))
  fixtureProject.targets.find((target) => target.name === 'Sprite1').variables.smokeVariable = ['smoke', 3]
  fixtureZip.file('project.json', JSON.stringify(fixtureProject))
  await page.locator('#sb3-file').setInputFiles({
    name: 'draggable.sb3',
    mimeType: 'application/zip',
    buffer: await fixtureZip.generateAsync({ type: 'nodebuffer' }),
  })
  await page.waitForFunction(() => document.querySelector('#file-status')?.getAttribute('data-kind') === 'ok', null, {
    timeout: 30000,
  })
  await page.locator('#preview-imported-project').click()
  const panel = page.locator('#student-preview details').filter({ hasText: '調整匯入作品的角色、舞台與變數' })
  await panel.locator(':scope > summary').click()
  await panel.locator('select').nth(0).selectOption('Sprite1')
  await panel.locator('select').nth(1).selectOption('x')
  await panel.locator(':scope > label input').fill('42')
  await panel.getByRole('button', { name: '套用屬性' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用' }).waitFor()
  const downloaded = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下載修改後的 SB3' }).click()
  const download = await downloaded
  const zip = await JSZip.loadAsync(await readFile(await download.path()))
  const json = JSON.parse(await zip.file('project.json').async('string'))
  if (json.targets.find((target) => target.name === 'Sprite1').x !== 42)
    throw new Error('export did not retain the new x')
  await panel.getByRole('button', { name: '復原', exact: true }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已復原' }).waitFor()
  await panel.getByRole('button', { name: '重做', exact: true }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已重做' }).waitFor()
  await panel.locator('select').nth(1).selectOption('variable:smokeVariable')
  await panel.locator(':scope > label input').fill('9')
  await panel.getByRole('button', { name: '套用屬性' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '變數：smoke' }).waitFor()
  const variableDownload = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下載修改後的 SB3' }).click()
  const variableZip = await JSZip.loadAsync(await readFile(await (await variableDownload).path()))
  const variableProject = JSON.parse(await variableZip.file('project.json').async('string'))
  if (variableProject.targets.find((target) => target.name === 'Sprite1').variables.smokeVariable[1] !== 9)
    throw new Error('export did not retain the new variable')
  await panel.locator('select').nth(1).selectOption('x')
  await page.locator('#student-preview .student-preview-actions button').filter({ hasText: '執行作品' }).click()
  await page
    .waitForFunction(
      () => document.querySelector('.student-preview-stage-status')?.textContent?.includes('動畫執行中'),
      null,
      { timeout: 30000 },
    )
    .catch(async (error) => {
      throw new Error(`Preview failed: ${await page.locator('.student-preview-stage-status').textContent()}`, {
        cause: error,
      })
    })
  const frame = page.frameLocator('#student-preview iframe.student-preview-animation')
  await frame.locator('#stage').evaluate(() => {
    globalThis.__rawPatchMarker = 'still-running'
  })
  await panel.locator(':scope > label input').fill('40')
  await panel.getByRole('button', { name: '套用屬性' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用' }).waitFor({ timeout: 30000 })
  await panel.getByRole('button', { name: '復原', exact: true }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已復原' }).waitFor()
  await panel.getByRole('button', { name: '重做', exact: true }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已重做' }).waitFor()
  if ((await frame.locator('#stage').evaluate(() => globalThis.__rawPatchMarker)) !== 'still-running')
    throw new Error('runtime apply or history reloaded the game')
  await page.route('http://127.0.0.1:1234/**', async (route) => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = route.request().postDataJSON()
    const revision = /revision: (sha256:[a-f0-9]+)/.exec(body.messages[0].content)?.[1]
    if (!revision) throw new Error('raw AI instruction did not include a revision')
    const patch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: revision,
      summary: '移動角色',
      change: { kind: 'property', targetName: 'Sprite1', property: 'x', expected: 40, value: 44 },
    }
    await route.fulfill({
      status: 200,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(patch) } }] }),
    })
  })
  await panel.getByText('設定本機模型 API（不需要 OpenAI key）').click()
  await panel.locator('#local-ai-base-url').fill('http://127.0.0.1:1234/v1')
  await panel.locator('#local-ai-model').fill('mock')
  await panel.locator('#local-ai-request').fill('向右移動')
  await panel.getByRole('button', { name: '請本機 AI 提出修改' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: 'AI 修改已通過檢查' }).waitFor()
  await panel.getByRole('button', { name: '確認套用 AI 修改' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用 AI 修改' }).waitFor({ timeout: 30000 })
  const aiDownload = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下載修改後的 SB3' }).click()
  const aiZip = await JSZip.loadAsync(await readFile(await (await aiDownload).path()))
  const aiProject = JSON.parse(await aiZip.file('project.json').async('string'))
  if (aiProject.targets.find((target) => target.name === 'Sprite1').x !== 44)
    throw new Error('AI proposal was not saved')
  let gatewayRequestSeen = false
  await page.route('http://127.0.0.1:43129/**', async (route) => {
    const request = route.request()
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type,x-bridge-token',
      'access-control-allow-methods': 'POST,OPTIONS',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(request.url()).pathname
    if (path === '/bridge/pair')
      return route.fulfill({
        status: 200,
        headers,
        json: { token: 'g'.repeat(64), endpoint: 'http://192.168.1.5:1234' },
      })
    if (path === '/bridge/unpair') return route.fulfill({ status: 204, headers })
    if (path !== '/v1/chat/completions' || request.headers()['x-bridge-token'] !== 'g'.repeat(64))
      throw new Error('gateway request lacked pairing token')
    gatewayRequestSeen = true
    const revision = /revision: (sha256:[a-f0-9]+)/.exec(request.postDataJSON().messages[0].content)?.[1]
    const patch = {
      format: 'scratch-ai-bridge/raw-patch',
      version: 1,
      baseRevision: revision,
      summary: '區網修改',
      change: { kind: 'property', targetName: 'Sprite1', property: 'x', expected: 44, value: 46 },
    }
    return route.fulfill({
      status: 200,
      headers,
      json: { choices: [{ message: { content: JSON.stringify(patch) } }] },
    })
  })
  await panel.getByRole('button', { name: '配對區網模型 gateway' }).click()
  await panel.getByText('已配對 http://192.168.1.5:1234', { exact: false }).waitFor()
  await panel.getByRole('button', { name: '請本機 AI 提出修改' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: 'AI 修改已通過檢查' }).waitFor()
  if (!gatewayRequestSeen) throw new Error('paired gateway did not receive the model request')
  await panel.getByRole('button', { name: '確認套用 AI 修改' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用 AI 修改' }).waitFor({ timeout: 30000 })
  await panel.getByRole('button', { name: '中斷區網模型 gateway' }).click()
  const queue = []
  const pending = new Map()
  await page.route('http://127.0.0.1:43128/**', async (route) => {
    const request = route.request()
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(request.url()).pathname
    if (path === '/bridge/pair') return route.fulfill({ status: 200, headers, json: { token: 'a'.repeat(64) } })
    if (path === '/bridge/poll')
      return queue.length
        ? route.fulfill({ status: 200, headers, json: queue.shift() })
        : route.fulfill({ status: 204, headers })
    if (path === '/bridge/respond') {
      const result = request.postDataJSON()
      pending.get(result.id)?.(result)
      return route.fulfill({ status: 200, headers, json: {} })
    }
    return route.fulfill({ status: 200, headers, json: {} })
  })
  const tool = (id, name, args = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP relay timed out: ${name}`)), 10000)
      pending.set(id, (value) => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(value)
      })
      queue.push({ id, tool: name, arguments: args })
    })
  await panel.getByText('連接外部 AI（MCP）').click()
  await panel.getByRole('button', { name: '連接 MCP' }).click()
  await panel.getByText('已連線，等待外部 AI 工具呼叫。').waitFor()
  const inspected = await tool('inspect', 'inspect_project')
  const mcpRevision = /revision: (sha256:[a-f0-9]+)/.exec(inspected.result.instruction)?.[1]
  if (!mcpRevision) throw new Error('MCP inspect did not return the raw revision')
  const mcpPatch = {
    format: 'scratch-ai-bridge/raw-patch',
    version: 1,
    baseRevision: mcpRevision,
    summary: 'MCP 修改',
    change: { kind: 'property', targetName: 'Sprite1', property: 'x', expected: 46, value: 50 },
  }
  const proposed = await tool('propose', 'propose_live_patch', { patchJson: JSON.stringify(mcpPatch) })
  if (proposed.result?.state !== 'pending-user-review')
    throw new Error(`MCP proposal failed: ${JSON.stringify(proposed)}`)
  const duplicate = await tool('duplicate', 'propose_live_patch', { patchJson: JSON.stringify(mcpPatch) })
  if (!duplicate.error) throw new Error('MCP silently replaced a pending proposal')
  const mcpStatus = await tool('status', 'get_patch_status')
  if (mcpStatus.result?.state !== 'pending-user-review') throw new Error('MCP candidate status was not pending')
  await panel.locator(':scope > label input').fill('47')
  await panel.getByRole('button', { name: '套用屬性' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用' }).waitFor()
  const stale = await tool('stale', 'get_patch_status')
  if (stale.result?.state !== 'revision-changed') throw new Error('MCP did not report the stale proposal')
  await panel.getByRole('button', { name: '確認套用 AI 修改' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: 'revision has changed' }).waitFor()
  await panel.getByRole('button', { name: '捨棄 AI 修改' }).click()
  const updated = await tool('inspect-again', 'inspect_project')
  const updatedRevision = /revision: (sha256:[a-f0-9]+)/.exec(updated.result.instruction)?.[1]
  const updatedPatch = { ...mcpPatch, baseRevision: updatedRevision, change: { ...mcpPatch.change, expected: 47 } }
  const reproposed = await tool('propose-again', 'propose_live_patch', { patchJson: JSON.stringify(updatedPatch) })
  if (reproposed.result?.state !== 'pending-user-review') throw new Error('MCP proposal after stale discard failed')
  await panel.getByRole('button', { name: '確認套用 AI 修改' }).click()
  await panel.locator(':scope > p[role=status]').filter({ hasText: '已套用 AI 修改' }).waitFor({ timeout: 30000 })
  const applied = await tool('applied', 'get_patch_status')
  if (applied.result?.state !== 'no-candidate') throw new Error('MCP candidate was not cleared after apply')
  await panel.getByRole('button', { name: '中斷 MCP' }).click()
  console.log('Raw SB3 browser smoke passed')
} finally {
  await browser.close()
}
