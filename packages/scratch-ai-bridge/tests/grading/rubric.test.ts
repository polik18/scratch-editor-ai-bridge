import { describe, expect, it } from 'vitest'
import {
  approveRubric,
  createFallbackRubric,
  PROJECT_TYPES,
  rubricHash,
  validateRubric,
} from '../../src/core/grading'
import { bigFishRubric } from './fixtures'

describe('rubric validator', () => {
  it('accepts the teacher 30/30/40 rubric and pins a stable hash', () => {
    const validation = validateRubric(bigFishRubric())
    expect(validation.errors).toEqual([])
    expect(validation.ok).toBe(true)
    const reordered = Object.fromEntries(Object.entries(bigFishRubric()).reverse())
    expect(rubricHash(reordered)).toBe(validation.rubricHash)
  })

  it('rejects point totals, component sums, duplicate IDs and missing full levels', () => {
    const rubric = bigFishRubric()
    const broken = {
      ...rubric,
      totalPoints: 90,
      criteria: [
        rubric.criteria[0],
        { ...rubric.criteria[1], components: rubric.criteria[1].components?.slice(0, 2) },
        { ...rubric.criteria[2], id: 'swimming', levels: rubric.criteria[2].levels?.slice(1) },
      ],
    }
    const codes = validateRubric(broken).errors.map(({ code }) => code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'points-sum-mismatch',
        'component-sum-mismatch',
        'criterion-id-duplicate',
        'level-full-missing',
      ]),
    )
  })

  it('rejects unknown check kinds and warns about criteria nothing can check', () => {
    const rubric = bigFishRubric()
    const result = validateRubric({
      ...rubric,
      criteria: [
        {
          ...rubric.criteria[0],
          levels: [
            { ratio: 1, description: 'x', checks: [{ kind: 'magic' }] },
            { ratio: 0, description: 'y' },
          ],
        },
        { id: 'story', title: '故事', points: 70, mode: 'binary', evidence: ['teacher'] },
      ],
    })
    expect(result.errors.map(({ code }) => code)).toContain('check-kind-invalid')
    expect(result.warnings.map(({ code }) => code)).toContain('criterion-manual')
  })

  it('treats an approval as stale once the rubric changes', () => {
    const approved = approveRubric(bigFishRubric(), 'teacher-A', '2026-11-19T00:00:00.000Z')
    expect(validateRubric(approved).approved).toBe(true)
    const edited = { ...approved, title: '改過的標題' }
    const validation = validateRubric(edited)
    expect(validation.approved).toBe(false)
    expect(validation.warnings.map(({ code }) => code)).toContain('approval-stale')
  })

  it('ships a valid, approved fallback profile for every project type with weights adding up to 100', () => {
    for (const projectType of PROJECT_TYPES) {
      const rubric = createFallbackRubric(projectType)
      const validation = validateRubric(rubric)
      expect(validation.ok, projectType).toBe(true)
      expect(validation.approved, projectType).toBe(true)
      expect(rubric.criteria.reduce((sum, { points }) => sum + points, 0)).toBe(100)
    }
  })
})
