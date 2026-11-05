import { describe, expect, it } from 'vitest'
import { runBehaviorTest } from '../src/test/behavior-test'

describe('runBehaviorTest', () => {
  it('does not claim unexecuted behavior passed', async () => {
    await expect(runBehaviorTest({ invalid: true })).rejects.toThrow(/not implemented/i)
  })
})
