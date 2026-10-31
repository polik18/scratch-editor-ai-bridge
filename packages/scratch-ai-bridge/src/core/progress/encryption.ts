import type { ProgressSave } from './storage'

const FORMAT = 'scratch-ai-bridge/encrypted-progress'
const ITERATIONS = 310_000
const MAX_PLAINTEXT = 160 * 1024
const encoder = new TextEncoder()
const additionalData = encoder.encode('scratch-ai-bridge/encrypted-progress/v1')

const encode = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
const decode = (value: unknown, maxBytes: number): Uint8Array<ArrayBuffer> => {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error('加密存檔格式無效。')
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
const keyFor = async (password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> => {
  if (password.length < 12 || password.length > 256) throw new Error('加密密碼須為 12 至 256 個字元。')
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt one export locally; the password is not stored in the envelope.
 * @param value Data to protect.
 * @param password User-provided password.
 * @returns Encrypted export envelope.
 */
const encryptPrivateValue = async (value: unknown, password: string): Promise<Record<string, unknown>> => {
  const plaintext = encoder.encode(JSON.stringify(value))
  if (plaintext.byteLength > MAX_PLAINTEXT) throw new Error('存檔超過加密上限。')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFor(password, salt)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plaintext)
  return {
    format: FORMAT,
    version: 1,
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: encode(salt),
    cipher: 'AES-256-GCM',
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  }
}

export const encryptProgressSave = (save: ProgressSave, password: string): Promise<Record<string, unknown>> =>
  encryptPrivateValue(save, password)

export interface PrivateCloudValue {
  readonly format: 'scratch-ai-bridge/self-hosted-cloud-value'
  readonly version: 1
  readonly projectRevision: string
  readonly name: string
  readonly value: string | number
}

export const encryptCloudValue = (value: PrivateCloudValue, password: string): Promise<Record<string, unknown>> =>
  encryptPrivateValue(value, password)

/**
 * Decrypt an untrusted export; callers must validate the resulting save.
 * @param value Untrusted encrypted envelope.
 * @param password User-provided password.
 * @returns Parsed plaintext data.
 */
export const decryptProgressSave = async (value: unknown, password: string): Promise<unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('加密存檔格式無效。')
  const data = value as Record<string, unknown>
  if (
    Object.keys(data).some(
      (key) => !['format', 'version', 'kdf', 'iterations', 'salt', 'cipher', 'iv', 'ciphertext'].includes(key),
    ) ||
    data.format !== FORMAT ||
    data.version !== 1 ||
    data.kdf !== 'PBKDF2-SHA-256' ||
    data.iterations !== ITERATIONS ||
    data.cipher !== 'AES-256-GCM'
  )
    throw new Error('加密存檔格式或版本不支援。')
  const salt = decode(data.salt, 16)
  const iv = decode(data.iv, 12)
  const ciphertext = decode(data.ciphertext, MAX_PLAINTEXT + 16)
  if (salt.byteLength !== 16 || iv.byteLength !== 12 || ciphertext.byteLength < 16)
    throw new Error('加密存檔格式無效。')
  const key = await keyFor(password, salt)
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, ciphertext)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown
  } catch {
    throw new Error('密碼錯誤或加密存檔已損壞。')
  }
}

export const isEncryptedProgressSave = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { format?: unknown }).format === FORMAT
