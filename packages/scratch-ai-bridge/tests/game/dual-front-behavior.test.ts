import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createVM, getVariable, loadSb3 } from '../../src/scratch/vm'

interface Target {
  getName(): string
  x: number
  currentCostume: number
  setXY(x: number, y: number): void
}
interface Harness {
  runtime: { _step(): void; targets: Target[] }
  postIOData(device: string, data: Record<string, unknown>): void
  start(): void
  greenFlag(): void
}

it('plays a round: movement, mode, miss, hit, cooldown, winner and restart', async () => {
  const path = resolve(process.cwd(), 'research/dual-front-game/dual-front-v2.canonical.json')
  const project = JSON.parse(await readFile(path, 'utf8')) as CanonicalProject
  const archive = await compileCanonicalProjectToSb3(project)
  const vm = (await createVM()) as Awaited<ReturnType<typeof createVM>> & Harness
  await loadSb3(await archive.arrayBuffer(), vm)
  const step = () => vm.runtime._step()
  const ticks = (n = 5) => {
    for (let i = 0; i < n; i++) step()
  }
  const press = (key: string) => {
    vm.postIOData('keyboard', { key, isDown: true })
    ticks()
    vm.postIOData('keyboard', { key, isDown: false })
    ticks()
  }
  const value = (name: string) => getVariable(vm, 'Stage', name)?.value
  const target = (name: string) => {
    const result = vm.runtime.targets.find((item) => item.getName() === name)
    if (!result) throw new Error(`Missing target: ${name}`)
    return result
  }
  try {
    vm.start()
    vm.greenFlag()
    ticks()
    expect(value('P1 health')).toBe(100)
    expect(value('P2 health')).toBe(100)
    const p1 = target('Player 1')
    const p2 = target('Player 2')
    const p2Hud = target('P2 HUD')
    const result = target('Game result')
    expect(p2Hud.currentCostume).toBe(10)
    press('d')
    expect(p1.x).toBe(-118)
    press('q')
    expect(getVariable(vm, 'Player 1', 'P1 mode')?.value).toBe('dark')
    press('f')
    expect(value('P2 health')).toBe(100)
    p1.setXY(0, -75)
    p2.setXY(50, -75)
    press('f')
    expect(value('P2 health')).toBe(100)
    await new Promise((done) => setTimeout(done, 400))
    ticks()
    press('f')
    expect(value('P2 health')).toBe(90)
    ticks()
    expect(p2Hud.currentCostume).toBe(9)
    press('f')
    expect(value('P2 health')).toBe(90)
    for (let i = 0; i < 9; i++) {
      await new Promise((done) => setTimeout(done, 400))
      ticks()
      press('f')
    }
    expect(value('P2 health')).toBe(0)
    expect(value('Game state')).toBe('P1 wins')
    ticks()
    expect(p2Hud.currentCostume).toBe(0)
    expect(result.currentCostume).toBe(1)
    press('ArrowDown')
    expect(value('P1 health')).toBe(100)
    vm.greenFlag()
    ticks()
    expect(value('P1 health')).toBe(100)
    expect(value('P2 health')).toBe(100)
    expect(value('Game state')).toBe('playing')
    expect(result.currentCostume).toBe(0)
    expect(p1.x).toBe(-130)
    expect(p2.x).toBe(130)
    press('ArrowUp')
    expect(getVariable(vm, 'Player 2', 'P2 mode')?.value).toBe('dark')
    p1.setXY(0, -75)
    p2.setXY(50, -75)
    for (let i = 0; i < 10; i++) {
      press('ArrowDown')
      if (i < 9) {
        await new Promise((done) => setTimeout(done, 400))
        ticks()
      }
    }
    expect(value('P1 health')).toBe(0)
    expect(value('Game state')).toBe('P2 wins')
    ticks()
    expect(result.currentCostume).toBe(2)
  } finally {
    vm.quit()
  }
}, 20000)

it('runs a customized generated template and rejects invalid settings', async () => {
  const { execFile } = await import('node:child_process')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const directory = await mkdtemp(join(tmpdir(), 'dual-front-template-'))
  const generator = resolve(process.cwd(), 'research/dual-front-game/build-dual-front.py')
  const output = join(directory, 'custom.json')
  try {
    await expect(run('python3', [generator, '--out', output, '--damage', '13'])).rejects.toThrow()
    await expect(run('python3', [generator, '--out', output, '--cooldown', 'nan'])).rejects.toThrow()
    await run('python3', [
      generator,
      '--out',
      output,
      '--name',
      'Custom arena',
      '--damage',
      '20',
      '--speed',
      '8',
      '--reach',
      '65',
      '--cooldown',
      '0.2',
    ])
    const project = JSON.parse(await readFile(output, 'utf8')) as CanonicalProject
    expect(project.name).toBe('Custom arena')
    const archive = await compileCanonicalProjectToSb3(project)
    const vm = (await createVM()) as Awaited<ReturnType<typeof createVM>> & Harness
    try {
      await loadSb3(await archive.arrayBuffer(), vm)
      const tick = () => {
        for (let i = 0; i < 5; i++) vm.runtime._step()
      }
      const press = (key: string) => {
        vm.postIOData('keyboard', { key, isDown: true })
        tick()
        vm.postIOData('keyboard', { key, isDown: false })
        tick()
      }
      const target = (name: string) => {
        const found = vm.runtime.targets.find((item) => item.getName() === name)
        if (!found) throw new Error(`Missing target: ${name}`)
        return found
      }
      vm.start()
      vm.greenFlag()
      tick()
      const p1 = target('Player 1')
      const p2 = target('Player 2')
      press('d')
      expect(p1.x).toBe(-122)
      p1.setXY(0, -75)
      p2.setXY(70, -75)
      press('f')
      expect(getVariable(vm, 'Stage', 'P2 health')?.value).toBe(100)
      p2.setXY(50, -75)
      await new Promise((done) => setTimeout(done, 250))
      tick()
      for (let i = 0; i < 5; i++) {
        press('f')
        if (i < 4) {
          await new Promise((done) => setTimeout(done, 250))
          tick()
        }
      }
      expect(getVariable(vm, 'Stage', 'P2 health')?.value).toBe(0)
      expect(getVariable(vm, 'Stage', 'Game state')?.value).toBe('P1 wins')
      tick()
      expect(target('P2 HUD').currentCostume).toBe(0)
      vm.greenFlag()
      tick()
      expect(getVariable(vm, 'Stage', 'P2 health')?.value).toBe(100)
    } finally {
      vm.quit()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 10000)
