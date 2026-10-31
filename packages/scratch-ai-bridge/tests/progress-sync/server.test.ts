import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encryptProgressSave } from '../../src/core/progress/encryption'
import { ProgressSyncServer } from '../../src/progress-sync/server'
import { EncryptedSaveStore } from '../../src/progress-sync/store'

const token = 'a'.repeat(64)
const origin = 'http://localhost:5173'
const key = 'b'.repeat(64)
const save = {
  format: 'scratch-ai-bridge/progress' as const,
  version: 1 as const,
  projectRevision: `sha256:${'c'.repeat(64)}`,
  slot: 'private',
  savedAt: '2026-10-31T00:00:00Z',
  variables: [{ name: 'secret-value' }],
}

describe('self-hosted encrypted progress storage', () => {
  it('protects concurrent updates, stores ciphertext and enforces one process per root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bridge-sync-'))
    const store = new EncryptedSaveStore(root)
    const other = new EncryptedSaveStore(root)
    await store.start()
    try {
      await expect(other.start()).rejects.toThrow()
      const first = await encryptProgressSave(save, 'correct horse battery staple')
      const next = await encryptProgressSave({ ...save, slot: 'second' }, 'correct horse battery staple')
      const initial = await store.put(key, first, null)
      await expect(store.put(key, next, null)).rejects.toThrow('SAVE_CONFLICT')
      const races = await Promise.allSettled([store.put(key, next, initial), store.put(key, first, initial)])
      expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(races.filter((result) => result.status === 'rejected')).toHaveLength(1)
      const stored = await store.get(key)
      expect(stored).not.toBeNull()
      const directory = join(root, 'scratch-ai-bridge-sync-v1')
      const body = await readFile(join(directory, `${key}.json`), 'utf8')
      expect(body).not.toContain('secret-value')
      expect((await stat(join(directory, `${key}.json`))).mode & 0o077).toBe(0)
      await expect(store.delete(key, initial)).rejects.toThrow('SAVE_CONFLICT')
      await store.delete(key, stored!.etag)
      expect(await store.get(key)).toBeNull()
      expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toEqual([])
    } finally {
      await store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
  it('checks origin, token, conditional writes and rejects plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bridge-sync-http-'))
    const store = new EncryptedSaveStore(root)
    await store.start()
    const server = new ProgressSyncServer(store, token, [origin])
    const port = await server.listen(0)
    const url = `http://127.0.0.1:${port}/v1/saves/${key}`
    const headers = { origin, authorization: `Bearer ${token}` }
    try {
      expect((await fetch(url, { headers: { origin, authorization: 'Bearer bad' } })).status).toBe(401)
      expect((await fetch(url, { headers: { ...headers, origin: 'https://untrusted.example' } })).status).toBe(403)
      expect((await fetch(url, { headers })).status).toBe(404)
      expect(
        (
          await fetch(url, {
            method: 'PUT',
            headers: { ...headers, 'content-type': 'application/json', 'if-none-match': '*' },
            body: JSON.stringify(save),
          })
        ).status,
      ).toBe(400)
      const encrypted = await encryptProgressSave(save, 'correct horse battery staple')
      expect(
        (
          await fetch(url, {
            method: 'PUT',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify(encrypted),
          })
        ).status,
      ).toBe(428)
      const created = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json', 'if-none-match': '*' },
        body: JSON.stringify(encrypted),
      })
      expect(created.status).toBe(200)
      const etag = created.headers.get('etag')!
      expect(
        (
          await fetch(url, {
            method: 'PUT',
            headers: { ...headers, 'content-type': 'application/json', 'if-none-match': '*' },
            body: JSON.stringify(encrypted),
          })
        ).status,
      ).toBe(412)
      const read = await fetch(url, { headers })
      expect(read.headers.get('etag')).toBe(etag)
      expect(await read.json()).toEqual(encrypted)
      expect(
        (await fetch(url, { method: 'DELETE', headers: { ...headers, 'if-match': `"${'0'.repeat(64)}"` } })).status,
      ).toBe(412)
      expect((await fetch(url, { method: 'DELETE', headers: { ...headers, 'if-match': etag } })).status).toBe(204)
    } finally {
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
