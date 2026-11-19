import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { approveRubric } from '../../src/core/grading'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import {
  draftRubricTool,
  getGradeReportTool,
  gradeBatchTool,
  gradeSb3Tool,
  resolveGradingPath,
  validateRubricTool,
} from '../../src/mcp/grade-tools'
import { bigFishRubric } from './fixtures'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'scratch-ai-bridge-mcp-grade-'))
  roots.push(root)
  await mkdir(join(root, 'classes', '601'), { recursive: true })
  const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
  await writeFile(join(root, 'classes', '601', 'a.sb3'), new Uint8Array(await archive.arrayBuffer()))
  return root
}

describe('MCP grading tools', () => {
  it('only reads inside the allowed output folder', async () => {
    const root = await setup()
    await expect(resolveGradingPath('/etc/hosts', root)).rejects.toThrow('必須放在')
    await expect(resolveGradingPath('../', root)).rejects.toThrow('必須放在')
    expect(await resolveGradingPath('classes/601/a.sb3', root)).toMatch(/a\.sb3$/)
  })

  it('validates and drafts rubrics without approving them', () => {
    expect(validateRubricTool(JSON.stringify(bigFishRubric()))).toMatchObject({ ok: true, approved: false })
    const draft = draftRubricTool({ text: '碰到小魚會播放音效 30分', id: 'd1', title: 'd', projectType: 'animation' })
    expect(draft.validation.approved).toBe(false)
    expect(draft.rubric.totalPoints).toBe(30)
  })

  it('refuses an unapproved rubric and keeps unplayed work pending', async () => {
    const root = await setup()
    await expect(gradeSb3Tool({ file: 'classes/601/a.sb3', rubric: bigFishRubric() }, root)).rejects.toThrow(
      '尚未核准',
    )
    const grade = await gradeSb3Tool(
      { file: 'classes/601/a.sb3', rubric: approveRubric(bigFishRubric(), 'T1') },
      root,
    )
    expect(grade).toMatchObject({ status: 'pending', rawScore: null, runtimeStatus: 'not-run' })
  })

  it('grades a class folder into output/reports and reads the report back without the private map', async () => {
    const root = await setup()
    const { reportDirectory, summary } = await gradeBatchTool(
      { directory: 'classes/601', rubric: approveRubric(bigFishRubric(), 'T1'), reportName: 'r1' },
      root,
    )
    expect(reportDirectory).toBe(join(root, 'reports', 'r1'))
    expect(summary).toMatchObject({ total: 1, pending: 1 })
    const csv = await getGradeReportTool({ reportDirectory: 'reports/r1', part: 'grades.csv' }, root)
    expect(JSON.stringify(csv)).toContain('S0001')
    await expect(
      getGradeReportTool({ reportDirectory: 'reports/r1', part: 'PRIVATE-teacher-source-map.csv' }, root),
    ).rejects.toThrow()
  })
})
