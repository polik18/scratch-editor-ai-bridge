import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'

/**
 * Validate a fixed private IPv4 model endpoint without resolving DNS.
 * @param input User-selected model URL.
 * @returns Validated chat completions URL.
 */
export const privateModelEndpoint = (input: string): URL => {
  const url = new URL(input)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isIP(url.hostname) !== 4
  )
    throw new Error('Model endpoint must use a private IPv4 address and have no credentials, query or fragment.')
  const parts = url.hostname.split('.').map(Number)
  if (!(
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  ))
    throw new Error('Only RFC 1918 private IPv4 model endpoints are allowed.')
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/chat/completions')
    ? path
    : `${path}${path.endsWith('/v1') ? '' : '/v1'}/chat/completions`
  return url
}

const readLimited = async (request: IncomingMessage): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > 128 * 1024) throw new Error('Request exceeds 128 KiB.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

export class LocalModelGateway {
  private readonly server: Server
  private readonly endpoint: URL
  private readonly origins: ReadonlySet<string>
  private token = ''
  private expires = 0
  private readonly pairTimes: number[] = []
  private active = 0
  private readonly requests = new Set<AbortController>()
  constructor(endpoint: string, origins: readonly string[]) {
    this.endpoint = privateModelEndpoint(endpoint)
    this.origins = new Set(origins)
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
        if (!address || typeof address === 'string') return reject(new Error('Gateway has no TCP address.'))
        resolve(address.port)
      })
    })
  }
  close(): void {
    this.revoke()
    this.server.close()
  }
  private revoke(): void {
    this.token = ''
    for (const controller of this.requests) controller.abort()
    this.requests.clear()
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let host: string
    try {
      host = new URL(`http://${request.headers.host ?? ''}`).hostname
    } catch {
      response.writeHead(400).end()
      return
    }
    const origin = request.headers.origin
    if (!['127.0.0.1', 'localhost'].includes(host) || !origin || !this.origins.has(origin)) {
      response.writeHead(403).end()
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Bridge-Token')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
    response.setHeader('Vary', 'Origin')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    const path = request.url
    if (request.method === 'POST' && path === '/bridge/pair') {
      const now = Date.now()
      while (this.pairTimes.length && now - (this.pairTimes[0] ?? now) >= 60_000) this.pairTimes.shift()
      if (this.pairTimes.length >= 5) {
        response.writeHead(429).end()
        return
      }
      this.pairTimes.push(now)
      this.revoke()
      this.token = randomBytes(32).toString('base64url')
      this.expires = now + 30 * 60_000
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ token: this.token, endpoint: this.endpoint.origin }))
      return
    }
    const actual = Buffer.from(
      typeof request.headers['x-bridge-token'] === 'string' ? request.headers['x-bridge-token'] : '',
    )
    const expected = Buffer.from(this.token)
    if (
      !this.token ||
      Date.now() >= this.expires ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'POST' && path === '/bridge/unpair') {
      this.revoke()
      response.writeHead(204).end()
      return
    }
    if (request.method !== 'POST' || path !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    if (this.active >= 2) {
      response.writeHead(429).end()
      return
    }
    this.active += 1
    const controller = new AbortController()
    this.requests.add(controller)
    const timeout = setTimeout(() => {
      controller.abort()
      request.destroy()
    }, 120_000)
    response.on('close', () => {
      if (!response.writableEnded) controller.abort()
    })
    try {
      const body = await readLimited(request)
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('Model request must be a JSON object.')
      if ((parsed as { stream?: unknown }).stream === true) throw new Error('Streaming is not supported.')
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (request.headers.authorization) headers.authorization = request.headers.authorization
      const result = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: Buffer.from(body),
        redirect: 'error',
        signal: controller.signal,
      })
      const reader = result.body?.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      if (reader)
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1024 * 1024) {
            await reader.cancel()
            throw new Error('Model response exceeds 1 MiB.')
          }
          chunks.push(value)
        }
      response
        .writeHead(result.status, { 'Content-Type': 'application/json' })
        .end(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
    } catch (error) {
      if (!response.headersSent)
        response.writeHead(502, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            error: error instanceof Error ? error.message.slice(0, 300) : 'Gateway request failed.',
          }),
        )
    } finally {
      clearTimeout(timeout)
      this.requests.delete(controller)
      this.active -= 1
    }
  }
}
