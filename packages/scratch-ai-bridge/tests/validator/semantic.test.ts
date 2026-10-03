import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { normalizeAiDraft } from '../../src/core/normalizer/ai-draft'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'
import { validateCanonicalSemantics } from '../../src/core/validator/semantic'

const geminiFixture = fileURLToPath(new URL('../fixtures/gemini-platformer-shorthand.json', import.meta.url))

describe('Canonical IR semantic validator', () => {
  it('accepts the checked-in repeat example without semantic issues', () => {
    expect(validateCanonicalSemantics(example as CanonicalProject)).toEqual([])
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
})
