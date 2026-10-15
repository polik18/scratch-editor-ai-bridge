import { describe, expect, it } from 'vitest'
import { createAuthoringInstruction, createStudentProjectInstruction } from '../../src/core/capabilities'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import { parseAiProjectResponse } from '../../src/core/normalizer'

describe('AI response envelope', () => {
  it('keeps bare Canonical IR v1 responses backward compatible', () => {
    expect(parseAiProjectResponse(example)).toEqual({ project: example, requirementCoverage: null, envelope: false })
  })

  it('accepts requirement coverage only when evidence pointers exist', () => {
    const envelope = {
      format: 'scratch-ai-bridge/ai-response',
      version: 1,
      project: example,
      requirementCoverage: [
        {
          id: 'R1',
          requirement: '追蹤分數',
          status: 'implemented-structure',
          evidencePointers: ['/stage/scripts/0/blocks/1'],
        },
        {
          id: 'R2',
          requirement: '達到 60 FPS',
          status: 'not-verifiable-from-ir',
          evidencePointers: [],
        },
      ],
    }

    expect(parseAiProjectResponse(envelope)).toMatchObject({
      envelope: true,
      requirementCoverage: envelope.requirementCoverage,
    })
    expect(() =>
      parseAiProjectResponse({
        ...envelope,
        requirementCoverage: [{ ...envelope.requirementCoverage[0], evidencePointers: ['/sprites/90/scripts/0'] }],
      }),
    ).toThrow('evidence pointer 不存在')
  })

  it('teaches the student generator to separate requirements from the Canonical project', () => {
    expect(createAuthoringInstruction()).toContain('根物件必須包含 format="scratch-ai-bridge/canonical-ir"')
    const instruction = createStudentProjectInstruction('Create a simple platform game')
    expect(instruction).toContain('scratch-ai-bridge/ai-response')
    expect(instruction).toContain('requirementCoverage')
    expect(instruction).toContain('implemented-structure')
  })
})
