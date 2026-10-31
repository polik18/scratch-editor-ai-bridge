import { describe, expect, it } from 'vitest'
import { parseProgressSave } from '../../src/core/progress/storage'

const revision = `sha256:${'a'.repeat(64)}`
const data = {
  format: 'scratch-ai-bridge/progress',
  version: 1,
  projectRevision: revision,
  slot: 'original',
  savedAt: '2026-10-31T00:00:00.000Z',
  variables: [{ targetName: 'Stage', isStage: true, id: 'score', name: 'score', type: '', value: 42 }],
}
describe('progress import validation', () => {
  it('binds an imported save to the selected slot while retaining its exact project revision', () => {
    expect(parseProgressSave(data, revision, 'copy')).toMatchObject({ slot: 'copy', projectRevision: revision })
    expect(() => parseProgressSave(data, `sha256:${'b'.repeat(64)}`, 'copy')).toThrow(/版本/)
    expect(parseProgressSave(data, null, 'copy').projectRevision).toBe(revision)
  })
  it('rejects duplicate identifiers and unsupported values', () => {
    expect(() =>
      parseProgressSave({ ...data, variables: [data.variables[0], data.variables[0]] }, revision, 'copy'),
    ).toThrow(/重複/)
    expect(() =>
      parseProgressSave(
        { ...data, variables: [{ ...data.variables[0], value: { script: 'bad' } }] },
        revision,
        'copy',
      ),
    ).toThrow(/無效/)
  })
  it('accepts old saves and validates imported sprite states', () => {
    expect(parseProgressSave(data, revision, 'copy').targets).toBeUndefined()
    const sprite = {
      name: 'Cat',
      isStage: false,
      currentCostume: 0,
      x: 10,
      y: 20,
      direction: 90,
      size: 100,
      visible: true,
    }
    expect(parseProgressSave({ ...data, targets: [sprite] }, revision, 'copy').targets).toEqual([sprite])
    expect(() => parseProgressSave({ ...data, targets: [{ ...sprite, x: Infinity }] }, revision, 'copy')).toThrow(
      /sprite state/,
    )
    expect(() => parseProgressSave({ ...data, targets: [sprite, sprite] }, revision, 'copy')).toThrow(/Duplicate/)
  })
})
