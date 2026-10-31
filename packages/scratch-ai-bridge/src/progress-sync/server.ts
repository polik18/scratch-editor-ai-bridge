import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { EncryptedSaveStore } from './store.js'

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > 224 * 1024) throw new Error('Encrypted save is too large.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

/** Loopback-only encrypted save server. Remote access requires an SSH tunnel. */
export class ProgressSyncServer {
  private readonly server: Server
  private readonly token: Buffer
  private readonly origins: ReadonlySet<string>
  private active = 0
  private closing = false
  constructor(privateStore: EncryptedSaveStore, token: string, origins: readonly string[]) {
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Sync token must be 64 hexadecimal characters.')
    this.store = privateStore
    this.token = Buffer.from(token, 'utf8')
    this.origins = new Set(origins)
    this.server = createServer((request, response) => {
      void this.handle(request, response)
    })
  }
  private readonly store: EncryptedSaveStore
  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject)
        const address = this.server.address()
        if (!address || typeof address === 'string') return reject(new Error('Sync server has no TCP address.'))
        resolve(address.port)
      })
    })
  }
  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.token.fill(0)
    this.server.closeAllConnections()
    this.server.close()
    await this.store.close()
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let host = ''
    try {
      host = new URL(`http://${request.headers.host ?? ''}`).hostname
    } catch {
      response.writeHead(400).end()
      return
    }
    const origin = request.headers.origin
    if (this.closing || !['127.0.0.1', 'localhost'].includes(host) || !origin || !this.origins.has(origin)) {
      response.writeHead(403).end()
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, If-None-Match')
    response.setHeader('Access-Control-Expose-Headers', 'ETag')
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
    response.setHeader('Vary', 'Origin')
    response.setHeader('Cache-Control', 'no-store')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    const authorization = request.headers.authorization
    const supplied = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '', 'utf8')
    if (supplied.length !== this.token.length || !timingSafeEqual(supplied, this.token)) {
      response.writeHead(401).end()
      return
    }
    const match = /^\/v1\/saves\/([a-f0-9]{64})$/.exec(request.url ?? '')
    if (!match) {
      response.writeHead(404).end()
      return
    }
    const key = match[1]
    if (!['GET', 'PUT', 'DELETE'].includes(request.method ?? '')) {
      response.writeHead(405).end()
      return
    }
    if (this.active >= 8) {
      response.writeHead(429).end()
      return
    }
    this.active += 1
    const timer = setTimeout(() => request.destroy(), 15_000)
    try {
      if (request.method === 'GET') {
        const stored = await this.store.get(key)
        if (!stored) {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/json', ETag: `"${stored.etag}"` }).end(stored.body)
        return
      }
      const ifMatch = /^"([a-f0-9]{64})"$/.exec(request.headers['if-match'] ?? '')
      const create = request.headers['if-none-match'] === '*'
      if (
        (request.headers['if-match'] !== undefined && !ifMatch) ||
        (request.headers['if-none-match'] !== undefined && !create) ||
        (create && ifMatch) ||
        (!create && !ifMatch) ||
        (request.method === 'DELETE' && !ifMatch)
      ) {
        response.writeHead(428).end()
        return
      }
      if (request.method === 'PUT') {
        const input: unknown = JSON.parse(await readBody(request))
        const etag = await this.store.put(key, input, create ? null : (ifMatch?.[1] ?? null))
        response.writeHead(200, { ETag: `"${etag}"` }).end()
      } else {
        await this.store.delete(key, ifMatch?.[1] ?? '')
        response.writeHead(204).end()
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const conflict = error instanceof Error && error.message === 'SAVE_CONFLICT'
        response
          .writeHead(conflict ? 412 : 400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: conflict ? 'Save changed; fetch again.' : 'Save request failed.' }))
      }
    } finally {
      clearTimeout(timer)
      this.active -= 1
    }
  }
}
