import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { normalizeAiDraft, normalizeAiResponse, parseAiResponse } from '../../src/core/normalizer/ai-draft'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'
import { validateCanonicalSemantics } from '../../src/core/validator/semantic'

const geminiFixture = fileURLToPath(new URL('../fixtures/gemini-platformer-shorthand.json', import.meta.url))
const mixedResponseFixture = fileURLToPath(new URL('../fixtures/gemini-notebook-mixed-response.txt', import.meta.url))

describe('AI draft normalizer', () => {
  it('repairs the real Gemini platformer shorthand into schema-valid Canonical IR', () => {
    const draft: unknown = JSON.parse(readFileSync(geminiFixture, 'utf8'))
    const original = JSON.stringify(draft)
    const normalized = normalizeAiDraft(draft)
    const validation = validateCanonicalProject(normalized.data)

    expect(validation.valid).toBe(true)
    expect(JSON.stringify(draft)).toBe(original)
    expect(normalized.repairs.length).toBeGreaterThan(40)
    expect(new Set(normalized.repairs.map((repair) => repair.code))).toEqual(
      new Set([
        'target-default',
        'script-wrapper',
        'literal-input',
        'broadcast-input',
        'stack-input',
        'variable-input',
        'broadcast-declaration',
      ]),
    )
    expect(normalized.warnings.some((warning) => warning.code === 'condition-not-boolean')).toBe(true)

    if (validation.valid) {
      const project: CanonicalProject = validation.data
      expect(project.stage.kind).toBe('stage')
      expect(project.sprites).toHaveLength(4)
      expect(project.sprites[0]?.scripts[0]?.blocks[1]?.inputs?.VALUE).toEqual({ type: 'literal', value: 0 })
      expect(project.broadcasts[0]).toEqual({ name: 'start_game' })
    }
  })

  it('leaves an already valid Canonical IR unchanged', () => {
    const normalized = normalizeAiDraft(example)
    expect(normalized.data).toEqual(example)
    expect(normalized.repairs).toEqual([])
    expect(normalized.warnings).toEqual([])
  })

  it('extracts the largest Canonical IR from a Gemini notebook response and repairs field/asset wrappers', () => {
    const response = readFileSync(mixedResponseFixture, 'utf8')
    const parsed = parseAiResponse(response)
    const normalized = normalizeAiResponse(response)
    const validation = validateCanonicalProject(normalized.data)

    expect(parsed.extracted).toBe(true)
    expect(parsed.candidateCount).toBe(2)
    expect((parsed.data as { name?: unknown }).name).toBe('Mario Mixed Response')
    expect(validation.valid).toBe(true)
    expect(new Set(normalized.repairs.map((repair) => repair.code))).toEqual(
      new Set(['extract-json', 'field-scalar', 'costume-data-format']),
    )
    if (!validation.valid) return

    expect(validation.data.name).toBe('Mario Mixed Response')
    expect(validation.data.stage.costumes[0]?.dataFormat).toBe('svg')
    expect(validation.data.sprites[0]?.scripts[0]?.blocks[0]?.fields?.KEY_OPTION).toBe('right arrow')
    expect(validation.data.sprites[0]?.scripts[0]?.blocks[1]?.fields?.VARIABLE).toBe('vy')
    expect(validateCanonicalSemantics(validation.data)).toEqual([])
  })

  it('rejects mixed prose that contains no complete Canonical IR object', () => {
    expect(() => parseAiResponse('```python\nprint("no project")\n```')).toThrow(
      '找不到完整的 Scratch AI Bridge Canonical IR JSON',
    )
  })
})
