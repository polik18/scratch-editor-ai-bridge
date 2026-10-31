import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(packageRoot, 'scripts/scratch-session.mjs')
const fixture = path.resolve(packageRoot, '../scratch-vm/test/fixtures/draggable.sb3')
const cwd = await mkdtemp(path.join(os.tmpdir(), 'scratch-session-browser-'))
const run = (...args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (data) => {
      out += data
    })
    child.stderr.on('data', (data) => {
      out += data
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${args.join(' ')} failed (${code}): ${out}`)),
    )
  })
try {
  await run('load', fixture)
  await run('preview', 'preview.png')
  await run(
    'open',
    '--url',
    process.env.BRIDGE_URL ?? 'http://127.0.0.1:5178/',
    '--headless',
    '--screenshot',
    'bridge.png',
  )
  if (process.env.SCRATCH_GUI_URL)
    await run('open', '--url', process.env.SCRATCH_GUI_URL, '--headless', '--screenshot', 'gui.png')
  for (const file of ['preview.png', 'bridge.png', ...(process.env.SCRATCH_GUI_URL ? ['gui.png'] : [])]) {
    const bytes = await readFile(path.join(cwd, file))
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.length < 1000)
      throw new Error(`Invalid screenshot: ${file}`)
  }
  console.log(`Session browser smoke passed${process.env.SCRATCH_GUI_URL ? ' (including Scratch GUI)' : ''}`)
} finally {
  await rm(cwd, { recursive: true, force: true })
}
