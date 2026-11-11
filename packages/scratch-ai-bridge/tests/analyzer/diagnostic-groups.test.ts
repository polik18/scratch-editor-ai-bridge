import { describe, expect, it } from 'vitest'
import { groupDiagnosticsForDisplay } from '../../src/core/analyzer/diagnostic-groups'

describe('student diagnostic presentation', () => {
  it('groups repeated draft observations and keeps genuine warnings separate', () => {
    const groups = groupDiagnosticsForDisplay([
      { code: 'detached-script', severity: 'info', message: 'draft 1' },
      { code: 'detached-script', severity: 'info', message: 'draft 2' },
      { code: 'block-graph-invalid-argument-reporter', severity: 'info', message: 'orphan parameter' },
      { code: 'block-graph-missing-block', severity: 'warning', message: 'missing link' },
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0]).toMatchObject({ severity: 'warning', code: 'block-graph-missing-block' })
    expect(groups.find(({ code }) => code === 'detached-script')).toMatchObject({ severity: 'info', count: 2 })
    expect(groups.find(({ code }) => code === 'detached-script')?.summary).toContain('不一定是錯誤')
  })
})
