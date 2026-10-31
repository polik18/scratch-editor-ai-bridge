import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export const validSelfHostedCloudValue = (value: unknown): value is string | number => {
  if (typeof value === 'number' && !Number.isFinite(value)) return false
  if (typeof value !== 'string' && typeof value !== 'number') return false
  const text = String(value)
  return text.length > 0 && text.length <= 256 && /^-?\d+(?:\.\d+)?$/.test(text)
}

export const selfHostedCloudKey = (revision: string, name: string): string => {
  if (!/^sha256:[a-f0-9]{64}$/.test(revision) || !name || name.length > 256)
    throw new Error('雲端變數作品或名稱無效。')
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['scratch-ai-bridge-cloud-v1', revision, name]))))
}

export const parseSelfHostedCloudValue = (value: unknown, revision: string, name: string): string | number => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('自架雲端資料格式無效。')
  const entry = value as Record<string, unknown>
  if (
    Object.keys(entry).sort().join(',') !== 'format,name,projectRevision,value,version' ||
    entry.format !== 'scratch-ai-bridge/self-hosted-cloud-value' ||
    entry.version !== 1 ||
    entry.projectRevision !== revision ||
    entry.name !== name ||
    !validSelfHostedCloudValue(entry.value)
  )
    throw new Error('自架雲端資料與作品或變數不符。')
  return entry.value
}
