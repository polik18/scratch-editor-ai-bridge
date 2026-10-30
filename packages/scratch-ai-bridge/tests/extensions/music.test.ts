import { describe, expect, it } from 'vitest'
import { buildScratchProjectArchive } from '../../src/core/compiler/project-json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import type { CanonicalBlock, CanonicalProject } from '../../src/core/ir/types'
import { createVM, getProjectJson, loadSb3, runForTicks, type ScratchVMHandle } from '../../src/scratch/vm'

describe('built-in Scratch extension runtime behavior', () => {
  it('waits for Music note and drum beat durations without an audio device', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push(
      { name: 'zeroNoteFinished', value: false },
      { name: 'noteFinished', value: false },
      { name: 'drumFinished', value: false },
    )
    const setFlag = (name: string): CanonicalBlock => ({
      opcode: 'data_setvariableto',
      fields: { VARIABLE: name },
      inputs: { VALUE: { type: 'literal', value: true } },
    })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'music_playNoteForBeats',
            inputs: { NOTE: { type: 'literal', value: 60 }, BEATS: { type: 'literal', value: 0 } },
          },
          setFlag('zeroNoteFinished'),
          {
            opcode: 'music_playNoteForBeats',
            inputs: { NOTE: { type: 'literal', value: 60 }, BEATS: { type: 'literal', value: 0.1 } },
          },
          setFlag('noteFinished'),
          {
            opcode: 'music_playDrumForBeats',
            inputs: { DRUM: { type: 'literal', value: 1 }, BEATS: { type: 'literal', value: 0.5 } },
          },
          setFlag('drumFinished'),
        ],
      },
    ]

    const vm: ScratchVMHandle = await createVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    const readFlag = (name: string): unknown => {
      const projectJson = getProjectJson(vm) as {
        targets: { isStage: boolean; variables: Record<string, [string, unknown]> }[]
      }
      const stage = projectJson.targets.find(({ isStage }) => isStage)
      return Object.values(stage?.variables ?? {}).find(([variableName]) => variableName === name)?.[1]
    }
    const step = () => {
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(readFlag('zeroNoteFinished')).toBe('true')
      expect(readFlag('noteFinished')).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 120))
      step()
      expect(readFlag('noteFinished')).toBe('true')
      expect(readFlag('drumFinished')).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 550))
      step()
      expect(readFlag('drumFinished')).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('waits for the Music rest duration before resuming the script', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.variables.push({ name: 'restFinished', value: false })
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'music_restForBeats', inputs: { BEATS: { type: 'literal', value: 0.1 } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'restFinished' },
            inputs: { VALUE: { type: 'literal', value: true } },
          },
        ],
      },
    ]

    const vm: ScratchVMHandle = await createVM()
    const runtime = vm as unknown as {
      start(): void
      greenFlag(): void
      runtime: { _step(): void }
    }
    const restFinished = (): unknown => {
      const projectJson = getProjectJson(vm) as {
        targets: { isStage: boolean; variables: Record<string, [string, unknown]> }[]
      }
      const stage = projectJson.targets.find(({ isStage }) => isStage)
      return Object.values(stage?.variables ?? {}).find(([name]) => name === 'restFinished')?.[1]
    }
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runtime.start()
      runtime.greenFlag()
      runtime.runtime._step()
      expect(restFinished()).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 120))
      for (let tick = 0; tick < 5; tick += 1) runtime.runtime._step()
      expect(restFinished()).toBe('true')
    } finally {
      vm.quit()
    }
  })

  it('runs Music tempo commands and reporter through the local VM adapter', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.extensions = ['music']
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'music_setInstrument', inputs: { INSTRUMENT: { type: 'literal', value: 1 } } },
          { opcode: 'music_setTempo', inputs: { TEMPO: { type: 'literal', value: 125 } } },
          { opcode: 'music_changeTempo', inputs: { TEMPO: { type: 'literal', value: 20 } } },
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: 'score' },
            inputs: {
              VALUE: {
                type: 'block',
                block: { opcode: 'music_getTempo' } satisfies CanonicalBlock,
              },
            },
          },
        ],
      },
    ]

    const vm: ScratchVMHandle = await createVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      runForTicks(vm, 12)
      const projectJson = getProjectJson(vm) as {
        targets: { isStage: boolean; tempo?: number; variables: Record<string, [string, unknown]> }[]
      }
      const stage = projectJson.targets.find(({ isStage }) => isStage)
      expect(stage?.tempo).toBe(145)
      expect(Object.values(stage?.variables ?? {}).find(([name]) => name === 'score')?.[1]).toBe(145)
    } finally {
      vm.quit()
    }
  })
})
