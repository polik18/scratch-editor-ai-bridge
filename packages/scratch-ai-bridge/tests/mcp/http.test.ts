import { request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { BrowserBridgeRelay } from '../../src/mcp/companion'
import { TunnelMcpHttp } from '../../src/mcp/http'

const token = 'a'.repeat(64)
const post = (port: number, message: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...headers,
    },
    body: JSON.stringify(message),
  })
const result = async (response: Response) => {
  const body = await response.text()
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = body.split('\n').find((line) => line.startsWith('data: '))
    if (!data) throw new Error(`No SSE data in ${body}`)
    return JSON.parse(data.slice(6)) as Record<string, unknown>
  }
  return JSON.parse(body) as Record<string, unknown>
}

describe('loopback MCP HTTP for SSH tunnels', () => {
  it('rejects unauthorized and browser requests and routes MCP tool calls', async () => {
    const relay = {
      call: vi.fn().mockResolvedValue({ instruction: 'test project' }),
    } as unknown as BrowserBridgeRelay
    const server = new TunnelMcpHttp(relay, token)
    const port = await server.listen(0)
    try {
      const hello = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }
      expect((await post(port, hello, { authorization: 'Bearer wrong' })).status).toBe(401)
      expect((await post(port, hello, { origin: 'https://untrusted.example' })).status).toBe(403)
      const wrongHost = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/mcp',
            method: 'POST',
            headers: { host: 'evil.example', authorization: `Bearer ${token}` },
          },
          (response) => {
            response.resume()
            resolve(response.statusCode ?? 0)
          },
        )
        req.on('error', reject)
        req.end('{}')
      })
      expect(wrongHost).toBe(403)
      const init = await post(port, hello)
      expect(init.status).toBe(200)
      expect((await result(init)).result).toBeDefined()
      const listed = await result(await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }))
      expect(JSON.stringify(listed)).toContain('propose_live_patch')
      const called = await result(
        await post(port, {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'inspect_project', arguments: {} },
        }),
      )
      expect(JSON.stringify(called)).toContain('test project')
      expect(relay.call).toHaveBeenCalledWith('inspect_project', {})
    } finally {
      await server.close()
    }
  })
  it('rejects weak tokens', () => {
    expect(() => new TunnelMcpHttp({} as BrowserBridgeRelay, 'short')).toThrow(/64 hexadecimal/)
  })
  it('routes HTTP tool calls through the paired browser relay', async () => {
    const relay = new BrowserBridgeRelay(['http://localhost:5173'])
    const relayPort = await relay.listen(0)
    const server = new TunnelMcpHttp(relay, token)
    const httpPort = await server.listen(0)
    const origin = 'http://localhost:5173'
    try {
      const paired = await fetch(`http://127.0.0.1:${relayPort}/bridge/pair`, { method: 'POST', headers: { origin } })
      const pairing = (await paired.json()) as { token: string }
      const headers = { origin, authorization: `Bearer ${pairing.token}` }
      await fetch(`http://127.0.0.1:${relayPort}/bridge/poll`, { headers })
      const called = post(httpPort, {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'inspect_project', arguments: {} },
      })
      let toolRequest: { id: string; tool: string } | undefined
      for (let i = 0; i < 100 && !toolRequest; i += 1) {
        const poll = await fetch(`http://127.0.0.1:${relayPort}/bridge/poll`, { headers })
        if (poll.status === 200) toolRequest = (await poll.json()) as typeof toolRequest
        else await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(toolRequest?.tool).toBe('inspect_project')
      const response = await fetch(`http://127.0.0.1:${relayPort}/bridge/respond`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ id: toolRequest?.id, result: { project: 'paired page' } }),
      })
      expect(response.status).toBe(204)
      expect(JSON.stringify(await result(await called))).toContain('paired page')
    } finally {
      await server.close()
      relay.close()
    }
  })
})
