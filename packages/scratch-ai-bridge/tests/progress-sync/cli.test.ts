import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('self-hosted sync launcher', () => {
  it('requires a private token and cleans its process lock on shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bridge-sync-cli-'))
    const tokenFile = join(root, 'token')
    const token = 'a'.repeat(64)
    await writeFile(tokenFile, token, { mode: 0o600 })
    const reservation = createServer()
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const port = address.port
    await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())))
    const run = () =>
      spawn(
        process.execPath,
        ['scripts/scratch-ai-bridge-sync.mjs', '--root', root, '--token-file', tokenFile, '--port', String(port)],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
      )
    try {
      await chmod(tokenFile, 0o644)
      const denied = run()
      let deniedLog = ''
      denied.stderr.on('data', (chunk: Buffer) => {
        deniedLog += chunk.toString()
      })
      expect(await new Promise<number | null>((resolve) => denied.on('exit', resolve))).not.toBe(0)
      expect(deniedLog).not.toContain(token)
      await chmod(tokenFile, 0o600)
      const child = run()
      let log = ''
      child.stderr.on('data', (chunk: Buffer) => {
        log += chunk.toString()
      })
      try {
        for (let i = 0; i < 100 && !log.includes('sync server is restricted'); i += 1)
          await new Promise((resolve) => setTimeout(resolve, 25))
        expect(log).toContain('sync server is restricted')
        expect(log).not.toContain(token)
        expect((await stat(join(root, 'scratch-ai-bridge-sync-v1', '.server.lock'))).isFile()).toBe(true)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exit = new Promise((resolve) => child.on('exit', resolve))
          child.kill('SIGTERM')
          await exit
        }
      }
      await expect(stat(join(root, 'scratch-ai-bridge-sync-v1', '.server.lock'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15000)
})
