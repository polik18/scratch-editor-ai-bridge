import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import example from '../../src/core/ir/examples/05-full-entities.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import {
  captureScratchProgress,
  captureScratchTargetProgress,
  createVM,
  loadSb3,
  restoreScratchProgress,
  setRuntimePatchValues,
} from '../../src/scratch/vm'

describe('Scratch progress variables and lists', () => {
  it('restores selected data and rejects invalid snapshots before changing anything', async () => {
    const project = structuredClone(example) as CanonicalProject
    project.stage.variables.push({ name: 'private-cloud', value: 7, cloud: true })
    const vm = await createVM()
    try {
      await loadSb3(await compileCanonicalProjectToSb3(project), vm)
      const snapshot = captureScratchProgress(vm)
      const targets = captureScratchTargetProgress(vm)
      const player = targets.find((target) => target.name === 'Player')!
      expect(snapshot.some((entry) => entry.name === 'private-cloud')).toBe(false)
      const score = snapshot.find((entry) => entry.name === 'globalScore')!
      const list = snapshot.find((entry) => entry.name === 'highScores')!
      expect(list.type).toBe('list')
      setRuntimePatchValues(vm, [
        { op: 'set-variable', targetName: score.targetName, variableName: score.name, value: 88 },
      ])
      const before = captureScratchProgress(vm)
      setRuntimePatchValues(vm, [{ op: 'set-target-property', targetName: 'Player', property: 'x', value: 80 }])
      const targetBefore = captureScratchTargetProgress(vm)
      expect(() => restoreScratchProgress(vm, [score], [{ ...player, currentCostume: 999 }])).toThrow(/costume/)
      expect(captureScratchProgress(vm)).toEqual(before)
      expect(captureScratchTargetProgress(vm)).toEqual(targetBefore)
      restoreScratchProgress(vm, [score, list], targets, true)
      expect(captureScratchProgress(vm)).toEqual(before)
      expect(captureScratchTargetProgress(vm)).toEqual(targetBefore)
      expect(() => restoreScratchProgress(vm, [score, { ...list, id: 'unknown' }])).toThrow(/does not match/)
      expect(captureScratchProgress(vm)).toEqual(before)
      restoreScratchProgress(vm, [score, { ...list, value: ['new', 42] }], targets)
      expect(captureScratchProgress(vm).find((entry) => entry.name === score.name)?.value).toEqual(score.value)
      expect(captureScratchProgress(vm).find((entry) => entry.name === list.name)?.value).toEqual(['new', 42])
      expect(captureScratchTargetProgress(vm).find((target) => target.name === 'Player')?.x).toBe(player.x)
    } finally {
      vm.quit()
    }
  })
})
