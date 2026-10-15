import { describe, expect, it } from 'vitest'
import {
  evaluateTeacherReviewGate,
  parseTeacherReviewRecords,
  type TeacherReviewRecord,
} from '../../src/core/feedback'

const passingReviews = (): TeacherReviewRecord[] =>
  Array.from({ length: 20 }, (_, index) => {
    const caseId = `synthetic-case-${index + 1}`
    const item = {
      feedbackId: `feedback-${index + 1}`,
      type: 'definite-error' as const,
      judgedCorrect: true,
      evidenceResolvable: true,
      usefulness: 4 as const,
      highImpactError: false,
      unsupportedCertaintyClaim: false,
    }
    const records: TeacherReviewRecord[] = [{ caseId, reviewerCode: 'R1', items: [item] }]
    if (index < 5) records.push({ caseId, reviewerCode: 'R2', items: [item] })
    return records
  }).flat()

describe('teacher review release gate', () => {
  it('validates review imports and rejects identifying or unrecognized fields', () => {
    const records = passingReviews()
    expect(parseTeacherReviewRecords(records)).toEqual(records)
    expect(() => parseTeacherReviewRecords([{ ...records[0], studentName: 'must not be collected' }])).toThrow(
      'only caseId, reviewerCode, and items',
    )
    expect(() =>
      parseTeacherReviewRecords([{ ...records[0], items: [{ ...records[0].items[0], usefulness: 7 }] }]),
    ).toThrow('invalid or extra fields')
    expect(() => parseTeacherReviewRecords([records[0], records[0]])).toThrow('duplicate reviewer record')
  })

  it('keeps the release gate closed until human review evidence meets every threshold', () => {
    expect(evaluateTeacherReviewGate([])).toMatchObject({ status: 'ready-for-human-review' })
    const reviews = passingReviews()
    expect(evaluateTeacherReviewGate(reviews)).toMatchObject({
      status: 'passed',
      metrics: {
        caseCount: 20,
        doubleReviewedCaseCount: 5,
        definiteErrorPrecision: 1,
        evidenceLocalization: 1,
        usefulnessAverage: 4,
      },
    })
    reviews[0] = {
      ...reviews[0],
      items: [
        {
          ...reviews[0].items[0],
          judgedCorrect: false,
          evidenceResolvable: false,
          usefulness: 1,
          highImpactError: true,
        },
      ],
    }
    expect(evaluateTeacherReviewGate(reviews)).toMatchObject({ status: 'not-ready' })
  })

  it('rejects invented case IDs when a corpus manifest is provided', () => {
    const reviews = passingReviews()
    const expectedCaseIds = Array.from({ length: 20 }, (_, index) => `synthetic-case-${index + 1}`)
    expect(evaluateTeacherReviewGate(reviews, expectedCaseIds).status).toBe('passed')
    expect(
      evaluateTeacherReviewGate([...reviews, { ...reviews[0], caseId: 'invented-case' }], expectedCaseIds),
    ).toMatchObject({ status: 'not-ready', metrics: { caseCount: 20 } })
  })
})
