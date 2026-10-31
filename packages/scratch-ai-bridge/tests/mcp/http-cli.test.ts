import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const reserve = async () => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No TCP address')
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

describe('MCP HTTP launcher', () => {
  it('uses a private token file and does not print the token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bridge-mcp-'))
    const path = join(dir, 'token')
    const token = 'a'.repeat(64)
    await writeFile(path, token, { mode: 0o600 })
    const httpPort = await reserve()
    let relayPort = await reserve()
    while (relayPort === httpPort) relayPort = await reserve()
    const run = () =>
      spawn(
        process.execPath,
        [
          'scripts/scratch-ai-bridge-mcp-http.mjs',
          '--token-file',
          path,
          '--http-port',
          String(httpPort),
          '--relay-port',
          String(relayPort),
        ],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
      )
    try {
      await chmod(path, 0o644)
      const rejected = run()
      let rejectedLog = ''
      rejected.stderr.on('data', (chunk: Buffer) => {
        rejectedLog += chunk.toString()
      })
      const code = await new Promise<number | null>((resolve) => rejected.on('exit', resolve))
      expect(code).not.toBe(0)
      expect(rejectedLog).toContain('accessible only by that user')
      expect(rejectedLog).not.toContain(token)
      await chmod(path, 0o600)
      const child = run()
      let log = ''
      child.stderr.on('data', (chunk: Buffer) => {
        log += chunk.toString()
      })
      try {
        for (let i = 0; i < 100 && !log.includes('MCP HTTP is restricted'); i += 1)
          await new Promise((resolve) => setTimeout(resolve, 25))
        expect(log).toContain('MCP HTTP is restricted')
        expect(log).not.toContain(token)
        const response = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
          }),
        })
        expect(response.status).toBe(200)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise((resolve) => child.on('exit', resolve))
          child.kill('SIGTERM')
          await exited
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 15000)
})
