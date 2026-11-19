import { describe, expect, it } from 'vitest'
import {
  calibrateCohorts,
  DEFAULT_GRADING_POLICY,
  inverseNormal,
  parseGradingPolicy,
  spearman,
  type CohortMember,
  type FormalGrade,
} from '../../src/core/grading'

const grade = (rawScore: number | null, overrides: Partial<FormalGrade> = {}): FormalGrade => ({
  format: 'scratch-ai-bridge/formal-grade',
  version: 1,
  layer: 'formal-grade',
  status: rawScore === null ? 'pending' : 'graded',
  rubric: { id: 'r', title: 'r', projectType: 'game', hash: 'a'.repeat(64), origin: 'teacher', approved: true },
  rawScore,
  provisionalPoints: rawScore ?? 0,
  maxPoints: 100,
  criteria: [],
  diagnostic: { layer: 'static-diagnostic', rubric: 'sb3-static-v3', score: 50, coverage: 1 },
  runtimeStatus: 'passed',
  evidenceCoverage: 1,
  confidence: 0.85,
  reviewRequired: false,
  reviewReasons: [],
  highScoreEvidence: true,
  limitations: [],
  ...overrides,
})

const member = (studentId: string, value: FormalGrade, gradeLevel = '6', classId = '601'): CohortMember => ({
  studentId,
  gradeLevel,
  classId,
  assignmentId: 'a1',
  grade: value,
})

/**
 * V2-14 fixed batch: 30 works from outstanding to broken and low-confidence.
 * @returns Cohort members for one class.
 */
const thirtyWorks = (): CohortMember[] => {
  const raws = [
    98, 95, 93, 91, 90, 88, 87, 86, 85, 84, 82, 80, 79, 78, 76, 75, 74, 72, 70, 68, 66, 63, 60, 55, 50, 45,
  ]
  const members = raws.map((raw, index) => member(`S${String(index + 1).padStart(2, '0')}`, grade(raw)))
  members.push(member('S27', grade(20))) // too thin to enter the range
  members.push(member('S28', grade(0, { runtimeStatus: 'failed', highScoreEvidence: false }))) // broken
  members.push(member('S29', grade(null))) // pending criteria
  members.push(member('S30', grade(92, { confidence: 0.4 }))) // low confidence
  return members
}

describe('cohort calibration', () => {
  it('approximates the inverse normal CDF', () => {
    expect(inverseNormal(0.5)).toBeCloseTo(0, 6)
    expect(inverseNormal(0.975)).toBeCloseTo(1.959964, 4)
    expect(inverseNormal(0.01)).toBeCloseTo(-2.326348, 4)
  })

  it('spreads a 30-student class across 80–100 with a mode near 90 and keeps broken work out of range', () => {
    const { grades, cohorts } = calibrateCohorts(thirtyWorks())
    const [summary] = cohorts
    const scored = grades.filter(({ band }) => band === 'scored')
    const finals = scored.map(({ finalScore }) => finalScore ?? 0)
    expect(scored).toHaveLength(26)
    expect(Math.min(...finals)).toBeGreaterThanOrEqual(80)
    expect(Math.max(...finals)).toBeLessThanOrEqual(100)
    expect(new Set(finals).size).toBeGreaterThan(8)
    expect(Math.abs((summary.mode ?? 0) - 90)).toBeLessThanOrEqual(3)
    expect(Math.abs((summary.median ?? 0) - 90)).toBeLessThanOrEqual(3)
    expect(summary.calibrationWarnings).toEqual([])
    // Higher raw score never ends up lower.
    const byRaw = [...scored].sort((left, right) => (left.rawScore ?? 0) - (right.rawScore ?? 0))
    for (let index = 1; index < byRaw.length; index += 1)
      expect(byRaw[index].finalScore ?? 0).toBeGreaterThanOrEqual(byRaw[index - 1].finalScore ?? 0)
    const find = (id: string) => grades.find(({ studentId }) => studentId === id)
    expect(find('S27')).toMatchObject({ band: 'below-range' })
    expect(find('S27')?.finalScore).toBeLessThan(80)
    expect(find('S28')).toMatchObject({ band: 'below-range' })
    expect(find('S29')).toMatchObject({ band: 'pending', finalScore: null })
    expect(find('S30')).toMatchObject({ band: 'pending', finalScore: null })
    expect(summary).toMatchObject({ size: 30, scored: 26, belowRange: 2, pending: 2 })
  })

  it('keeps grade levels apart so a third-grade class is not pushed to 80 by sixth graders', () => {
    const sixth = thirtyWorks()
    const third = thirtyWorks().map((entry) => ({
      ...entry,
      studentId: `T${entry.studentId}`,
      gradeLevel: '3',
      classId: '301',
      grade:
        entry.grade.rawScore === null
          ? entry.grade
          : { ...entry.grade, rawScore: Math.round(entry.grade.rawScore * 0.6) },
    }))
    const { cohorts, grades } = calibrateCohorts([...sixth, ...third])
    expect(cohorts).toHaveLength(2)
    const thirdTop = grades.filter(({ studentId, band }) => studentId.startsWith('T') && band === 'scored')
    expect(Math.max(...thirdTop.map(({ finalScore }) => finalScore ?? 0))).toBeGreaterThanOrEqual(93)
  })

  it('caps scores of 90+ that lack complete runtime evidence', () => {
    const members = thirtyWorks().map((entry) =>
      entry.studentId === 'S01' ? { ...entry, grade: { ...entry.grade, highScoreEvidence: false } } : entry,
    )
    const top = calibrateCohorts(members).grades.find(({ studentId }) => studentId === 'S01')
    expect(top?.finalScore).toBe(89)
    expect(top?.warnings.join()).toContain('高分')
  })

  it('skips relative calibration for small groups and warns', () => {
    const { cohorts, grades } = calibrateCohorts(thirtyWorks().slice(0, 5))
    expect(cohorts[0].calibrationWarnings.join()).toContain('不做班內相對校準')
    expect(grades.every(({ cohortScore }) => cohortScore === null)).toBe(true)
  })

  it('warns when every work gets the same score', () => {
    const members = Array.from({ length: 12 }, (_, index) => member(`S${index}`, grade(100)))
    expect(calibrateCohorts(members).cohorts[0].calibrationWarnings.join()).toMatch(/沒有鑑別度|超過三成/)
  })

  it('validates policy files and fills defaults', () => {
    expect(parseGradingPolicy({ relativeWeight: 0.3 })).toMatchObject({
      ...DEFAULT_GRADING_POLICY,
      relativeWeight: 0.3,
    })
    expect(() => parseGradingPolicy({ scoreRange: { min: 90, max: 80 } })).toThrow('policy-invalid')
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1)
  })
})
