import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformerCore from '../../src/core/ir/examples/06-platformer-core.json'
import { CANONICAL_JSON_MAX_DEPTH, CANONICAL_JSON_MAX_NODES, type CanonicalProject } from '../../src/core/ir/types'
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

  it('removes registry shape metadata copied onto nested block JSON', () => {
    const draft = JSON.parse(JSON.stringify(example)) as Record<string, unknown>
    draft.meta = { shape: 'project-metadata' }
    const stage = draft.stage as { scripts: { blocks: Record<string, unknown>[] }[] }
    const blocks = stage.scripts[0].blocks
    blocks[0].shape = 'hat'
    blocks[0].inputs = {
      CONDITION: {
        type: 'block',
        block: { opcode: 'operator_equals', shape: 'boolean', inputs: {} },
      },
    }

    const normalized = normalizeAiDraft(draft)
    const validation = validateCanonicalProject(normalized.data)

    expect(validation.valid).toBe(true)
    expect(normalized.repairs.filter((repair) => repair.code === 'block-shape-metadata')).toHaveLength(2)
    const normalizedStage = (normalized.data as { stage: { scripts: { blocks: Record<string, unknown>[] }[] } }).stage
    const normalizedBlocks = normalizedStage.scripts[0].blocks
    expect(normalizedBlocks[0]).not.toHaveProperty('shape')
    const reporter = (normalizedBlocks[0].inputs as { CONDITION: { block: Record<string, unknown> } }).CONDITION.block
    expect(reporter).not.toHaveProperty('shape')
    expect((normalized.data as { meta: { shape: string } }).meta.shape).toBe('project-metadata')
  })

  it('compiles a Gemini-style platformer draft after removing copied shape labels', async () => {
    const draft = structuredClone(platformerCore) as Record<string, unknown>
    const markBlocks = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(markBlocks)
      } else if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>
        if (typeof record.opcode === 'string') record.shape = 'boolean'
        Object.values(record).forEach(markBlocks)
      }
    }
    markBlocks(draft.stage)
    markBlocks(draft.sprites)

    const normalized = normalizeAiDraft(draft)
    const validation = validateCanonicalProject(normalized.data)
    expect(validation.valid).toBe(true)
    if (!validation.valid) return
    expect(validateCanonicalSemantics(validation.data)).toEqual([])

    const archive = await compileCanonicalProjectToSb3(validation.data)
    expect(archive.size).toBeGreaterThan(0)
    expect(normalized.repairs.some(({ code }) => code === 'block-shape-metadata')).toBe(true)
  })

  it('bounds nested AI project data before recursive normalization', () => {
    const draft: Record<string, unknown> = {}
    let current = draft
    for (let depth = 0; depth <= CANONICAL_JSON_MAX_DEPTH; depth += 1) {
      const nested: Record<string, unknown> = {}
      current.child = nested
      current = nested
    }

    expect(() => normalizeAiDraft(draft)).toThrow(`巢狀超過 ${CANONICAL_JSON_MAX_DEPTH} 層上限`)
  })

  it('accepts nested AI project data exactly at the maximum depth', () => {
    const draft: Record<string, unknown> = {}
    let current = draft
    for (let depth = 0; depth < CANONICAL_JSON_MAX_DEPTH; depth += 1) {
      const nested: Record<string, unknown> = {}
      current.child = nested
      current = nested
    }

    expect(normalizeAiDraft(draft).data).toEqual(draft)
  })

  it('bounds AI project value counts before recursive normalization', () => {
    expect(() => normalizeAiDraft({ values: Array.from({ length: CANONICAL_JSON_MAX_NODES }, () => null) })).toThrow(
      `${CANONICAL_JSON_MAX_NODES.toLocaleString()} 個值的上限`,
    )
  })

  it('accepts AI project data with exactly the maximum number of values', () => {
    const values = Array.from({ length: CANONICAL_JSON_MAX_NODES - 2 }, () => null)
    const normalized = normalizeAiDraft({ values })

    expect((normalized.data as { values: unknown[] }).values).toHaveLength(CANONICAL_JSON_MAX_NODES - 2)
  })

  it('rejects cyclic AI draft objects before recursive normalization', () => {
    const draft: Record<string, unknown> = {}
    draft.child = draft
    expect(() => normalizeAiDraft(draft)).toThrow('不可包含循環參照')
  })

  it('extracts the largest Canonical IR from a Gemini notebook response and repairs field/asset wrappers', () => {
    const response = readFileSync(mixedResponseFixture, 'utf8')
    const parsed = parseAiResponse(response)
    const normalized = normalizeAiResponse(response)
    const validation = validateCanonicalProject(normalized.data)

    expect(parsed.extracted).toBe(true)
    expect(parsed.candidateCount).toBe(2)
    expect((parsed.data as { name?: unknown }).name).toBe('Mario ``` Mixed Response')
    expect(validation.valid).toBe(true)
    expect(new Set(normalized.repairs.map((repair) => repair.code))).toEqual(
      new Set(['extract-json', 'field-scalar', 'costume-data-format']),
    )
    if (!validation.valid) return

    expect(validation.data.name).toBe('Mario ``` Mixed Response')
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

  it('extracts generated Canonical projects from noisy Markdown responses', () => {
    let state = 0x51a1c0de
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['{', '}', '"', '\\', '`', '雪', '🚀', '\n', ':', '[', ']']

    for (let sample = 0; sample < 1_024; sample += 1) {
      const noise = Array.from(
        { length: 8 + (nextRandom() % 40) },
        () => alphabet[nextRandom() % alphabet.length],
      ).join('')
      const target = {
        ...example,
        name: `seed-${sample}-${noise}`,
        description: `literal braces { "format": "decoy" } and unicode 雪 🚀 ${noise}`,
      }
      const decoy = JSON.stringify({ format: 'scratch-ai-bridge/canonical-ir', version: 1, name: `small-${sample}` })
      const embedded = JSON.stringify(target, null, sample % 2 === 0 ? 0 : 2)
      const fence = (sample % 2 === 0 ? '`' : '~').repeat(3 + (sample % 3))
      const openingIndent = ' '.repeat(sample % 4)
      const eol = sample % 5 === 0 ? '\r\n' : '\n'
      const response = `Notes ${noise}${eol}${openingIndent}${fence}json${eol}${decoy}${eol}${fence}${eol}${eol}${openingIndent}${fence}json${eol}${embedded}${eol}${fence}${eol}End ${noise}`

      const parsed = parseAiResponse(response)
      expect(parsed.extracted).toBe(true)
      expect(parsed.candidateCount).toBeGreaterThan(0)
      expect(parsed.data).toEqual(target)
    }
  })

  it('selects the largest valid project across seeded malformed and mixed-fence responses', () => {
    let state = 0x2b7e1516
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['{', '}', '"', '\\', '`', '~', '雪', '🚀', '\t', ':', '[', ']']

    for (let sample = 0; sample < 1_024; sample += 1) {
      const noise = Array.from(
        { length: 24 + (nextRandom() % 128) },
        () => alphabet[nextRandom() % alphabet.length],
      ).join('')
      const eol = sample % 3 === 0 ? '\r\n' : '\n'
      const validFenceChar = sample % 2 === 0 ? '`' : '~'
      const invalidFenceChar = validFenceChar === '`' ? '~' : '`'
      const validFenceLength = 3 + (nextRandom() % 6)
      const validFence = validFenceChar.repeat(validFenceLength)
      const closingFence = `${validFenceChar.repeat(validFenceLength + (nextRandom() % 3))}${' '.repeat(nextRandom() % 4)}\t`
      const openingIndent = ' '.repeat(nextRandom() % 4)
      const closingIndent = ' '.repeat(nextRandom() % 4)
      const decoy = {
        format: 'scratch-ai-bridge/canonical-ir',
        version: 1,
        name: `decoy-${sample}`,
      }
      const target = {
        ...example,
        name: `selected-${sample}`,
        description: `${noise} ${JSON.stringify(decoy)} ${noise}`,
      }
      const response = [
        `Malformed draft ${noise}`,
        `${invalidFenceChar.repeat(3 + (sample % 4))}json`,
        `This opening fence is intentionally never closed ${noise}`,
        `${openingIndent}${validFence}json`,
        JSON.stringify(decoy),
        `${closingIndent}${closingFence}`,
        `${openingIndent}${validFence}json`,
        JSON.stringify(target),
        `${closingIndent}${closingFence}`,
        `Trailing prose ${noise}`,
      ].join(eol)

      const parsed = parseAiResponse(response)
      expect(parsed.extracted, `seed ${sample}`).toBe(true)
      expect(parsed.candidateCount, `seed ${sample}`).toBe(2)
      expect(parsed.data, `seed ${sample}`).toEqual(target)
    }
  })

  it('recovers generated embedded projects after malformed prose and rejects malformed noise', () => {
    let state = 0x6d2b79f5
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const alphabet = ['{', '}', '[', ']', '"', '\\', '`', '~', ':', '雪', '\n', '\r', ' ']

    for (let sample = 0; sample < 2_048; sample += 1) {
      const noise = Array.from(
        { length: 16 + (nextRandom() % 96) },
        () => alphabet[nextRandom() % alphabet.length],
      ).join('')
      const target = { ...example, name: `recovery-${sample}-${noise}` }
      const embedded = JSON.stringify(target)
      const fenceCharacter = sample % 2 === 0 ? '`' : '~'
      const fence = fenceCharacter.repeat(3 + (sample % 4))
      const malformedPrefix = `Draft ${noise} {"format":"scratch-ai-bridge/canonical-ir","version":1,"truncated":`
      const response = `${malformedPrefix}\n${fence}json\n${embedded}\n${fence}\n${noise}`

      let parsed: ReturnType<typeof parseAiResponse>
      try {
        parsed = parseAiResponse(response)
      } catch (error) {
        throw new Error(`seed ${sample} failed to recover its embedded project`, { cause: error })
      }
      expect(parsed.data, `seed ${sample}`).toEqual(target)
      expect(() => parseAiResponse(`Draft ${noise} {"truncated": [ ${noise}`)).toThrow(
        '找不到完整的 Scratch AI Bridge Canonical IR JSON',
      )
    }
  })

  it('accepts a JSON response at the two-million-character limit and rejects the next character', () => {
    const atLimit = JSON.stringify('x'.repeat(1_999_998))
    expect(atLimit).toHaveLength(2_000_000)
    expect(parseAiResponse(atLimit).data).toBe('x'.repeat(1_999_998))

    const overLimit = JSON.stringify('x'.repeat(1_999_999))
    expect(overLimit).toHaveLength(2_000_001)
    expect(() => parseAiResponse(overLimit)).toThrow('AI 回覆超過 2,000,000 字元上限')
  })
})
