import { describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler/compiler'
import broadcastFixture from '../../src/core/ir/examples/04-broadcast-flow.json'
import platformerFixture from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalBlock, CanonicalBroadcast, CanonicalProject, CanonicalScript } from '../../src/core/ir/types'
import {
  applyLiveVariablePatchToProject,
  getLivePatchScriptSelector,
  parseLiveVariablePatch,
} from '../../src/core/normalizer'
import { createVM, getVariable, loadSb3 } from '../../src/scratch/vm'

interface GameTarget {
  getName(): string
  x: number
}

interface GameVM {
  runtime: {
    _step(): void
    targets: GameTarget[]
  }
  postIOData(device: string, data: Record<string, unknown>): void
  start(): void
  greenFlag(): void
  quit(): void
}

const createLivePatch = (summary: string, operations: unknown[]): string =>
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
    const player = original.sprites.find((sprite) => sprite.name === 'Player')
    if (!player) throw new Error('Player sprite not found')

    const movement = player.scripts.find((script) => script.blocks[0]?.fields?.KEY_OPTION === 'right arrow')
    if (!movement) throw new Error('Movement script not found')

    const selector = getLivePatchScriptSelector(movement)
    const fasterMovement: CanonicalScript = structuredClone(movement)
    const moveBlocks: (CanonicalBlock | undefined)[] = fasterMovement.blocks
    const moveBlock = moveBlocks[1]
    if (!moveBlock) throw new Error('Move block not found')
    moveBlock.inputs = { ...moveBlock.inputs, DX: { type: 'literal', value: 12 } }

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
      const target = vm.runtime.targets.find((item) => item.getName() === 'Player')
      if (!target) throw new Error('Player target not found')
      const before = target.x
      vm.postIOData('keyboard', { key: 'ArrowRight', isDown: true })
      vm.runtime._step()
      expect(target.x - before).toBe(12)
    } finally {
      vm.quit()
    }

    const rollbackVM = await runProject(original)
    try {
      const target = rollbackVM.runtime.targets.find((item) => item.getName() === 'Player')
      if (!target) throw new Error('Rollback target not found')
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

    const broadcasts: (CanonicalBroadcast | undefined)[] = original.broadcasts
    const firstBroadcast = broadcasts[0]
    if (!firstBroadcast) throw new Error('Broadcast not found')
    firstBroadcast.name = 'unlock_door'

    const stageScripts: (CanonicalScript | undefined)[] = original.stage.scripts
    const stageScript0 = stageScripts[0]
    if (!stageScript0) throw new Error('Stage script 0 not found')
    const stageBlocks0: (CanonicalBlock | undefined)[] = stageScript0.blocks
    const broadcastBlock = stageBlocks0[1]
    if (!broadcastBlock) throw new Error('Broadcast block not found')
    broadcastBlock.inputs = { ...broadcastBlock.inputs, BROADCAST_INPUT: { type: 'broadcast', name: 'unlock_door' } }

    const stageScript1 = stageScripts[1]
    if (!stageScript1) throw new Error('Stage script 1 not found')
    const stageBlocks1: (CanonicalBlock | undefined)[] = stageScript1.blocks
    const receiveBlock = stageBlocks1[0]
    if (!receiveBlock) throw new Error('Receive block not found')
    receiveBlock.fields = { ...receiveBlock.fields, BROADCAST_OPTION: 'unlock_door' }

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
