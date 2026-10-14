import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createRepairReport } from '../../src/core/repair/report'
import { createAiOutputValidationReport } from '../../src/core/repair/validation-report'

describe('AI output validation report', () => {
  it('identifies the exact response and validated Canonical project without storing the response text', async () => {
    const source = '{"name":"Repeat Score","privateNote":"student private text"}'
    const project = structuredClone(example) as CanonicalProject
    const repairReport = createRepairReport({ data: project })

    const report = await createAiOutputValidationReport({
      sourceResponse: source,
      canonicalProject: project,
      repairReport,
      checks: {
        responseParsed: 'passed',
        normalization: 'passed',
        canonicalSchema: 'passed',
        semanticValidation: 'passed',
        scratchVmCompile: 'passed',
      },
    })

    expect(report).toMatchObject({
      format: 'scratch-ai-bridge/validation-report',
      version: 2,
      canonicalVersion: 1,
      projectName: project.name,
      checks: {
        responseParsed: 'passed',
        normalization: 'passed',
        canonicalSchema: 'passed',
        semanticValidation: 'passed',
        scratchVmCompile: 'passed',
      },
    })
    expect(report.sourceResponseSha256).toBe(createHash('sha256').update(source).digest('hex'))
    expect(report.canonicalProjectSha256).toBe(createHash('sha256').update(JSON.stringify(project)).digest('hex'))
    expect(report.sourceResponseSha256).not.toBe(report.canonicalProjectSha256)
    expect(JSON.stringify(report)).not.toContain('student private text')
    expect(report.repairReport).toEqual(repairReport)
  })

  it('records failed stages and hashes unparseable response text without storing it', async () => {
    const source = 'not valid JSON: private response'
    const repairReport = createRepairReport({ parseError: 'invalid JSON' })
    const report = await createAiOutputValidationReport({
      sourceResponse: source,
      repairReport,
      checks: {
        responseParsed: 'failed',
        normalization: 'skipped',
        canonicalSchema: 'skipped',
        semanticValidation: 'skipped',
        scratchVmCompile: 'skipped',
      },
    })

    expect(report.sourceResponseSha256).toBe(createHash('sha256').update(source).digest('hex'))
    expect(report.canonicalProjectSha256).toBeNull()
    expect(report.checks).toEqual({
      responseParsed: 'failed',
      normalization: 'skipped',
      canonicalSchema: 'skipped',
      semanticValidation: 'skipped',
      scratchVmCompile: 'skipped',
    })
    expect(JSON.stringify(report)).not.toContain('private response')
  })

  it('records normalization failures separately from successful parsing', async () => {
    const repairReport = createRepairReport({ normalizationError: new Error('AI project exceeds depth limit') })
    const report = await createAiOutputValidationReport({
      sourceResponse: '{"format":"scratch-ai-bridge/canonical-ir","version":1}',
      repairReport,
      checks: {
        responseParsed: 'passed',
        normalization: 'failed',
        canonicalSchema: 'skipped',
        semanticValidation: 'skipped',
        scratchVmCompile: 'skipped',
      },
    })

    expect(report.checks).toMatchObject({ responseParsed: 'passed', normalization: 'failed' })
    expect(report.repairReport.issues).toContainEqual(
      expect.objectContaining({
        phase: 'normalize',
        code: 'normalization-failed',
        status: 'must-fix',
      }),
    )
  })

  it('records compiler preflight failures without claiming the Scratch VM ran', async () => {
    const project = structuredClone(example) as CanonicalProject
    const repairReport = createRepairReport({ data: project, compileError: new Error('Malformed SVG') })
    const report = await createAiOutputValidationReport({
      sourceResponse: JSON.stringify(project),
      canonicalProject: project,
      repairReport,
      compileFailureStage: 'svg-preflight',
      checks: {
        responseParsed: 'passed',
        normalization: 'passed',
        canonicalSchema: 'passed',
        semanticValidation: 'passed',
        scratchVmCompile: 'skipped',
      },
    })

    expect(report.compileFailureStage).toBe('svg-preflight')
    expect(report.checks.scratchVmCompile).toBe('skipped')
  })
})
