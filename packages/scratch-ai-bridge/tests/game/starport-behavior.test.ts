import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createVM, getVariable, loadSb3 } from '../../src/scratch/vm'
import { applyLiveVariablePatchToProject, getLivePatchScriptSelector, parseLiveVariablePatch } from '../../src/core/normalizer'
import { describe, expect, it } from 'vitest'

interface TargetHarness {
  drawableID: number | null
  getName(): string
  readonly x: number
  readonly y: number
  setXY(x: number, y: number): void
}
interface RuntimeHarness {
  runtime: { _step(): void; targets: TargetHarness[] }
  postIOData(device: string, data: Record<string, unknown>): void
  start(): void
  greenFlag(): void
  attachRenderer(renderer: Record<string, unknown>): void
}

const openStarport = async (projectOverride?: CanonicalProject) => {
  const designPath = resolve(process.cwd(), '../../research/tool-evaluation/2026-10-30-starport/starport-rift-expedition.canonical.json')
  const project = projectOverride ?? (JSON.parse(await readFile(designPath, 'utf8')) as CanonicalProject)
  const archive = await compileCanonicalProjectToSb3(project)
  const vm = (await createVM()) as typeof createVM extends () => Promise<infer T> ? T & RuntimeHarness : never
  let collisionMode: 'none' | 'projectile' | 'enemy' = 'none'
  let nextDrawableId = 1
  const renderer = {
    setLayerGroupOrdering() {},
    createSVGSkin: async () => nextDrawableId++,
    createTextSkin: () => nextDrawableId++,
    getSkinSize: () => [100, 100],
    getBounds: () => null,
    getCurrentSkinSize: () => [100, 100],
    getNativeSize: () => [480, 360],
    getSkinRotationCenter: () => [50, 50],
    getFencedPositionOfDrawable: (_id: number, position: number[]) => position,
    createDrawable: () => nextDrawableId++,
    updateDrawablePosition() {},
    updateDrawableDirectionScale() {},
    updateDrawableVisible() {},
    updateDrawableSkinId() {},
    updateTextSkin() {},
    updateDrawableEffect() {},
    setDrawableOrder: () => 0,
    isTouchingDrawables: (targetId: number, candidateIds: number[]) => {
      const target = (name: string) => vm.runtime.targets.find((candidate) => candidate.getName() === name)
      const bullet = target('脈衝彈')
      const enemy = target('裂隙掠奪者')
      const player = target('巡防艇')
      if (!bullet || !enemy || !player) return false
      if (collisionMode === 'projectile' && targetId === bullet.drawableID && candidateIds.includes(enemy.drawableID ?? -1)) {
        return Math.abs(bullet.x - enemy.x) < 35 && Math.abs(bullet.y - enemy.y) < 35
      }
      if (collisionMode === 'enemy' && targetId === enemy.drawableID && candidateIds.includes(player.drawableID ?? -1)) {
        return Math.abs(enemy.x - player.x) < 35 && Math.abs(enemy.y - player.y) < 35
      }
      return false
    },
    pick: () => -1,
    getDrawableOrder: (id: number) => id,
    destroyDrawable() {},
    destroySkin() {},
    penClear() {},
    penStamp() {},
    penPoint() {},
    penLine() {},
    draw() {},
  }
  vm.attachRenderer(renderer)
  await loadSb3(await archive.arrayBuffer(), vm)
  return { vm, runtime: vm, setCollisionMode: (mode: typeof collisionMode) => { collisionMode = mode } }
}

const wait = (ms: number) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

describe('Starport Rift Expedition runtime smoke', () => {
  it('moves, hits the enemy, loses on three collisions, and resets on green flag', async () => {
    const { vm, runtime, setCollisionMode } = await openStarport()
    const target = (name: string) => runtime.runtime.targets.find((candidate) => candidate.getName() === name)!
    const step = () => runtime.runtime._step()
    try {
      runtime.start()
      runtime.greenFlag()
      for (let tick = 0; tick < 5; tick += 1) step()
      expect(getVariable(vm, 'Stage', '分數')?.value).toBe(0)
      expect(getVariable(vm, 'Stage', '護盾')?.value).toBe(3)
      expect(getVariable(vm, 'Stage', '遊戲狀態')?.value).toBe('作戰中')

      const player = target('巡防艇')
      const initialX = player.x
      runtime.postIOData('keyboard', { key: 'ArrowLeft', isDown: true })
      for (let tick = 0; tick < 8; tick += 1) step()
      expect(player.x).toBeLessThan(initialX)
      runtime.postIOData('keyboard', { key: 'ArrowLeft', isDown: false })

      player.setXY(-80, -130)
      target('裂隙掠奪者').setXY(0, 140)
      runtime.postIOData('keyboard', { key: ' ', isDown: true })
      setCollisionMode('projectile')
      const deadline = Date.now() + 2500
      while (getVariable(vm, 'Stage', '分數')?.value !== 10 && Date.now() < deadline) {
        target('裂隙掠奪者').setXY(target('脈衝彈').x, 140)
        step()
        await wait(12)
      }
      runtime.postIOData('keyboard', { key: ' ', isDown: false })
      expect(getVariable(vm, 'Stage', '分數')?.value).toBe(10)

      setCollisionMode('enemy')
      for (let expectedShield = 2; expectedShield >= 0; expectedShield -= 1) {
        const deadlineForHit = Date.now() + 1000
        while (getVariable(vm, 'Stage', '護盾')?.value !== expectedShield && Date.now() < deadlineForHit) {
          target('裂隙掠奪者').setXY(player.x, player.y)
          step()
          await wait(12)
        }
        expect(getVariable(vm, 'Stage', '護盾')?.value).toBe(expectedShield)
      }
      expect(getVariable(vm, 'Stage', '遊戲狀態')?.value).toBe('任務失敗')

      runtime.greenFlag()
      for (let tick = 0; tick < 5; tick += 1) step()
      expect(getVariable(vm, 'Stage', '分數')?.value).toBe(0)
      expect(getVariable(vm, 'Stage', '護盾')?.value).toBe(3)
      expect(getVariable(vm, 'Stage', '遊戲狀態')?.value).toBe('作戰中')
    } finally {
      vm.quit()
    }
  }, 10_000)

  it('applies a structural balance patch to starting shields and can roll back to the original value', async () => {
    const designPath = resolve(process.cwd(), '../../research/tool-evaluation/2026-10-30-starport/starport-rift-expedition.canonical.json')
    const original = JSON.parse(await readFile(designPath, 'utf8')) as CanonicalProject
    const patchedScript = structuredClone(original.stage.scripts[0]!)
    patchedScript.blocks[2]!.inputs!.VALUE = { type: 'literal', value: 5 }
    const patch = parseLiveVariablePatch(
      JSON.stringify({
        format: 'scratch-ai-bridge/live-patch',
        version: 1,
        baseRevision: 0,
        summary: '射擊遊戲：增加初始護盾',
        operations: [
          {
            op: 'replace-target-script',
            target: 'Stage',
            selector: getLivePatchScriptSelector(original.stage.scripts[0]!),
            script: patchedScript,
          },
        ],
      }),
      original,
      0,
    )
    const patched = applyLiveVariablePatchToProject(original, patch.operations)
    for (const [project, expectedShield] of [
      [patched, 5],
      [original, 3],
    ] as const) {
      const { vm, runtime } = await openStarport(project)
      try {
        runtime.start()
        runtime.greenFlag()
        for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
        expect(getVariable(vm, 'Stage', '護盾')?.value).toBe(expectedShield)
      } finally {
        vm.quit()
      }
    }
  }, 10_000)
})
