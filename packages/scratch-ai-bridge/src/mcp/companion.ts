import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'

export interface BrowserToolRequest {
  readonly id: string
  readonly tool: string
  readonly arguments: Record<string, unknown>
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

const MAX_REQUEST_BODY_BYTES = 32 * 1024
const MAX_PENDING_REQUESTS = 4

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error('Bridge relay request body exceeds 32 KiB.')
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown
  } catch {
    throw new Error('Bridge relay request body is not valid JSON.')
  }
}

const bearerTokenMatches = (authorization: string | undefined, token: string): boolean => {
  if (!authorization?.startsWith('Bearer ')) return false
  const actual = Buffer.from(authorization.slice(7))
  const expected = Buffer.from(token)
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

export class BrowserBridgeRelay {
  private readonly server: Server
  private readonly allowedOrigins: ReadonlySet<string>
  private readonly pending = new Map<string, PendingRequest>()
  private readonly queue: BrowserToolRequest[] = []
  private token = ''
  private tokenExpiresAt = 0
  private readonly pairTimes: number[] = []
  private lastBrowserPoll = 0

  constructor(allowedOrigins: readonly string[]) {
    this.allowedOrigins = new Set(allowedOrigins)
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
        if (!address || typeof address === 'string') return reject(new Error('Bridge relay has no TCP address.'))
        resolve(address.port)
      })
    })
  }

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.token || Date.now() >= this.tokenExpiresAt)
      throw new Error('Scratch AI Bridge page is not paired. Open the game and connect the MCP relay.')
    await this.waitForBrowserPoll()
    if (this.pending.size >= MAX_PENDING_REQUESTS)
      throw new Error('Too many MCP requests are waiting for the Bridge page.')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Bridge page did not answer the MCP request within 20 seconds.'))
      }, 20_000)
      this.pending.set(id, { resolve, reject, timer })
      this.queue.push({ id, tool, arguments: args })
    })
  }

  private async waitForBrowserPoll(): Promise<void> {
    const deadline = Date.now() + 5_000
    while (Date.now() - this.lastBrowserPoll > 5_000 && Date.now() < deadline) {
      if (!this.token || Date.now() >= this.tokenExpiresAt)
        throw new Error('Bridge MCP pairing expired or was disconnected.')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (Date.now() - this.lastBrowserPoll > 5_000)
      throw new Error('Bridge page is not polling the MCP relay. Reconnect MCP from the Bridge page.')
  }

  close(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Bridge MCP relay closed.'))
      this.pending.delete(id)
    }
    this.server.close()
  }

  private async handle(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    let hostname = ''
    try {
      hostname = new URL(`http://${request.headers.host ?? ''}`).hostname.replace(/^\[|\]$/g, '')
    } catch {
      response.writeHead(400).end()
      return
    }
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      response.writeHead(403).end()
      return
    }
    const origin = request.headers.origin
    if (!origin || !this.allowedOrigins.has(origin)) {
      response.writeHead(403).end()
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (request.method === 'POST' && path === '/bridge/pair') {
      const now = Date.now()
      while (this.pairTimes.length > 0 && now - (this.pairTimes.at(0) ?? now) >= 60_000) this.pairTimes.shift()
      if (this.pairTimes.length >= 5) {
        response.writeHead(429).end()
        return
      }
      this.pairTimes.push(now)
      this.revokePairing()
      this.token = randomBytes(32).toString('base64url')
      this.tokenExpiresAt = now + 30 * 60_000
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ token: this.token, expiresAt: this.tokenExpiresAt }))
      return
    }
    if (
      !this.token ||
      Date.now() >= this.tokenExpiresAt ||
      !bearerTokenMatches(request.headers.authorization, this.token)
    ) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'POST' && path === '/bridge/unpair') {
      this.revokePairing()
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
      return
    }
    if (request.method === 'GET' && path === '/bridge/poll') {
      this.lastBrowserPoll = Date.now()
      const toolRequest = this.queue.shift()
      if (!toolRequest) {
        response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(toolRequest))
      return
    }
    if (request.method === 'POST' && path === '/bridge/respond') {
      try {
        const body = await readBody(request)
        if (typeof body !== 'object' || body === null || Array.isArray(body))
          throw new Error('Invalid response object.')
        const { id, result, error } = body as { id?: unknown; result?: unknown; error?: unknown }
        if (typeof id !== 'string') throw new Error('Response is missing request id.')
        const pending = this.pending.get(id)
        if (!pending) throw new Error('MCP request expired or no longer exists.')
        clearTimeout(pending.timer)
        this.pending.delete(id)
        if (typeof error === 'string' && error) pending.reject(new Error(error.slice(0, 500)))
        else pending.resolve(result)
        response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
      return
    }
    response.writeHead(404).end()
  }

  private revokePairing(): void {
    this.token = ''
    this.tokenExpiresAt = 0
    this.lastBrowserPoll = 0
    this.queue.length = 0
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Bridge MCP pairing was revoked.'))
      this.pending.delete(id)
    }
  }
}
