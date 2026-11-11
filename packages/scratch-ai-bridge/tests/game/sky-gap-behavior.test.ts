import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createVM, getVariable, loadSb3 } from '../../src/scratch/vm'

interface Target {
  getName(): string
  x: number
  y: number
  currentCostume: number
  setXY(x: number, y: number): void
}
interface Harness {
  runtime: { _step(): void; targets: Target[] }
  postIOData(device: string, data: Record<string, unknown>): void
  start(): void
  greenFlag(): void
}

it('simulates gravity, jumping, landing, falling, reaching the goal and restarting', async () => {
  const file = resolve(process.cwd(), 'research/dual-front-game/platformer.canonical.json')
  const project = JSON.parse(await readFile(file, 'utf8')) as CanonicalProject
  const archive = await compileCanonicalProjectToSb3(project)
  const vm = (await createVM()) as Awaited<ReturnType<typeof createVM>> & Harness
  await loadSb3(await archive.arrayBuffer(), vm)
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) vm.runtime._step()
  }
  const press = (key: string) => {
    vm.postIOData('keyboard', { key, isDown: true })
    tick()
    vm.postIOData('keyboard', { key, isDown: false })
    tick()
  }
  const target = (name: string) => {
    const item = vm.runtime.targets.find((candidate) => candidate.getName() === name)
    if (!item) throw new Error(`Missing target ${name}`)
    return item
  }
  try {
    vm.start()
    vm.greenFlag()
    tick(5)
    const player = target('Player')
    expect(player.x).toBe(-180)
    expect(player.y).toBe(-90)
    press('ArrowRight')
    expect(player.x).toBe(-172)
    press(' ')
    await new Promise((done) => setTimeout(done, 150))
    tick(4)
    expect(player.y).toBeGreaterThan(-90)
    await new Promise((done) => setTimeout(done, 1300))
    tick(4)
    expect(player.y).toBe(-90)
    player.setXY(-45, -90)
    press(' ')
    for (let i = 0; i < 15; i++) {
      press('ArrowRight')
      await new Promise((done) => setTimeout(done, 50))
    }
    await new Promise((done) => setTimeout(done, 650))
    tick(4)
    expect(player.x).toBe(75)
    expect(player.y).toBe(-90)
    expect(getVariable(vm, 'Stage', 'Falls')?.value).toBe(0)
    player.setXY(0, -90)
    await new Promise((done) => setTimeout(done, 700))
    tick(4)
    expect(getVariable(vm, 'Stage', 'Falls')?.value).toBe(1)
    expect(player.x).toBe(-180)
    expect(player.y).toBe(-90)
    player.setXY(160, -90)
    await new Promise((done) => setTimeout(done, 80))
    tick(5)
    expect(getVariable(vm, 'Stage', 'Game state')?.value).toBe('won')
    expect(target('Result').currentCostume).toBe(1)
    press('ArrowLeft')
    expect(player.x).toBe(160)
    vm.greenFlag()
    tick(5)
    expect(player.x).toBe(-180)
    expect(getVariable(vm, 'Stage', 'Falls')?.value).toBe(0)
    expect(getVariable(vm, 'Stage', 'Game state')?.value).toBe('playing')
  } finally {
    vm.quit()
  }
}, 10000)
