import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const fixturePath = fileURLToPath(new URL('../../scratch-vm/test/fixtures/default.sb3', import.meta.url))
const evidencePath = fileURLToPath(new URL('../test-results/browser-safari.json', import.meta.url))
const previewPort = Number(process.env.SAFARI_PREVIEW_PORT ?? 4174)
const driverPort = Number(process.env.SAFARI_DRIVER_PORT ?? 4444)
const previewUrl = `http://127.0.0.1:${previewPort}/`
const driverUrl = `http://127.0.0.1:${driverPort}`
const children = []
let sessionId

const stop = (child) => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
}

const waitFor = async (label, check, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`)
}

const request = async (method, route, body) => {
  const response = await fetch(`${driverUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok || payload.value?.error) {
    const message = payload.value?.message ?? `${method} ${route} returned HTTP ${response.status}`
    throw new Error(message)
  }
  return payload.value
}

const command = async (method, route, body) => request(method, `/session/${sessionId}${route}`, body)

try {
  const preview = spawn(
    'npm',
    ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'],
    {
      cwd: packageRoot,
      stdio: 'ignore',
    },
  )
  children.push(preview)
  preview.on('error', (error) => console.error(`Vite preview failed: ${error.message}`))
  await waitFor('Vite production preview', async () => {
    const response = await fetch(previewUrl)
    return response.ok
  })

  const driver = spawn('safaridriver', ['-p', String(driverPort)], { stdio: 'ignore' })
  children.push(driver)
  driver.on('error', (error) => console.error(`SafariDriver failed: ${error.message}`))
  await waitFor('SafariDriver', async () => {
    const response = await fetch(`${driverUrl}/status`)
    if (!response.ok) return false
    const payload = await response.json()
    return payload.value?.ready === true
  })

  let session
  try {
    session = await request('POST', '/session', {
      capabilities: {
        alwaysMatch: { browserName: 'safari', acceptInsecureCerts: false, pageLoadStrategy: 'normal' },
      },
    })
  } catch (error) {
    if (/Allow Remote Automation|remote automation/i.test(error.message)) {
      throw new Error(
        "Native Safari is not enabled for WebDriver. In Safari Settings > Developer, enable 'Allow Remote Automation', then rerun npm run test:browser:safari.",
      )
    }
    throw error
  }
  sessionId = session.sessionId ?? session.value?.sessionId
  if (!sessionId) throw new Error('SafariDriver created a session without a session ID')

  await command('POST', '/url', { url: previewUrl })
  await waitFor('Scratch AI Bridge app', async () =>
    command('POST', '/execute/sync', {
      script:
        "return Boolean(document.querySelector('#sb3-file') && document.querySelector('button[data-tab=analyze]'))",
      args: [],
    }).then((value) => value === true),
  )
  const tab = await command('POST', '/element', {
    using: 'css selector',
    value: 'button[data-tab="analyze"]',
  })
  await command('POST', `/element/${tab.ELEMENT ?? tab['element-6066-11e4-a52e-4f735466cecf']}/click`, {})
  const fileInput = await command('POST', '/element', { using: 'css selector', value: '#sb3-file' })
  const elementId = fileInput.ELEMENT ?? fileInput['element-6066-11e4-a52e-4f735466cecf']
  await command('POST', `/element/${elementId}/value`, { text: fixturePath, value: [...fixturePath] })

  const result = await waitFor(
    'SB3 import and analysis',
    async () =>
      command('POST', '/execute/sync', {
        script: `
          const status = document.querySelector('#file-status');
          if (!status || !['ok', 'error'].includes(status.dataset.kind)) return null;
          return { kind: status.dataset.kind, message: status.textContent, canonical: document.querySelector('#canonical-output')?.textContent };
        `,
        args: [],
      }).then((value) => (value?.kind ? value : null)),
    60_000,
  )
  if (result.kind !== 'ok') throw new Error(`Safari SB3 import failed: ${result.message}`)
  const canonical = JSON.parse(result.canonical ?? 'null')
  if (!Array.isArray(canonical?.sprites) || canonical.sprites.length === 0) {
    throw new Error('Safari imported the SB3 but produced no Canonical sprites')
  }
  const evidence = {
    browser: 'Safari WebDriver',
    result: 'pass',
    fixture: 'scratch-vm/test/fixtures/default.sb3',
    spriteCount: canonical.sprites.length,
    status: result.message,
  }
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  if (sessionId) {
    try {
      await request('DELETE', `/session/${sessionId}`)
    } catch {
      // SafariDriver may already have discarded a failed session.
    }
  }
  children.reverse().forEach(stop)
}
