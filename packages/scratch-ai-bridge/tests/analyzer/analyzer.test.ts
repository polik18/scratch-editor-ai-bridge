import { describe, expect, it } from 'vitest'
import { analyzeCanonicalProject } from '../../src/core/analyzer'
import broadcastExample from '../../src/core/ir/examples/04-broadcast-flow.json'
import type { CanonicalProject } from '../../src/core/ir/types'

describe('analysis IR', () => {
  it('summarizes scripts and broadcast dependencies', () => {
    const result = analyzeCanonicalProject(broadcastExample as CanonicalProject)
    expect(result.summary.scripts).toBe(2)
    expect(result.summary.broadcasts).toBe(1)
    expect(result.dependencies.broadcasts[0]).toMatchObject({
      name: 'game_over',
      senders: ['Stage#1'],
      receivers: ['Stage#2'],
    })
  })
})
