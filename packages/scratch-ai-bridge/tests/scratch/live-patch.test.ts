import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import fullEntities from '../../src/core/ir/examples/05-full-entities.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createVM, getProjectJson, loadSb3, setRuntimePatchValues, type ScratchVMHandle } from '../../src/scratch/vm'

describe('Scratch VM runtime patch adapter', () => {
  it('applies live sprite and Stage properties and returns exact values for undo', async () => {
    const project = structuredClone(fullEntities) as CanonicalProject
    project.stage.tempo = 90
    project.stage.volume = 75
    const vm: ScratchVMHandle = await createVM()
    try {
      await loadSb3(await compileCanonicalProjectToSb3(project), vm)
      const changes = setRuntimePatchValues(vm, [
        { op: 'set-target-property', targetName: 'Player', property: 'x', value: 80 },
        { op: 'set-target-property', targetName: 'Player', property: 'size', value: 125 },
        { op: 'set-stage-property', property: 'tempo', value: 144 },
        { op: 'set-stage-property', property: 'volume', value: 40 },
        { op: 'set-stage-property', property: 'backdropIndex', value: 0 },
      ])
      expect(changes.map(({ beforeValue }) => beforeValue)).toEqual([12, 100, 90, 75, 0])
      const serialized = getProjectJson(vm) as {
        targets: {
          name: string
          isStage: boolean
          x: number
          size: number
          tempo: number
          volume: number
          currentCostume: number
        }[]
      }
      expect(serialized.targets.find((target) => target.name === 'Player')).toMatchObject({ x: 80, size: 125 })
      expect(serialized.targets.find((target) => target.isStage)).toMatchObject({
        tempo: 144,
        volume: 40,
        currentCostume: 0,
      })

      setRuntimePatchValues(
        vm,
        changes.map((change) => ({ ...change, value: change.beforeValue })) as Parameters<
          typeof setRuntimePatchValues
        >[1],
      )
      const restored = getProjectJson(vm) as typeof serialized
      expect(restored.targets.find((target) => target.name === 'Player')).toMatchObject({ x: 12, size: 100 })
      expect(restored.targets.find((target) => target.isStage)).toMatchObject({ tempo: 90, volume: 75 })
    } finally {
      vm.quit()
    }
  })

  it('rejects cloud values, clone-only sprites and out-of-range target state', async () => {
    const project = structuredClone(fullEntities) as CanonicalProject
    project.stage.variables.push({ name: 'cloud', value: 0, cloud: true })
    const vm = await createVM()
    try {
      await loadSb3(await compileCanonicalProjectToSb3(project), vm)
      expect(() =>
        setRuntimePatchValues(vm, [{ op: 'set-target-property', targetName: 'Player', property: 'size', value: 0 }]),
      ).toThrow(/supported range/)
      expect(() =>
        setRuntimePatchValues(vm, [{ op: 'set-target-property', targetName: 'missing', property: 'x', value: 1 }]),
      ).toThrow(/unique sprite/)
      expect(() =>
        setRuntimePatchValues(vm, [{ op: 'set-variable', targetName: 'Stage', variableName: 'cloud', value: 1 }]),
      ).toThrow(/non-cloud scalar/)
    } finally {
      vm.quit()
    }
  })
})
