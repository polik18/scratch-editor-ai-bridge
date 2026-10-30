import { describe, expect, it } from 'vitest'
import platformerFixture from '../../src/core/ir/examples/06-platformer-core.json'
import broadcastFixture from '../../src/core/ir/examples/04-broadcast-flow.json'
import type { CanonicalProject, CanonicalScript } from '../../src/core/ir/types'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import { applyLiveVariablePatchToProject, getLivePatchScriptSelector, parseLiveVariablePatch } from '../../src/core/normalizer'
import { createVM, getVariable, loadSb3 } from '../../src/scratch/vm'

interface GameVM {
  runtime: { _step(): void; targets: { getName(): string; x: number }[] }
  postIOData(device: string, data: Record<string, unknown>): void
  start(): void
  greenFlag(): void
  quit(): void
}

const createLivePatch = (summary: string, operations: unknown[]) =>
  JSON.stringify({
    format: 'scratch-ai-bridge/live-patch',
    version: 1,
    baseRevision: 0,
    summary,
    operations,
  })

const runProject = async (project: CanonicalProject): Promise<GameVM> => {
  const vm = (await createVM()) as unknown as GameVM
  const archive = await compileCanonicalProjectToSb3(project)
  await loadSb3(await archive.arrayBuffer(), vm as never)
  vm.start()
  vm.greenFlag()
  return vm
}

describe('AI live-patch behavior across game genres', () => {
  it('changes a platformer movement script and rollback restores the original movement', async () => {
    const original = structuredClone(platformerFixture) as CanonicalProject
    const player = original.sprites.find((sprite) => sprite.name === 'Player')!
    const movement = player.scripts.find((script) => script.blocks[0]?.fields?.KEY_OPTION === 'right arrow')!
    const selector = getLivePatchScriptSelector(movement)
    const fasterMovement: CanonicalScript = structuredClone(movement)
    fasterMovement.blocks[1]!.inputs!.DX = { type: 'literal', value: 12 }
    const patch = parseLiveVariablePatch(
      createLivePatch('平台跳躍：提高向右移動速度', [
        { op: 'replace-target-script', target: 'Player', selector, script: fasterMovement },
      ]),
      original,
      0,
    )
    const patched = applyLiveVariablePatchToProject(original, patch.operations)
    const vm = await runProject(patched)
    try {
      const target = vm.runtime.targets.find((item) => item.getName() === 'Player')!
      const before = target.x
      vm.postIOData('keyboard', { key: 'ArrowRight', isDown: true })
      vm.runtime._step()
      expect(target.x - before).toBe(12)
    } finally {
      vm.quit()
    }

    const rollbackVM = await runProject(original)
    try {
      const target = rollbackVM.runtime.targets.find((item) => item.getName() === 'Player')!
      const before = target.x
      rollbackVM.postIOData('keyboard', { key: 'ArrowRight', isDown: true })
      rollbackVM.runtime._step()
      expect(target.x - before).toBe(8)
    } finally {
      rollbackVM.quit()
    }
  })

  it('adds a puzzle response script and verifies the door-state transition', async () => {
    const original = structuredClone(broadcastFixture) as CanonicalProject
    original.name = 'Key and Door Puzzle'
    original.stage.variables.push({ name: 'Door state', value: 'locked' })
    original.broadcasts![0]!.name = 'unlock_door'
    const broadcastBlock = original.stage.scripts[0]!.blocks[1]!
    broadcastBlock.inputs!.BROADCAST_INPUT = { type: 'broadcast', name: 'unlock_door' }
    original.stage.scripts[1]!.blocks[0]!.fields!.BROADCAST_OPTION = 'unlock_door'

    const patch = parseLiveVariablePatch(
      createLivePatch('解謎：收到開門訊號後解鎖門', [
        {
          op: 'add-target-script',
          target: 'Stage',
          script: {
            blocks: [
              { opcode: 'event_whenbroadcastreceived', fields: { BROADCAST_OPTION: 'unlock_door' } },
              {
                opcode: 'data_setvariableto',
                fields: { VARIABLE: 'Door state' },
                inputs: { VALUE: { type: 'literal', value: 'open' } },
              },
            ],
          },
        },
      ]),
      original,
      0,
    )
    const patched = applyLiveVariablePatchToProject(original, patch.operations)
    const vm = await runProject(patched)
    try {
      for (let tick = 0; tick < 5; tick += 1) vm.runtime._step()
      expect(getVariable(vm as never, 'Stage', 'Door state')?.value).toBe('open')
    } finally {
      vm.quit()
    }
  })
})
