import { Buffer } from 'node:buffer'
import scratchParser from 'scratch-parser'
import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import example01 from '../../src/core/ir/examples/01-minimal-project.json'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import example03 from '../../src/core/ir/examples/03-repeat-score.json'
import example04 from '../../src/core/ir/examples/04-broadcast-flow.json'
import example05 from '../../src/core/ir/examples/05-full-entities.json'
import example06 from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'

const parseOfficialProject = (input: Buffer): Promise<unknown> =>
  new Promise((resolve, reject) => {
    scratchParser(input, false, (error, project) => {
      if (error) reject(error instanceof Error ? error : new Error('scratch-parser rejected the generated archive'))
      else resolve(project)
    })
  })

const examples = [example01, example02, example03, example04, example05, example06] as CanonicalProject[]

describe('generated SB3 compatibility', () => {
  it.each(examples)('passes scratch-parser for $name', async (project) => {
    const sb3 = await compileCanonicalProjectToSb3(project)
    const parsed = await parseOfficialProject(Buffer.from(await sb3.arrayBuffer()))

    expect(parsed).toBeDefined()
    expect(sb3.size).toBeGreaterThan(0)
  })

  it('refuses schema-valid projects with semantic authoring errors', async () => {
    const project = structuredClone(example06) as CanonicalProject
    project.sprites[0].scripts.push({ blocks: [{ opcode: 'event_whenkeypressed' }] })

    await expect(compileCanonicalProjectToSb3(project)).rejects.toThrow('semantic validation failed')
  })
})
