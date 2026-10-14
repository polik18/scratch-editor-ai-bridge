import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { normalizeAiDraft, type AiDraftRepair } from '../../src/core/normalizer'
import { createRepairPrompt, createRepairReport, type RepairReport } from '../../src/core/repair'
import repairReportSchema from '../../src/core/repair/schema.json'
import type { CanonicalIRValidationIssue } from '../../src/core/validator'
import { validateCanonicalProject, validateCanonicalSemantics } from '../../src/core/validator'

const validateReport = new Ajv2020({ strict: false }).compile<RepairReport>(repairReportSchema)

describe('AI repair report', () => {
  it('keeps compiler-reported Canonical asset paths actionable', () => {
    const report = createRepairReport({
      data: platformer,
      compileError: new Error('Cannot compile SVG costume "player" at /sprites/0/costumes/0: malformed XML'),
    })

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        phase: 'compile',
        code: 'compile-failed',
        path: '/sprites/0/costumes/0',
      }),
    )
  })

  it.each([
    ['svg-preflight', 'well-formed SVG', 'SVG XML'],
    ['raster-preflight', 'browser-decodable PNG, JPEG, or BMP', '可解碼的 PNG、JPEG 或 BMP'],
    ['audio-preflight', 'browser-decodable WAV or MP3', '可解碼的 WAV 或 MP3'],
    ['archive-generation', 'encoded into an SB3 archive', '無法序列化'],
    ['scratch-vm-load', 'accepted by the official Scratch VM', 'Scratch 不接受'],
    ['scratch-vm-save', 'serialized as SB3', '保存失敗'],
    ['unknown', 'local Scratch project compiler', '依錯誤訊息修正'],
  ])('provides stage-specific compile guidance for %s failures', (stage, expected, suggestion) => {
    const compileError = Object.assign(new Error('Compile failure at /sprites/0/costumes/0: invalid data'), { stage })
    const report = createRepairReport({ data: platformer, compileError })
    const issue = report.issues.find(({ phase }) => phase === 'compile')

    expect(validateReport(report)).toBe(true)
    expect(issue).toMatchObject({
      phase: 'compile',
      code: 'compile-failed',
      path: '/sprites/0/costumes/0',
      actual: { stage },
    })
    expect(issue?.expected).toContain(expected)
    expect(issue?.suggestion).toContain(suggestion)
  })

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
    const repairedRoot: Record<string, unknown> = {
      format: 'scratch-ai-bridge/canonical-ir',
      version: 1,
    }
    for (const issue of first.issues) {
      if (issue.code !== 'schema-required' || typeof issue.example !== 'object' || issue.example === null) continue
      const addProperty = (issue.example as { addProperty?: unknown }).addProperty
      if (typeof addProperty === 'object' && addProperty !== null) Object.assign(repairedRoot, addProperty)
    }
    expect(validateCanonicalProject(repairedRoot).valid).toBe(true)
  })

  it('derives a valid required-property example inside a selected union branch', () => {
    const project = structuredClone(platformer) as CanonicalProject
    const targetBlock = project.sprites[0].scripts[0].blocks[2]
    targetBlock.inputs = { ...targetBlock.inputs, VALUE: { type: 'literal' } as never }
    const normalized = normalizeAiDraft(project)
    const validation = validateCanonicalProject(normalized.data)
    if (validation.valid) throw new Error('Expected the literal input to fail its required value check')
    const report = createRepairReport({
      data: normalized.data,
      repairs: normalized.repairs,
      schemaIssues: validation.errors,
    })
    const issue = report.issues.find(
      ({ code, path }) => code === 'schema-required' && path === '/sprites/0/scripts/0/blocks/2/inputs/VALUE/value',
    )
    expect(issue).toMatchObject({
      expected: 'required property value',
      example: { addProperty: { value: '' } },
    })

    const addProperty = (issue?.example as { addProperty?: { value?: unknown } } | undefined)?.addProperty
    if (typeof addProperty?.value !== 'string') throw new Error('Required-property example omitted a scalar value')
    const corrected = structuredClone(normalized.data) as CanonicalProject
    const correctedBlock = corrected.sprites[0].scripts[0].blocks[2]
    correctedBlock.inputs = { ...correctedBlock.inputs, VALUE: { type: 'literal', value: addProperty.value } }
    expect(validateCanonicalProject(corrected).valid).toBe(true)
  })

  it('derives local missing-input and enum-field examples from the capability registry', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.stage.scripts = []
    project.sprites[0].scripts = [
      {
        blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'motion_movesteps' }],
      },
      { blocks: [{ opcode: 'event_whenkeypressed' }] },
    ]

    const report = createRepairReport({ data: project, semanticIssues: validateCanonicalSemantics(project) })
    const missingInput = report.issues.find(({ code }) => code === 'missing-input')
    const missingField = report.issues.find(({ code }) => code === 'missing-field')

    expect(validateReport(report)).toBe(true)
    expect(missingInput).toMatchObject({
      opcode: 'motion_movesteps',
      expected: 'Canonical input kind=number',
      example: { STEPS: { type: 'literal', value: 0 } },
    })
    expect(missingField).toMatchObject({
      opcode: 'event_whenkeypressed',
      example: { KEY_OPTION: 'space' },
    })
    expect(missingField?.expected).toContain('one of space, up arrow')
  })

  it('derives Canonical schema required, type, const, and enum examples that validate', () => {
    const invalidName: unknown = { ...platformer, name: 7 }
    const nameValidation = validateCanonicalProject(invalidName)
    if (nameValidation.valid) throw new Error('Expected an invalid project name')
    const nameReport = createRepairReport({ data: invalidName, schemaIssues: nameValidation.errors })
    const nameIssue = nameReport.issues.find(({ path }) => path === '/name')
    expect(nameIssue).toMatchObject({ example: { replaceWith: 'Scratch Project' }, expected: 'type=string' })

    const invalidVersion: unknown = { ...platformer, version: 2 }
    const versionValidation = validateCanonicalProject(invalidVersion)
    if (versionValidation.valid) throw new Error('Expected an invalid Canonical version')
    const versionIssue = createRepairReport({
      data: invalidVersion,
      schemaIssues: versionValidation.errors,
    }).issues.find(({ path }) => path === '/version')
    expect(versionIssue).toMatchObject({ example: { replaceWith: 1 }, expected: 'const=1' })

    const invalidEnum = structuredClone(platformer) as CanonicalProject
    const invalidEnumData = invalidEnum as unknown as { sprites: { rotationStyle: string }[] }
    invalidEnumData.sprites[0].rotationStyle = 'sideways'
    const enumValidation = validateCanonicalProject(invalidEnum)
    if (enumValidation.valid) throw new Error('Expected an invalid rotation style')
    const enumReport = createRepairReport({ data: invalidEnum, schemaIssues: enumValidation.errors })
    const enumIssue = enumReport.issues.find(({ code }) => code === 'schema-enum')
    expect(enumIssue?.example).toEqual({ replaceWith: 'all around' })
    const correctedEnum = structuredClone(invalidEnum)
    if (typeof enumIssue?.example !== 'object' || enumIssue.example === null) throw new Error('Missing enum example')
    const replacement = (enumIssue.example as { replaceWith?: unknown }).replaceWith
    if (typeof replacement !== 'string') throw new Error('Enum example is not a string')
    ;(correctedEnum as unknown as { sprites: { rotationStyle: string }[] }).sprites[0].rotationStyle = replacement
    expect(validateCanonicalProject(correctedEnum).valid).toBe(true)
  })

  it('points to and gives a removal action for unknown Canonical properties', () => {
    const projectWithUnknownProperty: unknown = { ...platformer, accidentalField: 'remove me' }
    const validation = validateCanonicalProject(projectWithUnknownProperty)
    if (validation.valid) throw new Error('Expected an additional property error')
    const report = createRepairReport({ data: projectWithUnknownProperty, schemaIssues: validation.errors })
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'schema-additionalProperties',
        path: '/accidentalField',
        actual: 'remove me',
        expected: 'no additional property at this path',
        example: { removeProperty: 'accidentalField' },
      }),
    )
  })

  it('generates replacement examples for Canonical length, numeric-range, and list-size limits', () => {
    const invalidName = { ...platformer, name: '' }
    const nameValidation = validateCanonicalProject(invalidName)
    if (nameValidation.valid) throw new Error('Expected a minimum-length error')
    const nameReport = createRepairReport({ data: invalidName, schemaIssues: nameValidation.errors })
    const nameExample = nameReport.issues.find(({ code }) => code === 'schema-minLength')?.example as {
      replaceWith: string
    }
    expect(nameExample.replaceWith).toBe('Scratch Project')
    expect(validateCanonicalProject({ ...invalidName, name: nameExample.replaceWith }).valid).toBe(true)

    const invalidRange = structuredClone(platformer) as CanonicalProject
    invalidRange.stage.videoTransparency = 120
    const rangeValidation = validateCanonicalProject(invalidRange)
    if (rangeValidation.valid) throw new Error('Expected a maximum-value error')
    const rangeReport = createRepairReport({ data: invalidRange, schemaIssues: rangeValidation.errors })
    const rangeExample = rangeReport.issues.find(({ code }) => code === 'schema-maximum')?.example as {
      replaceWith: number
    }
    expect(rangeExample.replaceWith).toBe(100)
    expect(
      validateCanonicalProject({
        ...invalidRange,
        stage: { ...invalidRange.stage, videoTransparency: rangeExample.replaceWith },
      }).valid,
    ).toBe(true)

    const invalidListSize = structuredClone(platformer) as CanonicalProject
    invalidListSize.sprites[0].scripts[0].blocks = []
    const listValidation = validateCanonicalProject(invalidListSize)
    if (listValidation.valid) throw new Error('Expected a minItems error')
    const listReport = createRepairReport({ data: invalidListSize, schemaIssues: listValidation.errors })
    const listExample = listReport.issues.find(({ code }) => code === 'schema-minItems')?.example as {
      replaceWith: unknown
    }
    const correctedList = structuredClone(invalidListSize)
    correctedList.sprites[0].scripts[0].blocks =
      listExample.replaceWith as CanonicalProject['sprites'][number]['scripts'][number]['blocks']
    expect(validateCanonicalProject(correctedList).valid).toBe(true)
  })

  it('repairs inclusive and exclusive numeric lower bounds with schema-valid examples', () => {
    const invalidProject = structuredClone(platformer) as CanonicalProject
    invalidProject.sprites[0].size = 0
    invalidProject.stage.videoTransparency = -1
    const validation = validateCanonicalProject(invalidProject)
    if (validation.valid) throw new Error('Expected lower-bound schema errors')

    const report = createRepairReport({ data: invalidProject, schemaIssues: validation.errors })
    const exclusive = report.issues.find(
      ({ code, path }) => code === 'schema-exclusiveMinimum' && path.endsWith('/size'),
    )
    const inclusive = report.issues.find(
      ({ code, path }) => code === 'schema-minimum' && path === '/stage/videoTransparency',
    )
    expect(exclusive?.example).toEqual({ replaceWith: Number.EPSILON })
    expect(inclusive?.example).toEqual({ replaceWith: 0 })

    const corrected = structuredClone(invalidProject)
    corrected.sprites[0].size = (exclusive?.example as { replaceWith: number }).replaceWith
    corrected.stage.videoTransparency = (inclusive?.example as { replaceWith: number }).replaceWith
    expect(validateCanonicalProject(corrected).valid).toBe(true)
  })

  it('trims overlong strings and arrays for upper-bound schema issues', () => {
    const issues: CanonicalIRValidationIssue[] = [
      {
        instancePath: '/name',
        schemaPath: '#/maxLength',
        keyword: 'maxLength',
        message: 'must NOT have more than 3 characters',
        params: { limit: 3 },
      },
      {
        instancePath: '/sprites/0/scripts/0/blocks',
        schemaPath: '#/maxItems',
        keyword: 'maxItems',
        message: 'must NOT have more than 1 item',
        params: { limit: 1 },
      },
    ]
    const report = createRepairReport({ data: platformer, schemaIssues: issues })
    expect(report.issues.find(({ code }) => code === 'schema-maxLength')?.example).toEqual({ replaceWith: 'Pla' })
    expect(report.issues.find(({ code }) => code === 'schema-maxItems')?.example).toEqual({
      replaceWith: platformer.sprites[0].scripts[0].blocks.slice(0, 1),
    })
  })

  it('derives a schema-branch replacement example for invalid oneOf inputs', () => {
    const invalidProject = structuredClone(platformer) as unknown as {
      sprites: { scripts: { blocks: { inputs?: Record<string, unknown> }[] }[] }[]
    }
    invalidProject.sprites[0].scripts[0].blocks[1].inputs = { COSTUME: { type: 'unsupported-input' } }
    const validation = validateCanonicalProject(invalidProject)
    if (validation.valid) throw new Error('Expected oneOf input errors')
    const oneOfError = validation.errors.find((issue) => issue.keyword === 'oneOf')
    if (!oneOfError) throw new Error('Expected an input oneOf error')

    const report = createRepairReport({ data: invalidProject, schemaIssues: [oneOfError] })
    const issue = report.issues.find(({ code }) => code === 'schema-oneOf')
    expect(validateReport(report)).toBe(true)
    if (!issue?.example) throw new Error('Missing oneOf replacement example')
    expect(issue.example).toEqual({ replaceWith: { type: 'literal', value: '' } })

    const corrected = structuredClone(invalidProject)
    corrected.sprites[0].scripts[0].blocks[1].inputs = {
      COSTUME: (issue.example as { replaceWith: unknown }).replaceWith,
    }
    expect(validateCanonicalProject(corrected).valid).toBe(true)
  })

  it('provides a specific repair suggestion for every semantic validator code', () => {
    const codes = [
      'asset-data-invalid',
      'asset-format-mismatch',
      'asset-checksum-mismatch',
      'asset-missing',
      'current-costume-out-of-range',
      'boolean-input-type',
      'broadcast-input-type',
      'condition-not-boolean',
      'hat-not-first',
      'hat-not-top-level',
      'input-block-shape',
      'input-kind',
      'invalid-argument-reporter',
      'invalid-field-value',
      'missing-field',
      'missing-input',
      'missing-procedure-argument',
      'procedure-argument-type',
      'substack-type',
      'target-not-supported',
      'unknown-broadcast',
      'unknown-field',
      'unknown-input',
      'unknown-list',
      'unknown-opcode',
      'unknown-procedure',
      'unknown-procedure-argument',
      'unknown-sprite',
      'unknown-variable',
    ]
    const report = createRepairReport({
      data: platformer,
      semanticIssues: codes.map((code) => ({ severity: 'error' as const, code, path: '/', message: code })),
    })
    const genericSuggestion = '依錯誤訊息與 capability registry 修正此項目'

    expect(report.issues).toHaveLength(codes.length)
    expect(report.issues.every(({ suggestion }) => suggestion !== genericSuggestion)).toBe(true)
  })

  it('reports missing and mismatched assets as actionable semantic errors', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.sprites[0].costumes[0].assetIssue = 'missing-archive-entry'
    project.sprites[0].sounds.push({ name: 'Missing sound', dataFormat: 'wav', assetIssue: 'checksum-mismatch' })

    const report = createRepairReport({ data: project, semanticIssues: validateCanonicalSemantics(project) })
    const missing = report.issues.find(({ code }) => code === 'asset-missing')
    const mismatch = report.issues.find(({ code }) => code === 'asset-checksum-mismatch')

    expect(validateReport(report)).toBe(true)
    expect(missing).toMatchObject({
      severity: 'error',
      status: 'must-fix',
      phase: 'semantic',
      path: '/sprites/0/costumes/0/assetIssue',
      actual: 'missing-archive-entry',
      expected: 'source asset bytes must be present',
    })
    expect(missing?.suggestion).toContain('來源專案封存檔還原')
    expect(mismatch).toMatchObject({
      severity: 'error',
      status: 'must-fix',
      phase: 'semantic',
      path: '/sprites/0/sounds/0/assetIssue',
      actual: 'checksum-mismatch',
      expected: 'source asset bytes must match the original checksum',
    })
    expect(mismatch?.suggestion).toContain('原始校驗值相符')
  })

  it('reports malformed asset bytes with an exact path and no fabricated replacement', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.sprites[0].costumes[0].data = 'broken-base64'
    const report = createRepairReport({ data: project, semanticIssues: validateCanonicalSemantics(project) })

    expect(validateReport(report)).toBe(true)
    expect(report.issues.find(({ code }) => code === 'asset-data-invalid')).toMatchObject({
      severity: 'error',
      status: 'must-fix',
      phase: 'semantic',
      path: '/sprites/0/costumes/0/data',
      actual: 'broken-base64',
      expected: 'non-empty decodable Base64, data URI, or inline SVG',
    })
  })

  it('reports a raster data-format mismatch without inventing replacement bytes', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.sprites[0].costumes[0].dataFormat = 'png'
    project.sprites[0].costumes[0].data = 'dGhpcyBpcyBub3QgYSBQTkc='
    const report = createRepairReport({ data: project, semanticIssues: validateCanonicalSemantics(project) })
    const issue = report.issues.find(({ code }) => code === 'asset-format-mismatch')

    expect(validateReport(report)).toBe(true)
    expect(issue).toMatchObject({
      phase: 'semantic',
      status: 'must-fix',
      path: '/sprites/0/costumes/0/data',
      expected: 'raster asset signature must match the declared dataFormat',
    })
    expect(issue?.suggestion).toContain('實際格式相符')
    expect(issue).not.toHaveProperty('example')
  })

  it('suggests the last valid costume index and validates the corrected project', () => {
    const project = structuredClone(platformer) as CanonicalProject
    const target = project.sprites[0]
    target.currentCostume = target.costumes.length + 4
    const report = createRepairReport({ data: project, semanticIssues: validateCanonicalSemantics(project) })
    const issue = report.issues.find(({ code }) => code === 'current-costume-out-of-range')

    expect(validateReport(report)).toBe(true)
    expect(issue).toMatchObject({
      severity: 'error',
      status: 'must-fix',
      path: '/sprites/0/currentCostume',
      expected: `integer index from 0 through ${target.costumes.length - 1}`,
      example: { replaceWith: target.costumes.length - 1 },
    })
    if (!issue?.example || typeof issue.example !== 'object' || !('replaceWith' in issue.example)) {
      throw new Error('Missing a costume-index replacement example')
    }
    target.currentCostume = issue.example.replaceWith as number
    expect(validateCanonicalSemantics(project).some(({ code }) => code === 'current-costume-out-of-range')).toBe(
      false,
    )
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
