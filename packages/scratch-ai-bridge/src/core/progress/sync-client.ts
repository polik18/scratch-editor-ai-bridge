import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export interface SyncConnection {
  readonly baseUrl: string
  readonly token: string
  readonly fetchImpl?: typeof fetch
  readonly signal?: AbortSignal
}

export const syncSaveKey = (revision: string, slot: string): string => {
  if (!/^sha256:[a-f0-9]{64}$/.test(revision) || !slot.trim() || slot.length > 40)
    throw new Error('作品版本或存檔名稱無效。')
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['scratch-ai-bridge-sync-v1', revision, slot]))))
}

const target = (connection: SyncConnection, key: string): URL => {
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/i.test(connection.token))
    throw new Error('同步 token 或存檔識別無效。')
  const url = new URL(connection.baseUrl)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('同步網址必須是本機 HTTP origin。跨裝置請使用 SSH tunnel。')
  url.pathname = `/v1/saves/${key}`
  return url
}
const etagValue = (value: string | null): string => {
  if (!value || !/^"[a-f0-9]{64}"$/.test(value)) throw new Error('同步伺服器沒有回傳有效版本。')
  return value
}
const readLimited = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('同步伺服器回應為空。')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 224 * 1024) {
      await reader.cancel()
      throw new Error('同步存檔超過上限。')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
const withTimeout = async <T>(operation: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> => {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  if (external?.aborted) abort()
  else external?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    return await operation(controller.signal)
  } catch (error) {
    if (external?.aborted) throw new Error('同步已取消。')
    if (controller.signal.aborted) throw new Error('同步連線逾時，請檢查服務或 SSH tunnel。')
    throw error
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', abort)
  }
}

export const getSyncedSave = async (
  connection: SyncConnection,
  key: string,
): Promise<{ readonly etag: string; readonly document: unknown } | null> =>
  withTimeout(async (signal) => {
    const response = await (connection.fetchImpl ?? fetch)(target(connection, key), {
      headers: { Authorization: `Bearer ${connection.token}` },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`同步讀取失敗（HTTP ${response.status}）。`)
    return {
      etag: etagValue(response.headers.get('etag')),
      document: JSON.parse(await readLimited(response)) as unknown,
    }
  }, connection.signal)

export const putSyncedSave = async (
  connection: SyncConnection,
  key: string,
  document: Record<string, unknown>,
  expected: string | null,
): Promise<string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${connection.token}`,
    'Content-Type': 'application/json',
  }
  if (expected === null) headers['If-None-Match'] = '*'
  else headers['If-Match'] = etagValue(expected)
  return withTimeout(async (signal) => {
    const body = JSON.stringify(document)
    if (new TextEncoder().encode(body).byteLength > 224 * 1024) throw new Error('加密存檔超過同步上限。')
    const response = await (connection.fetchImpl ?? fetch)(target(connection, key), {
      method: 'PUT',
      headers,
      body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
    if (response.status === 412) throw new Error('遠端存檔已變更；請先下載並比較，再決定是否覆蓋。')
    if (!response.ok) throw new Error(`同步上傳失敗（HTTP ${response.status}）。`)
    return etagValue(response.headers.get('etag'))
  }, connection.signal)
}

export const deleteSyncedSave = async (connection: SyncConnection, key: string, expected: string): Promise<void> => {
  await withTimeout(async (signal) => {
    const response = await (connection.fetchImpl ?? fetch)(target(connection, key), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${connection.token}`, 'If-Match': etagValue(expected) },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    })
    if (response.status === 412) throw new Error('遠端存檔已變更；請重新讀取後再刪除。')
    if (!response.ok) throw new Error(`同步刪除失敗（HTTP ${response.status}）。`)
  }, connection.signal)
}
