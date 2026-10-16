import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runBatch } from '../../src/cli/batch'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'

const temporaryDirectories: string[] = []

const makeTempDirectory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'scratch-ai-bridge-cli-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('batch CLI core', () => {
  it('isolates each project, creates reports and keeps the source mapping separate', async () => {
    const root = await makeTempDirectory()
    const input = join(root, 'class')
    const output = join(root, 'reports')
    await mkdir(input)
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    const bytes = new Uint8Array(await archive.arrayBuffer())
    await writeFile(join(input, 'one.sb3'), bytes)
    await writeFile(join(input, 'two.sb3'), bytes)

    const summary = await runBatch({ inputDirectory: input, outputDirectory: output, recursive: false, jobs: 2 })
    const sourceMap = await readFile(join(output, 'PRIVATE-teacher-source-map.csv'), 'utf8')
    const results = await readFile(join(output, 'results.jsonl'), 'utf8')

    expect(summary).toMatchObject({ total: 2, ok: 2, partial: 0, failed: 0 })
    expect(sourceMap).toContain('studentId,relativeFile')
    expect(sourceMap).toContain('S0001,one.sb3')
    expect(results.trim().split('\n')).toHaveLength(2)
    await expect(readFile(join(output, 'S0001.md'), 'utf8')).resolves.toContain('Scratch 作品靜態分析')
    await expect(
      runBatch({ inputDirectory: input, outputDirectory: output, recursive: false, jobs: 1 }),
    ).rejects.toThrow('output-exists')
  })

  it('rejects an output directory inside the input directory', async () => {
    const root = await makeTempDirectory()
    const input = join(root, 'class')
    await mkdir(input)
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    await writeFile(join(input, 'one.sb3'), new Uint8Array(await archive.arrayBuffer()))

    await expect(
      runBatch({
        inputDirectory: input,
        outputDirectory: join(input, 'reports'),
        recursive: false,
        jobs: 1,
      }),
    ).rejects.toThrow('output-path-invalid')
  })

  it('rejects a manifest path that escapes the input directory before creating reports', async () => {
    const root = await makeTempDirectory()
    const input = join(root, 'class')
    const output = join(root, 'reports')
    const manifest = join(root, 'students.json')
    await mkdir(input)
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    await writeFile(join(input, 'one.sb3'), new Uint8Array(await archive.arrayBuffer()))
    await writeFile(manifest, JSON.stringify([{ studentId: 'S1', file: '../outside.sb3' }]))

    await expect(
      runBatch({
        inputDirectory: input,
        outputDirectory: output,
        recursive: false,
        jobs: 1,
        manifestPath: manifest,
      }),
    ).rejects.toThrow('manifest-invalid')
  })

  it('uses validated CSV student IDs in anonymized reports', async () => {
    const root = await makeTempDirectory()
    const input = join(root, 'class')
    const output = join(root, 'reports')
    const manifest = join(root, 'students.csv')
    await mkdir(input)
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    await writeFile(join(input, 'one.sb3'), new Uint8Array(await archive.arrayBuffer()))
    await writeFile(manifest, 'studentId,file\nPupil-A,one.sb3\n')

    const summary = await runBatch({
      inputDirectory: input,
      outputDirectory: output,
      recursive: false,
      jobs: 1,
      manifestPath: manifest,
    })
    const sourceMap = await readFile(join(output, 'PRIVATE-teacher-source-map.csv'), 'utf8')

    expect(summary.records[0]?.studentId).toBe('Pupil-A')
    expect(sourceMap).toContain('Pupil-A,one.sb3')
    await expect(readFile(join(output, 'Pupil-A.json'), 'utf8')).resolves.toContain('"studentId": "Pupil-A"')
  })
})
