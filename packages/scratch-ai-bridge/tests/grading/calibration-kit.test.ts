import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCalibrate } from '../../src/cli/grade-command'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { approveRubric } from '../../src/core/grading'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { bigFishRubric } from './fixtures'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('calibrate prepare', () => {
  it('builds a blind kit without automatic scores and merges several teacher sheets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scratch-ai-bridge-kit-'))
    roots.push(root)
    const input = join(root, 'class')
    await mkdir(input)
    const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
    const bytes = new Uint8Array(await archive.arrayBuffer())
    for (const name of ['王小明.sb3', 'b.sb3']) await writeFile(join(input, name), bytes)
    const rubricPath = join(root, 'rubric.json')
    await writeFile(rubricPath, JSON.stringify(approveRubric(bigFishRubric(), 'T1')))
    const out = join(root, 'kit')

    const prepared = await runCalibrate(['prepare', input, '--rubric', rubricPath, '--out', out])
    expect(prepared.exitCode).toBe(0)
    const kitFiles = await readdir(join(out, 'teacher-kit'))
    expect(kitFiles.sort()).toEqual(['scores-T1.csv', 'scores-T2.csv', 'works', '評分說明.md'])
    expect(await readdir(join(out, 'teacher-kit', 'works'))).toEqual(['S0001.sb3', 'S0002.sb3'])
    const sheet = await readFile(join(out, 'teacher-kit', 'scores-T1.csv'), 'utf8')
    expect(sheet).toContain('studentId,teacher,score,c:swimming,c:eat-feedback,c:clone-respawn')
    expect(sheet).not.toContain('王小明')
    expect(await readFile(join(out, 'PRIVATE-source-map.csv'), 'utf8')).toContain('王小明.sb3')
    const guide = await readFile(join(out, 'teacher-kit', '評分說明.md'), 'utf8')
    expect(guide).toContain('不要看系統的自動分數')

    // Synthetic teacher sheets (test data only): criterion columns filled, score left blank.
    for (const teacher of ['T1', 'T2'])
      await writeFile(
        join(root, `scores-${teacher}.csv`),
        `studentId,teacher,score,c:swimming,c:eat-feedback,c:clone-respawn\nS0001,${teacher},,30,20,40\nS0002,${teacher},,15,10,0\n`,
      )
    const calibrated = await runCalibrate([
      join(out, 'auto-report'),
      '--teachers',
      `${join(root, 'scores-T1.csv')},${join(root, 'scores-T2.csv')}`,
    ])
    const report = calibrated.output as { teachers: string[]; pendingExcluded: number; officialReady: boolean }
    expect(report.teachers).toEqual(['T1', 'T2'])
    // Without --playtest nothing is decided automatically, so nothing can be compared yet.
    expect(report.pendingExcluded).toBe(2)
    expect(report.officialReady).toBe(false)
  })
})
