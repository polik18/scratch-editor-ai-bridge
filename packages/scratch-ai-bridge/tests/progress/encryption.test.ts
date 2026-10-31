import { describe, expect, it } from 'vitest'
import { decryptProgressSave, encryptProgressSave, isEncryptedProgressSave } from '../../src/core/progress/encryption'
import type { ProgressSave } from '../../src/core/progress/storage'

const save: ProgressSave = {
  format: 'scratch-ai-bridge/progress',
  version: 1,
  projectRevision: `sha256:${'a'.repeat(64)}`,
  slot: 'personal',
  savedAt: '2026-10-31T00:00:00.000Z',
  variables: [{ targetName: 'Stage', isStage: true, id: 'secret', name: 'secret', type: '', value: 'private value' }],
}
describe('encrypted progress files', () => {
  it('round-trips without exposing contents and uses fresh salt and IV', async () => {
    const first = await encryptProgressSave(save, 'correct horse battery staple')
    const second = await encryptProgressSave(save, 'correct horse battery staple')
    expect(isEncryptedProgressSave(first)).toBe(true)
    expect(JSON.stringify(first)).not.toContain('private value')
    expect(JSON.stringify(first)).not.toContain(save.projectRevision)
    expect(first.salt).not.toBe(second.salt)
    expect(first.iv).not.toBe(second.iv)
    expect(await decryptProgressSave(first, 'correct horse battery staple')).toEqual(save)
    await expect(decryptProgressSave(first, 'wrong horse battery staple')).rejects.toThrow(/密碼錯誤/)
    const tampered = { ...first, ciphertext: `${String(first.ciphertext).slice(0, -4)}AAAA` }
    await expect(decryptProgressSave(tampered, 'correct horse battery staple')).rejects.toThrow()
  })
  it('rejects weak passwords and untrusted KDF parameters before decryption', async () => {
    await expect(encryptProgressSave(save, 'short')).rejects.toThrow(/12/)
    const value = await encryptProgressSave(save, 'correct horse battery staple')
    await expect(
      decryptProgressSave({ ...value, iterations: 999999999 }, 'correct horse battery staple'),
    ).rejects.toThrow(/格式/)
    await expect(decryptProgressSave({ ...value, salt: 'invalid!' }, 'correct horse battery staple')).rejects.toThrow(
      /格式/,
    )
  })
})
