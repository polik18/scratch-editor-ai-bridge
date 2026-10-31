import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { BrowserBridgeRelay } from './companion.js'
import { createBridgeMcpFactory } from './tools.js'

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.byteLength
    if (length > 64 * 1024) throw new Error('Request exceeds 64 KiB.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

/** Loopback-only Streamable HTTP adapter intended for an authenticated SSH tunnel. */
export class TunnelMcpHttp {
  private readonly server: Server
  private readonly handler
  private readonly token: Buffer
  private readonly expires = Date.now() + 30 * 60_000
  private active = 0
  constructor(relay: BrowserBridgeRelay, token: string) {
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('MCP token must be 64 hexadecimal characters.')
    this.token = Buffer.from(token, 'utf8')
    this.handler = createMcpHandler(createBridgeMcpFactory(relay), {
      maxRequestBodySize: 64 * 1024,
      maxSubscriptions: 1,
    })
    this.server = createServer((request, response) => {
      void this.handle(request, response)
    })
  }
  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject)
        const address = this.server.address()
        if (!address || typeof address === 'string') return reject(new Error('MCP HTTP has no TCP address.'))
        resolve(address.port)
      })
    })
  }
  async close(): Promise<void> {
    this.token.fill(0)
    this.server.closeAllConnections()
    this.server.close()
    await this.handler.close()
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let host = ''
    try {
      host = new URL(`http://${request.headers.host ?? ''}`).hostname
    } catch {
      response.writeHead(400).end()
      return
    }
    if (!['127.0.0.1', 'localhost'].includes(host) || request.headers.origin) {
      response.writeHead(403).end()
      return
    }
    const auth = request.headers.authorization
    const received = Buffer.from(auth?.startsWith('Bearer ') ? auth.slice(7) : '', 'utf8')
    if (
      Date.now() >= this.expires ||
      received.length !== this.token.length ||
      !timingSafeEqual(received, this.token)
    ) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end()
      return
    }
    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(405).end()
      return
    }
    if (this.active >= 4) {
      response.writeHead(429).end()
      return
    }
    this.active += 1
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
      request.destroy()
    }, 30_000)
    response.on('close', () => {
      if (!response.writableEnded) controller.abort()
    })
    try {
      const body = await readBody(request)
      const headers = new Headers()
      for (const key of [
        'content-type',
        'accept',
        'mcp-protocol-version',
        'mcp-session-id',
        'mcp-method',
        'mcp-name',
      ]) {
        const value = request.headers[key]
        if (typeof value === 'string') headers.set(key, value)
      }
      const result = await this.handler.fetch(
        new Request('http://127.0.0.1/mcp', { method: 'POST', headers, body, signal: controller.signal }),
      )
      const chunks: Uint8Array[] = []
      let length = 0
      const reader = result.body?.getReader()
      if (reader)
        for (;;) {
          const item = await reader.read()
          if (item.done) break
          length += item.value.byteLength
          if (length > 1024 * 1024) {
            await reader.cancel()
            throw new Error('MCP response exceeds 1 MiB.')
          }
          chunks.push(item.value)
        }
      const outputHeaders: Record<string, string> = { 'cache-control': 'no-store' }
      for (const key of ['content-type', 'mcp-session-id', 'mcp-protocol-version']) {
        const value = result.headers.get(key)
        if (value) outputHeaders[key] = value
      }
      response.writeHead(result.status, outputHeaders).end(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
    } catch (error) {
      if (!response.headersSent && !response.destroyed)
        response
          .writeHead(400, { 'content-type': 'application/json' })
          .end(
            JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 300) : 'MCP request failed.' }),
          )
    } finally {
      clearTimeout(timer)
      this.active -= 1
    }
  }
}
