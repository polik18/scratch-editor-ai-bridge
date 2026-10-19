import { describe, expect, it } from 'vitest'
import { inspectSb3Bytes, inspectionToMarkdown, inspectionToStudentMarkdown } from '../../src/cli/inspect'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'

describe('static CLI inspection', () => {
  it('analyzes raw SB3 structure without exposing sprite names or block IDs', async () => {
    const project = structuredClone(example02) as CanonicalProject
    project.sprites[0].name = 'Private Student Name'
    const archive = await compileCanonicalProjectToSb3(project)
    const result = await inspectSb3Bytes(new Uint8Array(await archive.arrayBuffer()))
    const json = JSON.stringify(result)

    expect(result).toMatchObject({
      format: 'scratch-ai-bridge/inspection',
      version: 1,
      analysisMode: 'static-raw-sb3',
      runtimeVerified: false,
      status: 'ok',
    })
    expect(result.summary.sprites).toBe(1)
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence[0]?.id).toMatch(/^E\d+$/)
    const evidenceIds = new Set(result.evidence.map(({ id }) => id))
    for (const reference of [
      ...result.feedback.items.flatMap(({ evidenceIds: ids }) => ids),
      ...result.score.criteria.flatMap(({ evidenceIds: ids }) => ids),
    ]) {
      expect(evidenceIds.has(reference)).toBe(true)
    }
    expect(json).not.toContain('Private Student Name')
    expect(json).toContain('角色 1')
    expect(json).not.toContain('blockId')
    expect(inspectionToMarkdown(result)).toContain('沒有執行作品')
    const studentReport = inspectionToStudentMarkdown(result)
    expect(studentReport).toContain('給學生看的作品小提醒')
    expect(studentReport).toContain('沒有實際執行你的作品')
    expect(studentReport).not.toContain('SB3 結構參考分')
    expect(studentReport).not.toMatch(/[EF]\d+/)
  })

  it('writes a short student report with a concrete location for a detached script', async () => {
    const project = structuredClone(example02) as CanonicalProject
    project.sprites[0]?.scripts[0]?.blocks.shift()
    const archive = await compileCanonicalProjectToSb3(project)
    const result = await inspectSb3Bytes(new Uint8Array(await archive.arrayBuffer()))
    const studentReport = inspectionToStudentMarkdown(result)

    expect(result.diagnostics.some(({ code }) => code === 'detached-script')).toBe(true)
    expect(studentReport).toContain('檢查這段程式怎麼開始')
    expect(studentReport).toContain('角色 A・第 1 段程式')
    expect(studentReport).toContain('移動 10 步')
    expect(studentReport).toContain('當綠旗被點擊')
    expect(studentReport).not.toContain('detached-script')
    expect(studentReport).not.toMatch(/[EF]\d+/)
  })
})
