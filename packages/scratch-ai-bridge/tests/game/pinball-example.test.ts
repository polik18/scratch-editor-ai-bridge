import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CanonicalProject } from '../../src/core/ir/types'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import { getVariable, loadSb3 } from '../../src/scratch/vm'

interface TestTarget {
  getName(): string
  x: number
  y: number
  direction: number
  setXY(x: number, y: number): void
  isTouchingObject(name: string): boolean
}
interface TestVM {
  start(): void
  greenFlag(): void
  postIOData(device: string, data: Record<string, unknown>): void
  runtime: { _step(): void; targets: TestTarget[] }
}

describe('pinball example behavior', () => {
  it('initializes, moves, responds to both flipper keys, and loses a life', async () => {
    const source = path.resolve('../../research/pinball-candidate-20261031/pinball-refined.json')
    const project = JSON.parse(readFileSync(source, 'utf8')) as CanonicalProject
    const archive = await compileCanonicalProjectToSb3(project)
    const handle = await loadSb3(await archive.arrayBuffer())
    const vm = handle as unknown as TestVM
    try {
      vm.start()
      vm.greenFlag()
      vm.runtime._step()
      const ball = vm.runtime.targets.find((target) => target.getName() === 'Ball')
      const left = vm.runtime.targets.find((target) => target.getName() === 'LeftFlipper')
      const right = vm.runtime.targets.find((target) => target.getName() === 'RightFlipper')
      expect(ball).toBeDefined()
      expect(getVariable(handle, 'Stage', 'lives')?.value).toBe(3)
      expect(ball?.x).not.toBe(-160)
      vm.postIOData('keyboard', { key: 'ArrowLeft', isDown: true })
      vm.runtime._step()
      expect(left?.direction).toBe(60)
      vm.postIOData('keyboard', { key: 'ArrowLeft', isDown: false })
      vm.postIOData('keyboard', { key: 'ArrowRight', isDown: true })
      vm.runtime._step()
      expect(right?.direction).toBe(120)
      vm.postIOData('keyboard', { key: 'ArrowRight', isDown: false })
      ball?.setXY(160, -170)
      for (let i = 0; i < 10 && getVariable(handle, 'Stage', 'lives')?.value === 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 35))
        vm.runtime._step()
      }
      expect(getVariable(handle, 'Stage', 'lives')?.value).toBe(2)
      for (const expectedLives of [1, 0]) {
        ball?.setXY(160, -170)
        for (let i = 0; i < 10 && getVariable(handle, 'Stage', 'lives')?.value !== expectedLives; i++) {
          await new Promise((resolve) => setTimeout(resolve, 35))
          vm.runtime._step()
        }
        expect(getVariable(handle, 'Stage', 'lives')?.value).toBe(expectedLives)
      }
      vm.greenFlag()
      vm.runtime._step()
      expect(getVariable(handle, 'Stage', 'lives')?.value).toBe(3)
      expect(getVariable(handle, 'Stage', 'score')?.value).toBe(0)
    } finally {
      handle.quit()
    }
  }, 60000)

  it('scores once for continuous bumper contact and scores again after separation', async () => {
    const source = path.resolve('../../research/pinball-candidate-20261031/pinball-refined.json')
    const project = JSON.parse(readFileSync(source, 'utf8')) as CanonicalProject
    const archive = await compileCanonicalProjectToSb3(project)
    const handle = await loadSb3(await archive.arrayBuffer())
    const vm = handle as unknown as TestVM
    try {
      const ball = vm.runtime.targets.find((target) => target.getName() === 'Ball')
      if (!ball) throw new Error('Missing ball')
      let touching = true
      ball.isTouchingObject = (name) => name === 'Bumper1' && touching
      vm.start()
      vm.greenFlag()
      for (let i = 0; i < 16; i++) {
        vm.runtime._step()
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      expect(getVariable(handle, 'Stage', 'score')?.value).toBe(10)
      touching = false
      for (let i = 0; i < 4; i++) {
        vm.runtime._step()
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      touching = true
      for (let i = 0; i < 4; i++) {
        vm.runtime._step()
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      expect(getVariable(handle, 'Stage', 'score')?.value).toBe(20)
    } finally {
      handle.quit()
    }
  }, 60000)
})
