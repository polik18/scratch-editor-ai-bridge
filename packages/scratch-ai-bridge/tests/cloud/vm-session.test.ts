import { describe, expect, it, vi } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import sample from '../../src/core/ir/examples/05-full-entities.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { attachScratchCloudSession, createVM, getVariable, loadSb3 } from '../../src/scratch/vm'

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
})
