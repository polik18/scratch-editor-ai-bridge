import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildScratchProjectArchive } from '../../src/core/compiler/project-json'
import { decompileSb3WithBlockGraphs } from '../../src/core/decompiler/decompiler'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { createVM, getProjectJson, loadSb3 } from '../../src/scratch/vm'
import type { ScratchVMHandle } from '../../src/scratch/vm'
import { fixtureByName } from '../compatibility/fixture-matrix'

describe('unknown Scratch extensions', () => {
  it('keeps unknown extension blocks without attempting to load their code', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.extensions = ['vendor']
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          { opcode: 'vendor_custom', inputs: { VALUE: { type: 'literal', value: 7 } } },
        ],
      },
    ]

    const vm: ScratchVMHandle = await createVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      const json = getProjectJson(vm) as {
        extensions: string[]
        targets: { blocks: Record<string, { opcode: string; inputs: Record<string, unknown> }> }[]
      }
      expect(json.extensions).toContain('vendor')
      expect(Object.values(json.targets[0]?.blocks ?? {}).some(({ opcode }) => opcode === 'vendor_custom')).toBe(true)
      expect(
        Object.values(json.targets[0]?.blocks ?? {}).find(({ opcode }) => opcode === 'vendor_custom')?.inputs,
      ).toBeDefined()
    } finally {
      vm.quit()
    }
  })

  it('preserves disabled face sensing blocks without initializing camera or model code', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.extensions = ['faceSensing']
    project.stage.scripts = [
      {
        blocks: [{ opcode: 'event_whenflagclicked' }, { opcode: 'faceSensing_whenFaceDetected' }],
      },
    ]

    const vm: ScratchVMHandle = await createVM()
    try {
      await loadSb3(await buildScratchProjectArchive(project), vm)
      const json = getProjectJson(vm) as {
        extensions: string[]
        targets: { blocks: Record<string, { opcode: string }> }[]
      }
      expect(json.extensions).toContain('faceSensing')
      expect(
        Object.values(json.targets[0]?.blocks ?? {}).some(({ opcode }) => opcode === 'faceSensing_whenFaceDetected'),
      ).toBe(true)
    } finally {
      vm.quit()
    }
  })

  it('loads the official Video Sensing fixture without enabling camera and preserves its blocks', async () => {
    const vm: ScratchVMHandle = await createVM()
    const runtime = (vm as unknown as { runtime: { ioDevices: { video: { enableVideo(): Promise<void> } } } }).runtime
    const enableVideo = runtime.ioDevices.video.enableVideo.bind(runtime.ioDevices.video)
    let cameraEnableCalls = 0
    runtime.ioDevices.video.enableVideo = () => {
      cameraEnableCalls += 1
      return Promise.resolve()
    }

    try {
      const fixture = fixtureByName('load-extensions/confirm-load/videoSensing-simple-project.sb3')
      const bytes = await readFile(fixture.path)
      await loadSb3(bytes, vm)
      const json = getProjectJson(vm) as { extensions: string[] }
      expect(cameraEnableCalls).toBe(0)
      expect(json.extensions).toContain('videoSensing')
      const decompiled = await decompileSb3WithBlockGraphs(bytes, fixture.name)
      expect(
        decompiled.rawBlockGraphs
          .flatMap(({ blocks }) => Object.values(blocks))
          .some(({ opcode }) => opcode.startsWith('videoSensing_')),
      ).toBe(true)
    } finally {
      runtime.ioDevices.video.enableVideo = enableVideo
      vm.quit()
    }
  })

  it('loads official built-in extension fixtures through local VM adapters', async () => {
    const fixtures = [
      ['load-extensions/confirm-load/pen-simple-project.sb3', 'pen'],
      ['load-extensions/confirm-load/text2speech-simple-project.sb3', 'text2speech'],
      ['load-extensions/confirm-load/music-simple-project.sb3', 'music'],
      ['load-extensions/confirm-load/wedo2-simple-project.sb3', 'wedo2'],
      ['load-extensions/confirm-load/ev3-simple-project.sb3', 'ev3'],
      ['load-extensions/confirm-load/microbit-simple-project.sb3', 'microbit'],
    ] as const

    for (const [fixtureName, extensionId] of fixtures) {
      const vm = await loadSb3(await readFile(fixtureByName(fixtureName).path))
      try {
        const projectJson = getProjectJson(vm) as { extensions?: string[] }
        expect(projectJson.extensions, fixtureName).toContain(extensionId)
      } finally {
        vm.quit()
      }
    }
  })

  it('instantiates every extension module explicitly allowed by the local adapter', async () => {
    const vm: ScratchVMHandle = await createVM()
    const manager = (
      vm as unknown as {
        extensionManager: {
          loadExtensionURL(url: string): Promise<unknown>
          isExtensionLoaded(id: string): boolean
        }
      }
    ).extensionManager
    try {
      for (const extensionId of [
        'pen',
        'wedo2',
        'music',
        'microbit',
        'text2speech',
        'translate',
        'ev3',
        'makeymakey',
        'boost',
        'gdxfor',
      ]) {
        await manager.loadExtensionURL(extensionId)
      }
      await manager.loadExtensionURL('faceSensing')
      expect(manager.isExtensionLoaded('faceSensing')).toBe(false)
      await manager.loadExtensionURL('videoSensing')
      expect(manager.isExtensionLoaded('videoSensing')).toBe(false)
    } finally {
      vm.quit()
    }
  })
})
