import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import type { AiDraftRepair } from '../../src/core/normalizer'
import { createRepairPrompt, createRepairReport, type RepairReport } from '../../src/core/repair'
import repairReportSchema from '../../src/core/repair/schema.json'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../src/core/validator'

const validateReport = new Ajv2020({ strict: false }).compile<RepairReport>(repairReportSchema)

describe('AI repair report', () => {
  it('maps automatic repairs and semantic warnings to a schema-valid stable report', () => {
    const project = structuredClone(platformer) as CanonicalProject
    const conditionPath = '/sprites/0/scripts/3/blocks/1/inputs/CONDITION'
    project.sprites[0].scripts[3].blocks[1].inputs = {
      ...project.sprites[0].scripts[3].blocks[1].inputs,
      CONDITION: { type: 'variable', name: 'y velocity' },
    }
    const repairs: readonly AiDraftRepair[] = [
      { path: '/sprites/0/kind', code: 'target-default', message: '補上必要欄位 kind' },
    ]

    const report = createRepairReport({
      data: project,
      repairs,
      semanticIssues: validateCanonicalSemantics(project),
    })

    expect(validateReport(report)).toBe(true)
    expect(report.summary).toEqual({ autoRepaired: 1, errors: 0, warnings: 1 })
    expect(report.issues[1]).toMatchObject({
      severity: 'warning',
      status: 'review',
      phase: 'semantic',
      code: 'condition-not-boolean',
      path: conditionPath,
      actual: { type: 'variable', name: 'y velocity' },
    })
  })

  it('turns AJV required errors into stable must-fix paths', () => {
    const broken: unknown = { format: 'scratch-ai-bridge/canonical-ir', version: 1 }
    const validation = validateCanonicalProject(broken)
    expect(validation.valid).toBe(false)
    if (validation.valid) return

    const first = createRepairReport({ data: broken, schemaIssues: validation.errors })
    const second = createRepairReport({ data: broken, schemaIssues: validation.errors })

    expect(first).toEqual(second)
    expect(validateReport(first)).toBe(true)
    expect(first.issues.every((issue) => issue.status === 'must-fix')).toBe(true)
    expect(first.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['/name', '/stage', '/sprites']))
  })

  it('creates a paste-ready prompt containing the complete report and project', () => {
    const report = createRepairReport({
      data: platformer,
      parseError: new SyntaxError('Unexpected token at /Users/example/private.json'),
    })
    const prompt = createRepairPrompt(report, platformer, 'CAPABILITY GUIDE')

    expect(prompt).toContain('只回傳一個完整 JSON 根物件')
    expect(prompt).toContain('不要 Markdown、Python、說明、patch 或多個候選版本')
    expect(prompt).toContain('CAPABILITY GUIDE')
    expect(prompt).toContain('"format": "scratch-ai-bridge/repair-report"')
    expect(prompt).toContain('"format": "scratch-ai-bridge/canonical-ir"')
    expect(prompt).not.toContain('/Users/example')
  })
})
