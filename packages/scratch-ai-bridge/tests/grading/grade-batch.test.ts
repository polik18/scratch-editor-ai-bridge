import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractStaticEvidence, planGradingPlaytest, runGradeBatch } from '../../src/cli/grade'
import type { PlaytestResult, PlaytestRunner } from '../../src/cli/playtest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { approveRubric } from '../../src/core/grading'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { bigFishRubric } from './fixtures'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const fakeRunner = (results: PlaytestResult[]): PlaytestRunner => {
  let index = 0
  return {
    run: () => Promise.resolve(results[index++ % results.length]),
    close: () => Promise.resolve(),
  } as unknown as PlaytestRunner
}

const played = (overrides: Partial<PlaytestResult> = {}): PlaytestResult => ({
  ready: true,
  pageErrors: [],
  autonomousMotion: true,
  controls: [],
  changedVariables: [],
  executedOpcodes: { 'sensing_touchingobject:true': 1, looks_hide: 1, sound_play: 1, control_create_clone_of: 1 },
  maxClones: 1,
  changedSprites: ['大魚', '小魚'],
  durationMs: 8000,
  ...overrides,
})

describe('grade batch', () => {
  it('reads static evidence and plans a playtest from the project', async () => {
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    const evidence = await extractStaticEvidence(new Uint8Array(await archive.arrayBuffer()))
    expect(evidence.opcodes.event_whenflagclicked).toBeGreaterThan(0)
    expect(evidence.sprites).toBeGreaterThan(0)
    expect(evidence.coverage).toBeGreaterThan(0)
    const { plan } = planGradingPlaytest({ ...evidence, keys: ['left arrow', 'space'] })
    expect(plan.controls.map(({ key, expectsMovement }) => [key, expectsMovement])).toEqual([
      ['ArrowLeft', true],
      [' ', false],
    ])
  })

  it('writes the teacher grade sheet, review queue, summary and private map', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scratch-ai-bridge-grade-'))
    temporaryDirectories.push(root)
    const input = join(root, 'class')
    await mkdir(input)
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    const bytes = new Uint8Array(await archive.arrayBuffer())
    await writeFile(join(input, 'a.sb3'), bytes)
    await writeFile(join(input, 'b.sb3'), bytes)
    await writeFile(join(input, 'c.sb3'), new Uint8Array([1, 2, 3]))
    const rubricPath = join(root, 'rubric.json')
    await writeFile(rubricPath, JSON.stringify(approveRubric(bigFishRubric(), 'teacher-A')))
    const manifest = join(root, 'manifest.csv')
    await writeFile(
      manifest,
      'studentId,file,gradeLevel,classId\nA01,a.sb3,6,601\nA02,b.sb3,6,601\nA03,c.sb3,6,601\n',
    )
    const overrides = join(root, 'overrides.csv')
    await writeFile(overrides, 'studentId,score,reason,reviewer\nA02,95,"現場確認有音效",T1\n')
    const output = join(root, 'out')

    const summary = await runGradeBatch({
      inputDirectory: input,
      outputDirectory: output,
      manifestPath: manifest,
      rubricPath,
      overridesPath: overrides,
      playtest: true,
      runner: fakeRunner([played(), played({ executedOpcodes: { looks_hide: 1 } })]),
    })
    expect(summary).toMatchObject({ total: 3, graded: 2, failed: 1, officialGrades: true })
    const csv = await readFile(join(output, 'grades.csv'), 'utf8')
    const [header, a01, a02, a03] = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\n')
    expect(header).toContain('exportScore,finalScore,autoScore,teacherScore,rawScore,cohortScore,diagnosticScore')
    expect(header).toContain('c:swimming,c:eat-feedback,c:clone-respawn')
    expect(a01).toContain('A01,6,601')
    expect(a01).toContain(',100,') // raw 100
    expect(a02.split(',')[6]).toBe('95') // teacher score exported, automatic score kept beside it
    expect(a03).toContain('failed')
    const queue = await readFile(join(output, 'review-queue.csv'), 'utf8')
    expect(queue).toContain('A03')
    expect(queue).not.toContain('A01')
    expect(await readFile(join(output, 'PRIVATE-teacher-source-map.csv'), 'utf8')).toContain('A01,a.sb3')
    expect(await readFile(join(output, 'A01.md'), 'utf8')).toContain('大魚吃小魚')
  })

  it('refuses an unapproved rubric unless the run is marked trial', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scratch-ai-bridge-grade-'))
    temporaryDirectories.push(root)
    const input = join(root, 'class')
    await mkdir(input)
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    await writeFile(join(input, 'a.sb3'), new Uint8Array(await archive.arrayBuffer()))
    const rubricPath = join(root, 'rubric.json')
    await writeFile(rubricPath, JSON.stringify(bigFishRubric()))
    await expect(
      runGradeBatch({ inputDirectory: input, outputDirectory: join(root, 'out'), rubricPath, playtest: false }),
    ).rejects.toThrow('rubric-not-approved')
    const summary = await runGradeBatch({
      inputDirectory: input,
      outputDirectory: join(root, 'trial'),
      rubricPath,
      playtest: false,
      allowTrial: true,
    })
    expect(summary).toMatchObject({ officialGrades: false, trial: 1 })
  })
})
