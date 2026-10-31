import { createServer, request } from 'node:http'
import { networkInterfaces } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalModelGateway, privateModelEndpoint } from '../../src/provider-gateway/gateway'

const call = (port: number, path: string, headers: Record<string, string> = {}, body = '') =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { origin: 'http://localhost:5173', ...headers } },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          data += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
afterEach(() => vi.unstubAllGlobals())

describe('local network model gateway', () => {
  it('restricts the destination to literal private IPv4 with no URL credentials or redirects', () => {
    expect(privateModelEndpoint('http://192.168.1.20:1234/v1').href).toBe(
      'http://192.168.1.20:1234/v1/chat/completions',
    )
    for (const url of [
      'http://localhost:1234',
      'http://127.0.0.1',
      'http://8.8.8.8',
      'http://172.32.1.1',
      'http://user:pass@192.168.1.1',
      'http://192.168.1.1/?x=1',
    ])
      expect(() => privateModelEndpoint(url)).toThrow()
  })
  it('requires pairing and only forwards to the configured endpoint', async () => {
    const modelFetch = vi.fn().mockResolvedValue(new Response('{"choices":[]}', { status: 200 }))
    vi.stubGlobal('fetch', modelFetch)
    const gateway = new LocalModelGateway('http://192.168.1.20:1234/v1', ['http://localhost:5173'])
    const port = await gateway.listen(0)
    try {
      expect((await call(port, '/v1/chat/completions', {}, '{}')).status).toBe(401)
      expect((await call(port, '/bridge/pair', { origin: 'https://untrusted.example' })).status).toBe(403)
      const paired = await call(port, '/bridge/pair')
      const token = (JSON.parse(paired.body) as { token: string }).token
      const headers = { 'x-bridge-token': token, authorization: 'Bearer local-secret' }
      expect((await call(port, '/other', headers, '{}')).status).toBe(404)
      const response = await call(port, '/v1/chat/completions', headers, '{"model":"test"}')
      expect(response.status).toBe(200)
      expect(modelFetch).toHaveBeenCalledTimes(1)
      const [url, options] = modelFetch.mock.calls[0] as [URL, RequestInit]
      expect(url.href).toBe('http://192.168.1.20:1234/v1/chat/completions')
      expect(options.redirect).toBe('error')
      expect(options.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer local-secret' })
      expect((await call(port, '/bridge/unpair', headers)).status).toBe(204)
      expect((await call(port, '/v1/chat/completions', headers, '{}')).status).toBe(401)
    } finally {
      gateway.close()
    }
  })
  it('forwards to a mock model bound to a private network interface', async (context) => {
    const ip = Object.values(networkInterfaces())
      .flat()
      .find(
        (item) =>
          item &&
          item.family === 'IPv4' &&
          !item.internal &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address),
      )?.address
    if (!ip) return context.skip()
    const model = createServer((_request, response) =>
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end('{"choices":[{"message":{"content":"ok"}}]}'),
    )
    await new Promise<void>((resolve) => model.listen(0, ip, resolve))
    const address = model.address()
    if (!address || typeof address === 'string') throw new Error('Mock model has no port')
    const gateway = new LocalModelGateway(`http://${ip}:${address.port}/v1`, ['http://localhost:5173'])
    const port = await gateway.listen(0)
    try {
      const paired = await call(port, '/bridge/pair')
      const token = (JSON.parse(paired.body) as { token: string }).token
      const result = await call(port, '/v1/chat/completions', { 'x-bridge-token': token }, '{"model":"mock"}')
      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ choices: [{ message: { content: 'ok' } }] })
    } finally {
      gateway.close()
      model.close()
    }
  })
})
