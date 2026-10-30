import { describe, expect, it } from 'vitest'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import fullEntities from '../../src/core/ir/examples/05-full-entities.json'
import type { CanonicalProject, CanonicalScript } from '../../src/core/ir/types'
import {
  applyLiveVariablePatchToProject,
  createLiveVariablePatchInstruction,
  getLivePatchScriptSelector,
  LIVE_PATCH_FORMAT,
  listLivePatchScripts,
  parseLiveVariablePatch,
} from '../../src/core/normalizer'

const project = structuredClone(example) as CanonicalProject
const patch = (operations: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: LIVE_PATCH_FORMAT,
    version: 1,
    baseRevision: 3,
    summary: '調整分數',
    operations,
    ...extra,
  })

describe('live variable patches', () => {
  it('parses an existing scalar variable patch and applies it immutably', () => {
    const parsed = parseLiveVariablePatch(
      patch([{ op: 'set-variable', target: 'Stage', name: 'score', value: 25 }]),
      project,
      3,
    )
    const updated = applyLiveVariablePatchToProject(project, parsed.operations)
    expect(updated.stage.variables[0]?.value).toBe(25)
    expect(project.stage.variables[0]?.value).toBe(0)
    expect(parsed.operations[0]?.op === 'set-variable' && parsed.operations[0].beforeValue).toBe(0)
  })

  it('keeps the AI edit prompt compact for large projects and asks before guessing omitted targets', () => {
    const largeProject = structuredClone(project)
    const score = largeProject.stage.variables[0]!
    largeProject.stage.variables = Array.from({ length: 500 }, (_, index) => ({
      ...score,
      name: `score ${index}`,
    }))
    const sourceScript = largeProject.stage.scripts[0]!
    largeProject.stage.scripts = Array.from({ length: 500 }, (_, index) => ({
      ...structuredClone(sourceScript),
      blocks: sourceScript.blocks.map((block, blockIndex) => ({
        ...block,
        opcode: `${block.opcode}-${index}-${blockIndex}`,
      })),
    }))
    const instruction = createLiveVariablePatchInstruction(largeProject, 3)
    expect(instruction.length).toBeLessThan(13_000)
    expect(instruction).toContain('其餘')
    expect(instruction).toContain('要求列出目標')
  })

  it('rejects stale revisions, unknown fields, duplicate writes and unsafe values', () => {
    const op = { op: 'set-variable', target: 'Stage', name: 'score', value: 25 }
    expect(() => parseLiveVariablePatch(patch([op]), project, 4)).toThrow(/revision 過期/)
    expect(() => parseLiveVariablePatch(patch([op], { script: 'unsafe' }), project, 3)).toThrow(/不支援的欄位/)
    expect(() => parseLiveVariablePatch(patch([op, op]), project, 3)).toThrow(/重複修改/)
    expect(() => parseLiveVariablePatch(patch([{ ...op, value: 1_000_001 }]), project, 3)).toThrow(/安全範圍/)
  })

  it('rejects undeclared and cloud variables and keeps the instruction scoped', () => {
    expect(() =>
      parseLiveVariablePatch(patch([{ op: 'set-variable', target: 'Stage', name: 'missing', value: 1 }]), project, 3),
    ).toThrow(/找不到唯一變數/)
    const cloudProject = structuredClone(project)
    cloudProject.stage.variables[0]!.cloud = true
    expect(() =>
      parseLiveVariablePatch(
        patch([{ op: 'set-variable', target: 'Stage', name: 'score', value: 1 }]),
        cloudProject,
        3,
      ),
    ).toThrow(/雲端變數/)
    const instruction = createLiveVariablePatchInstruction(project, 3)
    expect(instruction).toContain('Stage/score')
    expect(instruction).toContain('baseRevision":3')
    expect(instruction).toContain('不得執行 JS')
  })

  it('supports bounded live target and stage properties and applies them immutably', () => {
    const targetProject = structuredClone(fullEntities) as CanonicalProject
    targetProject.stage.tempo = 90
    targetProject.stage.volume = 70
    const source = patch([
      { op: 'set-target-property', target: 'Player', property: 'x', value: 40 },
      { op: 'set-target-property', target: 'Player', property: 'size', value: 85 },
      { op: 'set-stage-property', property: 'tempo', value: 128 },
      { op: 'set-stage-property', property: 'volume', value: 45 },
      { op: 'set-stage-property', property: 'backdropIndex', value: 0 },
    ])
    const parsed = parseLiveVariablePatch(source, targetProject, 3)
    const updated = applyLiveVariablePatchToProject(targetProject, parsed.operations)
    expect(updated.sprites[0]).toMatchObject({ x: 40, size: 85 })
    expect(updated.stage).toMatchObject({ tempo: 128, volume: 45, currentCostume: 0 })
    expect(targetProject.sprites[0]).toMatchObject({ x: 12, size: 100 })
    expect(targetProject.stage).toMatchObject({ tempo: 90, volume: 70 })
  })

  it('rejects invalid target/stage properties and duplicate property writes', () => {
    const targetProject = structuredClone(fullEntities) as CanonicalProject
    const targetOp = { op: 'set-target-property', target: 'Player', property: 'size', value: 85 }
    expect(() => parseLiveVariablePatch(patch([{ ...targetOp, value: 0 }]), targetProject, 3)).toThrow(/size 必須/)
    expect(() =>
      parseLiveVariablePatch(patch([{ ...targetOp, property: 'opacity', value: 50 }]), targetProject, 3),
    ).toThrow(/property 不支援/)
    expect(() => parseLiveVariablePatch(patch([targetOp, targetOp]), targetProject, 3)).toThrow(/重複修改欄位/)
    expect(() =>
      parseLiveVariablePatch(patch([{ op: 'set-stage-property', property: 'tempo', value: 501 }]), targetProject, 3),
    ).toThrow(/tempo 必須/)
  })

  it('adds, replaces and removes scripts by unique structural selector', () => {
    const scriptProject = structuredClone(example) as CanonicalProject
    const original = scriptProject.stage.scripts[0]!
    const selector = getLivePatchScriptSelector(original)
    const replacement = {
      blocks: [
        { opcode: 'event_whenflagclicked' },
        { opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'patched' } } },
      ],
    } as unknown as CanonicalScript
    const replaced = parseLiveVariablePatch(
      patch([{ op: 'replace-target-script', target: 'Stage', selector, script: replacement }]),
      scriptProject,
      3,
    )
    const replacedProject = applyLiveVariablePatchToProject(scriptProject, replaced.operations)
    expect(replacedProject.stage.scripts[0]).toEqual(replacement)
    expect(scriptProject.stage.scripts[0]).toEqual(original)

    const added = parseLiveVariablePatch(
      patch([{ op: 'add-target-script', target: 'Stage', script: replacement }]),
      scriptProject,
      3,
    )
    const addedProject = applyLiveVariablePatchToProject(scriptProject, added.operations)
    expect(addedProject.stage.scripts).toHaveLength(scriptProject.stage.scripts.length + 1)
    expect(
      listLivePatchScripts(addedProject).some(
        (script) => script.selector === getLivePatchScriptSelector(replacement),
      ),
    ).toBe(true)

    const removeSelector = getLivePatchScriptSelector(replacement)
    const removed = parseLiveVariablePatch(
      patch([{ op: 'remove-target-script', target: 'Stage', selector: removeSelector }]),
      addedProject,
      3,
    )
    expect(applyLiveVariablePatchToProject(addedProject, removed.operations).stage.scripts).toHaveLength(
      addedProject.stage.scripts.length - 1,
    )
  })

  it('rejects ambiguous script selectors, malformed scripts and mixed structure/runtime changes', () => {
    const scriptProject = structuredClone(example) as CanonicalProject
    const original = scriptProject.stage.scripts[0]!
    const selector = getLivePatchScriptSelector(original)
    scriptProject.stage.scripts.push(structuredClone(original))
    expect(() =>
      parseLiveVariablePatch(patch([{ op: 'remove-target-script', target: 'Stage', selector }]), scriptProject, 3),
    ).toThrow(/必須唯一/)
    expect(() =>
      parseLiveVariablePatch(
        patch([{ op: 'add-target-script', target: 'Stage', script: { blocks: [] } }]),
        scriptProject,
        3,
      ),
    ).toThrow(/blocks 必須/)
    const mixedProject = structuredClone(example) as CanonicalProject
    const mixedSelector = getLivePatchScriptSelector(mixedProject.stage.scripts[0]!)
    expect(() =>
      parseLiveVariablePatch(
        patch([
          { op: 'set-variable', target: 'Stage', name: 'score', value: 5 },
          { op: 'remove-target-script', target: 'Stage', selector: mixedSelector },
        ]),
        mixedProject,
        3,
      ),
    ).toThrow(/不可與 runtime/)
  })
})
