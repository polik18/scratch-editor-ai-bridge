import { describe, expect, it } from 'vitest'
import { draftRubricFromText, validateRubric } from '../../src/core/grading'

describe('rubric draft from teacher text', () => {
  it('keeps the teacher items and points exactly and proposes checks', () => {
    const { rubric, unread } = draftRubricFromText(
      [
        '1. 大魚、小魚的游泳方式正確 30分',
        '2. 大魚碰到小魚，小魚消失並播放吃掉的音效 30 分',
        '3. 小魚被吃掉後，新的小魚分身在別處出現（40分）',
        '備註：要準時交',
      ].join('\n'),
      { id: 'big-fish-draft', title: '大魚吃小魚', projectType: 'animation' },
    )
    expect(unread).toEqual(['備註：要準時交'])
    expect(rubric.criteria.map(({ points }) => points)).toEqual([30, 30, 40])
    expect(rubric.totalPoints).toBe(100)
    expect(rubric.origin).toBe('draft')
    const eat = rubric.criteria[1]
    expect(eat.mode).toBe('components')
    expect(eat.components?.map(({ description }) => description)).toEqual(['碰觸事件', '消失', '音效'])
    expect(eat.components?.reduce((sum, { points }) => sum + points, 0)).toBe(30)
    const validation = validateRubric(rubric)
    expect(validation.ok).toBe(true)
    expect(validation.approved).toBe(false)
  })

  it('leaves items without observable keywords to the teacher', () => {
    const { rubric } = draftRubricFromText('作品有創意 20分', { id: 'x1', title: 'x', projectType: 'custom' })
    expect(rubric.criteria[0]).toMatchObject({ mode: 'partial', evidence: ['teacher'] })
  })
})
