import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getBlockCapability, isKnownOpcode } from '../../src/core/capabilities'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { normalizeAiDraft } from '../../src/core/normalizer/ai-draft'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'
import { validateCanonicalSemantics } from '../../src/core/validator/semantic'

const geminiFixture = fileURLToPath(new URL('../fixtures/gemini-platformer-shorthand.json', import.meta.url))

describe('Canonical IR semantic validator', () => {
  it('accepts the checked-in repeat example without semantic issues', () => {
    expect(validateCanonicalSemantics(example as CanonicalProject)).toEqual([])
  })

  it('accepts keyboard, collision, and Boolean reporters in the platformer example', () => {
    expect(validateCanonicalSemantics(platformer as CanonicalProject)).toEqual([])
  })

  it('rejects procedure declarations with duplicate parameter names', () => {
    const project = structuredClone(example) as CanonicalProject
    project.stage.procedures.push({
      name: 'combine',
      parameters: [
        { name: 'value', kind: 'string-number', default: '' },
        { name: 'value', kind: 'number', default: 0 },
      ],
      warp: false,
      body: [],
    })

    expect(validateCanonicalSemantics(project)).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'duplicate-procedure-argument',
        path: '/stage/procedures/0/parameters/1/name',
      }),
    )
  })

  it('rejects selected costume indexes outside each target costume range', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.stage.currentCostume = 1
    project.sprites[0].currentCostume = project.sprites[0].costumes.length

    expect(validateCanonicalSemantics(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'current-costume-out-of-range',
          path: '/stage/currentCostume',
        }),
        expect.objectContaining({
          severity: 'error',
          code: 'current-costume-out-of-range',
          path: '/sprites/0/currentCostume',
        }),
      ]),
    )
  })

  it('rejects missing and checksum-mismatched costume and sound assets with local paths', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.sprites[0].costumes[0].assetIssue = 'missing-archive-entry'
    project.sprites[0].sounds.push({ name: 'Missing sound', dataFormat: 'wav', assetIssue: 'checksum-mismatch' })

    expect(validateCanonicalSemantics(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'asset-missing',
          path: '/sprites/0/costumes/0/assetIssue',
        }),
        expect.objectContaining({
          severity: 'error',
          code: 'asset-checksum-mismatch',
          path: '/sprites/0/sounds/0/assetIssue',
        }),
      ]),
    )
  })

  it('rejects empty and malformed costume and sound asset encodings', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.sprites[0].costumes[0].data = 'not-base64!'
    project.sprites[0].sounds.push({ name: 'Invalid sound', dataFormat: 'wav', data: 'data:audio/wav;base64,%%%=' })
    project.stage.costumes.push({ name: 'Empty costume', dataFormat: 'svg', data: '' })

    expect(validateCanonicalSemantics(project).filter(({ code }) => code === 'asset-data-invalid')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/sprites/0/costumes/0/data' }),
        expect.objectContaining({ path: '/sprites/0/sounds/0/data' }),
        expect.objectContaining({ path: '/stage/costumes/0/data' }),
      ]),
    )
  })

  it('rejects Base64-valid costume bytes that do not match the declared raster format', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.sprites[0].costumes[0].dataFormat = 'png'
    project.sprites[0].costumes[0].data = 'dGhpcyBpcyBub3QgYSBQTkc='

    expect(validateCanonicalSemantics(project)).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'asset-format-mismatch',
        path: '/sprites/0/costumes/0/data',
      }),
    )
  })

  it('keeps unknown opcode strings representable while strict semantic validation rejects them', () => {
    const project = structuredClone(example) as CanonicalProject
    project.stage.scripts[0].blocks[0].opcode = 'thirdparty_extension_block'

    const structural = validateCanonicalProject(project)
    expect(structural.valid).toBe(true)
    if (!structural.valid) return
    expect(validateCanonicalSemantics(structural.data).map(({ code }) => code)).toContain('unknown-opcode')
    expect(isKnownOpcode('thirdparty_extension_block')).toBe(false)
    expect(getBlockCapability('toString')).toBeUndefined()
  })

  it('reports ambiguous numeric conditions in the repaired Gemini draft', () => {
    const draft: unknown = JSON.parse(readFileSync(geminiFixture, 'utf8'))
    const normalized = normalizeAiDraft(draft)
    const validation = validateCanonicalProject(normalized.data)
    expect(validation.valid).toBe(true)
    if (!validation.valid) return

    const issues = validateCanonicalSemantics(validation.data)
    expect(issues.filter((issue) => issue.code === 'condition-not-boolean')).toHaveLength(3)
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false)
  })

  it('rejects unknown symbols, missing inputs, and a misplaced event hat', () => {
    const project = structuredClone(example) as CanonicalProject
    project.stage.scripts[0]?.blocks.push(
      { opcode: 'event_whenflagclicked' },
      {
        opcode: 'data_setvariableto',
        fields: { VARIABLE: 'missing' },
      },
      {
        opcode: 'event_broadcast',
        inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'missing-message' } },
      },
    )

    const issues = validateCanonicalSemantics(project)
    expect(new Set(issues.map((issue) => issue.code))).toEqual(
      new Set(['hat-not-first', 'hat-not-top-level', 'missing-input', 'unknown-variable', 'unknown-broadcast']),
    )
  })

  it('enforces registry target, field, input, and collision contracts', () => {
    const project = structuredClone(platformer) as CanonicalProject
    project.stage.scripts.push({
      blocks: [
        {
          opcode: 'motion_gotoxy',
          fields: { EXTRA: 'unexpected' },
          inputs: {
            X: { type: 'literal', value: 0 },
            Y: { type: 'literal', value: 0 },
            EXTRA: { type: 'literal', value: 0 },
          },
        },
      ],
    })
    project.sprites[0].scripts.push({
      blocks: [
        { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: 'escape' } },
        {
          opcode: 'control_if',
          inputs: {
            CONDITION: {
              type: 'block',
              block: {
                opcode: 'sensing_touchingobject',
                inputs: { TOUCHINGOBJECTMENU: { type: 'literal', value: 'Ghost' } },
              },
            },
            SUBSTACK: { type: 'stack', blocks: [] },
          },
        },
      ],
    })

    const codes = new Set(validateCanonicalSemantics(project).map((issue) => issue.code))
    expect(codes).toEqual(
      new Set(['invalid-field-value', 'target-not-supported', 'unknown-field', 'unknown-input', 'unknown-sprite']),
    )
  })
})
