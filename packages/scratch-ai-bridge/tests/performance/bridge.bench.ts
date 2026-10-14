import JSZip from 'jszip'
import { bench, describe } from 'vitest'
import { analyzeCanonicalProject } from '../../src/core/analyzer'
import { importLosslessSb3 } from '../../src/core/archive'
import { buildScratchProjectArchive } from '../../src/core/compiler'
import sampleProject from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { normalizeAiDraft } from '../../src/core/normalizer'
import { validateCanonicalProject } from '../../src/core/validator'

const assetArchivePromise = (async () => {
  const archive = new JSZip()
  const bytes = new Uint8Array(4 * 1024 * 1024)
  let state = 0x4d595df4
  for (let index = 0; index < bytes.length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    bytes[index] = state >>> 24
  }
  archive.file('project.json', '{"targets":[]}')
  archive.file('assets/benchmark.bin', bytes)
  return new Uint8Array(await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
})()

const makeProject = (blockCount: number): CanonicalProject => {
  const project = structuredClone(sampleProject) as CanonicalProject
  const [sprite, ...otherSprites] = project.sprites

  const blocks = Array.from({ length: blockCount }, (_, index) =>
    index === 0
      ? { opcode: 'event_whenflagclicked' as const }
      : {
          opcode: 'looks_say' as const,
          inputs: { MESSAGE: { type: 'literal' as const, value: `sample ${index}` } },
        },
  )
  return {
    ...project,
    stage: { ...project.stage, scripts: [] },
    sprites: [{ ...sprite, scripts: [{ blocks }] }, ...otherSprites.map((target) => ({ ...target, scripts: [] }))],
  }
}

describe(`Canonical processing / ${process.version} / ${process.platform}-${process.arch}`, () => {
  bench('4 MiB DEFLATE asset · SB3 archive import', async () => {
    await importLosslessSb3(await assetArchivePromise)
  })

  for (const blockCount of [100, 500, 2_000]) {
    const project = makeProject(blockCount)
    const json = JSON.stringify(project)

    bench(`${blockCount} blocks · AI draft normalization`, () => {
      normalizeAiDraft(project)
    })

    bench(`${blockCount} blocks · Canonical schema validation`, () => {
      const result = validateCanonicalProject(project)
      if (!result.valid) throw new Error(`Benchmark fixture invalid: ${JSON.stringify(result.errors.slice(0, 1))}`)
    })

    bench(`${blockCount} blocks · project analysis`, () => {
      analyzeCanonicalProject(project)
    })

    bench(`${blockCount} blocks · JSON parse`, () => {
      JSON.parse(json)
    })

    bench(`${blockCount} blocks · SB3 archive compilation`, async () => {
      await buildScratchProjectArchive(project)
    })
  }
})
