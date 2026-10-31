import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'

describe('MCP stdio entry', () => {
  it('initializes and lists tools after the transport factory refactor', async () => {
    const reservation = createServer()
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const port = address.port
    await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())))
    const child = spawn(process.execPath, ['scripts/scratch-ai-bridge-mcp.mjs', '--port', String(port)], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const lines = createInterface({ input: child.stdout })
    const pending = new Map<number, (data: Record<string, unknown>) => void>()
    let stderr = ''
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    lines.on('line', (line) => {
      const message = JSON.parse(line) as { id?: number } & Record<string, unknown>
      if (typeof message.id === 'number') pending.get(message.id)?.(message)
    })
    const send = (id: number, method: string, params: unknown) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`stdio timeout: ${stderr}`)), 10000)
        pending.set(id, (data) => {
          clearTimeout(timer)
          pending.delete(id)
          resolve(data)
        })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    try {
      const init = await send(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      })
      expect(init.result).toBeDefined()
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
      const tools = await send(2, 'tools/list', {})
      expect(JSON.stringify(tools)).toContain('propose_live_patch')
    } finally {
      child.stdin.end()
      child.kill()
      lines.close()
    }
  }, 15000)
})
