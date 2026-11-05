import { describe, expect, it } from 'vitest'
import { createStudentIterationInstruction } from '../../src/core/capabilities/student-iteration'

describe('student iteration instruction', () => {
  it('includes the complete current canonical project and the requested change', () => {
    const project = '{"name":"貓","stage":{"scripts":[]},"sprites":[]}'
    const result = createStudentIterationInstruction(project, '跳高一點', '做一個冒險遊戲')
    expect(result).toContain(project)
    expect(result).toContain('跳高一點')
    expect(result).toContain('做一個冒險遊戲')
    expect(result).toContain('Canonical IR')
    expect(result).not.toContain('無需手動貼回')
  })
})
