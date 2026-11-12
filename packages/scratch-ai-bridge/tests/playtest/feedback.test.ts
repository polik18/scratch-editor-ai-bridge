import { describe, expect, it } from 'vitest'
import keyboardProject from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createPlaytestFeedback, inferPlaytestPlan, type PlaytestObservation } from '../../src/core/playtest/feedback'

const readyObservation = (overrides: Partial<PlaytestObservation> = {}): PlaytestObservation => ({
  ready: true,
  pageErrors: [],
  autonomousMotion: true,
  controls: [
    { key: 'ArrowLeft', expected: 'x-', moved: true, sprite: 'Player', delta: 8 },
    { key: 'ArrowRight', expected: 'x+', moved: true, sprite: 'Player', delta: 8 },
  ],
  changedVariables: ['Player/y velocity'],
  ...overrides,
})

describe('in-browser playtest feedback', () => {
  it('infers bounded keyboard checks and falls back to autonomous progress', () => {
    expect(inferPlaytestPlan('平台遊戲使用左右鍵移動，角色會自動下落')).toMatchObject({
      controls: [expect.objectContaining({ key: 'ArrowLeft' }), expect.objectContaining({ key: 'ArrowRight' })],
      checkAutonomousMotion: false,
      checkLoopMotion: true,
    })
    expect(inferPlaytestPlan('一個會自己跑動的故事').checkAutonomousMotion).toBe(true)
  })

  it('catches a key with no event binding and gives a repair direction', () => {
    const broken = structuredClone(keyboardProject as CanonicalProject)
    broken.sprites[0].scripts = []
    const feedback = createPlaytestFeedback(
      '請用左右鍵控制角色移動',
      broken,
      readyObservation({
        autonomousMotion: false,
        controls: [
          { key: 'ArrowLeft', expected: 'x-', moved: false, delta: 0 },
          { key: 'ArrowRight', expected: 'x+', moved: false, delta: 0 },
        ],
        changedVariables: [],
      }),
    )
    expect(feedback.passed).toBe(false)
    expect(feedback.issues.some((issue) => issue.includes('找不到「左鍵」'))).toBe(true)
    expect(feedback.issues.some((issue) => issue.includes('找不到「右鍵」'))).toBe(true)
    expect(feedback.repairPrompt).toContain('按鍵事件')
  })

  it('catches an empty loop instead of trusting the presence of a loop block', () => {
    const broken = structuredClone(keyboardProject as CanonicalProject)
    const firstScript = broken.sprites[0].scripts[0]
    firstScript.blocks = [
      { opcode: 'event_whenflagclicked' },
      {
        opcode: 'control_forever',
        inputs: {
          SUBSTACK: {
            type: 'stack',
            blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: '等一下' } } }],
          },
        },
      },
    ]
    const feedback = createPlaytestFeedback(
      '請讓角色一直自動移動',
      broken,
      readyObservation({ autonomousMotion: false, controls: [], changedVariables: [] }),
    )
    expect(feedback.passed).toBe(false)
    expect(feedback.issues.some((issue) => issue.includes('迴圈裡沒有 motion_*'))).toBe(true)
  })

  it('does not flag the working platformer fixture when runtime signals agree', () => {
    const feedback = createPlaytestFeedback(
      '平台遊戲使用左右鍵移動，角色會自動下落',
      keyboardProject as CanonicalProject,
      readyObservation(),
    )
    expect(feedback).toMatchObject({ passed: true, issues: [] })
    expect(feedback.repairPrompt).toBeUndefined()
  })

  it('treats space as an action key when the request says fire instead of move', () => {
    const shooter = structuredClone(keyboardProject as CanonicalProject)
    shooter.sprites[0].scripts[0].blocks.push({
      opcode: 'control_wait_until',
      inputs: {
        CONDITION: {
          type: 'block',
          block: { opcode: 'sensing_keypressed', inputs: { KEY_OPTION: { type: 'literal', value: 'space' } } },
        },
      },
    })
    const plan = inferPlaytestPlan('按空白鍵發射雷射')
    expect(plan.controls).toEqual([expect.objectContaining({ key: ' ', expectsMovement: false })])
    const feedback = createPlaytestFeedback(
      '玩家按空白鍵發射雷射',
      shooter,
      readyObservation({
        controls: [{ key: ' ', expected: 'y+', moved: false, delta: 0 }],
        autonomousMotion: false,
        changedVariables: ['Stage/score'],
      }),
    )
    expect(feedback).toMatchObject({ passed: true, issues: [] })
  })
})
