import { describe, expect, it } from 'vitest'
import {
  parseSelfHostedCloudValue,
  selfHostedCloudKey,
  validSelfHostedCloudValue,
} from '../../src/core/cloud/self-hosted'
import { decryptProgressSave, encryptCloudValue } from '../../src/core/progress/encryption'
import { syncSaveKey } from '../../src/core/progress/sync-client'

const revision = `sha256:${'a'.repeat(64)}`
const value = {
  format: 'scratch-ai-bridge/self-hosted-cloud-value',
  version: 1,
  projectRevision: revision,
  name: '☁ score',
  value: '-17.5',
} as const

describe('self-hosted cloud data', () => {
  it('separates cloud variables from save slots and binds keys to project and name', () => {
    expect(selfHostedCloudKey(revision, value.name)).toBe(selfHostedCloudKey(revision, value.name))
    expect(selfHostedCloudKey(revision, value.name)).not.toBe(syncSaveKey(revision, value.name))
    expect(selfHostedCloudKey(revision, value.name)).not.toBe(selfHostedCloudKey(revision, '☁ other'))
    expect(() => selfHostedCloudKey('bad', value.name)).toThrow()
  })

  it('accepts bounded decimal values and rejects malformed or mismatched records', () => {
    for (const item of [17, '17', '-17.5', '0']) expect(validSelfHostedCloudValue(item)).toBe(true)
    for (const item of [Infinity, '1e6', '', 'x', '1'.repeat(257)])
      expect(validSelfHostedCloudValue(item)).toBe(false)
    expect(parseSelfHostedCloudValue(value, revision, value.name)).toBe('-17.5')
    expect(() => parseSelfHostedCloudValue(value, revision, '☁ other')).toThrow()
    expect(() => parseSelfHostedCloudValue({ ...value, extra: true }, revision, value.name)).toThrow()
    expect(() => parseSelfHostedCloudValue({ ...value, value: 'NaN' }, revision, value.name)).toThrow()
  })

  it('encrypts cloud data locally and rejects the wrong password', async () => {
    const encrypted = await encryptCloudValue(value, 'a strong password')
    expect(JSON.stringify(encrypted)).not.toContain(value.name)
    expect(
      parseSelfHostedCloudValue(await decryptProgressSave(encrypted, 'a strong password'), revision, value.name),
    ).toBe('-17.5')
    await expect(decryptProgressSave(encrypted, 'a wrong password')).rejects.toThrow()
  })
})
