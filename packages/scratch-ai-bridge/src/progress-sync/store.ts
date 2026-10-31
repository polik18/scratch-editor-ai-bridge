import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const MAX_DOCUMENT_BYTES = 224 * 1024
const digest = (body: string): string => createHash('sha256').update(body).digest('hex')

/**
 * Validate an encrypted envelope without receiving its decryption password.
 * @param value Untrusted uploaded JSON.
 * @returns Normalized JSON to store.
 */
export const validateEncryptedDocument = (value: unknown): string => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid encrypted save.')
  const data = value as Record<string, unknown>
  if (
    Object.keys(data).sort().join(',') !== 'cipher,ciphertext,format,iterations,iv,kdf,salt,version' ||
    data.format !== 'scratch-ai-bridge/encrypted-progress' ||
    data.version !== 1 ||
    data.kdf !== 'PBKDF2-SHA-256' ||
    data.iterations !== 310_000 ||
    data.cipher !== 'AES-256-GCM'
  )
    throw new Error('Invalid encrypted save format.')
  const isBase64 = (input: unknown, length: number): input is string =>
    typeof input === 'string' &&
    input.length <= Math.ceil(length / 3) * 4 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)
  if (
    !isBase64(data.salt, 16) ||
    Buffer.from(data.salt, 'base64').length !== 16 ||
    !isBase64(data.iv, 12) ||
    Buffer.from(data.iv, 'base64').length !== 12 ||
    !isBase64(data.ciphertext, 160 * 1024 + 16) ||
    Buffer.from(data.ciphertext, 'base64').length < 16
  )
    throw new Error('Invalid encrypted save data.')
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body) > MAX_DOCUMENT_BYTES) throw new Error('Encrypted save is too large.')
  return body
}

export class EncryptedSaveStore {
  private readonly directory: string
  private readonly lockPath: string
  private readonly pending = new Map<string, Promise<void>>()
  private locked = false
  constructor(root: string) {
    if (!root.trim()) throw new Error('A dedicated sync storage root is required.')
    this.directory = join(resolve(root), 'scratch-ai-bridge-sync-v1')
    this.lockPath = join(this.directory, '.server.lock')
  }
  async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const directory = await lstat(this.directory)
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && directory.uid !== process.getuid())
    )
      throw new Error('Sync directory must be owned by the current user and private.')
    const lock = await open(this.lockPath, 'wx', 0o600)
    try {
      await lock.writeFile(`${process.pid}\n`)
    } catch (error) {
      await lock.close()
      await unlink(this.lockPath)
      throw error
    }
    await lock.close()
    this.locked = true
  }
  async close(): Promise<void> {
    const hadLock = this.locked
    this.locked = false
    await Promise.all([...this.pending.values()])
    if (hadLock) {
      await unlink(this.lockPath)
    }
  }
  private path(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid save key.')
    if (!this.locked) throw new Error('Save store is not active.')
    return join(this.directory, `${key}.json`)
  }
  private async read(path: string): Promise<{ body: string; etag: string } | null> {
    let file
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new Error('Stored save is invalid or oversized.')
      const body = await file.readFile('utf8')
      validateEncryptedDocument(JSON.parse(body) as unknown)
      return { body, etag: digest(body) }
    } finally {
      await file.close()
    }
  }
  private async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.pending.set(key, current)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.pending.get(key) === current) this.pending.delete(key)
    }
  }
  async get(key: string): Promise<{ body: string; etag: string } | null> {
    const path = this.path(key)
    return this.exclusive(key, () => this.read(path))
  }
  async put(key: string, value: unknown, expected: string | null): Promise<string> {
    const path = this.path(key)
    const body = validateEncryptedDocument(value)
    return this.exclusive(key, async () => {
      const current = await this.read(path)
      if ((current?.etag ?? null) !== expected) throw new Error('SAVE_CONFLICT')
      const temp = join(this.directory, `.tmp-${randomBytes(16).toString('hex')}`)
      let file
      try {
        file = await open(temp, 'wx', 0o600)
        await file.writeFile(body, 'utf8')
        await file.sync()
        await file.close()
        file = undefined
        await rename(temp, path)
      } catch (error) {
        await file?.close().catch(() => undefined)
        await unlink(temp).catch(() => undefined)
        throw error
      }
      return digest(body)
    })
  }
  async delete(key: string, expected: string): Promise<void> {
    const path = this.path(key)
    await this.exclusive(key, async () => {
      const current = await this.read(path)
      if (current?.etag !== expected) throw new Error('SAVE_CONFLICT')
      await unlink(path)
    })
  }
}
