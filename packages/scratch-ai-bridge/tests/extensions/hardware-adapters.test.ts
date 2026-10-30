import { describe, expect, it, vi } from 'vitest'
import { createVM, loadPreviewHardwareExtension, type ScratchVMHandle } from '../../src/scratch/vm'

interface MicroBitPeripheral {
  readonly _device?: { readonly opened: boolean; deviceWriteInterval: unknown }
  readonly buttonA: number
  readonly tiltX: number
  readonly tiltY: number
  _onMessage(message: string): void
  reset(): void
  displayMatrix(matrix: Uint8Array): void
  displayText(text: string): void
}

interface EV3Peripheral {
  _onMessage(params: { message: string }): void
  _pollValues(): void
  beep(frequency: number, milliseconds: number): void
  isConnected(): boolean
  motor(index: number): { power: number } | undefined
}

type MicroBitPrimitive = (args: Record<string, string>, util: object) => unknown

interface MicroBitRuntime {
  readonly peripheralExtensions: Partial<Record<string, MicroBitPeripheral>>
  readonly _primitives: Partial<Record<string, MicroBitPrimitive>>
}

interface VMWithPeripheralRegistry extends ScratchVMHandle {
  readonly runtime: MicroBitRuntime
  configureScratchLinkSocketFactory(factory: (type: string) => ScratchLinkSocket): void
  scanForPeripheral(extensionId: string): void
  connectPeripheral(extensionId: string, peripheralId: string): void
  disconnectPeripheral(extensionId: string): void
}

interface ScratchLinkSocket {
  open(): void
  close(): void
  isOpen(): boolean
  setOnOpen(handler: () => void): void
  setOnClose(handler: () => void): void
  setOnError(handler: (error: unknown) => void): void
  setHandleMessage(handler: (message: Record<string, unknown>) => void): void
  sendMessage(message: Record<string, unknown>): void
  setWriteResponder(responder: (params: Record<string, unknown>) => void): void
}

class MockScratchLinkSocket implements ScratchLinkSocket {
  readonly requests: Record<string, unknown>[] = []
  private opened = false
  private onOpen: (() => void) | undefined
  private onClose: (() => void) | undefined
  private onMessage: ((message: Record<string, unknown>) => void) | undefined
  private writeResponder: ((params: Record<string, unknown>) => void) | undefined

  open(): void {
    this.opened = true
    this.onOpen?.()
  }

  close(): void {
    this.opened = false
    this.onClose?.()
  }

  isOpen(): boolean {
    return this.opened
  }

  setOnOpen(handler: () => void): void {
    this.onOpen = handler
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler
  }

  setOnError(): void {}

  setHandleMessage(handler: (message: Record<string, unknown>) => void): void {
    this.onMessage = handler
  }

  setWriteResponder(responder: (params: Record<string, unknown>) => void): void {
    this.writeResponder = responder
  }

  sendMessage(message: Record<string, unknown>): void {
    this.requests.push(message)
    if (typeof message.id !== 'number') return
    queueMicrotask(() => {
      this.onMessage?.({ jsonrpc: '2.0', id: message.id, result: null })
      if (message.method !== 'write' || !this.writeResponder) return
      this.writeResponder(message.params as Record<string, unknown>)
    })
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.onMessage?.({ jsonrpc: '2.0', method, params })
  }
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for the Scratch Link request')
}

describe('built-in Scratch hardware extension adapter behavior', () => {
  it('starts WeDo 2.0 BLE notifications after Scratch Link pairing', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory((type) => {
      expect(type).toBe('BLE')
      return socket
    })

    try {
      await loadPreviewHardwareExtension(vm, 'wedo2')
      vm.scanForPeripheral('wedo2')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      expect(socket.requests.find(({ method }) => method === 'discover')?.params).toEqual({
        filters: [{ services: ['00001523-1212-efde-1523-785feabcd123'] }],
        optionalServices: ['00004f0e-1212-efde-1523-785feabcd123'],
      })

      vm.connectPeripheral('wedo2', 'mock-wedo-hub')
      await waitFor(() => socket.requests.some(({ method }) => method === 'startNotifications'))
      expect(socket.requests.find(({ method }) => method === 'connect')?.params).toEqual({
        peripheralId: 'mock-wedo-hub',
      })
      expect(socket.requests.find(({ method }) => method === 'startNotifications')?.params).toEqual({
        serviceId: '00001523-1212-efde-1523-785feabcd123',
        characteristicId: '00001527-1212-efde-1523-785feabcd123',
      })
      expect(socket.requests.filter(({ method }) => method === 'write').map(({ params }) => params)).toEqual([
        {
          serviceId: '00004f0e-1212-efde-1523-785feabcd123',
          characteristicId: '00001563-1212-efde-1523-785feabcd123',
          message: Buffer.from([1, 2, 6, 0x17, 1, 0, 0, 0, 0, 0, 0]).toString('base64'),
          encoding: 'base64',
        },
        {
          serviceId: '00004f0e-1212-efde-1523-785feabcd123',
          characteristicId: '00001565-1212-efde-1523-785feabcd123',
          message: Buffer.from([6, 4, 3, 0, 0, 255]).toString('base64'),
          encoding: 'base64',
        },
      ])

      vm.disconnectPeripheral('wedo2')
      expect(socket.isOpen()).toBe(false)
    } finally {
      vm.runtime.peripheralExtensions.wedo2?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('executes WeDo motor power/direction blocks into exact Scratch Link firmware bytes', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory(() => socket)

    const internal = vm as unknown as {
      runtime: {
        _primitives: Partial<Record<string, (args: Record<string, string | number>, util: object) => unknown>>
        peripheralExtensions: {
          wedo2?: {
            _onMessage(message: string): void
            motor(index: number): { power: number; direction: number; isOn: boolean } | undefined
            reset(): void
          }
        }
      }
    }
    const invoke = async (opcode: string, args: Record<string, string | number>): Promise<void> => {
      const primitive = internal.runtime._primitives[opcode]
      if (!primitive) throw new Error('WeDo VM did not register ' + opcode)
      await primitive(args, {})
    }

    try {
      await loadPreviewHardwareExtension(vm, 'wedo2')
      vm.scanForPeripheral('wedo2')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      vm.connectPeripheral('wedo2', 'mock-wedo-hub')
      await waitFor(() => socket.requests.some(({ method }) => method === 'startNotifications'))

      const peripheral = internal.runtime.peripheralExtensions.wedo2
      if (!peripheral) throw new Error('Scratch VM did not register the WeDo peripheral')
      peripheral._onMessage(Buffer.from([1, 1, 0, 1]).toString('base64'))

      await invoke('wedo2_setMotorDirection', { MOTOR_ID: 'motor A', MOTOR_DIRECTION: 'that way' })
      await invoke('wedo2_startMotorPower', { MOTOR_ID: 'motor A', POWER: 150 })
      expect(peripheral.motor(0)?.power).toBe(100)
      expect(peripheral.motor(0)?.direction).toBe(-1)
      expect(peripheral.motor(0)?.isOn).toBe(true)

      const outputWrites = () =>
        socket.requests
          .filter(
            ({ method, params }) =>
              method === 'write' &&
              (params as { characteristicId?: string }).characteristicId === '00001565-1212-efde-1523-785feabcd123',
          )
          .map(({ params }) => Buffer.from((params as { message: string }).message, 'base64'))
      const latestOutputWrite = (): Buffer => {
        const latest = outputWrites().at(-1)
        if (!latest) throw new Error('WeDo motor command did not write to Scratch Link')
        return latest
      }
      expect([...latestOutputWrite()]).toEqual([1, 1, 1, 156])

      await invoke('wedo2_motorOff', { MOTOR_ID: 'motor A' })
      await waitFor(() => outputWrites().length >= 2)
      expect([...latestOutputWrite()]).toEqual([1, 1, 1, 0])
      vm.disconnectPeripheral('wedo2')
      expect(socket.isOpen()).toBe(false)
    } finally {
      internal.runtime.peripheralExtensions.wedo2?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('routes WeDo distance and tilt notifications into registered VM reporters and hats', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory(() => socket)

    const internal = vm as unknown as {
      runtime: {
        _primitives: Partial<Record<string, (args: Record<string, string | number>, util: object) => unknown>>
        peripheralExtensions: {
          wedo2?: {
            readonly distance: number
            readonly tiltX: number
            readonly tiltY: number
            reset(): void
          }
        }
      }
    }

    try {
      await loadPreviewHardwareExtension(vm, 'wedo2')
      vm.scanForPeripheral('wedo2')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      vm.connectPeripheral('wedo2', 'mock-wedo-sensors')
      await waitFor(() => socket.requests.some(({ method }) => method === 'startNotifications'))

      const invoke = (opcode: string, args: Record<string, string | number> = {}): unknown => {
        const primitive = internal.runtime._primitives[opcode]
        if (!primitive) throw new Error('WeDo VM did not register ' + opcode)
        return primitive(args, {})
      }
      const notifyHub = (bytes: number[]) =>
        socket.notify('characteristicDidChange', { message: Buffer.from(bytes).toString('base64') })

      notifyHub([1, 1, 0, 35])
      notifyHub([2, 1, 0, 34])
      await waitFor(
        () =>
          socket.requests.filter(
            ({ method, params }) =>
              method === 'startNotifications' &&
              (params as { characteristicId?: string }).characteristicId === '00001560-1212-efde-1523-785feabcd123',
          ).length === 2,
      )

      const peripheral = internal.runtime.peripheralExtensions.wedo2
      if (!peripheral) throw new Error('Scratch VM did not register the WeDo peripheral')
      notifyHub([0, 1, 74])
      notifyHub([0, 2, 30, 20])

      expect(peripheral.distance).toBe(74)
      expect(invoke('wedo2_getDistance')).toBe(74)
      expect(invoke('wedo2_whenDistance', { OP: '<', REFERENCE: 80 })).toBe(true)
      expect(invoke('wedo2_whenDistance', { OP: '>', REFERENCE: 80 })).toBe(false)
      expect(peripheral.tiltX).toBe(30)
      expect(peripheral.tiltY).toBe(20)
      expect(invoke('wedo2_getTiltAngle', { TILT_DIRECTION: 'up' })).toBe(-20)
      expect(invoke('wedo2_getTiltAngle', { TILT_DIRECTION: 'right' })).toBe(30)
      expect(invoke('wedo2_whenTilted', { TILT_DIRECTION_ANY: 'right' })).toBe(true)
      expect(invoke('wedo2_isTilted', { TILT_DIRECTION_ANY: 'left' })).toBe(false)

      vm.disconnectPeripheral('wedo2')
      expect(socket.isOpen()).toBe(false)
    } finally {
      internal.runtime.peripheralExtensions.wedo2?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('pairs over Scratch Link BT and sends an EV3 tone command', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory((type) => {
      expect(type).toBe('BT')
      return socket
    })

    try {
      await loadPreviewHardwareExtension(vm, 'ev3')
      vm.scanForPeripheral('ev3')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      expect(socket.requests.find(({ method }) => method === 'discover')?.params).toEqual({
        majorDeviceClass: 8,
        minorDeviceClass: 1,
      })

      vm.connectPeripheral('ev3', 'mock-ev3-brick')
      await waitFor(() => socket.requests.some(({ method }) => method === 'connect'))
      expect(socket.requests.find(({ method }) => method === 'connect')?.params).toEqual({
        peripheralId: 'mock-ev3-brick',
        pin: '1234',
      })
      const peripheral = vm.runtime.peripheralExtensions.ev3 as EV3Peripheral | undefined
      if (!peripheral) throw new Error('Scratch VM did not register the EV3 peripheral')
      await waitFor(() => peripheral.isConnected())
      peripheral.beep(440, 250)
      await waitFor(() => socket.requests.some(({ method }) => method === 'send'))
      const sendRequest = socket.requests.find(({ method }) => method === 'send')
      const message = Buffer.from(String((sendRequest?.params as { message?: string }).message), 'base64')
      expect(message[4]).toBe(0x80)
      expect([...message.subarray(7)]).toEqual([0x94, 1, 0x81, 2, 0x82, 0xb8, 1, 0x82, 250, 0])

      peripheral._pollValues()
      const deviceReply = Buffer.alloc(64)
      deviceReply[4] = 0x02
      deviceReply.fill(126, 5, 9)
      deviceReply[5] = 16
      deviceReply[6] = 29
      deviceReply[7] = 30
      deviceReply[21] = 7
      deviceReply.fill(126, 22, 25)
      peripheral._onMessage({ message: deviceReply.toString('base64') })

      const runtime = vm.runtime as unknown as {
        _primitives: Record<string, (args: Record<string, string>, util: object) => unknown>
        emit(event: string): void
      }
      const primitives = runtime._primitives
      const sensorReply = Buffer.alloc(64)
      sensorReply[4] = 0x02
      sensorReply.writeFloatLE(1, 5)
      sensorReply.writeFloatLE(67, 9)
      sensorReply.writeFloatLE(45.5, 13)
      sensorReply.writeFloatLE(0, 17)
      sensorReply.writeInt32LE(450, 21)
      peripheral._onMessage({ message: sensorReply.toString('base64') })
      expect(primitives.ev3_buttonPressed({ PORT: '0' }, {})).toBe(true)
      expect(primitives.ev3_getBrightness({}, {})).toBe(67)
      expect(primitives.ev3_getDistance({}, {})).toBe(45.5)
      expect(primitives.ev3_whenDistanceLessThan({ DISTANCE: '46' }, {})).toBe(true)
      expect(primitives.ev3_whenBrightnessLessThan({ DISTANCE: '67' }, {})).toBe(false)
      expect(primitives.ev3_whenBrightnessLessThan({ DISTANCE: '150' }, {})).toBe(true)
      expect(primitives.ev3_getMotorPosition({ PORT: '0' }, {})).toBe(89)

      primitives.ev3_motorSetPower({ PORT: '0', POWER: '150' }, {})
      expect(peripheral.motor(0)?.power).toBe(100)
      const turn = primitives.ev3_motorTurnCounterClockwise({ PORT: '0', TIME: '0.1' }, {}) as Promise<void>
      const motorMessageIndex = socket.requests.filter(({ method }) => method === 'send').length - 1
      const motorRequest = socket.requests.filter(({ method }) => method === 'send')[motorMessageIndex]
      const motorMessage = Buffer.from(String((motorRequest.params as { message: string }).message), 'base64')
      expect([...motorMessage]).toEqual([
        18, 0, 0, 0, 0x80, 0, 0, 0xaf, 0, 1, 0x81, 156, 0x81, 50, 0x82, 0, 0, 0x81, 50, 1,
      ])
      await turn

      const stopAllStart = socket.requests.filter(({ method }) => method === 'send').length
      runtime.emit('PROJECT_STOP_ALL')
      const stopMessages = socket.requests
        .filter(({ method }) => method === 'send')
        .slice(stopAllStart)
        .map(({ params }) => Buffer.from(String((params as { message?: string }).message), 'base64'))
      expect(stopMessages.map((bytes) => [...bytes])).toEqual([
        [9, 0, 0, 0, 0x80, 0, 0, 0xa3, 0, 1, 0],
        [7, 0, 0, 0, 0x80, 0, 0, 0x94, 0],
      ])
      await new Promise((resolve) => setTimeout(resolve, 1_150))
      vm.disconnectPeripheral('ev3')
      expect(socket.isOpen()).toBe(false)
    } finally {
      vm.runtime.peripheralExtensions.ev3?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('completes GDX Go Direct initialization over the Scratch Link BLE adapter', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory((type) => {
      expect(type).toBe('BLE')
      return socket
    })
    socket.setWriteResponder(({ message }) => {
      const command = Buffer.from(String(message), 'base64')
      const response = new Uint8Array(160)
      response[0] = 0x10
      response[1] = response.byteLength
      response[4] = command[4]
      response[5] = command[2]
      if (command[4] === 0x51) response[6] = 0x1e
      if (command[4] === 0x50) {
        response[6] = command[5]
        response[8] = 0x34
        response[9] = 0x12
      }
      socket.notify('characteristicDidChange', {
        message: Buffer.from(response).toString('base64'),
      })
    })

    try {
      await loadPreviewHardwareExtension(vm, 'gdxfor')
      vm.scanForPeripheral('gdxfor')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      expect(socket.requests.find(({ method }) => method === 'discover')?.params).toEqual({
        filters: [{ namePrefix: 'GDX-FOR' }],
        optionalServices: ['d91714ef-28b9-4f91-ba16-f0d9a604f112'],
      })

      const peripheral = vm.runtime.peripheralExtensions.gdxfor
      if (!peripheral) throw new Error('Scratch VM did not register the GDX FOR peripheral')
      const gdx = peripheral as unknown as {
        _device?: { opened: boolean; sensors: unknown[]; collecting: boolean; deviceWriteInterval: unknown }
        reset(): void
      }
      vm.connectPeripheral('gdxfor', 'mock-gdx-force')
      await waitFor(() => {
        const device = gdx._device
        return Boolean(device && device.opened && device.sensors.length === 4)
      })
      const device = gdx._device
      if (!device) throw new Error('Go Direct device was not created')
      await waitFor(() => device.collecting)

      expect(device.opened).toBe(true)
      expect(socket.requests.find(({ method }) => method === 'startNotifications')?.params).toEqual({
        serviceId: 'd91714ef-28b9-4f91-ba16-f0d9a604f112',
        characteristicId: 'b41e6675-a329-40e0-aa01-44d2f444babe',
      })
      const goDirectCommands = socket.requests
        .filter(
          ({ method, params }) =>
            method === 'write' &&
            (params as { characteristicId?: string }).characteristicId === 'f4bf14a6-c7d5-4b6d-8aa8-df1a7c83adcb',
        )
        .map(({ params }) => Buffer.from(String((params as { message: string }).message), 'base64')[4])
      expect(goDirectCommands).toEqual([0x1a, 0x10, 0x55, 0x56, 0x51, 0x50, 0x50, 0x50, 0x50, 0x1b, 0x18])

      const primitives = (
        vm.runtime as unknown as {
          _primitives: Record<string, (args: Record<string, string>, util: object) => unknown>
        }
      )._primitives
      const invoke = (opcode: string, args: Record<string, string> = {}): unknown => primitives[opcode](args, {})

      const measurement = Buffer.alloc(25)
      measurement[0] = 0x20
      measurement[1] = measurement.byteLength
      measurement[4] = 0x06
      measurement.writeUInt16LE(0x1e, 5)
      measurement[7] = 1
      measurement.writeFloatLE(18.5, 9)
      measurement.writeFloatLE(12.6, 13)
      measurement.writeFloatLE(0, 17)
      measurement.writeFloatLE(9.8, 21)
      socket.notify('characteristicDidChange', { message: measurement.toString('base64') })

      expect(invoke('gdxfor_getForce')).toBe(37)
      expect(invoke('gdxfor_whenForcePushedOrPulled', { PUSH_PULL: 'pulled' })).toBe(true)
      expect(invoke('gdxfor_getAcceleration', { DIRECTION: 'x' })).toBe(13)
      expect(invoke('gdxfor_getTilt', { TILT: 'front' })).toBe(52)
      expect(invoke('gdxfor_isTilted', { TILT: 'front' })).toBe(true)

      const aperiodicMeasurement = Buffer.alloc(12)
      aperiodicMeasurement[0] = 0x20
      aperiodicMeasurement[1] = aperiodicMeasurement.byteLength
      aperiodicMeasurement[4] = 0x0a
      aperiodicMeasurement[6] = 1
      aperiodicMeasurement[7] = 1
      aperiodicMeasurement.writeFloatLE(60, 8)
      socket.notify('characteristicDidChange', { message: aperiodicMeasurement.toString('base64') })
      expect(invoke('gdxfor_getForce')).toBe(100)

      const singleChannelRealMeasurement = Buffer.alloc(12)
      singleChannelRealMeasurement[0] = 0x20
      singleChannelRealMeasurement[1] = singleChannelRealMeasurement.byteLength
      singleChannelRealMeasurement[4] = 0x08
      singleChannelRealMeasurement[6] = 1
      singleChannelRealMeasurement[7] = 1
      singleChannelRealMeasurement.writeFloatLE(2.5, 8)
      socket.notify('characteristicDidChange', { message: singleChannelRealMeasurement.toString('base64') })
      expect(invoke('gdxfor_getForce')).toBe(5)
      expect(invoke('gdxfor_whenForcePushedOrPulled', { PUSH_PULL: 'pulled' })).toBe(false)

      const singleChannelIntegerMeasurement = Buffer.alloc(12)
      singleChannelIntegerMeasurement[0] = 0x20
      singleChannelIntegerMeasurement[1] = singleChannelIntegerMeasurement.byteLength
      singleChannelIntegerMeasurement[4] = 0x09
      singleChannelIntegerMeasurement[6] = 1
      singleChannelIntegerMeasurement[7] = 1
      singleChannelIntegerMeasurement.writeInt32LE(3, 8)
      socket.notify('characteristicDidChange', { message: singleChannelIntegerMeasurement.toString('base64') })
      expect(invoke('gdxfor_getForce')).toBe(6)

      const singleChannelMeasurement = Buffer.alloc(12)
      singleChannelMeasurement[0] = 0x20
      singleChannelMeasurement[1] = singleChannelMeasurement.byteLength
      singleChannelMeasurement[4] = 0x0b
      singleChannelMeasurement[6] = 1
      singleChannelMeasurement[7] = 1
      singleChannelMeasurement.writeInt32LE(-3, 8)
      socket.notify('characteristicDidChange', { message: singleChannelMeasurement.toString('base64') })
      expect(invoke('gdxfor_getForce')).toBe(-6)
      expect(invoke('gdxfor_whenForcePushedOrPulled', { PUSH_PULL: 'pushed' })).toBe(true)

      const wideMeasurement = Buffer.alloc(27)
      wideMeasurement[0] = 0x20
      wideMeasurement[1] = wideMeasurement.byteLength
      wideMeasurement[4] = 0x07
      wideMeasurement.writeUInt32LE(0x1e, 5)
      wideMeasurement[9] = 1
      wideMeasurement.writeFloatLE(3.25, 11)
      wideMeasurement.writeFloatLE(12.6, 15)
      wideMeasurement.writeFloatLE(0, 19)
      wideMeasurement.writeFloatLE(9.8, 23)
      socket.notify('characteristicDidChange', { message: wideMeasurement.toString('base64') })
      expect(invoke('gdxfor_getForce')).toBe(7)
      expect(invoke('gdxfor_getAcceleration', { DIRECTION: 'x' })).toBe(13)

      const freeFallMeasurement = Buffer.from(measurement)
      freeFallMeasurement.writeFloatLE(0, 13)
      freeFallMeasurement.writeFloatLE(0, 21)
      socket.notify('characteristicDidChange', { message: freeFallMeasurement.toString('base64') })
      expect(invoke('gdxfor_isFreeFalling')).toBe(true)

      vm.disconnectPeripheral('gdxfor')
      expect(device.deviceWriteInterval).toBeNull()
      expect(socket.isOpen()).toBe(false)
    } finally {
      vm.runtime.peripheralExtensions.gdxfor?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('discovers Boost hubs with the manufacturer-data filter and subscribes after pairing', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory((type) => {
      expect(type).toBe('BLE')
      return socket
    })

    try {
      await loadPreviewHardwareExtension(vm, 'boost')
      vm.scanForPeripheral('boost')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      expect(socket.requests.find(({ method }) => method === 'discover')?.params).toEqual({
        filters: [
          {
            services: ['00001623-1212-efde-1623-785feabcd123'],
            manufacturerData: { 919: { dataPrefix: [0, 64], mask: [0, 255] } },
          },
        ],
        optionalServices: [],
      })

      vm.connectPeripheral('boost', 'mock-boost-hub')
      await waitFor(() => socket.requests.some(({ method }) => method === 'startNotifications'))
      expect(socket.requests.find(({ method }) => method === 'startNotifications')?.params).toEqual({
        serviceId: '00001623-1212-efde-1623-785feabcd123',
        characteristicId: '00001624-1212-efde-1623-785feabcd123',
      })
      vm.disconnectPeripheral('boost')
      expect(socket.isOpen()).toBe(false)
    } finally {
      vm.runtime.peripheralExtensions.boost?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('executes Boost motor power/direction blocks into exact LEGO Wireless Protocol bytes', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory(() => socket)

    const internal = vm as unknown as {
      runtime: {
        _primitives: Partial<Record<string, (args: Record<string, string | number>, util: object) => unknown>>
        peripheralExtensions: {
          boost?: {
            _onMessage(message: string): void
            motor(index: number): { power: number; direction: number; status: number } | undefined
            readonly color: string
            readonly previousColor: string
            readonly tiltX: number
            readonly tiltY: number
            reset(): void
          }
        }
      }
    }
    const invoke = async (opcode: string, args: Record<string, string | number>): Promise<void> => {
      const primitive = internal.runtime._primitives[opcode]
      if (!primitive) throw new Error('Boost VM did not register ' + opcode)
      await primitive(args, {})
    }

    try {
      await loadPreviewHardwareExtension(vm, 'boost')
      vm.scanForPeripheral('boost')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      vm.connectPeripheral('boost', 'mock-boost-hub')
      await waitFor(() => socket.requests.some(({ method }) => method === 'startNotifications'))

      const peripheral = internal.runtime.peripheralExtensions.boost
      if (!peripheral) throw new Error('Scratch VM did not register the Boost peripheral')

      const notifyHub = (bytes: number[]) =>
        socket.notify('characteristicDidChange', { message: Buffer.from(bytes).toString('base64') })
      notifyHub([6, 0, 4, 2, 1, 0x25])
      notifyHub([6, 0, 4, 3, 1, 0x28])
      const readPrimitive = (opcode: string, args: Record<string, string>): unknown => {
        const primitive = internal.runtime._primitives[opcode]
        if (!primitive) throw new Error('Boost VM did not register ' + opcode)
        return primitive(args, {})
      }
      notifyHub([6, 0, 0x45, 3, 20, 100])
      expect(peripheral.tiltX).toBe(20)
      expect(peripheral.tiltY).toBe(100)
      expect(readPrimitive('boost_getTiltAngle', { TILT_DIRECTION: 'up' })).toBe(156)
      expect(readPrimitive('boost_whenTilted', { TILT_DIRECTION_ANY: 'up' })).toBe(true)
      expect(readPrimitive('boost_whenTilted', { TILT_DIRECTION_ANY: 'any' })).toBe(true)

      for (let sample = 0; sample < 6; sample += 1) notifyHub([6, 0, 0x45, 2, 5])
      expect(peripheral.color).toBe('green')
      expect(readPrimitive('boost_seeingColor', { COLOR: 'green' })).toBe(true)
      expect(readPrimitive('boost_whenColor', { COLOR: 'any' })).toBe(true)
      for (let sample = 0; sample < 6; sample += 1) notifyHub([6, 0, 0x45, 2, 5])
      expect(readPrimitive('boost_whenColor', { COLOR: 'any' })).toBe(false)
      // The color reporter clears while mixed samples pass through the rolling window.
      for (let sample = 0; sample < 5; sample += 1) notifyHub([6, 0, 0x45, 2, 7])
      expect(peripheral.previousColor).toBe('none')
      expect(peripheral.color).toBe('yellow')
      expect(readPrimitive('boost_whenColor', { COLOR: 'any' })).toBe(true)
      expect(readPrimitive('boost_seeingColor', { COLOR: 'yellow' })).toBe(true)

      peripheral._onMessage(Buffer.from([6, 0, 4, 0, 1, 0x27]).toString('base64'))
      await waitFor(() => socket.requests.some(({ method }) => method === 'write'))

      await invoke('boost_setMotorPower', { MOTOR_ID: 'A', POWER: 150 })
      await invoke('boost_setMotorDirection', { MOTOR_ID: 'A', MOTOR_DIRECTION: 'that way' })
      await invoke('boost_motorOn', { MOTOR_ID: 'A' })
      const outputWrites = () =>
        socket.requests
          .filter(
            ({ method, params }) =>
              method === 'write' &&
              (params as { characteristicId?: string }).characteristicId === '00001624-1212-efde-1623-785feabcd123',
          )
          .map(({ params }) => Buffer.from((params as { message: string }).message, 'base64'))
      const latestOutputWrite = (): Buffer => {
        const latest = outputWrites().at(-1)
        if (!latest) throw new Error('Boost motor command did not write to Scratch Link')
        return latest
      }
      await waitFor(() => outputWrites().length >= 2)
      const motor = peripheral.motor(0)
      expect(motor?.power).toBe(100)
      expect(motor?.direction).toBe(-1)
      expect([...latestOutputWrite()]).toEqual([9, 0, 129, 0, 16, 7, 156, 100, 0])

      await invoke('boost_motorOff', { MOTOR_ID: 'A' })
      await waitFor(() => outputWrites().length >= 3)
      expect([...latestOutputWrite()]).toEqual([7, 0, 129, 0, 16, 1, 0])

      const rotate = invoke('boost_motorOnForRotation', { MOTOR_ID: 'A', ROTATION: 1.5 })
      await waitFor(() => outputWrites().length >= 4)
      expect([...latestOutputWrite()]).toEqual([14, 0, 129, 0, 17, 11, 28, 2, 0, 0, 156, 100, 127, 0])
      peripheral._onMessage(Buffer.from([5, 0, 0x82, 0, 0x02]).toString('base64'))
      await rotate
      vm.disconnectPeripheral('boost')
      expect(socket.isOpen()).toBe(false)
    } finally {
      internal.runtime.peripheralExtensions.boost?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('scans, connects, reads sensor notifications, and writes LED commands over Scratch Link BLE', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    const socket = new MockScratchLinkSocket()
    vi.stubGlobal('window', globalThis)
    vm.configureScratchLinkSocketFactory((type) => {
      expect(type).toBe('BLE')
      return socket
    })

    try {
      await loadPreviewHardwareExtension(vm, 'microbit')
      vm.scanForPeripheral('microbit')
      await waitFor(() => socket.requests.some(({ method }) => method === 'discover'))
      const discover = socket.requests.find(({ method }) => method === 'discover')
      expect(discover?.params).toEqual({ filters: [{ services: [0xf005] }] })

      vm.connectPeripheral('microbit', 'mock-microbit')
      await waitFor(() => socket.requests.some(({ method }) => method === 'read'))
      expect(socket.requests.find(({ method }) => method === 'connect')?.params).toEqual({
        peripheralId: 'mock-microbit',
      })
      expect(socket.requests.find(({ method }) => method === 'read')?.params).toEqual({
        serviceId: 0xf005,
        characteristicId: '5261da01-fa7e-42ab-850b-7c80220097cc',
        startNotifications: true,
      })

      const peripheral = vm.runtime.peripheralExtensions.microbit
      if (!peripheral) throw new Error('Scratch VM did not register the micro:bit peripheral')
      socket.notify('characteristicDidChange', {
        message: Buffer.from([0, 10, 0, 20, 1, 0, 0, 1, 0, 0]).toString('base64'),
      })
      socket.notify('characteristicDidChange', { message: Buffer.from([0, 1, 0]).toString('base64') })
      expect(peripheral.buttonA).toBe(1)
      expect(peripheral.tiltX).toBe(10)
      expect(peripheral.tiltY).toBe(20)

      const displaySymbol = vm.runtime._primitives.microbit_displaySymbol
      if (!displaySymbol) throw new Error('Scratch VM did not register micro:bit displaySymbol')
      const displayPromise = displaySymbol({ MATRIX: '11111 11111 11111 11111 11111' }, {}) as Promise<void>
      await waitFor(() => socket.requests.some(({ method }) => method === 'write'))
      await displayPromise
      expect(socket.requests.find(({ method }) => method === 'write')?.params).toEqual({
        serviceId: 0xf005,
        characteristicId: '5261da02-fa7e-42ab-850b-7c80220097cc',
        message: Buffer.from([0x82, 31, 31, 31, 31, 31]).toString('base64'),
        encoding: 'base64',
        withResponse: true,
      })

      vi.useFakeTimers()
      try {
        const displayText = vm.runtime._primitives.microbit_displayText?.(
          { TEXT: '0123456789abcdefghijABCDEFGHIJ' },
          {},
        ) as Promise<void>
        await Promise.resolve()
        expect(socket.requests.filter(({ method }) => method === 'write').at(-1)?.params).toEqual({
          serviceId: 0xf005,
          characteristicId: '5261da02-fa7e-42ab-850b-7c80220097cc',
          message: Buffer.from([0x81, ...Buffer.from('0123456789abcdefghi')]).toString('base64'),
          encoding: 'base64',
          withResponse: true,
        })
        await vi.advanceTimersByTimeAsync(14_400)
        await displayText

        const displayClear = vm.runtime._primitives.microbit_displayClear?.({}, {}) as Promise<void>
        await Promise.resolve()
        expect(socket.requests.filter(({ method }) => method === 'write').at(-1)?.params).toEqual({
          serviceId: 0xf005,
          characteristicId: '5261da02-fa7e-42ab-850b-7c80220097cc',
          message: Buffer.from([0x82, 0, 0, 0, 0, 0]).toString('base64'),
          encoding: 'base64',
          withResponse: true,
        })
        await vi.advanceTimersByTimeAsync(100)
        await displayClear
      } finally {
        vi.useRealTimers()
      }

      vm.disconnectPeripheral('microbit')
      expect(socket.isOpen()).toBe(false)
    } finally {
      vm.runtime.peripheralExtensions.microbit?.reset()
      vm.quit()
      vi.unstubAllGlobals()
    }
  })

  it('decodes sensor reports and emits bounded display commands through the local adapter', async () => {
    const vm: VMWithPeripheralRegistry = await createVM() as VMWithPeripheralRegistry
    vi.stubGlobal('window', globalThis)
    let peripheral: MicroBitPeripheral | undefined

    try {
      await loadPreviewHardwareExtension(vm, 'microbit')
      const registeredPeripheral = vm.runtime.peripheralExtensions.microbit
      if (!registeredPeripheral) throw new Error('Scratch VM did not register the micro:bit peripheral')
      peripheral = registeredPeripheral

      const report = new Uint8Array([0x00, 0xfa, 0xfe, 0xd4, 1, 0, 0, 1, 0, 0b101])
      registeredPeripheral._onMessage(Buffer.from(report).toString('base64'))
      const primitive = (name: string): MicroBitPrimitive => {
        const fn = vm.runtime._primitives[`microbit_${name}`]
        if (!fn) throw new Error(`Scratch VM did not register micro:bit primitive ${name}`)
        return fn
      }
      expect(primitive('whenButtonPressed')({ BTN: 'A' }, {})).toBe(1)
      expect(primitive('whenButtonPressed')({ BTN: 'B' }, {})).toBe(0)
      expect(primitive('isButtonPressed')({ BTN: 'any' }, {})).toBe(true)
      expect(primitive('whenGesture')({ GESTURE: 'moved' }, {})).toBe(1)
      expect(primitive('whenGesture')({ GESTURE: 'shaken' }, {})).toBe(1)
      expect(primitive('whenGesture')({ GESTURE: 'jumped' }, {})).toBe(0)
      expect(primitive('getTiltAngle')({ DIRECTION: 'front' }, {})).toBe(30)
      expect(primitive('getTiltAngle')({ DIRECTION: 'back' }, {})).toBe(-30)
      expect(primitive('getTiltAngle')({ DIRECTION: 'left' }, {})).toBe(-25)
      expect(primitive('isTilted')({ DIRECTION: 'right' }, {})).toBe(true)
      expect(primitive('whenPinConnected')({ PIN: '1' }, {})).toBe(1)

      const matrices: number[][] = []
      const displayedText: string[] = []
      vi.spyOn(peripheral, 'displayMatrix').mockImplementation((matrix) => {
        matrices.push(Array.from(matrix))
      })
      vi.spyOn(peripheral, 'displayText').mockImplementation((text) => {
        displayedText.push(text)
      })
      vi.useFakeTimers()

      const symbol = primitive('displaySymbol')({ MATRIX: '11111 11111 11111 11111 11111' }, {}) as Promise<void>
      await vi.advanceTimersByTimeAsync(100)
      await symbol
      expect(matrices[0]).toEqual([31, 31, 31, 31, 31])

      const display = primitive('displayText')({ TEXT: '0123456789abcdefghijABCDEFGHIJ' }, {}) as Promise<void>
      expect(displayedText).toEqual(['0123456789abcdefghi'])
      await vi.advanceTimersByTimeAsync(120 * (6 * 19 + 6))
      await display

      const clear = primitive('displayClear')({}, {}) as Promise<void>
      await vi.advanceTimersByTimeAsync(100)
      await clear
      expect(matrices[1]).toEqual([0, 0, 0, 0, 0])
    } finally {
      peripheral?.reset()
      vm.quit()
      vi.clearAllTimers()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
