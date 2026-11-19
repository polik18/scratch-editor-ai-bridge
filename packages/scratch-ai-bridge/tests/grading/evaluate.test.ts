import { describe, expect, it } from 'vitest'
import { approveRubric, createFallbackRubric, evaluateProject, NOT_RUN } from '../../src/core/grading'
import { bigFishRubric, runtimeEvidence, staticEvidence } from './fixtures'

const rubric = approveRubric(bigFishRubric(), 'teacher-A', '2026-11-19T00:00:00.000Z')

describe('formal-grade core', () => {
  it('never produces a formal score without running the work', () => {
    const grade = evaluateProject({ rubric, staticEvidence: staticEvidence(), runtime: NOT_RUN })
    expect(grade.status).toBe('pending')
    expect(grade.rawScore).toBeNull()
    expect(grade.runtimeStatus).toBe('not-run')
    expect(grade.reviewReasons.join()).toContain('未執行')
    expect(grade.criteria.every(({ status }) => status === 'pending')).toBe(true)
  })

  it('scores strictly by the teacher criteria: missing sound costs exactly its 10 points', () => {
    const grade = evaluateProject({ rubric, staticEvidence: staticEvidence(), runtime: runtimeEvidence() })
    const eat = grade.criteria.find(({ id }) => id === 'eat-feedback')
    expect(grade.criteria.map(({ earnedPoints }) => earnedPoints)).toEqual([30, 20, 40])
    expect(eat?.components?.map(({ earnedPoints }) => earnedPoints)).toEqual([10, 10, 0])
    expect(grade.rawScore).toBe(90)
    expect(grade.status).toBe('graded')
    // sound_play exists in the code but never ran: flag for the teacher instead of silently trusting the zero.
    expect(eat?.reviewRequired).toBe(true)
    expect(eat?.reviewReasons.join()).toContain('自動試玩沒有觸發')
  })

  it('does not reward size: more sprites, scripts or blocks leave the score unchanged', () => {
    const small = evaluateProject({ rubric, staticEvidence: staticEvidence(), runtime: runtimeEvidence() })
    const big = evaluateProject({
      rubric,
      staticEvidence: staticEvidence({
        sprites: 40,
        scripts: 300,
        opcodes: { ...staticEvidence().opcodes, motion_movesteps: 900 },
      }),
      runtime: runtimeEvidence(),
    })
    expect(big.rawScore).toBe(small.rawScore)
  })

  it('lets a teacher judgment override the automatic result and keeps the note', () => {
    const grade = evaluateProject({
      rubric,
      staticEvidence: staticEvidence(),
      runtime: runtimeEvidence(),
      judgments: [
        {
          criterionId: 'eat-feedback',
          source: 'teacher',
          components: { collision: true, disappear: true, sound: true },
          note: '現場聽到音效',
        },
      ],
    })
    const eat = grade.criteria.find(({ id }) => id === 'eat-feedback')
    expect(eat).toMatchObject({ earnedPoints: 30, source: 'teacher', teacherNote: '現場聽到音效' })
    expect(grade.rawScore).toBe(100)
  })

  it('keeps human-only fallback facets pending until an AI provider or teacher judges them', () => {
    const fallback = createFallbackRubric('animation')
    const grade = evaluateProject({ rubric: fallback, staticEvidence: staticEvidence(), runtime: runtimeEvidence() })
    expect(grade.status).toBe('pending')
    expect(grade.rawScore).toBeNull()
    expect(grade.criteria.filter(({ status }) => status === 'pending').map(({ id }) => id)).toEqual([
      'intent',
      'depth',
      'testing',
    ])
    const judged = evaluateProject({
      rubric: fallback,
      staticEvidence: staticEvidence(),
      runtime: runtimeEvidence({ executedOpcodes: { looks_say: 3, sound_play: 2, looks_nextcostume: 4 } }),
      judgments: [
        { criterionId: 'intent', source: 'ai', ratio: 0.6, confidence: 0.9 },
        { criterionId: 'depth', source: 'ai', ratio: 0.6, confidence: 0.5 },
        { criterionId: 'testing', source: 'teacher', ratio: 0.5 },
      ],
    })
    expect(judged.status).toBe('graded')
    expect(judged.criteria.find(({ id }) => id === 'depth')?.reviewRequired).toBe(true)
    expect(judged.highScoreEvidence).toBe(true)
  })

  it('marks results from an unapproved rubric as trial', () => {
    const grade = evaluateProject({
      rubric: bigFishRubric(),
      staticEvidence: staticEvidence(),
      runtime: runtimeEvidence(),
    })
    expect(grade.status).toBe('trial')
    expect(grade.rubric.approved).toBe(false)
  })

  it('gives a work that cannot start zero on runtime criteria but keeps it reviewable', () => {
    const grade = evaluateProject({
      rubric,
      staticEvidence: staticEvidence(),
      runtime: { ...NOT_RUN, status: 'failed', error: 'project.json invalid' },
    })
    expect(grade.rawScore).toBe(0)
    expect(grade.reviewRequired).toBe(true)
    expect(grade.highScoreEvidence).toBe(false)
  })
})
