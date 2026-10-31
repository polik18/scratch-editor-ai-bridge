import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import sample from '../../src/core/ir/examples/05-full-entities.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { attachScratchCloudSession, createVM, getVariable, loadSb3, startProjectRuntime } from '../../src/scratch/vm'

describe('guarded Scratch VM cloud session with fake transport', () => {
  it('forwards only declared cloud data and detaches safely on project switch', async () => {
    const project = structuredClone(sample) as CanonicalProject
    project.stage.variables.push({ name: '☁ score', value: 1, cloud: true })
    const vm = await createVM()
    const send = vi.fn()
    const report = vi.fn()
    try {
      const archive = await compileCanonicalProjectToSb3(project)
      await loadSb3(archive, vm)
      const attached = attachScratchCloudSession(vm, {
        grant: {
          projectId: 'project-1',
          username: 'owner',
          expiresAt: Date.now() + 10000,
          canRead: true,
          canWrite: true,
        },
        verifyGrant: () => true,
        validValue: (value) => /^\d+$/.test(String(value)),
        minWriteIntervalMs: 0,
        send,
        report,
      })
      expect(() =>
        attachScratchCloudSession(vm, {
          grant: { projectId: 'x', username: 'x', expiresAt: Date.now() + 10000, canRead: true, canWrite: true },
          verifyGrant: () => true,
          validValue: () => true,
          minWriteIntervalMs: 0,
          send,
          report,
        }),
      ).toThrow(/already attached/)
      const cloud = (
        vm as unknown as {
          runtime: { ioDevices: { cloud: { requestUpdateVariable(name: string, value: number): void } } }
        }
      ).runtime.ioDevices.cloud
      cloud.requestUpdateVariable('☁ score', 8)
      expect(send).not.toHaveBeenCalled()
      attached.session.setConnected(true)
      cloud.requestUpdateVariable('☁ score', 8)
      expect(send).toHaveBeenCalledTimes(1)
      expect(attached.session.receive({ projectId: 'project-1', name: '☁ score', value: '12' })).toBe(true)
      expect(getVariable(vm, 'Stage', '☁ score')?.value).toBe('12')
      expect(attached.session.receive({ projectId: 'wrong', name: '☁ score', value: '50' })).toBe(false)
      expect(getVariable(vm, 'Stage', '☁ score')?.value).toBe('12')
      await loadSb3(archive, vm)
      attached.session.updateVariable('☁ score', 15)
      expect(send).toHaveBeenCalledTimes(1)
      expect(attached.session.receive({ projectId: 'project-1', name: '☁ score', value: '13' })).toBe(false)
      attached.disconnect()
      expect(attached.session.receive({ projectId: 'project-1', name: '☁ score', value: '14' })).toBe(false)
    } finally {
      vm.quit()
    }
  })
  it('receives a real Scratch script cloud update through the fake transport', async () => {
    const fixture = fileURLToPath(new URL('../../../scratch-vm/test/fixtures/draggable.sb3', import.meta.url))
    const zip = await JSZip.loadAsync(await readFile(fixture))
    const project = JSON.parse(await zip.file('project.json')!.async('string')) as {
      targets: { isStage: boolean; variables: Record<string, unknown>; blocks: Record<string, unknown> }[]
    }
    const stage = project.targets.find((target) => target.isStage)!
    stage.variables.cloudTest = ['☁ cloudTest', 0, true]
    stage.blocks.cloudHat = {
      opcode: 'event_whenflagclicked',
      next: 'cloudSet',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 20,
      y: 20,
    }
    stage.blocks.cloudSet = {
      opcode: 'data_setvariableto',
      next: null,
      parent: 'cloudHat',
      inputs: { VALUE: [1, [4, '17']] },
      fields: { VARIABLE: ['☁ cloudTest', 'cloudTest'] },
      shadow: false,
      topLevel: false,
    }
    zip.file('project.json', JSON.stringify(project))
    const vm = await createVM()
    const send = vi.fn()
    try {
      await loadSb3(await zip.generateAsync({ type: 'uint8array' }), vm)
      const attached = attachScratchCloudSession(vm, {
        grant: { projectId: 'p', username: 'u', expiresAt: Date.now() + 10000, canRead: true, canWrite: true },
        verifyGrant: () => true,
        validValue: () => true,
        minWriteIntervalMs: 0,
        send,
        report: () => undefined,
      })
      attached.session.setConnected(true)
      startProjectRuntime(vm)
      for (let i = 0; i < 100 && !send.mock.calls.length; i += 1)
        await new Promise((resolve) => setTimeout(resolve, 20))
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p', name: '☁ cloudTest', value: '17' }),
        expect.any(AbortSignal),
      )
      attached.disconnect()
    } finally {
      vm.quit()
    }
  }, 10000)
})
