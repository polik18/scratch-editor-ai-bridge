import { describe, expect, it, vi } from 'vitest'
import {
  connectScratchPeripheral,
  disconnectScratchPeripheral,
  loadPreviewHardwareExtension,
  scanScratchPeripheral,
  subscribeScratchPeripheralEvent,
  type ScratchVMHandle,
} from '../../src/scratch/vm'

describe('Scratch hardware preview adapter', () => {
  it('forwards scan, connect, disconnect, and event cleanup through the allowlisted VM API', () => {
    const vm = {
      scanForPeripheral: vi.fn(),
      connectPeripheral: vi.fn(),
      disconnectPeripheral: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as ScratchVMHandle
    const listener = vi.fn()

    scanScratchPeripheral(vm, 'microbit')
    connectScratchPeripheral(vm, 'microbit', 'mock-device-1')
    disconnectScratchPeripheral(vm, 'microbit')
    const unsubscribe = subscribeScratchPeripheralEvent(vm, 'PERIPHERAL_CONNECTED', listener)
    unsubscribe()

    expect((vm as unknown as { scanForPeripheral: ReturnType<typeof vi.fn> }).scanForPeripheral).toHaveBeenCalledWith(
      'microbit',
    )
    expect((vm as unknown as { connectPeripheral: ReturnType<typeof vi.fn> }).connectPeripheral).toHaveBeenCalledWith(
      'microbit',
      'mock-device-1',
    )
    expect(
      (vm as unknown as { disconnectPeripheral: ReturnType<typeof vi.fn> }).disconnectPeripheral,
    ).toHaveBeenCalledWith('microbit')
    expect((vm as unknown as { on: ReturnType<typeof vi.fn> }).on).toHaveBeenCalledWith(
      'PERIPHERAL_CONNECTED',
      listener,
    )
    expect((vm as unknown as { removeListener: ReturnType<typeof vi.fn> }).removeListener).toHaveBeenCalledWith(
      'PERIPHERAL_CONNECTED',
      listener,
    )
  })

  it('loads only a locally bundled hardware adapter declared for the preview', async () => {
    const loadExtensionURL = vi.fn().mockResolvedValue(undefined)
    const vm = { extensionManager: { loadExtensionURL } } as unknown as ScratchVMHandle

    await loadPreviewHardwareExtension(vm, 'microbit')

    expect(loadExtensionURL).toHaveBeenCalledWith('microbit')
    await expect(loadPreviewHardwareExtension(vm, 'vendor')).rejects.toThrow('Unsupported hardware extension')
    expect(loadExtensionURL).toHaveBeenCalledTimes(1)
  })

  it('rejects extension IDs outside the hardware pairing allowlist', () => {
    const vm = {
      scanForPeripheral: vi.fn(),
      connectPeripheral: vi.fn(),
      disconnectPeripheral: vi.fn(),
    } as unknown as ScratchVMHandle

    expect(() => scanScratchPeripheral(vm, 'vendor')).toThrow('Unsupported hardware extension')
    expect(() => connectScratchPeripheral(vm, 'text2speech', 7)).toThrow('Unsupported hardware extension')
    expect(() => disconnectScratchPeripheral(vm, 'faceSensing')).toThrow('Unsupported hardware extension')
  })
})
