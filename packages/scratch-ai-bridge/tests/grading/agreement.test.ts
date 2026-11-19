import { describe, expect, it } from 'vitest'
import { compareWithTeachers, type AutoScore, type TeacherScore } from '../../src/core/grading'

const works = (
  count: number,
  autoOf: (index: number) => number,
  flag: (index: number) => boolean = () => false,
): AutoScore[] =>
  Array.from({ length: count }, (_, index) => ({
    studentId: `S${index}`,
    rawScore: autoOf(index),
    criteria: { a: autoOf(index) / 2 },
    reviewRequired: flag(index),
    evidenceCoverage: 1,
  }))

const blind = (count: number, scoreOf: (index: number, teacher: number) => number): TeacherScore[] =>
  Array.from({ length: count }, (_, index) =>
    [0, 1].map((teacher) => ({
      studentId: `S${index}`,
      teacher: `T${teacher + 1}`,
      score: scoreOf(index, teacher),
      criteria: { a: scoreOf(index, teacher) / 2 },
    })),
  ).flat()

describe('teacher calibration', () => {
  it('passes when automatic scores rank like teachers and disagreements are already in review', () => {
    const report = compareWithTeachers(
      works(
        30,
        (index) => 40 + index * 1.5,
        (index) => index === 3,
      ),
      blind(30, (index, teacher) => 40 + index * 1.5 + (index === 3 ? 20 : 0) + teacher),
    )
    expect(report.spearman).toBeGreaterThan(0.9)
    expect(report.teacherAgreement).toBeGreaterThan(0.9)
    expect(report.largeDisagreements.map(({ studentId }) => studentId)).toEqual(['S3'])
    expect(report.reviewRecall).toBe(1)
    expect(report.officialReady).toBe(true)
    expect(report.criterionMeanAbsoluteError.a).toBeLessThan(3)
  })

  it('stays trial when there are too few works, one teacher, inflation or missed disagreements', () => {
    const report = compareWithTeachers(
      works(12, () => 95),
      blind(12, (index) => 50 + index * 3).filter(({ teacher }) => teacher === 'T1'),
    )
    expect(report.officialReady).toBe(false)
    expect(report.failures.join('\n')).toMatch(/30 件/)
    expect(report.failures.join('\n')).toMatch(/兩位教師/)
    expect(report.failures.join('\n')).toMatch(/虛高/)
    expect(report.failures.join('\n')).toMatch(/複核佇列/)
  })
})

describe('pending grades', () => {
  it('compares only the automatically decided criteria on both sides', () => {
    const autos: AutoScore[] = Array.from({ length: 3 }, (_, index) => ({
      studentId: `P${index}`,
      rawScore: null,
      criteria: { auto: index * 10, manual: null },
      reviewRequired: true,
      evidenceCoverage: 0.5,
      scope: { criteria: ['auto'], maxPoints: 30, earned: index * 10 },
    }))
    const teachers: TeacherScore[] = autos.flatMap(({ studentId }, index) =>
      ['T1', 'T2'].map((teacher) => ({ studentId, teacher, score: 0, criteria: { auto: index * 10, manual: 20 } })),
    )
    const report = compareWithTeachers(autos, teachers)
    expect(report.partialScope).toBe(3)
    expect(report.pendingExcluded).toBe(0)
    expect(report.meanAbsoluteError).toBe(0)
  })
})
